import { timingSafeEqual } from "node:crypto";
import type { AppEnvironment } from "@aijob/config";
import type { Database } from "@aijob/database";
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { ApiProblem, sendApiProblem } from "./http.js";
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

declare module "fastify" {
  interface FastifyRequest {
    ownerContext: OwnerContext | null;
  }
}

export interface AnonymousIdentityOptions {
  db: Kysely<Database>;
  appEnv: AppEnvironment;
  host: string;
  acceptedOrigins?: readonly string[];
  alphaInviteCodeHashes?: readonly string[];
  now?: () => Date;
}

const AlphaInviteRequestSchema = z
  .object({
    inviteCode: z.string().trim().min(16).max(256),
  })
  .strict();
const ALPHA_INVITE_FAILURE_WINDOW_MS = 15 * 60 * 1_000;
const ALPHA_INVITE_MAX_FAILURES = 5;

interface InviteFailureWindow {
  startedAtMs: number;
  failures: number;
}

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
): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  if (acceptedOrigins.includes(origin)) return true;

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
  const actual = Buffer.from(hashOpaqueToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function shouldHandleIdentity(request: FastifyRequest): boolean {
  return request.url === "/v1" || request.url.startsWith("/v1/");
}

function isDeletionReceiptStatusRequest(request: FastifyRequest): boolean {
  return (
    request.method === "GET" &&
    (request.url === "/v1/profile/deletion" || request.url.startsWith("/v1/profile/deletion?"))
  );
}

function shouldSkipAutomaticBootstrap(request: FastifyRequest): boolean {
  return isDeletionReceiptStatusRequest(request);
}

function isAlphaSessionCreation(request: FastifyRequest, appEnv: AppEnvironment): boolean {
  return appEnv === "alpha" && request.method === "POST" && request.url === "/v1/session";
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
    sameSite: "lax",
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

function inviteCodeAllowed(code: string, expectedHashes: readonly string[]): boolean {
  let matched = false;
  for (const expectedHash of expectedHashes) {
    matched = tokenHashMatches(code, expectedHash) || matched;
  }
  return matched;
}

export function clearIdentityCookies(reply: FastifyReply, appEnv: AppEnvironment): void {
  const secure = cookieSecurity(appEnv);
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
  });
  reply.clearCookie(CSRF_COOKIE_NAME, {
    path: "/",
    httpOnly: false,
    sameSite: "strict",
    secure,
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

/**
 * Install before product routes. `@fastify/cookie` is registered first so its
 * request/reply decorators are ready before the identity hook executes.
 */
export function installAnonymousIdentity(
  app: FastifyInstance,
  options: AnonymousIdentityOptions,
): void {
  const inviteFailures = new Map<string, InviteFailureWindow>();
  app.register(cookie);
  app.decorateRequest("ownerContext", null);

  app.addHook("onRequest", async (request, reply) => {
    if (!shouldHandleIdentity(request)) return;

    const now = options.now?.() ?? new Date();
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    let context = sessionToken
      ? await findActiveSession({ db: options.db, sessionToken, now })
      : null;

    if (!context && sessionToken) {
      clearIdentityCookies(reply, options.appEnv);
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
    if (isAlphaSessionCreation(request, options.appEnv)) {
      if (!requestOriginAllowed(request, options.acceptedOrigins ?? [])) {
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
    if (!requestOriginAllowed(request, options.acceptedOrigins ?? [])) {
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

  if (options.appEnv === "alpha") {
    app.post("/v1/session", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
      if (request.ownerContext) {
        return projectSessionStatus({ db: options.db, context: request.ownerContext });
      }

      const now = options.now?.() ?? new Date();
      const nowMs = now.getTime();
      const failureKey = request.ip;
      const currentWindow = inviteFailures.get(failureKey);
      if (
        currentWindow &&
        nowMs - currentWindow.startedAtMs < ALPHA_INVITE_FAILURE_WINDOW_MS &&
        currentWindow.failures >= ALPHA_INVITE_MAX_FAILURES
      ) {
        throw new ApiProblem(
          403,
          "ALPHA_INVITE_REJECTED",
          "访问凭证未通过校验",
          "请确认访问凭证后稍后重试。",
        );
      }

      const parsed = AlphaInviteRequestSchema.safeParse(request.body);
      const allowed =
        parsed.success &&
        inviteCodeAllowed(parsed.data.inviteCode, options.alphaInviteCodeHashes ?? []);
      if (!allowed) {
        const withinWindow =
          currentWindow && nowMs - currentWindow.startedAtMs < ALPHA_INVITE_FAILURE_WINDOW_MS;
        inviteFailures.set(failureKey, {
          startedAtMs: withinWindow ? currentWindow.startedAtMs : nowMs,
          failures: withinWindow ? currentWindow.failures + 1 : 1,
        });
        throw new ApiProblem(
          403,
          "ALPHA_INVITE_REJECTED",
          "访问凭证未通过校验",
          "请确认访问凭证后重试。",
        );
      }

      inviteFailures.delete(failureKey);
      const created = await createAnonymousSession({ db: options.db, now });
      request.ownerContext = created.context;
      setIdentityCookies(reply, options.appEnv, created);
      return reply
        .code(201)
        .send(await projectSessionStatus({ db: options.db, context: created.context }));
    });
  }
}
