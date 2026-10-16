import type { AppEnvironment } from "@aijob/config";
import {
  CompleteEmailVerificationRequestSchema,
  CreateEmailVerificationChallengeRequestSchema,
  LocalRecoveryFileSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { ServiceError } from "../lib/service-error.js";
import {
  DisabledEmailVerificationDelivery,
  type EmailVerificationDelivery,
} from "./email-delivery.js";
import { secureHexEqual } from "./email-crypto.js";
import { EmailVerificationService } from "./email-verification-service.js";
import { ApiProblem, sendApiProblem } from "./http.js";
import { BROWSER_ACCESS_TTL_MS, LocalWebAccess } from "./local-web-access.js";
import {
  createAnonymousSession,
  findActiveSession,
  hashOpaqueToken,
  type OwnerContext,
  projectSessionStatus,
} from "./session-repository.js";

export const SESSION_COOKIE_NAME = "aijob_session";
export const CSRF_COOKIE_NAME = "aijob_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const OWNER_CONTEXT_HEADER_NAME = "x-aijob-owner-context";
export const BROWSER_ACCESS_COOKIE_NAME = "aijob_browser_access";

declare module "fastify" {
  interface FastifyRequest {
    ownerContext: OwnerContext | null;
    localBrowserRemembered: boolean;
  }
}

export interface AnonymousIdentityOptions {
  db: Kysely<Database>;
  appEnv: AppEnvironment;
  host: string;
  acceptedOrigins?: readonly string[];
  identityMasterKey?: string;
  invitedEmailHashes?: readonly string[];
  emailDelivery?: EmailVerificationDelivery;
  fixedVerificationCode?: string;
  now?: () => Date;
  localBrowserAccess?: boolean;
}

const IdempotencyKeySchema = z.string().trim().min(1).max(200);

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.startsWith("127.")
  );
}

function requestOriginAllowed(
  request: FastifyRequest,
  acceptedOrigins: readonly string[],
  allowLoopbackFallback: boolean,
): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  if (acceptedOrigins.includes(origin)) return true;
  if (!allowLoopbackFallback) return false;

  try {
    const parsed = new URL(origin);
    const hostHeader = request.headers.host?.toLowerCase();
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      isLoopbackHostname(parsed.hostname) &&
      parsed.host.toLowerCase() === hostHeader
    );
  } catch {
    return false;
  }
}

function tokenHashMatches(token: string, expectedHash: string): boolean {
  return secureHexEqual(hashOpaqueToken(token), expectedHash);
}

function shouldHandleIdentity(request: FastifyRequest): boolean {
  return /^\/v[12](?:\/|$)/u.test(request.url);
}

function isDeletionReceiptStatusRequest(request: FastifyRequest): boolean {
  return (
    request.method === "GET" &&
    (request.url === "/v1/profile/deletion" || request.url.startsWith("/v1/profile/deletion?"))
  );
}

function isEmailIdentityMutation(request: FastifyRequest): boolean {
  return (
    request.method === "POST" &&
    (request.url === "/v1/email-verification-challenges" ||
      request.url === "/v1/email-verification-challenges/complete")
  );
}

function shouldSkipAutomaticBootstrap(request: FastifyRequest): boolean {
  return (
    isDeletionReceiptStatusRequest(request) ||
    isEmailIdentityMutation(request) ||
    isLocalRecoveryRequest(request)
  );
}

function isLocalRecoveryRequest(request: FastifyRequest): boolean {
  return request.method === "POST" && request.url === "/v1/local-access/restore";
}

function isAlphaAnonymousReadAllowed(request: FastifyRequest): boolean {
  if (request.method === "OPTIONS") return true;
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return request.url === "/v1/session" || isDeletionReceiptStatusRequest(request);
}

function cookieSecurity(appEnv: AppEnvironment) {
  return appEnv === "alpha" || appEnv === "production";
}

