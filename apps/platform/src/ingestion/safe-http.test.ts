import { describe, expect, it } from "vitest";
import type { SourceTarget } from "../sources/source-config.js";
import {
  assertRedirectAllowed,
  isPublicIp,
  validateNavigationUrl,
  validateUrl,
} from "./safe-http.js";

const targets: SourceTarget[] = [
  {
    method: "POST",
    scheme: "https",
    host: "join.qq.com",
    port: 443,
    pathPrefix: "/api/v1/position/searchPosition",
    allowRedirects: false,
    allowedQueryParameters: [],
  },
  {
    method: "GET",
    scheme: "https",
    host: "join.qq.com",
    port: 443,
    pathPrefix: "/api/v1/jobDetails/getJobDetailsByPostId",
    allowRedirects: false,
    allowedQueryParameters: ["postId"],
  },
];

describe("collector network policy", () => {
  it("accepts only exact approved method, host, port and path", () => {
    expect(
      validateUrl(
        "https://join.qq.com/api/v1/jobDetails/getJobDetailsByPostId?postId=123",
        "GET",
        targets,
      ).hostname,
    ).toBe("join.qq.com");
    expect(() =>
      validateUrl("https://join.qq.com/api/v1/position/searchPosition", "GET", targets),
    ).toThrowError(/not allowlisted/);
    expect(() =>
      validateUrl("https://join.qq.com/api/v1/position/searchPosition/extra", "POST", targets),
    ).toThrowError(/not allowlisted/);
    expect(() =>
      validateUrl("https://evil.example/api/v1/jobDetails/getJobDetailsByPostId", "GET", targets),
    ).toThrowError(/not allowlisted/);
    expect(() =>
      validateUrl(
        "https://join.qq.com/api/v1/jobDetails/getJobDetailsByPostId?postId=123&debug=1",
        "GET",
        targets,
      ),
    ).toThrowError(/Query parameter debug is not allowlisted/);
    expect(() =>
      validateUrl("https://join.qq.com/api/v1/position/searchPosition?debug=1", "POST", targets),
    ).toThrowError(/Query parameter debug is not allowlisted/);
  });

  it("blocks redirects unless the matched target explicitly permits them", () => {
    const target = targets[0];
    if (!target) throw new Error("test target is missing");

    expect(() => assertRedirectAllowed(target)).toThrowError(/redirect is forbidden/i);
    expect(() => assertRedirectAllowed({ ...target, allowRedirects: true })).not.toThrow();
  });

  it("allows fragments only for local navigation validation", () => {
    const navigationTargets: SourceTarget[] = [
      {
        method: "GET",
        scheme: "https",
        host: "app.mokahr.com",
        port: 443,
        pathPrefix: "/campus-recruitment/tal/95443",
        allowRedirects: false,
        allowedQueryParameters: ["locale"],
      },
    ];
    const officialUrl = "https://app.mokahr.com/campus-recruitment/tal/95443?locale=zh-CN#/jobs";

    expect(validateNavigationUrl(officialUrl, "GET", navigationTargets).hash).toBe("#/jobs");
    expect(() => validateUrl(officialUrl, "GET", navigationTargets)).toThrowError(/fragments/i);
    expect(() =>
      validateNavigationUrl(
        "https://app.mokahr.com/campus-recruitment/tal/95443?locale=zh-CN&next=evil#/jobs",
        "GET",
        navigationTargets,
      ),
    ).toThrowError(/Query parameter next is not allowlisted/);
    expect(() =>
      validateNavigationUrl(
        "https://evil.example/campus-recruitment/tal/95443?locale=zh-CN#/jobs",
        "GET",
        navigationTargets,
      ),
    ).toThrowError(/not allowlisted/);
    expect(() =>
      validateNavigationUrl(
        "https://app.mokahr.com/campus-recruitment/tal/95443/extra?locale=zh-CN#/jobs",
        "GET",
        navigationTargets,
      ),
    ).toThrowError(/not allowlisted/);
  });

  it("rejects private, loopback, link-local and special-use addresses", () => {
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("2606:4700:4700::1111")).toBe(true);
    expect(isPublicIp("10.0.0.1")).toBe(false);
    expect(isPublicIp("127.0.0.1")).toBe(false);
    expect(isPublicIp("169.254.1.1")).toBe(false);
    expect(isPublicIp("192.168.1.1")).toBe(false);
    expect(isPublicIp("192.0.2.1")).toBe(false);
    expect(isPublicIp("198.51.100.1")).toBe(false);
    expect(isPublicIp("203.0.113.1")).toBe(false);
    expect(isPublicIp("::1")).toBe(false);
    expect(isPublicIp("64:ff9b:1::1")).toBe(false);
    expect(isPublicIp("100::1")).toBe(false);
    expect(isPublicIp("2001:db8::1")).toBe(false);
    expect(isPublicIp("3fff::1")).toBe(false);
    expect(isPublicIp("5f00::1")).toBe(false);
    expect(isPublicIp("fc00::1")).toBe(false);
  });
});
