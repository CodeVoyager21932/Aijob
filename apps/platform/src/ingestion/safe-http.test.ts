import { describe, expect, it } from "vitest";
import type { SourceTarget } from "../sources/source-config.js";
import { assertRedirectAllowed, isPublicIp, validateUrl } from "./safe-http.js";

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

  it("rejects private, loopback, link-local and special-use addresses", () => {
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("10.0.0.1")).toBe(false);
    expect(isPublicIp("127.0.0.1")).toBe(false);
    expect(isPublicIp("169.254.1.1")).toBe(false);
    expect(isPublicIp("192.168.1.1")).toBe(false);
    expect(isPublicIp("::1")).toBe(false);
    expect(isPublicIp("fc00::1")).toBe(false);
  });
});
