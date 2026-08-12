import {
  type EmailVerificationChallenge,
  EmailVerificationChallengeSchema,
  type SessionStatus,
  SessionStatusSchema,
} from "@aijob/contracts";

const baseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export class ProductApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = "ProductApiError";
  }
}

interface ProblemPayload {
  detail?: string;
  title?: string;
  code?: string;
  correlationId?: string;
}

export function cookieValue(cookieHeader: string, name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of cookieHeader.split(";")) {
    const candidate = part.trim();
    if (!candidate.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(candidate.slice(prefix.length));
    } catch {
      return null;
    }
  }
  return null;
}

function currentCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  return cookieValue(document.cookie, "aijob_csrf");
}

let sessionBootstrapPromise: Promise<void> | null = null;
let knownOwnerKey: string | null = null;
const sessionBoundaryListeners = new Set<() => void>();
const OWNER_CONTEXT_HEADER_NAME = "x-aijob-owner-context";

export function subscribeToSessionBoundary(listener: () => void): () => void {
  sessionBoundaryListeners.add(listener);
  return () => sessionBoundaryListeners.delete(listener);
}

function recordOwnerKey(nextOwnerKey: string | null, forceNotify = false): boolean {
  const changed = knownOwnerKey !== null && knownOwnerKey !== nextOwnerKey;
  knownOwnerKey = nextOwnerKey;
  if (!forceNotify && !changed) return false;
  for (const listener of sessionBoundaryListeners) listener();
  return true;
}

function recordSessionStatus(status: SessionStatus, forceNotify = false): boolean {
  const nextOwnerKey = status.authenticated ? `${status.owner.id}:${status.owner.epoch}` : null;
  return recordOwnerKey(nextOwnerKey, forceNotify);
}

async function requestSessionStatus(): Promise<SessionStatus> {
  const response = await fetch(`${baseUrl}/v1/session`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!response.ok) throw await readProblem(response);
  return SessionStatusSchema.parse(await response.json());
}

async function ensureSessionBootstrap(): Promise<void> {
  if (currentCsrfToken()) return;
  if (!sessionBootstrapPromise) {
    sessionBootstrapPromise = (async () => {
      recordSessionStatus(await requestSessionStatus());
    })().finally(() => {
      sessionBootstrapPromise = null;
    });
  }
  await sessionBootstrapPromise;
}

async function readProblem(response: Response): Promise<ProductApiError> {
  let payload: ProblemPayload = {};
  try {
    payload = (await response.json()) as ProblemPayload;
  } catch {
    // HTML/proxy failures are deliberately reduced to the HTTP status.
  }
  return new ProductApiError(
    payload.detail || payload.title || `请求失败（HTTP ${response.status}）`,
    response.status,
    payload.code,
    payload.correlationId,
  );
}

async function ensureCsrfToken(): Promise<string> {
  const existing = currentCsrfToken();
  if (existing) return existing;

  await ensureSessionBootstrap();

  const token = currentCsrfToken();
  if (!token) {
    throw new ProductApiError(
      "匿名会话的安全令牌没有建立，请确认 web-api 正在本机运行后刷新页面。",
      403,
      "CSRF_COOKIE_MISSING",
    );
  }
  return token;
}