function setIdentityCookies(
  reply: FastifyReply,
  appEnv: AppEnvironment,
  created: Awaited<ReturnType<typeof createAnonymousSession>>,
): void {
  const secure = cookieSecurity(appEnv);
  reply.setCookie(SESSION_COOKIE_NAME, created.sessionToken, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure,
    expires: created.context.sessionExpiresAt,
  });
  reply.setCookie(CSRF_COOKIE_NAME, created.csrfToken, {
    path: "/",
    httpOnly: false,
    sameSite: "strict",
    secure,
    expires: created.context.sessionExpiresAt,
  });
  reply.header(
    OWNER_CONTEXT_HEADER_NAME,
    `${created.context.ownerId}:${created.context.ownerEpoch}`,
  );
}

function clearSessionCookies(reply: FastifyReply, appEnv: AppEnvironment): void {
  const secure = cookieSecurity(appEnv);
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure,
  });
  reply.clearCookie(CSRF_COOKIE_NAME, {
    path: "/",
    httpOnly: false,
    sameSite: "strict",
    secure,
  });
}

export function clearIdentityCookies(reply: FastifyReply, appEnv: AppEnvironment): void {
  clearSessionCookies(reply, appEnv);
  reply.clearCookie(BROWSER_ACCESS_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: cookieSecurity(appEnv),
  });
}

function setBrowserCookie(reply: FastifyReply, credential: string, now: Date) {
  reply.setCookie(BROWSER_ACCESS_COOKIE_NAME, credential, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    expires: new Date(now.valueOf() + BROWSER_ACCESS_TTL_MS),
  });
}

export function requireOwnerContext(request: FastifyRequest): OwnerContext {
  if (!request.ownerContext) {
    throw new ApiProblem(
      401,
      "SESSION_REQUIRED",
      "需要有效的匿名会话",
      "请刷新页面建立新的本地匿名会话后重试。",
    );
  }
  return request.ownerContext;
}

function assertCsrfToken(request: FastifyRequest): void {
  const context = requireOwnerContext(request);
  const csrfToken = request.headers[CSRF_HEADER_NAME];
  if (typeof csrfToken !== "string" || !tokenHashMatches(csrfToken, context.csrfTokenHash)) {
    throw new ApiProblem(
      403,
      "CSRF_REJECTED",
      "安全校验失败",
      "页面安全令牌已失效，请刷新后重试。",
    );
  }
}

function handleIdentityRouteError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ApiProblem) return sendApiProblem(request, reply, error);
  if (error instanceof ServiceError) {
    return sendApiProblem(
      request,
      reply,
      new ApiProblem(error.statusCode, error.code, "无法完成邮箱验证", error.message),
    );
  }
  if (error instanceof z.ZodError) {
    return sendApiProblem(
      request,
      reply,
      new ApiProblem(
        400,
        "INVALID_EMAIL_VERIFICATION_REQUEST",
        "邮箱验证请求格式不正确",
        "请检查邮箱、验证码和请求编号后重试。",
      ),
    );
  }
  throw error;
}

/**
 * Install before product routes. `@fastify/cookie` is registered first so its
 * request/reply decorators are ready before the identity hook executes.
 */
