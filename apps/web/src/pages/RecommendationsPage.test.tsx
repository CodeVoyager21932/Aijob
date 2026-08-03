import type { JobSummary, RecommendationItem, RecommendationRun } from "@aijob/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  initialRecommendationRunId,
  partitionCurrentRecommendations,
  RecommendationResult,
} from "./RecommendationsPage";

const recommendationItem = (publishedJobVersionId: string): RecommendationItem => ({
  ordinal: 0,
  publishedJobVersionId,
  matchRunId: `match-${publishedJobVersionId}`,
  eligibility: "needs_information",
  evidence: "insufficient_information",
  preference: "not_set",
  basisState: "partial",
  coverage: {
    eligibility: { required: 1, evaluated: 0, met: 0, conflicts: 0, unknown: 1 },
    evidence: { applicable: 1, supported: 0, partial: 0, missing: 0, unknown: 1 },
    preference: { configured: 0, compared: 0, conflicts: 0, unknown: 0 },
  },
  gaps: [],
  reasonCodes: [],
  unknownRequirementIds: [],
  lastVerifiedAt: null,
  catalogState: "current",
});

const succeededRun = (items: RecommendationItem[]): RecommendationRun => ({
  id: "recommendation-old",
  ownerId: "owner-one",
  status: "succeeded",
  candidateSetHash: "0".repeat(64),
  strategyVersion: "deterministic-v1",
  catalogState: "current",
  items,
  failureCode: null,
  createdAt: "2026-07-18T00:00:00.000Z",
  completedAt: "2026-07-18T00:00:01.000Z",
});

const currentJob: JobSummary = {
  id: "job-current",
  publishedJobVersionId: "version-current",
  activeRequirementSetId: "requirements-current",
  companyName: "示例公司",
  title: "产品实习生",
  jobFamily: { state: "known", value: "product", evidenceRefs: ["job#family"] },
  locations: { state: "known", value: ["上海"], evidenceRefs: ["job#city"] },
  weeklyAttendanceDays: { state: "unknown", reason: "source_not_stated" },
  durationMonths: { state: "unknown", reason: "source_not_stated" },
  salary: { state: "unknown", reason: "source_not_stated" },
  source: {
    sourceId: "source-current",
    type: "organization_career_site",
    provenanceLevel: "organization_owned",
    displayName: "示例公司招聘",
    domain: "careers.example.test",
    lastVerifiedAt: "2026-07-20T00:00:00.000Z",
  },
  publicationState: "published",
  activityState: "active",
  displayStatus: "recruiting",
};

describe("recommendations page state", () => {
  it("ignores a stored run when start=1 requests a fresh recommendation", () => {
    expect(initialRecommendationRunId(true, "recommendation-old")).toBeNull();
    expect(initialRecommendationRunId(false, "recommendation-old")).toBe("recommendation-old");
  });

  it("partitions stale versions once instead of producing one warning per item", () => {
    const result = partitionCurrentRecommendations(
      [recommendationItem("version-old-one"), recommendationItem("version-current")],
      new Map([["version-current", currentJob]]),
    );

    expect(result.current).toEqual([
      {
        item: expect.objectContaining({ publishedJobVersionId: "version-current" }),
        job: currentJob,
      },
    ]);
    expect(result.staleCount).toBe(1);
  });

  it("groups recommendations without rendering a 1-31 rank badge", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RecommendationResult
          run={succeededRun([recommendationItem("version-current")])}
          jobsByVersion={new Map([["version-current", currentJob]])}
          isRegenerating={false}
          onRegenerate={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("需补充信息");
    expect(html).toContain("依据完整度");
    expect(html).not.toContain("job-rank");
    expect(html).not.toContain(">1<");
  });

  it("keeps the full recommendation set while rendering only the first 100 cards", () => {
    const items = Array.from({ length: 150 }, (_, index) => ({
      ...recommendationItem(`version-${index}`),
      ordinal: index,
    }));
    const jobs = new Map(
      items.map((item, index) => [
        item.publishedJobVersionId,
        {
          ...currentJob,
          id: `job-${index}`,
          publishedJobVersionId: item.publishedJobVersionId,
          title: `岗位 ${index}`,
        },
      ]),
    );

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RecommendationResult
          run={succeededRun(items)}
          jobsByVersion={jobs}
          isRegenerating={false}
          onRegenerate={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("已显示 100 / 150 个当前岗位");
    expect(html).toContain("再显示 50 个岗位");
    expect(html.match(/<article class="product-job-card/g)).toHaveLength(100);
  });

  it("shows one clear regeneration state when an old run has no current catalog overlap", () => {
    const html = renderToStaticMarkup(
      <RecommendationResult
        run={succeededRun([
          recommendationItem("version-old-one"),
          recommendationItem("version-old-two"),
        ])}
        jobsByVersion={new Map()}
        isRegenerating={false}
        onRegenerate={vi.fn()}
      />,
    );

    expect(html).toContain("岗位目录已更新，需要重新生成推荐");
    expect(html).toContain("重新生成推荐");
    expect(html).not.toContain("这个推荐引用的岗位版本已不在当前目录");
    expect(html.match(/岗位目录已更新/g)).toHaveLength(1);
  });
});
