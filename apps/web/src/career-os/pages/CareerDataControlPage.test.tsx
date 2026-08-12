import type { CareerDataScopeResponse } from "@aijob/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { careerOsQueryKeys } from "../../api/career-os";
import { CareerDataControlPage } from "./CareerDataControlPage";

const timestamp = "2026-08-12T00:00:00.000Z";

function scope(retentionMode: "anonymous_ttl" | "account_managed"): CareerDataScopeResponse {
  const owner: CareerDataScopeResponse["owner"] =
    retentionMode === "anonymous_ttl"
      ? {
          id: "owner-local",
          status: "active",
          epoch: 1,
          retentionMode: "anonymous_ttl",
          retentionExpiresAt: "2026-09-11T00:00:00.000Z",
          accountId: null,
          createdAt: timestamp,
          lastSeenAt: timestamp,
          deletedAt: null,
        }
      : {
          id: "owner-local",
          status: "active",
          epoch: 1,
          retentionMode: "account_managed",
          retentionExpiresAt: null,
          accountId: "account-local",
          createdAt: timestamp,
          lastSeenAt: timestamp,
          deletedAt: null,
        };
  return {
    owner,
    sessionExpiresAt: "2026-09-11T00:00:00.000Z",
    counts: {
      currentFacts: 2,
      currentPreferences: 1,
      currentEvidence: 1,
      profileFactRevisions: 1,
      preferenceRevisions: 1,
      evidenceRevisions: 1,
      resumeDocumentRevisions: 1,
      resumeAnalysisMetadata: 1,
      resumeAnalysisContentPendingDeletion: 0,
      applicationCases: 0,
      privateJobSnapshots: 1,
      resumeDocuments: 1,
      detachedResumeDocuments: 1,
      resumeReviewRuns: 1,
      interviewSessions: 1,
      detachedInterviewSessions: 1,
      debriefs: 1,
      detachedDebriefs: 1,
      knowledgeClips: 0,
      legacyJobDecisions: 1,
      legacyMatchRuns: 0,
      legacyRecommendationRuns: 0,
      legacyInsightRuns: 0,
      legacyTailoringRuns: 0,
      legacyExports: 0,
      deletionAudits: 0,
    },
    detachedAssets: [
      {
        kind: "interview_session",
        id: "11111111-1111-4111-8111-111111111111",
        revision: 2,
        title: "产品实习生",
        companyName: "示例企业",
        status: "completed",
        createdAt: timestamp,
      },
      {
        kind: "debrief",
        id: "22222222-2222-4222-8222-222222222222",
        revision: 1,
        title: "产品实习生",
        companyName: "示例企业",
        status: "confirmed",
        createdAt: timestamp,
      },
    ],
    detachedAssetsTruncated: false,
  };
}

function renderScope(data: CareerDataScopeResponse): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(careerOsQueryKeys.dataScope, data);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CareerDataControlPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Career data control truth", () => {
  it("shows the real anonymous expiry and detached asset controls", () => {
    const html = renderScope(scope("anonymous_ttl"));
    const visibleText = html.replace(/<[^>]+>/g, " ");
    expect(html).toContain("本机匿名兼容模式");
    expect(html).toContain("邮箱账号与长期认领尚未在本地版本启用");
    expect(html).toContain("产品实习生");
    expect(html).toContain("前往简历资产管理");
    expect(html).not.toContain("最长保留 30 天");
    expect(visibleText).not.toMatch(/M1|M2|M3|Phase|PoC/);
  });

  it("distinguishes an account-managed owner from the anonymous fallback", () => {
    const html = renderScope(scope("account_managed"));
    expect(html).toContain("长期账号管理");
    expect(html).toContain("没有固定自动到期日");
    expect(html).not.toContain("本机匿名兼容模式");
  });
});
