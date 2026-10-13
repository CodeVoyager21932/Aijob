import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import { isPublicIp } from "../ingestion/safe-http.js";
import { ServiceError } from "../lib/service-error.js";

/** Pin the validated address to the TLS connection; never resolve a user host twice. */
export const userProviderFetch: typeof fetch = async (resource, init) => {
  const url = new URL(resource instanceof Request ? resource.url : String(resource));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.port && url.port !== "443")
  ) {
    throw new ServiceError(422, "AI_ENDPOINT_INVALID", "请使用 HTTPS API 地址。");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((address) => !isPublicIp(address.address))) {
    throw new ServiceError(
      422,
      "AI_ENDPOINT_UNAVAILABLE",
      "这个接口地址无法从服务器连接，请检查公开 API 地址。",
    );
  }
  const selected = addresses[0]!;
  if (init?.signal?.aborted) throw new Error("AI_REQUEST_ABORTED");
  return new Promise<Response>((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const req = request(
      url,
      {
        method: init?.method ?? "POST",
        headers,
        agent: false,
        family: selected.family,
        lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
        ...(init?.signal ? { signal: init.signal } : {}),
      },
      (res) => {
        if ((res.statusCode ?? 500) >= 300 && (res.statusCode ?? 500) < 400) {
          res.destroy();
          reject(
            new ServiceError(422, "AI_REDIRECT_BLOCKED", "接口返回了跳转，请填写最终 API 地址。"),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1000000) {
            res.destroy();
            reject(new Error("AI_RESPONSE_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 502,
              headers: { "content-type": "application/json" },
            }),
          ),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(120000, () => req.destroy(new Error("AI_REQUEST_TIMEOUT")));
    req.end(typeof init?.body === "string" ? init.body : undefined);
  });
};
