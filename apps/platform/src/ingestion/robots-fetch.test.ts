import { describe, expect, it } from "vitest";
import {
  looksLikeMarkupDocument,
  robotsTargetForHost,
  robotsUnavailableReason,
  robotsUrlForHost,
} from "./robots-fetch.js";

/**
 * `/robots.txt` 与白名单的关系是必须显式决定的一点（`AGENTS.md` 要求精确协议、主机、端口、
 * 路径前缀与查询参数白名单）。这里钉住那个决定：为每个主机现造一条只含该路径的目标，而不是
 * 把它加进任何来源已登记的 fetchTargets——后者会顺带放宽那个来源的获准访问范围。
 */
describe("robots.txt target scoping", () => {
  it("synthesises a target limited to exactly /robots.txt with no query and no redirects", () => {
    expect(robotsTargetForHost("career.nankai.edu.cn")).toEqual({
      method: "GET",
      scheme: "https",
      host: "career.nankai.edu.cn",
      port: 443,
      pathPrefix: "/robots.txt",
      allowRedirects: false,
      allowedQueryParameters: [],
    });
    expect(robotsUrlForHost("career.nankai.edu.cn")).toBe(
      "https://career.nankai.edu.cn/robots.txt",
    );
  });
});

/**
 * 按内容而非 content-type 判定「拿到的是不是 robots.txt」。实测 18 个已登记主机里有 8 个用
 * 非 `text/plain` 的 MIME 提供 robots.txt；按 RFC 9309 §2.3 从严会把它们全记成站点禁止，
 * 那是 MIME 不规范而不是访问政策。反向的软 404（回一个 HTML 页面）仍须按取不到处理。
 */
describe("robots.txt content detection", () => {
  it("accepts real robots bodies regardless of declared MIME", () => {
    for (const body of [
      "User-agent: *\nAllow: /\n",
      "user-agent: *\ndisallow: /admin\ncrawl-delay: 2\n",
      "# 注释开头\nUser-agent: Baiduspider\nDisallow:\n",
      "",
      "\n\n",
      "Sitemap: https://example.test/sitemap.xml\n",
    ]) {
      expect(looksLikeMarkupDocument(body), JSON.stringify(body)).toBe(false);
    }
  });

  it("rejects soft-404 markup served under /robots.txt", () => {
    for (const body of [
      "<!DOCTYPE html>\n<html><head><title>404</title></head></html>",
      '  <html lang="zh"><body>未找到</body></html>',
      '<?xml version="1.0"?><error/>',
      '\n<div id="app"></div><script src="/main.js"></script>',
    ]) {
      expect(looksLikeMarkupDocument(body), body.slice(0, 24)).toBe(true);
    }
  });
});

describe("robots.txt unavailable reasons", () => {
  it("keeps the four ADR-0033 reasons distinguishable", () => {
    expect(robotsUnavailableReason("UPSTREAM_HTTP_404")).toBe("not_found");
    expect(robotsUnavailableReason("UPSTREAM_HTTP_410")).toBe("not_found");
    expect(robotsUnavailableReason("UPSTREAM_TIMEOUT")).toBe("timeout");
    expect(robotsUnavailableReason("UPSTREAM_HTTP_406")).toBe("http_error");
    expect(robotsUnavailableReason("ROBOTS_RESPONSE_IS_MARKUP")).toBe("http_error");
    expect(robotsUnavailableReason("REDIRECT_NOT_ALLOWED")).toBe("http_error");
    expect(robotsUnavailableReason("DNS_EMPTY")).toBe("network_error");
    expect(robotsUnavailableReason("ECONNRESET")).toBe("network_error");
  });
});
