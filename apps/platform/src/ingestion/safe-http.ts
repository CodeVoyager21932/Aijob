import { lookup as dnsLookup } from "node:dns/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { canonicalJson, sha256 } from "../lib/canonical-json.js";
import type { SourceTarget } from "../sources/source-config.js";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const REQUEST_TIMEOUT_MS = 15_000;

export class NetworkPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NetworkPolicyError";
  }
}

export interface SafeHttpResult {
  requestUrl: string;
  finalUrl: string;
  method: "GET" | "POST";
  status: number;
  contentType: string;
  responseHeaders: Record<string, string>;
  requestFingerprint: string;
  body: Uint8Array;
}

export interface SafeJsonHttpResult extends SafeHttpResult {
  json: unknown;
}

export interface SafeHtmlHttpResult extends SafeHttpResult {
  text: string;
}

interface RequestSpec {
  method: "GET" | "POST";
  url: string;
  jsonBody?: unknown;
  formBody?: Record<string, string>;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [first = 0, second = 0] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return !isPrivateIpv4(address);
  }
  if (family !== 6) {
    return false;
  }

  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPublicIp(normalized.slice("::ffff:".length));
  }
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff")
  );
}

function pathMatches(pathname: string, pathPrefix: string): boolean {
  if (pathname === pathPrefix) {
    return true;
  }
  return pathPrefix.endsWith("/") && pathname.startsWith(pathPrefix);
}

function validateQueryParameters(url: URL, target: SourceTarget): void {
  const allowed = new Set(target.allowedQueryParameters);
  for (const parameter of url.searchParams.keys()) {
    if (!allowed.has(parameter)) {
      throw new NetworkPolicyError(
        "QUERY_PARAMETER_NOT_ALLOWLISTED",
        `Query parameter ${parameter} is not allowlisted for ${url.origin}${url.pathname}`,
      );
    }
  }
}

function validateRequestTarget(
  rawUrl: string,
  method: "GET" | "POST",
  targets: SourceTarget[],
  allowFragment = false,
): { url: URL; target: SourceTarget } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new NetworkPolicyError("INVALID_URL", `Invalid URL: ${rawUrl}`);
  }

  if (url.username || url.password || (!allowFragment && url.hash)) {
    throw new NetworkPolicyError(
      "URL_CREDENTIALS_OR_FRAGMENT",
      "URL credentials and fragments are forbidden",
    );
  }

  const port = url.port ? Number(url.port) : 443;
  const target = targets.find(
    (target) =>
      target.method === method &&
      target.scheme === url.protocol.slice(0, -1) &&
      target.host.toLowerCase() === url.hostname.toLowerCase() &&
      target.port === port &&
      pathMatches(url.pathname, target.pathPrefix),
  );

  if (!target) {
    throw new NetworkPolicyError(
      "TARGET_NOT_ALLOWLISTED",
      `${method} ${url.origin}${url.pathname} is not allowlisted`,
    );
  }

  validateQueryParameters(url, target);
  return { url, target };
}

export function validateUrl(rawUrl: string, method: "GET" | "POST", targets: SourceTarget[]): URL {
  return validateRequestTarget(rawUrl, method, targets).url;
}

/**
 * Validates an outbound user-navigation URL without issuing a request. The
 * fragment is allowed because it is interpreted only by the destination page
 * and is never part of an HTTP request. Scheme, host, port, path and query
 * parameters remain subject to the exact source policy allowlist.
 */
export function validateNavigationUrl(
  rawUrl: string,
  method: "GET" | "POST",
  targets: SourceTarget[],
): URL {
  return validateRequestTarget(rawUrl, method, targets, true).url;
}

export function assertRedirectAllowed(target: SourceTarget): void {
  if (target.allowRedirects !== true) {
    throw new NetworkPolicyError(
      "REDIRECT_NOT_ALLOWED",
      "Upstream redirect is forbidden by the source target policy",
    );
  }
}

