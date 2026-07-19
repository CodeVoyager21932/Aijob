import type { ResumeTailoringSegment } from "@aijob/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fileDownloadUrl } from "../api/client";
import {
  createResumeExport,
  getResumeExport,
  getResumeTailoring,
  putTailoringSegment,
} from "../api/product";
import {
  JourneySteps,
  ProductEmpty,
  ProductError,
  ProductLoading,
} from "../components/ProductStates";
import { formatDateTime } from "../product/domain";
import { readJourneyId, scopedJourneyId, writeJourneyId } from "../product/session-state";

const segmentDecisionLabels: Record<ResumeTailoringSegment["decision"], string> = {
  pending: "待决定",
  accepted: "已接受",
  rejected: "已保留原文",
  edited: "已保存编辑",
};

export function ResumeTailoringPage() {
  const { runId = "" } = useParams();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [exportId, setExportId] = useState(() =>
    scopedJourneyId(runId, readJourneyId("tailoringRunId"), readJourneyId("exportId")),
  );

  useEffect(() => {
    setExportId(scopedJourneyId(runId, readJourneyId("tailoringRunId"), readJourneyId("exportId")));
    setCopyState("idle");
  }, [runId]);

  const runQuery = useQuery({
    queryKey: ["product", "tailoring", runId],
    queryFn: ({ signal }) => getResumeTailoring(runId, signal),
    enabled: Boolean(runId),
    refetchInterval: (query) =>
      ["queued", "processing"].includes(query.state.data?.status ?? "") ? 800 : false,
  });
  useEffect(() => {
    if (!runQuery.data) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const segment of runQuery.data.segments) {
        if (!(segment.id in next)) {
          next[segment.id] = segment.editedText ?? segment.suggestedText;
        }
      }
      return next;
    });
  }, [runQuery.data]);

  const segmentMutation = useMutation({
    mutationFn: ({
      segment,
      action,
    }: {
      segment: ResumeTailoringSegment;
      action: "accepted" | "rejected" | "edited";
    }) =>
      putTailoringSegment(
        runId,
        segment.id,
        action === "edited"
          ? { decision: "edited", editedText: drafts[segment.id] || segment.suggestedText }
          : { decision: action },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product", "tailoring", runId] }),
  });

  const exportMutation = useMutation({
    mutationFn: () => createResumeExport(runId),
    onSuccess: (result) => {
      setExportId(result.id);
      writeJourneyId("tailoringRunId", runId);
      writeJourneyId("exportId", result.id);
    },
  });
  const exportQuery = useQuery({
    queryKey: ["product", "resume-export", exportId],
    queryFn: ({ signal }) => getResumeExport(exportId || "", signal),
    enabled: Boolean(exportId),
    refetchInterval: (query) =>
      ["queued", "processing"].includes(query.state.data?.status ?? "") ? 700 : false,
  });
  useEffect(() => {
    if (!exportQuery.data || exportQuery.data.tailoringRunId === runId) return;
    setExportId(null);
    writeJourneyId("exportId", null);
  }, [exportQuery.data, runId]);

  const finalText = useMemo(
    () =>
      (runQuery.data?.segments ?? [])
        .map((segment) => {
          if (segment.decision === "accepted") return segment.suggestedText;
          if (segment.decision === "edited") return segment.editedText || segment.originalText;
          return segment.originalText;
        })
        .join("\n\n"),
    [runQuery.data],
  );

  async function copyFinalText() {
    try {
      await navigator.clipboard.writeText(finalText);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  if (runQuery.isPending) return <ProductLoading label="正在读取简历优化任务" />;
  if (runQuery.isError) return <ProductError error={runQuery.error} />;
  const run = runQuery.data;
  if (run.status === "queued" || run.status === "processing") {
    return <ProductLoading label="正在生成可追溯的逐段修改稿" />;
  }
  if (run.status !== "succeeded") {
    return (
      <ProductError
        title="本次简历优化没有完成"
        error={new Error(run.failureCode || "推荐与岗位浏览仍可继续使用。")}
        action={
          <Link className="button button--secondary" to="/recommendations">
            返回岗位推荐
          </Link>
        }
      />
    );
  }

  return (
    <>
      <JourneySteps current={4} />
      <header className="product-hero">
        <div>
          <p className="eyebrow">修改权始终在你手里</p>
          <h1>逐段审核岗位定向简历</h1>
          <p>
            每条建议必须回指岗位要求与已确认经历证据。接受、拒绝或编辑后，再复制或导出统一 ATS 友好
            DOCX。
          </p>
        </div>
        <span className={`product-chip ${run.usedTemplateFallback ? "is-warning" : ""}`}>
          {run.usedTemplateFallback ? "安全模板降级" : "受控 AI"}
        </span>
      </header>

      {run.usedTemplateFallback ? (
        <div className="product-callout is-warning" aria-live="polite">
          <strong>当前使用确定性安全模板</strong>
          <p>AI 未启用或供应商暂不可用；建议不会创造新事实，核心推荐链路不受影响。</p>
        </div>
      ) : null}

      {run.segments.length === 0 ? (
        <ProductEmpty title="没有可展示的简历片段">
          <p>请确认至少一段经历证据后，重新从岗位详情创建优化任务。</p>
        </ProductEmpty>
      ) : (
        <ol className="tailoring-list">
          {run.segments.map((segment, index) => (
            <li key={segment.id}>
              <article className="tailoring-segment">
                <header>
                  <div>
                    <span>片段 {index + 1}</span>
                    <strong>
                      {segment.decision === "pending"
                        ? "待决定"
                        : segment.decision === "accepted"
                          ? "已接受"
                          : segment.decision === "rejected"
                            ? "已拒绝"
                            : "已编辑"}
                    </strong>
                  </div>
                  <span className={`segment-status is-${segment.decision}`}>
                    {segmentDecisionLabels[segment.decision]}
                  </span>
                </header>
                <div className="tailoring-compare">
                  <section>
                    <h2>原文</h2>
                    <p>{segment.originalText}</p>
                  </section>
                  <section>
                    <h2>建议稿</h2>
                    <textarea
                      rows={6}
                      value={drafts[segment.id] ?? segment.suggestedText}
                      onChange={(event) =>
                        setDrafts({ ...drafts, [segment.id]: event.target.value })
                      }
                      aria-label={`片段 ${index + 1} 建议稿`}
                    />
                  </section>
                </div>
                <div className="segment-evidence">
                  <strong>为什么修改</strong>
                  <p>{segment.reason}</p>
                  <small>
                    岗位要求：{segment.requirementIds.join("、")} · 简历证据：
                    {segment.evidenceIds.join("、")}
                  </small>
                </div>
                <div className="segment-actions">
                  <button
                    className="button button--primary"
                    type="button"
                    disabled={segmentMutation.isPending}
                    onClick={() => segmentMutation.mutate({ segment, action: "accepted" })}
                  >
                    接受建议
                  </button>
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={segmentMutation.isPending}
                    onClick={() => segmentMutation.mutate({ segment, action: "edited" })}
                  >
                    保存我的编辑
                  </button>
                  <button
                    className="button button--ghost"
                    type="button"
                    disabled={segmentMutation.isPending}
                    onClick={() => segmentMutation.mutate({ segment, action: "rejected" })}
                  >
                    保留原文
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ol>
      )}
      {segmentMutation.isError ? (
        <ProductError title="片段决定没有保存成功" error={segmentMutation.error} />
      ) : null}

      <section className="product-panel export-panel" aria-labelledby="export-heading">
        <div>
          <p className="eyebrow">可继续编辑的统一格式</p>
          <h2 id="export-heading">复制或导出最终文本</h2>
          <p>拒绝和未决定的片段保留原文；接受的片段使用建议稿；编辑的片段使用你的版本。</p>
        </div>
        <div className="export-actions">
          <button
            className="button button--secondary"
            type="button"
            disabled={!finalText}
            onClick={() => void copyFinalText()}
          >
            {copyState === "copied"
              ? "已复制"
              : copyState === "failed"
                ? "复制失败，请手动选择"
                : "复制最终文本"}
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={exportMutation.isPending || run.segments.length === 0}
            onClick={() => exportMutation.mutate()}
          >
            {exportMutation.isPending ? "正在创建导出…" : "生成 ATS 友好 DOCX"}
          </button>
        </div>
        {exportMutation.isError ? (
          <ProductError title="导出任务没有创建成功" error={exportMutation.error} />
        ) : null}
        {exportQuery.data?.tailoringRunId === runId ? (
          <ExportStatus exportResult={exportQuery.data} />
        ) : null}
      </section>
    </>
  );
}

function ExportStatus({
  exportResult,
}: {
  exportResult: Awaited<ReturnType<typeof getResumeExport>>;
}) {
  if (exportResult.status === "queued" || exportResult.status === "processing") {
    return <ProductLoading label="正在生成 DOCX" />;
  }
  if (exportResult.status !== "succeeded") {
    return (
      <ProductError
        title="DOCX 生成失败"
        error={new Error(exportResult.failureCode || "请稍后重新生成。")}
      />
    );
  }
  return (
    <div className="export-ready" aria-live="polite">
      <div>
        <strong>{exportResult.fileName}</strong>
        <span>
          {exportResult.byteSize?.toLocaleString() || "未知"} 字节 ·{" "}
          {formatDateTime(exportResult.expiresAt)} 前可下载
        </span>
      </div>
      <a
        className="button button--primary"
        href={fileDownloadUrl(`/v1/resume-exports/${encodeURIComponent(exportResult.id)}/file`)}
      >
        下载 DOCX
      </a>
    </div>
  );
}
