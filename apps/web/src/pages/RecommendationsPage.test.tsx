import type { JobSummary, RecommendationItem, RecommendationRun } from "@aijob/contracts";
import { renderToStaticMarkup } from "react-dom/server";
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

describe("recommendations page state", () => {
  it("ignores a stored run when start=1 requests a fresh recommendation", () => {
    expect(initialRecommendationRunId(true, "recommendation-old")).toBeNull();
    expect(initialRecommendationRunId(false, "recommendation-old")).toBe("recommendation-old");
  });

  it("partitions stale versions once instead of producing one warning per item", () => {
    const currentJob = { publishedJobVersionId: "version-current" } as JobSummary;
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