async function selectPublicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  if (isIP(hostname)) {
    if (!isPublicIp(hostname)) {
      throw new NetworkPolicyError("PRIVATE_IP_BLOCKED", "Private and special-use IPs are blocked");
    }
    return { address: hostname, family: isIP(hostname) as 4 | 6 };
  }

  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new NetworkPolicyError("DNS_EMPTY", `No DNS records for ${hostname}`);
  }
  if (addresses.some((entry) => !isPublicIp(entry.address))) {
    throw new NetworkPolicyError(
      "DNS_PRIVATE_IP_BLOCKED",
      `DNS response for ${hostname} contains a private or special-use address`,
    );
  }

  const selected = addresses[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6)) {
    throw new NetworkPolicyError("DNS_FAMILY_UNSUPPORTED", "Unsupported DNS address family");
  }
  return { address: selected.address, family: selected.family };
}

function safeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const allowed = ["content-type", "etag", "last-modified", "retry-after"];
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = headers[name];
      if (typeof value === "string") {
        return [[name, value]];
      }
      if (Array.isArray(value)) {
        return [[name, value.join(", ")]];
      }
      return [];
    }),
  );
}

async function requestOnce(
  spec: RequestSpec,
  targets: SourceTarget[],
  responseKind: "json" | "html",
  redirectCount = 0,
): Promise<SafeHttpResult> {
  const { url, target } = validateRequestTarget(spec.url, spec.method, targets);
  const selectedAddress = await selectPublicAddress(url.hostname);
  if (spec.jsonBody !== undefined && spec.formBody !== undefined) {
    throw new NetworkPolicyError(
      "REQUEST_BODY_AMBIGUOUS",
      "A POST request must use either jsonBody or formBody, not both",
    );
  }
  const requestBody =
    spec.method === "POST"
      ? spec.formBody !== undefined
        ? Buffer.from(new URLSearchParams(spec.formBody).toString(), "utf8")
        : Buffer.from(canonicalJson(spec.jsonBody ?? {}), "utf8")
      : undefined;
  const requestContentType =
    spec.formBody !== undefined
      ? "application/x-www-form-urlencoded;charset=UTF-8"
      : "application/json;charset=UTF-8";

  const response = await new Promise<{
    status: number;
    headers: IncomingHttpHeaders;
    body: Uint8Array;
  }>((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: "https:",
        // Connect to the already validated address while keeping the original Host/SNI.
        // This closes the DNS-rebinding window between policy validation and connection.
        hostname: selectedAddress.address,
        family: selectedAddress.family,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: spec.method,
        headers: {
          Accept:
            responseKind === "json" ? "application/json" : "text/html,application/xhtml+xml;q=0.9",
          "Accept-Encoding": "identity",
          Host: url.host,
          "User-Agent": "AijobLocalProbe/0.1 (+official-source-review)",
          ...(requestBody
            ? {
                "Content-Length": requestBody.byteLength,
                "Content-Type": requestContentType,
              }
            : {}),
        },
        servername: url.hostname,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let received = 0;
        incoming.on("data", (chunk: Buffer) => {
          received += chunk.byteLength;
          if (received > MAX_RESPONSE_BYTES) {
            incoming.destroy(
              new NetworkPolicyError("RESPONSE_TOO_LARGE", "Response exceeded 5 MiB"),
            );
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("end", () => {
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: Buffer.concat(chunks),
          });
        });
        incoming.on("error", reject);
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new NetworkPolicyError("UPSTREAM_TIMEOUT", "Upstream request timed out"));
    });
    request.on("error", reject);
    if (requestBody) {
      request.write(requestBody);
    }
    request.end();
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    assertRedirectAllowed(target);
    if (redirectCount >= MAX_REDIRECTS) {
      throw new NetworkPolicyError("TOO_MANY_REDIRECTS", "Too many upstream redirects");
    }
    const location = response.headers.location;
    if (!location) {
      throw new NetworkPolicyError("REDIRECT_WITHOUT_LOCATION", "Redirect has no Location header");
    }
    const redirectedUrl = new URL(location, url).toString();
    const redirectedMethod = response.status === 303 ? "GET" : spec.method;
    return requestOnce(
      {
        method: redirectedMethod,
        url: redirectedUrl,
        ...(redirectedMethod === "POST"
          ? { jsonBody: spec.jsonBody, formBody: spec.formBody }
          : {}),
      },
      targets,
      responseKind,
      redirectCount + 1,
    );
  }

  const contentType = response.headers["content-type"] ?? "";
  const normalizedContentType = contentType.toLowerCase();
  const expectedContentType =
    responseKind === "json"
      ? normalizedContentType.includes("application/json")
      : normalizedContentType.includes("text/html") ||
        normalizedContentType.includes("application/xhtml+xml");
  if (!expectedContentType) {
    throw new NetworkPolicyError(
      "UNEXPECTED_CONTENT_TYPE",
      `Expected ${responseKind.toUpperCase()} but received ${contentType || "unknown"}`,
    );
  }

  return {
    requestUrl: spec.url,
    finalUrl: url.toString(),
    method: spec.method,
    status: response.status,
    contentType,
    responseHeaders: safeHeaders(response.headers),
    requestFingerprint: sha256(
      canonicalJson({
        method: spec.method,
        url: spec.url,
        body:
          spec.method === "POST"
            ? spec.formBody !== undefined
              ? spec.formBody
              : spec.jsonBody
            : null,
        responseKind,
      }),
    ),
    body: response.body,
  };
}

