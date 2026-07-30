import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildJdCampusInternshipApplyUrl,
  buildJdCampusInternshipListRequest,
  normalizeJdCampusInternship,
  parseJdCampusInternshipPage,
} from "./jd-campus-internships-adapter.js";

async function jsonFixture(): Promise<unknown> {
  return JSON.parse(
    await readFile(
      new URL(
        "../../../../fixtures/ingestion/jd-campus-internships.synthetic.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

describe("JD campus internships adapter", () => {
  it("builds the exact anonymous internship request contract", () => {
    expect(buildJdCampusInternshipListRequest({ pageIndex: 0, pageSize: 10 })).toEqual({
      pageSize: 10,
      pageIndex: 0,
      parameter: {
        positionName: "",
        planIdList: [],
        jobDirectionCodeList: [],
        workCityCodeList: [],
        positionDeptList: [],
      },
    });
    expect(() => buildJdCampusInternshipListRequest({ pageSize: 11 })).toThrow();
  });

  it("parses and normalizes list fields without inventing missing facts", async () => {
    const page = parseJdCampusInternshipPage(await jsonFixture());
    expect(page.total).toBe(100);
    expect(page.jobs).toHaveLength(2);
    const job = page.jobs[0];
    if (!job) throw new Error("FIXTURE_JOB_MISSING");

    const normalized = normalizeJdCampusInternship({
      job,
      listItemIndex: 0,
      pageEvidenceRef: "fetch-jd-list",
    });
    expect(normalized).toMatchObject({
      sourceJobId: "9001",
      companyName: "京东",
      title: "财务会计实习生",
      jobFamily: { state: "known", value: "finance" },
      locations: { state: "known", value: ["北京市", "南京市"] },
      businessGroups: ["京东集团"],
      sourceProjectName: "新锐之星实习生",
      structuredFields: {
        weeklyAttendanceDays: { state: "known", value: 4 },
        durationMonths: { state: "known", value: 3 },
        graduationYears: { state: "unknown" },
      },
    });
    expect(normalized.applyUrl).toBe(
      "https://campus.jd.com/api/wx/position/index?type=internship#/details?type=internship&id=9001",
    );
    expect(normalized.reviewReasons.map((reason) => reason.code)).toContain(
      "SOURCE_POLICY_PENDING",
    );
  });

  it("fails closed on duplicate identities and invalid apply ids", async () => {
    const fixture = (await jsonFixture()) as {
      body: { items: Array<{ publishId: number; reqId: number }> };
    };
    const duplicate = structuredClone(fixture);
    const [firstItem, secondItem] = duplicate.body.items;
    if (!firstItem || !secondItem) throw new Error("FIXTURE_JOBS_MISSING");
    secondItem.publishId = firstItem.publishId;
    expect(() => parseJdCampusInternshipPage(duplicate)).toThrow("JD_DUPLICATE_PUBLISH_ID");
    expect(buildJdCampusInternshipApplyUrl(5851)).toBe(
      "https://campus.jd.com/api/wx/position/index?type=internship#/details?type=internship&id=5851",
    );
    expect(() => buildJdCampusInternshipApplyUrl(0)).toThrow();
  });
});