export function installAnonymousIdentity(
  app: FastifyInstance,
  options: AnonymousIdentityOptions,
): void {
  const identityMasterKey =
    options.identityMasterKey ?? hashOpaqueToken("aijob-local-test-identity-master-v1");
  if (
    (options.appEnv === "alpha" || options.appEnv === "production") &&
    !options.identityMasterKey
  ) {
    throw new Error("IDENTITY_MASTER_KEY_REQUIRED");
  }
  const emailVerification = new EmailVerificationService({
    db: options.db,
    identityMasterKey,
    invitedEmailHashes: options.invitedEmailHashes ?? [],
    delivery: options.emailDelivery ?? new DisabledEmailVerificationDelivery(),
    ...(options.fixedVerificationCode
      ? { fixedVerificationCode: options.fixedVerificationCode }
      : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  app.register(cookie);
  app.decorateRequest("ownerContext", null);
  app.decorateRequest("localBrowserRemembered", false);
  const allowLoopbackOriginFallback = options.appEnv === "local" || options.appEnv === "test";
  const localAccess =
    options.appEnv === "local" &&
    isLoopbackHostname(options.host) &&
    options.localBrowserAccess !== false
      ? new LocalWebAccess(options.db)
      : null;

  app.addHook("onRequest", async (request, reply) => {
    if (!shouldHandleIdentity(request)) return;

    const now = options.now?.() ?? new Date();
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    let context = sessionToken
      ? await findActiveSession({ db: options.db, sessionToken, now })
      : null;

    if (!context && sessionToken) {
      clearSessionCookies(reply, options.appEnv);
    }
    if (!context && localAccess && !shouldSkipAutomaticBootstrap(request)) {
      const credential = request.cookies[BROWSER_ACCESS_COOKIE_NAME];
      const restored = credential ? await localAccess.restore(credential, "browser", now) : null;
      if (restored && credential) {
        context = restored.context;
        setIdentityCookies(reply, options.appEnv, restored);
        setBrowserCookie(reply, credential, now);
      }
    }

    const mayBootstrap =
      options.appEnv === "local" || options.appEnv === "test"
        ? isLoopbackHostname(options.host)
        : false;
    if (!context && mayBootstrap && !shouldSkipAutomaticBootstrap(request)) {
      const created = await createAnonymousSession({ db: options.db, now });
      context = created.context;
      setIdentityCookies(reply, options.appEnv, created);
    }
    if (
      context &&
      localAccess &&
      !shouldSkipAutomaticBootstrap(request) &&
      request.method !== "DELETE"
    ) {
      const credential = await localAccess.remember(
        context,
        request.cookies[BROWSER_ACCESS_COOKIE_NAME],
        now,
      );
      if (credential) setBrowserCookie(reply, credential, now);
      request.localBrowserRemembered = true;
    }
    request.ownerContext = context;
    if (context) {
      reply.header(OWNER_CONTEXT_HEADER_NAME, `${context.ownerId}:${context.ownerEpoch}`);
    }

    if (
      options.appEnv === "alpha" &&
      !context &&
      isSafeMethod(request.method) &&
      !isAlphaAnonymousReadAllowed(request)
    ) {
      return sendApiProblem(
        request,
        reply,
        new ApiProblem(
          401,
          "SESSION_REQUIRED",
          "需要有效的匿名会话",
          "请先使用 Private Alpha 访问凭证进入 Aijob。",
        ),
      );
    }
    if (isSafeMethod(request.method)) return;
    if (isEmailIdentityMutation(request) || isLocalRecoveryRequest(request)) {
      if (
        !requestOriginAllowed(request, options.acceptedOrigins ?? [], allowLoopbackOriginFallback)
      ) {
        return sendApiProblem(
          request,
          reply,
          new ApiProblem(
            403,
            "ORIGIN_REJECTED",
            "请求来源未通过校验",
            "请只从当前 Aijob 页面发起访问请求。",
          ),
        );
      }
      return;
    }
    if (!context) {
      return sendApiProblem(
        request,
        reply,
        new ApiProblem(401, "SESSION_REQUIRED", "需要有效的匿名会话", "请先刷新页面建立匿名会话。"),
      );
    }
    if (
      !requestOriginAllowed(request, options.acceptedOrigins ?? [], allowLoopbackOriginFallback)
    ) {
      return sendApiProblem(
        request,
        reply,
        new ApiProblem(
          403,
          "ORIGIN_REJECTED",
          "请求来源未通过校验",
          "请只从当前 Aijob 页面发起修改请求。",
        ),
      );
    }
    const csrfToken = request.headers[CSRF_HEADER_NAME];
    if (typeof csrfToken !== "string" || !tokenHashMatches(csrfToken, context.csrfTokenHash)) {
      return sendApiProblem(
        request,
        reply,
        new ApiProblem(403, "CSRF_REJECTED", "安全校验失败", "页面安全令牌已失效，请刷新后重试。"),
      );
    }
  });

  app.get("/v1/session", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Pragma", "no-cache");
    return projectSessionStatus({ db: options.db, context: request.ownerContext });
  });

  app.get("/v1/local-access", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!localAccess) return { enabled: false };
    return {
      enabled: true,
      browserRemembered: request.localBrowserRemembered,
      recoveryCreatedAt: request.ownerContext
        ? await localAccess.recoveryCreatedAt(request.ownerContext)
        : null,
    };
  });

  if (localAccess) {
    app.post("/v1/local-access/recovery-file", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return localAccess.createRecoveryFile(
        requireOwnerContext(request),
        options.now?.() ?? new Date(),
      );
    });
    app.post("/v1/local-access/restore", { bodyLimit: 2048 }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const parsed = LocalRecoveryFileSchema.pick({ recoveryKey: true }).safeParse(request.body);
      const now = options.now?.() ?? new Date();
      const restored = parsed.success
        ? await localAccess.restore(parsed.data.recoveryKey, "recovery", now)
        : null;
      if (!restored)
        return sendApiProblem(
          request,
          reply,
          new ApiProblem(
            401,
            "LOCAL_RECOVERY_INVALID",
            "无法恢复资料",
            "恢复文件无效、已被重新生成，或对应资料已删除。请使用最新的恢复文件。",
          ),
        );
      // A successful explicit sign-in replaces this browser's remembered identity only.
      await localAccess.forgetBrowser(request.cookies[BROWSER_ACCESS_COOKIE_NAME], now);
      const credential = await localAccess.remember(restored.context, undefined, now);
      setIdentityCookies(reply, options.appEnv, restored);
      if (credential) setBrowserCookie(reply, credential, now);
      return projectSessionStatus({ db: options.db, context: restored.context });
    });
  }

  app.post("/v1/email-verification-challenges", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Pragma", "no-cache");
    try {
      const parsed = CreateEmailVerificationChallengeRequestSchema.parse(request.body);
      if (parsed.purpose === "claim_owner") {
        requireOwnerContext(request);
        assertCsrfToken(request);
      }
      const idempotencyKey = IdempotencyKeySchema.parse(request.headers["idempotency-key"]);
      const challenge = await emailVerification.createChallenge({
        request: parsed,
        context: request.ownerContext,
        idempotencyKey,
      });
      return reply.code(202).send(challenge);
    } catch (error) {
      return handleIdentityRouteError(error, request, reply);
    }
  });

  app.post("/v1/email-verification-challenges/complete", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Pragma", "no-cache");
    try {
      const parsed = CompleteEmailVerificationRequestSchema.parse(request.body);
      if (parsed.purpose === "claim_owner") {
        requireOwnerContext(request);
        assertCsrfToken(request);
      }
      const completed = await emailVerification.completeChallenge({
        request: parsed,
        context: request.ownerContext,
      });
      request.ownerContext = completed.credentials.context;
      setIdentityCookies(reply, options.appEnv, completed.credentials);
      if (localAccess) {
        const now = options.now?.() ?? new Date();
        await localAccess.forgetBrowser(request.cookies[BROWSER_ACCESS_COOKIE_NAME], now);
        const credential = await localAccess.remember(
          completed.credentials.context,
          undefined,
          now,
        );
        if (credential) setBrowserCookie(reply, credential, now);
      }
      return reply.code(200).send(completed.session);
    } catch (error) {
      return handleIdentityRouteError(error, request, reply);
    }
  });

  app.delete("/v1/session", async (request, reply) => {
    const context = requireOwnerContext(request);
    if (localAccess)
      await localAccess.forgetBrowser(
        request.cookies[BROWSER_ACCESS_COOKIE_NAME],
        options.now?.() ?? new Date(),
      );
    await options.db
      .updateTable("identity.owner_sessions")
      .set({ revoked_at: options.now?.() ?? new Date() })
      .where("id", "=", context.sessionId)
      .where("owner_id", "=", context.ownerId)
      .execute();
    clearIdentityCookies(reply, options.appEnv);
    return reply.code(204).send();
  });
}