function retryDelayMs(headers: Record<string, string>, attempt: number): number {
  const retryAfter = headers["retry-after"];
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    return Math.min(Number(retryAfter) * 1000, 5_000);
  }
  return Math.min(500 * 2 ** attempt, 2_000);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function safeRequestJson(
  spec: RequestSpec,
  targets: SourceTarget[],
): Promise<SafeJsonHttpResult> {
  let lastResult: SafeHttpResult | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await requestOnce(spec, targets, "json");
      lastResult = result;
      if ((result.status === 429 || result.status >= 500) && attempt < 2) {
        await delay(retryDelayMs(result.responseHeaders, attempt));
        continue;
      }
      if (result.status < 200 || result.status >= 300) {
        throw new NetworkPolicyError(
          `UPSTREAM_HTTP_${result.status}`,
          `Upstream returned HTTP ${result.status}`,
        );
      }

      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.body));
      } catch {
        throw new NetworkPolicyError("INVALID_JSON", "Upstream response is not valid UTF-8 JSON");
      }
      return { ...result, json };
    } catch (error) {
      lastError = error;
      const retryable =
        !(error instanceof NetworkPolicyError) ||
        ["UPSTREAM_TIMEOUT", "ECONNRESET", "ETIMEDOUT"].includes(error.code);
      if (!retryable || attempt >= 2) {
        throw error;
      }
      await delay(500 * 2 ** attempt);
    }
  }

  if (lastResult) {
    throw new NetworkPolicyError(
      `UPSTREAM_HTTP_${lastResult.status}`,
      `Upstream returned HTTP ${lastResult.status}`,
    );
  }
  throw lastError;
}

export async function safeRequestHtml(
  spec: RequestSpec,
  targets: SourceTarget[],
): Promise<SafeHtmlHttpResult> {
  let lastResult: SafeHttpResult | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await requestOnce(spec, targets, "html");
      lastResult = result;
      if ((result.status === 429 || result.status >= 500) && attempt < 2) {
        await delay(retryDelayMs(result.responseHeaders, attempt));
        continue;
      }
      if (result.status < 200 || result.status >= 300) {
        throw new NetworkPolicyError(
          `UPSTREAM_HTTP_${result.status}`,
          `Upstream returned HTTP ${result.status}`,
        );
      }

      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(result.body);
      } catch {
        throw new NetworkPolicyError("INVALID_HTML", "Upstream response is not valid UTF-8 HTML");
      }
      return { ...result, text };
    } catch (error) {
      lastError = error;
      const retryable =
        !(error instanceof NetworkPolicyError) ||
        ["UPSTREAM_TIMEOUT", "ECONNRESET", "ETIMEDOUT"].includes(error.code);
      if (!retryable || attempt >= 2) {
        throw error;
      }
      await delay(500 * 2 ** attempt);
    }
  }

  if (lastResult) {
    throw new NetworkPolicyError(
      `UPSTREAM_HTTP_${lastResult.status}`,
      `Upstream returned HTTP ${lastResult.status}`,
    );
  }
  throw lastError;
}
