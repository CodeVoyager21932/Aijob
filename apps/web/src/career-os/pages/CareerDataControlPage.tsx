import type { DetachedCareerAsset } from "@aijob/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  careerOsQueryKeys,
  deleteDebrief,
  deleteInterviewSession,
  getCareerDataScope,
} from "../../api/career-os";
import { deleteProfile } from "../../api/product";
import { ProductError, ProductLoading } from "../../components/ProductStates";
import { clearDeletedOwnerCache } from "../../product/privacy-cache";
import { clearJourneyState } from "../../product/session-state";
import { AssetDeletionDialog } from "../components/AssetDeletionDialog";
import { Icon } from "../components/Icon";
import { OwnerClaimPanel } from "../components/OwnerClaimPanel";

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function detachedAssetLabel(asset: DetachedCareerAsset): string {
  return asset.kind === "interview_session" ? "面试练习" : "复盘";
}

function AssetCountCard({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

export function CareerDataControlPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<DetachedCareerAsset | null>(null);
  const scopeQuery = useQuery({
    queryKey: careerOsQueryKeys.dataScope,
    queryFn: ({ signal }) => getCareerDataScope(signal),
  });
  const assetDeletion = useMutation({
    retry: false,
    mutationFn: async (asset: DetachedCareerAsset) => {
      if (asset.kind === "interview_session") {
        const result = await deleteInterviewSession(asset.id, {
          expectedRevision: asset.revision,
        });
        return { id: result.sessionId, deletedAt: result.deletedAt };
      }
      const result = await deleteDebrief(asset.id, { expectedRevision: asset.revision });
      return { id: result.debriefId, deletedAt: result.deletedAt };
    },
    onSuccess: async () => {
      setSelectedAsset(null);
      await queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.dataScope });
    },
  });
  const deletion = useMutation({
    retry: false,
    mutationFn: deleteProfile,
    onSuccess: () => {
      clearDeletedOwnerCache(queryClient);
      clearJourneyState();
      navigate("/settings/data/deletion", { replace: true });
    },
  });

  if (scopeQuery.isPending) return <ProductLoading label="正在读取真实数据范围" />;
  if (scopeQuery.isError) {
    return <ProductError title="暂时无法读取数据范围" error={scopeQuery.error} />;
  }

  const scope = scopeQuery.data;
  const counts = scope.counts;
  const accountManaged = scope.owner.retentionMode === "account_managed";
  const legacyCount =
    counts.legacyJobDecisions +
    counts.legacyMatchRuns +
    counts.legacyRecommendationRuns +
    counts.legacyInsightRuns +
    counts.legacyTailoringRuns +
    counts.legacyExports;

  return (
    <section className="career-data-page" aria-labelledby="career-data-title">
      <header className="career-page-heading career-data-page__heading">
        <div>
          <p>数据与设置</p>
          <h1 id="career-data-title">由你决定保留什么</h1>
          <span>查看真实保存范围、处理脱离项目的资产，或主动删除全部个人数据。</span>
        </div>
      </header>

      <section className="career-data-retention" aria-labelledby="retention-mode-title">
        <div className="career-data-retention__icon">
          <Icon name="settings" size={22} />
        </div>
        <div>
          <p>当前保留模式</p>
          <h2 id="retention-mode-title">{accountManaged ? "长期账号管理" : "本机匿名兼容模式"}</h2>
          {accountManaged ? (
            <span>职业资产没有固定自动到期日；你可以随时单项删除或删除全部数据。</span>
          ) : (
            <span>
              当前本机身份将于{" "}
              <time dateTime={scope.owner.retentionExpiresAt ?? undefined}>
                {formatDateTime(scope.owner.retentionExpiresAt ?? scope.sessionExpiresAt)}
              </time>{" "}
              到期。你可以在到期前验证邮箱并认领当前 owner；认领不会复制或替换已有职业资产。
            </span>
          )}
          <small>当前会话到期：{formatDateTime(scope.sessionExpiresAt)}</small>
        </div>
      </section>

      {!accountManaged ? (
        <OwnerClaimPanel
          ownerEpoch={scope.owner.epoch}
          onClaimed={() => queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.dataScope })}
        />
      ) : null}

      <section className="career-data-summary" aria-label="当前个人数据摘要">
        <AssetCountCard
          label="已确认资料"
          value={counts.currentFacts + counts.currentEvidence}
          note={`${counts.currentFacts} 项事实 · ${counts.currentEvidence} 段证据`}
        />
        <AssetCountCard
          label="求职项目"
          value={counts.applicationCases}
          note={`${counts.privateJobSnapshots} 份私有 JD 快照`}
        />
        <AssetCountCard
          label="简历资产"
          value={counts.resumeDocuments}
          note={`${counts.resumeReviewRuns} 次专业审阅`}
        />
        <AssetCountCard
          label="练习与复盘"
          value={counts.interviewSessions + counts.debriefs}
          note={`${counts.interviewSessions} 次练习 · ${counts.debriefs} 份复盘`}
        />
      </section>

      <section className="career-data-panel" aria-labelledby="detached-assets-title">
        <header>
          <div>
            <p>脱离求职项目后仍保留</p>
            <h2 id="detached-assets-title">独立资产</h2>
          </div>
          <span>
            {counts.detachedResumeDocuments +
              counts.detachedInterviewSessions +
              counts.detachedDebriefs}{" "}
            项
          </span>
        </header>
        {counts.detachedResumeDocuments > 0 ? (
          <div className="career-data-detached-resumes">
            <div>
              <strong>{counts.detachedResumeDocuments} 份岗位简历</strong>
              <span>仍保留固定岗位版本和证据来源。</span>
            </div>
            <Link className="career-button career-button--quiet" to="/resumes">
              前往简历资产管理
            </Link>
          </div>
        ) : null}
        {scope.detachedAssets.length === 0 && counts.detachedResumeDocuments === 0 ? (
          <div className="career-empty-state career-empty-state--compact">
            <strong>没有脱离项目后单独保留的资产</strong>
            <span>删除 Case 时选择“同时删除”的内容也不会在这里重新出现。</span>
          </div>
        ) : (
          <ul className="career-data-asset-list">
            {scope.detachedAssets.map((asset) => (
              <li key={`${asset.kind}:${asset.id}`}>
                <div>
                  <span>{detachedAssetLabel(asset)}</span>
                  <strong>{asset.title}</strong>
                  <small>
                    {asset.companyName ? `${asset.companyName} · ` : ""}
                    {formatDateTime(asset.createdAt)}
                  </small>
                </div>
                <button
                  className="career-button career-button--danger-quiet"
                  type="button"
                  onClick={() => {
                    assetDeletion.reset();
                    setSelectedAsset(asset);
                  }}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
        {scope.detachedAssetsTruncated ? (
          <output className="career-inline-error">
            独立练习/复盘超过当前页面的 5000 项安全显示上限；总数仍按真实数据展示。
          </output>
        ) : null}
      </section>

      <section className="career-data-panel" aria-labelledby="complete-scope-title">
        <header>
          <div>
            <p>完整范围</p>
            <h2 id="complete-scope-title">系统当前保存什么</h2>
          </div>
        </header>
        <ul className="career-data-scope-list">
          <li>
            <strong>资料与历史修订</strong>
            <span>
              事实 {counts.profileFactRevisions} 版、偏好 {counts.preferenceRevisions} 版、证据{" "}
              {counts.evidenceRevisions} 版、简历内容 {counts.resumeDocumentRevisions}{" "}
              版。确认后的职业资产按当前保留模式保存。
            </span>
          </li>
          <li>
            <strong>Case 工作资料</strong>
            <span>
              {counts.applicationCases} 个求职项目（含要求、问题和时间线）、
              {counts.resumeDocuments} 份简历、
              {counts.resumeReviewRuns} 次审阅、{counts.interviewSessions} 次面试练习、
              {counts.debriefs} 份复盘。
            </span>
          </li>
          <li>
            <strong>简历原文件与解析原文</strong>
            <span>
              原文确认后立即清除，任何情况下不超过 24 小时。当前有{" "}
              {counts.resumeAnalysisContentPendingDeletion} 份内容等待确认/清除，并保留{" "}
              {counts.resumeAnalysisMetadata} 条不含原文的解析元数据。
            </span>
          </li>
          <li>
            <strong>旧流程兼容记录</strong>
            <span>
              {legacyCount} 条旧决定、匹配、推荐、洞察、优化或导出记录；新 OS
              不再并行写入，但不会在证明迁移前擅自删除。
            </span>
          </li>
          <li>
            <strong>知识与删除审计</strong>
            <span>
              {counts.knowledgeClips} 条用户知识记录；{counts.deletionAudits}{" "}
              条不含正文的删除状态审计。
            </span>
          </li>
        </ul>
      </section>

      <section
        className="career-data-panel career-data-panel--actions"
        aria-labelledby="continue-title"
      >
        <header>
          <div>
            <p>继续使用</p>
            <h2 id="continue-title">保留数据不是删除倒计时</h2>
          </div>
        </header>
        <p>你可以继续完善简历和求职项目，也可以只删除不再需要的单项资产。</p>
        <div>
          <Link className="career-button career-button--primary" to="/resumes">
            查看简历资产
          </Link>
          <Link className="career-button career-button--quiet" to="/applications">
            查看我的求职
          </Link>
          <Link className="career-button career-button--quiet" to="/resumes/import">
            重新确认简历证据
          </Link>
        </div>
      </section>

      <section className="career-data-danger" aria-labelledby="danger-title">
        <p>不可撤销</p>
        <h2 id="danger-title">删除全部个人数据</h2>
        <span>
          此操作会立即撤销当前本机身份的访问，并清除新旧流程中的个人数据；公共岗位目录不受影响。
        </span>
        <label>
          <input
            type="checkbox"
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
          />
          我理解此操作不可撤销
        </label>
        <label>
          <span>输入“删除我的数据”以确认</span>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
        </label>
        <button
          className="career-button career-button--danger"
          type="button"
          disabled={deletion.isPending || !understood || confirmation.trim() !== "删除我的数据"}
          onClick={() => deletion.mutate()}
        >
          {deletion.isPending ? "正在撤销访问…" : "永久删除全部个人数据"}
        </button>
        {deletion.isError ? <ProductError title="删除请求没有成功" error={deletion.error} /> : null}
      </section>

      <AssetDeletionDialog
        open={Boolean(selectedAsset)}
        title={`删除${selectedAsset ? detachedAssetLabel(selectedAsset) : "独立资产"}`}
        description="该记录已与原求职项目脱离，现在可以单独删除。"
        consequence="删除后它会立即从当前 owner 的数据范围消失，不能通过原 Case 恢复。"
        pending={assetDeletion.isPending}
        error={assetDeletion.error}
        onClose={() => {
          if (assetDeletion.isPending) return;
          assetDeletion.reset();
          setSelectedAsset(null);
        }}
        onConfirm={() => {
          if (selectedAsset) assetDeletion.mutate(selectedAsset);
        }}
      />
    </section>
  );
}
