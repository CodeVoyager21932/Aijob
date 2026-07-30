import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  normalizeBytedanceManualBrowserJob,
  parseBytedanceManualBrowserSnapshot,
} from "./bytedance-manual-browser-adapter.js";

async function fixture(): Promise<unknown> {
  return JSON.parse(
    await readFile(
      new URL(
        "../../../../fixtures/ingestion/bytedance-manual-browser.synthetic.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

describe("ByteDance manual browser snapshot adapter", () => {
  it("accepts a bounded internship-only snapshot and normalizes explicit facts", async () => {
    const snapshot = parseBytedanceManualBrowserSnapshot(await fixture());
    expect(snapshot.jobs).toHaveLength(2);
    const job = snapshot.jobs[0];
    if (!job) throw new Error("FIXTURE_JOB_MISSING");
    const normalized = normalizeBytedanceManualBrowserJob({
      job,
      snapshotEvidenceRef: "fetch-bytedance-manual",
    });
    expect(normalized).toMatchObject({
      sourceJobId: "7664000000000000001",
      companyName: "字节跳动",
      jobFamily: { state: "known", value: "product" },
      locations: { state: "known", value: ["上海"] },
      recruitmentType: { state: "known", value: "实习" },
      structuredFields: {
        weeklyAttendanceDays: { state: "known", value: 4 },
        durationMonths: { state: "known", value: 3 },
        graduationYears: { state: "known", value: [2027] },
      },
    });
    expect(normalized.applyUrl).toBe(
      "https://jobs.bytedance.com/campus/position/7664000000000000001/detail",
    );
    expect(normalized.reviewReasons.map((reason) => reason.code)).toContain(
      "MANUAL_BROWSER_IMPORT_REQUIRES_REVIEW",
    );
  });

  it("rejects full-time campus jobs, duplicate ids and mismatched detail urls", async () => {
    const base = (await fixture()) as { jobs: Array<Record<string, unknown>> };
    const fullTime = structuredClone(base);
    const fullTimeFirst = fullTime.jobs[0];
    if (!fullTimeFirst) throw new Error("FIXTURE_JOB_MISSING");
    fullTimeFirst.employmentType = "正式";
    expect(() => parseBytedanceManualBrowserSnapshot(fullTime)).toThrow();

    const duplicate = structuredClone(base);
    const [duplicateFirst, duplicateSecond] = duplicate.jobs;
    if (!duplicateFirst || !duplicateSecond) throw new Error("FIXTURE_JOBS_MISSING");
    duplicateSecond.sourceJobId = duplicateFirst.sourceJobId;
    duplicateSecond.detailUrl = duplicateFirst.detailUrl;
    expect(() => parseBytedanceManualBrowserSnapshot(duplicate)).toThrow(
      "BYTEDANCE_DUPLICATE_SOURCE_JOB_ID",
    );

    const mismatch = structuredClone(base);
    const mismatchFirst = mismatch.jobs[0];
    if (!mismatchFirst) throw new Error("FIXTURE_JOB_MISSING");
    mismatchFirst.detailUrl =
      "https://jobs.bytedance.com/campus/position/7664000000000000002/detail";
    expect(() => parseBytedanceManualBrowserSnapshot(mismatch)).toThrow(
      "BYTEDANCE_DETAIL_ID_MISMATCH",
    );
  });
});
