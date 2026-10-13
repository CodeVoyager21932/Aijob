import { describe, expect, it } from "vitest";
import { parseSourceConfigValue } from "./source-config.js";
import {
  identifyBeisenPortal,
  probeTenant,
  type TenantOnboardingRequest,
} from "./tenant-onboarding.js";

const portalId = "290427f4-d052-45ba-a588-dc6ae9779d97";
const html = `<script>var BSGlobal = ${JSON.stringify({
  PortalId: portalId,
  Pages: [
    { Code: "InternList", PageType: 2, BusinessType: "3" },
    { Code: "CampusList", PageType: 2, BusinessType: "2" },
  ],
})};window.bad=1;</script>`;
const request: TenantOnboardingRequest = {
  sourceKey: "fixture-onboarding",
  companyName: "测试企业",
  officialUrl: "https://tenant.zhiye.com/intern/jobs",
  officialEvidenceUrl: "https://company.example/careers",
  category: "3",
  termsUrl: null,
  termsExcerpt: "夹具中的政策已核对",
  confirmedPublicScope: true,
};
const result = (json: unknown) => ({
  requestUrl: request.officialUrl,
  finalUrl: request.officialUrl,
  method: "POST" as const,
  status: 200,
  contentType: "application/json",
  responseHeaders: {},
  requestFingerprint: "fixture",
  body: new Uint8Array(),
  json,
});
function dependencies(pages: unknown[]) {
  let index = 0;
  return {
    wait: async () => {},
    robots: async () => ({
      host: "tenant.zhiye.com",
      requestUrl: "https://tenant.zhiye.com/robots.txt",
      outcome: { status: "fetched" as const, body: "User-agent: *\nAllow: /" },
      errorCode: null,
    }),
    html: async () => ({ ...result(null), text: html }),
    json: async () => result(pages[index++]),
  };
}
const job = (id: number) => ({
  JobAdId: id,
  JobAdName: "产品实习",
  Duty: "整理需求原句。",
  Require: "本科在读。\n我们能提供什么：\n免费午餐。",
  LocNames: ["上海"],
});
describe("source tenant identification and bounded probe", () => {
  it("reads actual portal JSON and listed categories without executing scripts or guessing IDs", () => {
    expect(identifyBeisenPortal(html, "tenant.zhiye.com")).toMatchObject({
      portalId,
      categories: [
        { category: "3", path: "/intern/jobs" },
        { category: "2", path: "/campus/jobs" },
      ],
    });
    expect(() =>
      identifyBeisenPortal("<script>var BSGlobal = getConfig()</script>", "tenant.zhiye.com"),
    ).toThrow("BEISEN_PORTAL_VARIANT_UNRECOGNIZED");
    expect(() => identifyBeisenPortal(html, "tenant.zhiye.com.evil.example")).toThrow(
      "SOURCE_VENDOR_UNRECOGNIZED",
    );
  });
  it("distinguishes explicit empty, complete paging, parse failure and duplicate/partial pages", async () => {
    const complete = await probeTenant({
      request,
      runId: "fixture",
      dependencies: dependencies([
        { Code: 200, Count: 2, Data: [job(1)] },
        { Code: 200, Count: 2, Data: [job(2)] },
      ]),
    });
    expect(complete).toMatchObject({ state: "complete", parsedCount: 2, reportedTotal: 2 });
    expect(complete.preview[0]?.requirements).toBe("本科在读。");
    const config = parseSourceConfigValue(complete.proposal!.configuration);
    expect(config.policy.adapterOptions.portalId).toBe(portalId);
    expect(config.policy.crawlInterval.enabled).toBe(false);
    expect(config.policy.status).toBe("pending_review");
    const empty = await probeTenant({
      request,
      runId: "fixture",
      dependencies: dependencies([{ Code: 200, Count: 0, Data: [] }]),
    });
    expect(empty.state).toBe("explicit_empty");
    expect(
      (
        await probeTenant({
          request,
          runId: "fixture",
          dependencies: dependencies([{ Code: 500, Data: [] }]),
        })
      ).state,
    ).toBe("failed");
    expect(
      await probeTenant({
        request,
        runId: "fixture",
        dependencies: dependencies([
          { Code: 200, Count: 2, Data: [job(1)] },
          { Code: 200, Count: 2, Data: [job(1)] },
        ]),
      }),
    ).toMatchObject({ state: "partial", proposal: null, reason: "BEISEN_DUPLICATE_PAGE" });
  });
  it("stops before the portal when the declared scope is prohibited", async () => {
    const deps = dependencies([]);
    deps.robots = async () => ({
      host: "tenant.zhiye.com",
      requestUrl: "https://tenant.zhiye.com/robots.txt",
      outcome: { status: "fetched", body: "User-agent: *\nDisallow: /" },
      errorCode: null,
    });
    const r = await probeTenant({
      request,
      runId: "fixture",
      dependencies: {
        ...deps,
        html: async () => {
          throw new Error("must not fetch");
        },
      },
    });
    expect(r).toMatchObject({ state: "failed", reason: "ROBOTS_DISALLOWED" });
  });
});
