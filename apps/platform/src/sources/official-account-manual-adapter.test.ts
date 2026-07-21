import { describe, expect, it } from "vitest";
import {
  normalizeOfficialAccountManualJob,
  parseOfficialAccountManualSnapshot,
} from "./official-account-manual-adapter.js";

function snapshot(email = "intern@example.com") {
  return {
    schemaVersion: "organization-official-account-manual-snapshot-v1",
    captureMode: "manual-official-account-visible-content",
    sourcePageUrl: "https://mp.weixin.qq.com/s/example-article",
    capturedAt: "2026-07-21T10:00:00+08:00",
    reportedTotal: 1,
    jobs: [
      {
        sourceJobId: "official-account-job-1",
        title: "产品实习生",
        locations: ["上海"],
        employmentScope: "实习",
        recruitmentChannel: "校招",
        jobCategory: "产品",
        responsibilities: "参与用户研究和需求分析。",
        requirements: "在校生，每周至少 4 天，连续实习 3 个月以上。",
        application: {
          type: "company_email",
          email,
          sourceText: `请将简历发送至 ${email}`,
        },
        itemIndex: 0,
      },
    ],
  };
}

describe("official account manual snapshot", () => {
  it("keeps an official company email with its exact source excerpt", () => {
    const parsed = parseOfficialAccountManualSnapshot(snapshot());
    const job = parsed.jobs[0];
    if (!job) throw new Error("official account fixture job missing");
    const normalized = normalizeOfficialAccountManualJob({
      job,
      organizationName: "示例科技",
      officialDomain: "example.com",
      sourcePageUrl: parsed.sourcePageUrl,
      snapshotEvidenceRef: "manual-official-account-snapshot",
    });
    expect(normalized).toMatchObject({
      companyName: "示例科技",
      applyUrl: null,
      sourceUrl: parsed.sourcePageUrl,
      recruitmentType: { state: "known", value: "校招" },
      structuredFields: {
        applicationEmail: "intern@example.com",
        applicationEmailSourceText: "请将简历发送至 intern@example.com",
      },
    });
  });

  it("rejects personal mailboxes and non-internship entries", () => {
    const parsed = parseOfficialAccountManualSnapshot(snapshot("recruiter@qq.com"));
    const job = parsed.jobs[0];
    if (!job) throw new Error("official account fixture job missing");
    expect(() =>
      normalizeOfficialAccountManualJob({
        job,
        organizationName: "示例科技",
        officialDomain: "example.com",
        sourcePageUrl: parsed.sourcePageUrl,
        snapshotEvidenceRef: "manual-official-account-snapshot",
      }),
    ).toThrow("OFFICIAL_ACCOUNT_COMPANY_EMAIL_UNVERIFIED");
    expect(() =>
      parseOfficialAccountManualSnapshot({
        ...snapshot(),
        jobs: [{ ...snapshot().jobs[0], employmentScope: "全职" }],
      }),
    ).toThrow();
  });
});
