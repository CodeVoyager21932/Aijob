import { describe, expect, it } from "vitest";
import { safeOfficialUrl } from "./navigation";
import {
  approvedResearchJobs,
  findApprovedResearchJob,
  loadApprovedResearchJobs,
} from "./researchJobs";

const expectedCatalog = [
  ["G0-CAND-001", "1257021174874167296"],
  ["G0-CAND-002", "1234496944370743296"],
  ["G0-CAND-003", "1224696103971292160"],
  ["G0-CAND-004", "1218257147532668928"],
  ["G0-CAND-005", "1212183855952704514"],
] as const;

describe("approved G0 research catalog", () => {
  it("contains exactly the five human-confirmed candidate IDs and official URLs", () => {
    expect(approvedResearchJobs).toHaveLength(5);
    expect(
      approvedResearchJobs.map((job) => [
        job.id,
        new URL(job.sourceUrl).searchParams.get("postid"),
      ]),
    ).toEqual(expectedCatalog);

    for (const job of approvedResearchJobs) {
      const officialUrl = safeOfficialUrl(job.sourceUrl, job.officialTarget);
      expect(officialUrl?.protocol).toBe("https:");
      expect(officialUrl?.host).toBe("join.qq.com");
      expect(officialUrl?.pathname).toBe("/post_detail.html");
      expect([...(officialUrl?.searchParams.keys() ?? [])]).toEqual(["postid"]);
      expect(job.officialTarget).toEqual({
        scheme: "https",
        host: "join.qq.com",
        port: 443,
        pathPrefix: "/post_detail.html",
        allowedQueryParameters: ["postid"],
      });
    }
  });

  it("keeps unsupported constraints unknown and the product-operations family conflict intact", () => {
    for (const job of approvedResearchJobs) {
      expect(job.weeklyAttendanceDays).toEqual({
        state: "unknown",
        reason: "官方页面未说明",
      });
      expect(job.durationMonths).toEqual({ state: "unknown", reason: "官方页面未说明" });
      expect(job.earliestStartDate).toEqual({ state: "unknown", reason: "官方页面未说明" });
      expect(job.graduationYears).toEqual({ state: "unknown", reason: "官方页面未说明" });
    }

    expect(approvedResearchJobs.find((job) => job.id === "G0-CAND-004")?.family).toEqual({
      state: "conflict",
      rawValues: ["product", "operations"],
    });
  });

  it("loads only active jobs and finds a confirmed job by ID", async () => {
    await expect(loadApprovedResearchJobs()).resolves.toEqual(approvedResearchJobs);
    await expect(findApprovedResearchJob("G0-CAND-003")).resolves.toBe(approvedResearchJobs[2]);
    await expect(findApprovedResearchJob("not-approved")).resolves.toBeNull();
  });

  it("rejects an already-aborted catalog read", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(loadApprovedResearchJobs(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(findApprovedResearchJob("G0-CAND-001", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
