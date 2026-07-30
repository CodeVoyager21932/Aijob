import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildFanruanTraineeApplyUrl,
  buildFanruanTraineeListFormBody,
  isFanruanInternship,
  normalizeFanruanTraineeJob,
  parseFanruanTraineePage,
} from "./fanruan-trainee-adapter.js";

async function jsonFixture(): Promise<string> {
  return readFile(
    new URL(
      "../../../../fixtures/ingestion/fanruan-trainee-internships.synthetic.json",
      import.meta.url,
    ),
    "utf8",
  );
}

describe("Fanruan trainee adapter", () => {
  it("parses the trainee list JSON and keeps only explicit internships", async () => {
    const page = parseFanruanTraineePage(await jsonFixture());
    expect(page).toMatchObject({ pageTotal: 1, curPage: 1, pageSize: 10, dataTotal: 3 });
    expect(page.jobs).toHaveLength(3);
    expect(page.jobs.filter(isFanruanInternship).map((job) => job.id)).toEqual(["9001", "9002"]);

    const internship = page.jobs[0];
    expect(internship).toBeDefined();
    if (!internship) throw new Error("FIXTURE_JOB_MISSING");
    const normalized = normalizeFanruanTraineeJob({
      job: internship,
      listItemIndex: 0,
      pageEvidenceRef: "fetch-fanruan-list",
    });
    expect(normalized.companyName).toBe("帆软");
    expect(normalized.sourceJobId).toBe("9001");
    expect(normalized.applyUrl).toBe("https://join.fanruan.com/trainee/detail?id=9001");
    expect(normalized.recruitmentType).toMatchObject({ state: "known", value: "实习" });
    expect(normalized.locations).toMatchObject({ state: "known", value: ["南京", "无锡"] });
    expect(normalized.structuredFields.durationMonths).toMatchObject({ state: "known", value: 3 });
    expect(normalized.structuredFields.weeklyAttendanceDays).toMatchObject({
      state: "known",
      value: 4,
    });
    expect(normalized.structuredFields.publishedAt.state).toBe("unknown");
    expect(normalized.reviewReasons.map((reason) => reason.code)).toContain(
      "SOURCE_POLICY_PENDING",
    );
  });

  it("rejects non-internship modes during normalization", async () => {
    const page = parseFanruanTraineePage(await jsonFixture());
    const socialJob = page.jobs.find((job) => job.mode === "社招");
    expect(socialJob).toBeDefined();
    if (!socialJob) throw new Error("FIXTURE_JOB_MISSING");
    expect(() =>
      normalizeFanruanTraineeJob({
        job: socialJob,
        listItemIndex: 2,
        pageEvidenceRef: "fetch-fanruan-list",
      }),
    ).toThrow("FANRUAN_NOT_EXPLICIT_INTERNSHIP");
  });

  it("builds only the official numeric detail route and page-1-based form body", () => {
    expect(buildFanruanTraineeApplyUrl("9839")).toBe(
      "https://join.fanruan.com/trainee/detail?id=9839",
    );
    expect(() => buildFanruanTraineeApplyUrl("9839x")).toThrow();
    expect(buildFanruanTraineeListFormBody(2)).toEqual({ filter: "1", page: "2", w: "" });
    expect(() => buildFanruanTraineeListFormBody(0)).toThrow();
  });

  it("fails closed on invalid JSON, inconsistent counts, or duplicate ids", async () => {
    const raw = await jsonFixture();
    expect(() => parseFanruanTraineePage(`${raw}<!-- html tail -->`)).toThrow(
      "FANRUAN_LIST_INVALID_JSON",
    );
    expect(() =>
      parseFanruanTraineePage(raw.replace('"dataTotal": "3"', '"dataTotal": "1"')),
    ).toThrow("FANRUAN_LIST_COUNT_INCONSISTENT");
    expect(() => parseFanruanTraineePage(raw.replaceAll('"9002"', '"9001"'))).toThrow(
      "FANRUAN_DUPLICATE_JOB_ID",
    );
  });
});
