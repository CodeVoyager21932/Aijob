import { lookup as dnsLookup } from "node:dns/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { canonicalJson, sha256 } from "../lib/canonical-json.js";
import type { SourceTarget } from "../sources/source-config.js";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * 采集器的可识别 User-Agent。ADR-0033 以站点公开访问政策为准入依据，
 * 因此必须用固定且可识别的 UA，并按同一 UA 解析 robots.txt。
 */
export const COLLECTOR_USER_AGENT = "AijobLocalProbe/0.1 (+official-source-review)";

/** robots.txt 中用于匹配本采集器的 product token（UA 首段，不含版本与注释）。 */
export const COLLECTOR_ROBOTS_TOKEN = "aijoblocalprobe";

export class NetworkPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly response?: SafeHttpResult,
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

export interface SafeRequestOptions {
  beforeRequest?: () => Promise<void> | void;
}

interface RequestSpec {
  method: "GET" | "POST";
  url: string;
  jsonBody?: unknown;
  formBody?: Record<string, string>;
}

const blockedIpv4Cidrs = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const;

const blockedIpv6Cidrs = [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const;

function ipv4Value(address: string): bigint | null {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function ipv6Value(address: string): bigint | null {
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    const embedded = ipv4Value(normalized.slice(separator + 1));
    if (separator < 0 || embedded === null) return null;
    normalized = `${normalized.slice(0, separator)}:${Number(embedded >> 16n).toString(16)}:${Number(
      embedded & 0xffffn,
    ).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function isInCidr(value: bigint, network: bigint, prefix: number, bits: number): boolean {
  const shift = BigInt(bits - prefix);
  return shift === 0n ? value === network : value >> shift === network >> shift;
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Value(address);
    return (
      value !== null &&
      !blockedIpv4Cidrs.some(([network, prefix]) => {
        const networkValue = ipv4Value(network);
        return networkValue !== null && isInCidr(value, networkValue, prefix, 32);
      })
    );
  }
  if (family !== 6) {
    return false;
  }

  const value = ipv6Value(address);
  return (
    value !== null &&
    !blockedIpv6Cidrs.some(([network, prefix]) => {
      const networkValue = ipv6Value(network);
      return networkValue !== null && isInCidr(value, networkValue, prefix, 128);
    })
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
  options: SafeRequestOptions,
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

  await options.beforeRequest?.();
  const response = await new Promise<{
    status: number;
    headers: IncomingHttpHeaders;
    body: Uint8Array;
  }>((resolve, reject) => {
    let settled = false;
    const settle = <T>(callback: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback(value);
    };
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
          "User-Agent": COLLECTOR_USER_AGENT,
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
          settle(resolve, {
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: Buffer.concat(chunks),
          });
        });
        incoming.on("error", (error) => settle(reject, error));
      },
    );
    const deadline = setTimeout(() => {
      request.destroy(new NetworkPolicyError("UPSTREAM_TIMEOUT", "Upstream request timed out"));
    }, REQUEST_TIMEOUT_MS);
    deadline.unref();
    request.on("error", (error) => settle(reject, error));
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
      options,
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
  options: SafeRequestOptions = {},
): Promise<SafeJsonHttpResult> {
  let lastResult: SafeHttpResult | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await requestOnce(spec, targets, "json", options);
      lastResult = result;
      if ((result.status === 429 || result.status >= 500) && attempt < 2) {
        await delay(retryDelayMs(result.responseHeaders, attempt));
        continue;
      }
      if (result.status < 200 || result.status >= 300) {
        throw new NetworkPolicyError(
          `UPSTREAM_HTTP_${result.status}`,
          `Upstream returned HTTP ${result.status}`,
          result,
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
      lastResult,
    );
  }
  throw lastError;
}

export async function safeRequestHtml(
  spec: RequestSpec,
  targets: SourceTarget[],
  options: SafeRequestOptions = {},
): Promise<SafeHtmlHttpResult> {
  let lastResult: SafeHttpResult | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await requestOnce(spec, targets, "html", options);
      lastResult = result;
      if ((result.status === 429 || result.status >= 500) && attempt < 2) {
        await delay(retryDelayMs(result.responseHeaders, attempt));
        continue;
      }
      if (result.status < 200 || result.status >= 300) {
        throw new NetworkPolicyError(
          `UPSTREAM_HTTP_${result.status}`,
          `Upstream returned HTTP ${result.status}`,
          result,
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
      lastResult,
    );
  }
  throw lastError;
}
