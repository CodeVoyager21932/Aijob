import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  isTencentStablePostId,
  normalizeTencentJob,
  TENCENT_ADAPTER_VERSION,
  TENCENT_NORMALIZER_VERSION,
  tencentDetailResponseSchema,
  tencentSearchResponseSchema,
} from "./tencent-campus-adapter.js";

async function fixture(name: string): Promise<unknown> {
  const url = new URL(`../../../../fixtures/ingestion/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

describe("Tencent campus adapter", () => {
  it("uses the semantic-hash adapter and normalizer version", () => {
    expect(TENCENT_ADAPTER_VERSION).toBe("0.1.2");
    expect(TENCENT_NORMALIZER_VERSION).toBe("0.1.2");
  });

  it("preserves postId beyond JavaScript's safe integer range as text", async () => {
    const parsed = tencentSearchResponseSchema.parse(
      await fixture("tencent-campus-search-position.synthetic.json"),
    );
    const postId = parsed.data.positionList[0]?.postId;

    expect(postId).toBe("1212345678901234567");
    expect(Number(postId)).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(() =>
      tencentSearchResponseSchema.parse({
        ...parsed,
        data: {
          ...parsed.data,
          positionList: [{ ...parsed.data.positionList[0], postId: Number(postId) }],
        },
      }),
    ).toThrow();
    expect(isTencentStablePostId(postId ?? "")).toBe(true);
    expect(isTencentStablePostId("-2")).toBe(false);
  });

  it("surfaces recruitment and family conflicts while leaving missing facts unknown", async () => {
    const search = tencentSearchResponseSchema.parse(
      await fixture("tencent-campus-search-position.synthetic.json"),
    );
    const detail = tencentDetailResponseSchema.parse(
      await fixture("tencent-campus-job-details.synthetic.json"),
    );
    const list = search.data.positionList[0];
    if (!list) throw new Error("fixture is empty");

    const normalized = normalizeTencentJob({
      list,
      detail: detail.data,
      listItemIndex: 0,
      entryScope: "日常实习",
      listEvidenceRef: "list-fetch",
      detailEvidenceRef: "detail-fetch",
    });

    expect(normalized.recruitmentType).toMatchObject({
      state: "conflict",
      rawValues: ["日常实习", "应届实习"],
    });
    expect(normalized.jobFamily.state).toBe("conflict");
    expect(normalized.structuredFields.arrivalTime).toEqual({
      state: "unknown",
      reason: "source_not_stated",
    });
    expect(normalized.structuredFields.weeklyAttendanceDays.state).toBe("unknown");
    expect(normalized.structuredFields.durationMonths.state).toBe("unknown");
    expect(normalized.structuredFields.graduationYears.state).toBe("unknown");
    expect(normalized.structuredFields.publishedAt.state).toBe("unknown");
    expect(normalized.structuredFields.deadline.state).toBe("unknown");
    expect(normalized.publicationState).toBe("review");
    expect(normalized.reviewReasons.map((reason) => reason.code)).toContain(
      "SOURCE_POLICY_PENDING",
    );
  });

  it("keeps the revision hash stable when only crawl evidence references change", async () => {
    const search = tencentSearchResponseSchema.parse(
      await fixture("tencent-campus-search-position.synthetic.json"),
    );
    const detail = tencentDetailResponseSchema.parse(
      await fixture("tencent-campus-job-details.synthetic.json"),
    );
    const list = search.data.positionList[0];
    if (!list) throw new Error("fixture is empty");

    const first = normalizeTencentJob({
      list,
      detail: detail.data,
      listItemIndex: 0,
      entryScope: "日常实习",
      listEvidenceRef: "crawl-a-list-fetch",
      detailEvidenceRef: "crawl-a-detail-fetch",
    });
    const second = normalizeTencentJob({
      list,
      detail: detail.data,
      listItemIndex: 0,
      entryScope: "日常实习",
      listEvidenceRef: "crawl-b-list-fetch",
      detailEvidenceRef: "crawl-b-detail-fetch",
    });

    expect(first.locations).not.toEqual(second.locations);
    expect(first.revisionContentHash).toBe(second.revisionContentHash);
  });

  it("changes the revision hash for title, responsibilities, or structured semantics", async () => {
    const search = tencentSearchResponseSchema.parse(
      await fixture("tencent-campus-search-position.synthetic.json"),
    );
    const detail = tencentDetailResponseSchema.parse(
      await fixture("tencent-campus-job-details.synthetic.json"),
    );
    const list = search.data.positionList[0];
    if (!list) throw new Error("fixture is empty");

    const normalize = (detailValue: typeof detail.data) =>
      normalizeTencentJob({
        list,
        detail: detailValue,
        listItemIndex: 0,
        entryScope: "日常实习",
        listEvidenceRef: "stable-list-fetch",
        detailEvidenceRef: "stable-detail-fetch",
      });
    const baseline = normalize(detail.data);
    const titleChanged = normalize({ ...detail.data, title: `${detail.data.title}-changed` });
    const responsibilitiesChanged = normalize({
      ...detail.data,
      desc: `${detail.data.desc}-changed`,
    });
    const structuredSemanticsChanged = normalize({
      ...detail.data,
      recruitLabelName: "changed-recruitment-batch",
    });

    expect(titleChanged.revisionContentHash).not.toBe(baseline.revisionContentHash);
    expect(responsibilitiesChanged.revisionContentHash).not.toBe(baseline.revisionContentHash);
    expect(structuredSemanticsChanged.structuredFields.recruitmentBatch).not.toEqual(
      baseline.structuredFields.recruitmentBatch,
    );
    expect(structuredSemanticsChanged.revisionContentHash).not.toBe(baseline.revisionContentHash);
  });
});
