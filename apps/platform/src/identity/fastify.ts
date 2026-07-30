import { timingSafeEqual } from "node:crypto";
import type { AppEnvironment } from "@aijob/config";
import type { Database } from "@aijob/database";
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import { ApiProblem, sendApiProblem } from "./http.js";
import {
  createAnonymousSession,
  findActiveSession,
  hashOpaqueToken,
  type OwnerContext,
} from "./session-repository.js";

export const SESSION_COOKIE_NAME = "aijob_session";
export const CSRF_COOKIE_NAME = "aijob_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

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
  now?: () => Date;
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

function shouldSkipAutomaticBootstrap(request: FastifyRequest): boolean {
  return request.method === "GET" && request.url.startsWith("/v1/profile/deletion");
}

function cookieSecurity(appEnv: AppEnvironment) {
  return appEnv === "alpha" || appEnv === "production";
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
      const secure = cookieSecurity(options.appEnv);
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
    }
    request.ownerContext = context;

    if (isSafeMethod(request.method)) return;
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
}
