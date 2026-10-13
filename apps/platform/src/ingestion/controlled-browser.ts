import { chromium } from "playwright-core";
import type { SourceTarget } from "../sources/source-config.js";
import {
  safeRequestResource,
  type SafeHttpResult,
  type SafeRequestOptions,
  NetworkPolicyError,
} from "./safe-http.js";

export interface RenderedSourcePage {
  html: string;
  responses: SafeHttpResult[];
}

/** Runs only in collector-worker. Browser itself has a dead proxy; all allowed HTTP
 * passes through safe-http, which pins DNS and carries neither cookies nor credentials. */
export async function renderControlledPage(input: {
  url: string;
  executablePath: string;
  targets: SourceTarget[];
  readySelector: string;
  requestOptions: SafeRequestOptions;
  timeoutMs?: number;
}): Promise<RenderedSourcePage> {
  const browser = await chromium.launch({
    executablePath: input.executablePath,
    headless: true,
    chromiumSandbox: process.platform === "linux",
    proxy: { server: "http://127.0.0.1:9", bypass: "<-loopback>" },
    args: [
      "--disable-background-networking",
      "--disable-quic",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
  });
  try {
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
    const responses: SafeHttpResult[] = [];
    let fatal: Error | undefined;
    // Serial dispatch also applies one source budget across concurrent page subrequests.
    let chain = Promise.resolve();
    await context.route("**/*", (route) => {
      chain = chain.then(async () => {
        const request = route.request();
        if (["image", "font", "media"].includes(request.resourceType())) {
          await route.abort();
          return;
        }
        try {
          if (fatal) throw fatal;
          const method = request.method();
          if (method !== "GET" && method !== "POST") throw new Error("BROWSER_METHOD_NOT_ALLOWED");
          const body = request.postData();
          const response = await safeRequestResource(
            { method, url: request.url(), ...(body ? { jsonBody: JSON.parse(body) } : {}) },
            input.targets,
            input.requestOptions,
          );
          responses.push(response);
          await route.fulfill({
            status: response.status,
            contentType: response.contentType,
            body: Buffer.from(response.body),
          });
        } catch (error) {
          fatal = error instanceof Error ? error : new Error("BROWSER_REQUEST_FAILED");
          await route.abort();
        }
      });
      return chain;
    });
    const page = await context.newPage();
    await page.routeWebSocket("**/*", (socket) => socket.close());
    page.setDefaultTimeout(input.timeoutMs ?? 20_000);
    try {
      await page.goto(input.url, { waitUntil: "domcontentloaded" });
      await page.locator(input.readySelector).first().waitFor({ state: "attached" });
      await chain;
      if (fatal) throw fatal;
      const html = await page.content();
      if (Buffer.byteLength(html) > 5 * 1024 * 1024)
        throw new NetworkPolicyError("RESPONSE_TOO_LARGE", "Rendered HTML exceeded 5 MiB");
      return { html, responses };
    } catch (error) {
      throw fatal ?? error;
    }
  } finally {
    await browser.close();
  }
}
