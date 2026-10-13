import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderControlledPage } from "./controlled-browser.js";
import { safeRequestResource, validateUrl } from "./safe-http.js";
import type { SourceTarget } from "../sources/source-config.js";
vi.mock("./safe-http.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./safe-http.js")>();
  return { ...actual, safeRequestResource: vi.fn() };
});
const executablePath = process.env.AIJOB_TEST_BROWSER_EXECUTABLE;
const targets: SourceTarget[] = [
  {
    method: "GET",
    scheme: "https",
    host: "render.example.test",
    port: 443,
    pathPrefix: "/",
    allowRedirects: false,
    allowedQueryParameters: [],
  },
];
(executablePath ? describe : describe.skip)("isolated browser with offline HTTP fixtures", () => {
  let pageHtml = "";
  beforeEach(() => {
    vi.mocked(safeRequestResource).mockImplementation(async (spec, allowed, options) => {
      validateUrl(spec.url, spec.method, allowed);
      await options?.beforeRequest?.();
      const body = spec.url.endsWith("/api/jobs")
        ? JSON.stringify({ title: "硕士研究实习" })
        : pageHtml;
      return {
        requestUrl: spec.url,
        finalUrl: spec.url,
        method: "GET",
        status: 200,
        body: Buffer.from(body),
        contentType: spec.url.endsWith("/api/jobs") ? "application/json" : "text/html",
        responseHeaders: {},
        requestFingerprint: "a".repeat(64),
      };
    });
  });
  it("renders a JS-fed page while every subrequest shares the configured budget", async () => {
    pageHtml =
      '<main></main><script>fetch("/api/jobs").then(r=>r.json()).then(x=>{const h=document.createElement("h1");h.textContent=x.title;document.querySelector("main").append(h)})</script>';
    let count = 0;
    const result = await renderControlledPage({
      url: "https://render.example.test/jobs",
      executablePath: executablePath as string,
      targets,
      readySelector: "h1",
      requestOptions: {
        beforeRequest: () => {
          count++;
        },
      },
      timeoutMs: 5000,
    });
    expect(result.html).toContain("硕士研究实习");
    expect(result.responses).toHaveLength(2);
    expect(count).toBe(2);
  }, 15000);
  it("fails a page that requires an unregistered host without issuing direct browser requests", async () => {
    pageHtml =
      '<main></main><script>fetch("https://outside.invalid/jobs").then(()=>document.querySelector("main").innerHTML="<h1>oops</h1>")</script>';
    await expect(
      renderControlledPage({
        url: "https://render.example.test/jobs",
        executablePath: executablePath as string,
        targets,
        readySelector: "h1",
        requestOptions: {},
        timeoutMs: 1000,
      }),
    ).rejects.toThrow();
  }, 15000);
});
