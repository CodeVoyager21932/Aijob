import type { ResumeTailoringSegment } from "@aijob/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fileDownloadUrl, ProductApiError } from "../api/client";
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

function growTextarea(event: FormEvent<HTMLTextAreaElement>): void {
  event.currentTarget.style.height = "auto";
  event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
}

const segmentDecisionLabels: Record<ResumeTailoringSegment["decision"], string> = {
  pending: "待决定",
  accepted: "已接受",
  rejected: "已保留原文",
  edited: "已保存编辑",
};

export function ResumeTailoringPage({ readOnly = false }: { readOnly?: boolean }) {
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
    retry: (failureCount, error) =>
      error instanceof ProductApiError && error.status === 404 ? false : failureCount < 1,
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
    }) => {
      if (readOnly) throw new Error("这条旧简历优化记录当前只读。");
      return putTailoringSegment(
        runId,
        segment.id,
        action === "edited"
          ? { decision: "edited", editedText: drafts[segment.id] || segment.suggestedText }
          : { decision: action },
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product", "tailoring", runId] }),
  });

  const exportMutation = useMutation({
    mutationFn: () => {
      if (readOnly) throw new Error("只读历史不能创建新的导出。");
      return createResumeExport(runId);
    },
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

  const finalText = useMemo(() => {
    const output: string[] = [];
    let previousSection = "";
    for (const segment of runQuery.data?.segments ?? []) {
      if (segment.sectionId !== previousSection) {
        output.push(segment.sectionTitle);
        previousSection = segment.sectionId;
      }
      const text =
        segment.decision === "accepted"
          ? segment.suggestedText
          : segment.decision === "edited"
            ? segment.editedText || segment.originalText
            : segment.originalText;
      output.push(text);
    }
    return output.join("\n\n");
  }, [runQuery.data]);

  async function copyFinalText() {
    try {
      await navigator.clipboard.writeText(finalText);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  if (runQuery.isPending) {
    return readOnly ? (
      <section className="career-legacy-tailoring career-legacy-tailoring--state">
        <output className="career-request-state">正在读取旧版简历优化历史…</output>
      </section>
    ) : (
      <ProductLoading label="正在读取简历优化任务" />
    );
  }
  if (runQuery.isError) {
    if (readOnly) {
      const notFound =
        runQuery.error instanceof ProductApiError && runQuery.error.status === 404;
      return (
        <section className="career-legacy-tailoring career-legacy-tailoring--state">
          <div className="career-inline-error" role="alert">
            <strong>{notFound ? "没有找到这条旧版优化历史" : "旧版优化历史暂时不可用"}</strong>
            <span>
              {notFound
                ? "记录不存在、已删除或不属于当前 owner。"
                : runQuery.error instanceof Error
                  ? runQuery.error.message
                  : "请稍后重试。"}
            </span>
            {!notFound ? (
              <button type="button" onClick={() => void runQuery.refetch()}>
                重新读取
              </button>
            ) : null}
            <Link to="/resumes">返回简历资产</Link>
          </div>
        </section>
      );
    }
    return <ProductError error={runQuery.error} />;
  }
  const run = runQuery.data;
  if (run.status === "queued" || run.status === "processing") {
    return readOnly ? (
      <section className="career-legacy-tailoring career-legacy-tailoring--state">
        <output className="career-request-state">旧版优化记录仍在处理中…</output>
      </section>
    ) : (
      <ProductLoading label="正在生成可追溯的逐段修改稿" />
    );
  }
  if (run.status !== "succeeded") {
    return (
      <ProductError
        title="本次简历优化没有完成"
        error={new Error(run.failureCode || "推荐与岗位浏览仍可继续使用。")}
        action={
          <Link
            className="button button--secondary"
            to={readOnly ? "/applications" : "/recommendations"}
          >
            {readOnly ? "返回我的求职" : "返回岗位推荐"}
          </Link>
        }
      />
    );
  }

  return (
    <div className={readOnly ? "career-legacy-tailoring" : undefined}>
      {readOnly ? null : <JourneySteps current={4} />}
      <header className="product-hero">
        <div>
          <p className="eyebrow">{readOnly ? "旧版优化历史" : "修改权始终在你手里"}</p>
          <h1>{readOnly ? "查看旧版岗位定向简历" : "逐段审核岗位定向简历"}</h1>
          <p>
            {readOnly
              ? "这里保留你过去的原文、建议和决定，不会猜测绑定到新的求职项目，也不会产生新的修改或导出。"
              : "每条建议必须回指岗位要求与已确认经历证据。接受、拒绝或编辑后，再复制或导出统一 ATS 友好 DOCX。"}
          </p>
        </div>
        <span className={`product-chip ${run.usedTemplateFallback ? "is-warning" : ""}`}>
          {run.usedTemplateFallback ? "安全模板降级" : "受控 AI"}
        </span>
      </header>

      {readOnly ? (
        <div className="product-callout" aria-live="polite">
          <strong>这是一条只读历史</strong>
          <p>你仍可查看、复制，并下载仍在有效期内的既有文件。新的岗位简历请从求职项目创建。</p>
          <Link className="button button--secondary" to="/applications">
            打开我的求职
          </Link>
        </div>
      ) : null}

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
                    <span>{segment.sectionTitle}</span>
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
                      rows={Math.min(
                        16,
                        Math.max(
                          3,
                          (drafts[segment.id] ?? segment.suggestedText).split("\n").length +
                            Math.ceil((drafts[segment.id] ?? segment.suggestedText).length / 48),
                        ),
                      )}
                      value={drafts[segment.id] ?? segment.suggestedText}
                      readOnly={readOnly}
                      onInput={growTextarea}
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
                  {segment.requirementCitations?.length ? (
                    <div>
                      <strong>岗位原句</strong>
                      <ul>
                        {segment.requirementCitations.map((citation) => (
                          <li key={citation.id}>{citation.sourceText}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {segment.evidenceCitations?.length ? (
                    <div>
                      <strong>证据摘要</strong>
                      <ul>
                        {segment.evidenceCitations.map((citation) => (
                          <li key={citation.id}>{citation.statement}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <small>该区块未被改写，按原章节和原顺序保留。</small>
                  )}
                </div>
                {readOnly ? null : (
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
                )}
              </article>
            </li>
          ))}
        </ol>
      )}
      {segmentMutation.isError ? (
        <ProductError title="片段决定没有保存成功" error={segmentMutation.error} />
      ) : null}

      <section className="product-panel final-resume-preview" aria-labelledby="preview-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">最终完整预览</p>
            <h2 id="preview-heading">按真实章节组合的简历文本</h2>
          </div>
        </div>
        <pre>{finalText}</pre>
      </section>

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
          {readOnly ? null : (
            <button
              className="button button--primary"
              type="button"
              disabled={exportMutation.isPending || run.segments.length === 0}
              onClick={() => exportMutation.mutate()}
            >
              {exportMutation.isPending ? "正在创建导出…" : "生成 ATS 友好 DOCX"}
            </button>
          )}
        </div>
        {!readOnly && exportMutation.isError ? (
          <ProductError title="导出任务没有创建成功" error={exportMutation.error} />
        ) : null}
        {exportQuery.data?.tailoringRunId === runId ? (
          <ExportStatus exportResult={exportQuery.data} />
        ) : null}
      </section>
    </div>
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
