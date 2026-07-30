import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildMeituanDetailRequest,
  buildMeituanOfficialJobUrl,
  buildMeituanSearchRequest,
  meituanDetailPayload,
  meituanDetailResponseSchema,
  meituanListPayload,
  meituanSearchResponseSchema,
  normalizeMeituanJob,
} from "./meituan-official-adapter.js";

async function fixture(name: string): Promise<unknown> {
  const url = new URL(`../../../../fixtures/ingestion/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

describe("Meituan official adapter", () => {
  it("builds the bounded product internship request", () => {
    expect(buildMeituanSearchRequest(1, 10)).toMatchObject({
      page: { pageNo: 1, pageSize: 10 },
      jfJgList: [{ code: "11002", subCode: ["1100206"] }],
      jobType: [{ code: "4", subCode: ["2", "6"] }],
      typeCode: ["2", "6"],
    });
    expect(() => buildMeituanSearchRequest(1, 11)).toThrow("INVALID_MEITUAN_PAGE");
    expect(buildMeituanDetailRequest("5100000001")).toEqual({
      jobUnionId: "5100000001",
      jobShareType: "1",
    });
    expect(() => buildMeituanDetailRequest("../1")).toThrow("INVALID_MEITUAN_JOB_ID");
  });

  it("parses ten unique target candidates and preserves stated fields", async () => {
    const list = meituanListPayload(
      meituanSearchResponseSchema.parse(await fixture("meituan-official-job-list.synthetic.json")),
    );
    const detailFixtures = (await fixture(
      "meituan-official-job-details.synthetic.json",
    )) as unknown[];
    const detail = meituanDetailPayload(meituanDetailResponseSchema.parse(detailFixtures[0]));

    expect(list.list).toHaveLength(10);
    expect(new Set(list.list.map((item) => item.jobUnionId)).size).toBe(10);
    const first = list.list[0];
    if (!first) throw new Error("fixture is empty");
    const normalized = normalizeMeituanJob({
      list: first,
      detail,
      listItemIndex: 0,
      listEvidenceRef: "list-fetch",
      detailEvidenceRef: "detail-fetch",
    });

    expect(normalized.companyName).toBe("美团");
    expect(normalized.jobFamily).toMatchObject({ state: "known", value: "product" });
    expect(normalized.locations).toMatchObject({ state: "known", value: ["北京市"] });
    expect(normalized.responsibilities).toContain("需求分析");
    expect(normalized.requirements).toContain("Excel");
    expect(normalized.structuredFields.graduationYears.state).toBe("unknown");
    expect(normalized.applyUrl).toBe(buildMeituanOfficialJobUrl("5100000001"));
    expect(normalized.publicationState).toBe("review");
  });

  it("accepts the live API name field without weakening source identity", () => {
    const parsed = meituanSearchResponseSchema.parse({
      data: {
        list: [{ jobUnionId: "2836792916", name: "大模型平台产品实习生" }],
        page: { pageNo: 1, pageSize: 10, totalCount: 1, totalPage: 1 },
      },
    });
    expect(meituanListPayload(parsed).list[0]).toMatchObject({
      jobUnionId: "2836792916",
      jobName: "大模型平台产品实习生",
    });
  });

  it("rejects a detail response for a different source job id", async () => {
    const list = meituanListPayload(
      meituanSearchResponseSchema.parse(await fixture("meituan-official-job-list.synthetic.json")),
    );
    const first = list.list[0];
    if (!first) throw new Error("fixture is empty");
    expect(() =>
      normalizeMeituanJob({
        list: first,
        detail: { jobUnionId: "999", jobName: first.jobName },
        listItemIndex: 0,
        listEvidenceRef: "list-fetch",
        detailEvidenceRef: "detail-fetch",
      }),
    ).toThrow("MEITUAN_JOB_ID_MISMATCH");
  });
});
