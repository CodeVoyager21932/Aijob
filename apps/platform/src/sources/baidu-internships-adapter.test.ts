import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildBaiduInternshipApplyUrl,
  normalizeBaiduInternship,
  parseBaiduInternshipPage,
} from "./baidu-internships-adapter.js";

async function htmlFixture(): Promise<string> {
  return readFile(
    new URL("../../../../fixtures/ingestion/baidu-internships.synthetic.html", import.meta.url),
    "utf8",
  );
}

describe("Baidu internships adapter", () => {
  it("parses only the internship list embedded in deterministic SSR data", async () => {
    const page = parseBaiduInternshipPage(await htmlFixture());
    expect(page).toMatchObject({ pageNum: 1, pageSize: 10, total: 399 });
    expect(page.jobs.map((job) => job.name)).toEqual([
      "AI产品经理（J103322）",
      "产品视觉设计实习生（J103350）",
    ]);

    const selectedJob = page.jobs[1];
    expect(selectedJob).toBeDefined();
    if (!selectedJob) throw new Error("FIXTURE_JOB_MISSING");
    const normalized = normalizeBaiduInternship({
      job: selectedJob,
      listItemIndex: 1,
      pageEvidenceRef: "fetch-baidu-list",
    });
    expect(normalized.companyName).toBe("百度");
    expect(normalized.sourceJobId).toBe("cc518dbb-e0ff-491d-a4df-c9e7d02acdab");
    expect(normalized.applyUrl).toBe(
      "https://talent.baidu.com/jobs/detail/INTERN/cc518dbb-e0ff-491d-a4df-c9e7d02acdab",
    );
    expect(normalized.jobFamily.state).toBe("conflict");
    expect(normalized.structuredFields.durationMonths).toMatchObject({
      state: "known",
      value: 6,
    });
    expect(normalized.requirements).toContain("至少6个月");
    expect(normalized.reviewReasons.map((reason) => reason.code)).toContain(
      "SOURCE_POLICY_PENDING",
    );
  });

  it("builds only the official UUID detail route", () => {
    expect(buildBaiduInternshipApplyUrl("d6d33d0e-d2d6-4e87-b3ae-f209528f61cd")).toBe(
      "https://talent.baidu.com/jobs/detail/INTERN/d6d33d0e-d2d6-4e87-b3ae-f209528f61cd",
    );
    expect(() => buildBaiduInternshipApplyUrl("J103322")).toThrow();
  });

  it("fails closed when SSR data disappears or repeats a stable id", async () => {
    const html = await htmlFixture();
    expect(() =>
      parseBaiduInternshipPage(html.replace("window.__INITIAL_DATA__", "window.DATA")),
    ).toThrow("BAIDU_INITIAL_DATA_MISSING");
    expect(() =>
      parseBaiduInternshipPage(
        html.replace(
          "cc518dbb-e0ff-491d-a4df-c9e7d02acdab",
          "d6d33d0e-d2d6-4e87-b3ae-f209528f61cd",
        ),
      ),
    ).toThrow("BAIDU_DUPLICATE_JOB_ID");
  });
});