export function createIdempotencyKey(prefix = "web"): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${suffix}`;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal | undefined;
  idempotencyKey?: string;
  headers?: HeadersInit;
}

function isMutation(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function isSessionBoundaryProblem(error: ProductApiError): boolean {
  return error.code === "SESSION_REQUIRED" || error.code === "CSRF_REJECTED";
}

async function recoverSessionBoundary(forceNotify: boolean): Promise<boolean> {
  try {
    const status = await requestSessionStatus();
    recordSessionStatus(status, forceNotify);
    return status.authenticated;
  } catch {
    recordSessionStatus({ authenticated: false }, forceNotify);
    return false;
  }
}

async function apiRequestInternal<T>(
  path: string,
  options: ApiRequestOptions,
  recoveryAttempted: boolean,
): Promise<T> {
  const method = options.method ?? "GET";
  if (typeof document !== "undefined" && path !== "/v1/session" && !currentCsrfToken()) {
    await ensureSessionBootstrap();
  }
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (isMutation(method)) {
    headers.set("x-csrf-token", await ensureCsrfToken());
  }
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }

  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    credentials: "same-origin",
    ...(body ? { body } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const responseOwnerKey = response.headers.get(OWNER_CONTEXT_HEADER_NAME);
  const boundaryNotified = responseOwnerKey ? recordOwnerKey(responseOwnerKey) : false;
  if (!response.ok) {
    const problem = await readProblem(response);
    if (!recoveryAttempted && isSessionBoundaryProblem(problem)) {
      const recovered = await recoverSessionBoundary(!boundaryNotified);
      if (recovered && !isMutation(method)) {
        return apiRequestInternal<T>(path, options, true);
      }
      if (recovered && isMutation(method)) {
        throw new ProductApiError(
          "本机会话已经更新。系统没有自动重放刚才的修改，请核对页面内容后再次提交。",
          409,
          "SESSION_RECOVERED_RETRY_REQUIRED",
          problem.correlationId,
        );
      }
    }
    throw problem;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequestInternal<T>(path, options, false);
}

export interface ApiDownload {
  blob: Blob;
  fileName: string | null;
}

function downloadFileName(contentDisposition: string | null): string | null {
  const encoded = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

async function apiDownloadInternal(
  path: string,
  signal: AbortSignal | undefined,
  recoveryAttempted: boolean,
): Promise<ApiDownload> {
  if (typeof document !== "undefined" && !currentCsrfToken()) {
    await ensureSessionBootstrap();
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    credentials: "same-origin",
    ...(signal ? { signal } : {}),
  });
  const responseOwnerKey = response.headers.get(OWNER_CONTEXT_HEADER_NAME);
  const boundaryNotified = responseOwnerKey ? recordOwnerKey(responseOwnerKey) : false;
  if (!response.ok) {
    const problem = await readProblem(response);
    if (!recoveryAttempted && isSessionBoundaryProblem(problem)) {
      const recovered = await recoverSessionBoundary(!boundaryNotified);
      if (recovered) return apiDownloadInternal(path, signal, true);
    }
    throw problem;
  }
  return {
    blob: await response.blob(),
    fileName: downloadFileName(response.headers.get("Content-Disposition")),
  };
}

export function apiDownload(path: string, signal?: AbortSignal): Promise<ApiDownload> {
  return apiDownloadInternal(path, signal, false);
}

export function getSessionStatus(signal?: AbortSignal): Promise<SessionStatus> {
  return apiRequest<SessionStatus>("/v1/session", { signal }).then((status) => {
    recordSessionStatus(status);
    return status;
  });
}

export async function createEmailVerificationChallenge(
  email: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<EmailVerificationChallenge> {
  const response = await fetch(`${baseUrl}/v1/email-verification-challenges`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    credentials: "same-origin",
    body: JSON.stringify({ purpose: "sign_in", email }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await readProblem(response);
  return EmailVerificationChallengeSchema.parse(await response.json());
}

export async function completeEmailVerification(
  input: { challengeId: string; email: string; verificationCode: string },
  signal?: AbortSignal,
): Promise<SessionStatus> {
  const response = await fetch(`${baseUrl}/v1/email-verification-challenges/complete`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify({ purpose: "sign_in", ...input }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await readProblem(response);
  const status = SessionStatusSchema.parse(await response.json());
  recordSessionStatus(status);
  return status;
}

export function createOwnerClaimChallenge(
  input: { email: string; expectedOwnerEpoch: number },
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<EmailVerificationChallenge> {
  return apiRequest<EmailVerificationChallenge>("/v1/email-verification-challenges", {
    method: "POST",
    body: { purpose: "claim_owner", ...input },
    idempotencyKey,
    signal,
  }).then((challenge) => EmailVerificationChallengeSchema.parse(challenge));
}

export function completeOwnerClaim(
  input: {
    challengeId: string;
    email: string;
    verificationCode: string;
    expectedOwnerEpoch: number;
  },
  signal?: AbortSignal,
): Promise<SessionStatus> {
  return apiRequest<SessionStatus>("/v1/email-verification-challenges/complete", {
    method: "POST",
    body: { purpose: "claim_owner", ...input },
    signal,
  }).then((response) => {
    const status = SessionStatusSchema.parse(response);
    recordSessionStatus(status);
    return status;
  });
}

export function fileDownloadUrl(path: string): string {
  return `${baseUrl}${path}`;
}
