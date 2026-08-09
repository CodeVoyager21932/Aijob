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

async function ensureSessionBootstrap(): Promise<void> {
  if (currentCsrfToken()) return;
  if (!sessionBootstrapPromise) {
    sessionBootstrapPromise = (async () => {
      const response = await fetch(`${baseUrl}/v1/session`, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      if (!response.ok) throw await readProblem(response);
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

export interface SessionStatus {
  authenticated: boolean;
}

function isMutation(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
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
  if (!response.ok) throw await readProblem(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getSessionStatus(signal?: AbortSignal): Promise<SessionStatus> {
  return apiRequest<SessionStatus>("/v1/session", { signal });
}

export async function createAlphaSession(
  inviteCode: string,
  signal?: AbortSignal,
): Promise<SessionStatus> {
  const response = await fetch(`${baseUrl}/v1/session`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify({ inviteCode }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as SessionStatus;
}

export function fileDownloadUrl(path: string): string {
  return `${baseUrl}${path}`;
}
