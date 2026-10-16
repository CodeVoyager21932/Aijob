import type { CareerDataScopeResponse, LocalAccessStatus } from "@aijob/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { careerOsQueryKeys } from "../../api/career-os";
import { CareerDataControlPage, publishAssetDeletionAfterRefresh } from "./CareerDataControlPage";

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

function renderScope(
  data: CareerDataScopeResponse,
  access: LocalAccessStatus = { enabled: false },
): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(careerOsQueryKeys.dataScope, data);
  client.setQueryData(["career-os", "local-access"], access);
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
    expect(html).toContain("旧版临时资料");
    expect(html).toContain("用邮箱认领这个本机身份");
    expect(html).toContain("认领不会复制或替换已有职业资产");
    expect(html).toContain("产品实习生");
    expect(html).toContain("前往简历资产管理");
    expect(html).not.toContain("最长保留 30 天");
    expect(visibleText).not.toMatch(/M1|M2|M3|Phase|PoC/);
  });

  it("distinguishes an account-managed owner from the anonymous fallback", () => {
    const html = renderScope(scope("account_managed"));
    expect(html).toContain("账号资料");
    expect(html).toContain("资料与上传原件保留至你主动删除");
    expect(html).not.toContain("本机匿名兼容模式");
    expect(html).not.toContain("用邮箱认领这个本机身份");
  });

  it("publishes deletion success only after the data scope refresh finishes", async () => {
    let finishRefresh: (() => void) | undefined;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    const publish = vi.fn();

    const completion = publishAssetDeletionAfterRefresh(refresh, publish);
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();

    finishRefresh?.();
    await completion;
    expect(publish).toHaveBeenCalledOnce();
  });
});

it("separates persistent guest data retention from browser access expiry", () => {
  const data = scope("anonymous_ttl");
  data.owner = {
    ...data.owner,
    retentionMode: "persistent_guest",
    retentionExpiresAt: null,
    accountId: null,
  };
  const html = renderScope(data);
  expect(html).toContain("当前浏览器的资料");
  expect(html).toContain("资料与上传原件保留至你主动删除");
  expect(html).toContain("用邮箱认领这个本机身份");
  expect(html).toContain("不会删除简历或配置");
  expect(html).not.toContain("当前本机身份将于");
});

it("shows automatic access and recovery controls for local persistent guests without requiring email", () => {
  const data = scope("anonymous_ttl");
  data.owner = {
    ...data.owner,
    retentionMode: "persistent_guest",
    retentionExpiresAt: null,
    accountId: null,
  };
  const html = renderScope(data, {
    enabled: true,
    browserRemembered: true,
    recoveryCreatedAt: null,
  });
  expect(html).toContain("已记住此浏览器");
  expect(html).toContain("下载恢复文件");
  expect(html).toContain("用恢复文件找回资料");
  expect(html).not.toContain("用邮箱认领这个本机身份");
});
