import type { ApplicationCaseWithJobContext, ResumeDocument } from "@aijob/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  careerOsQueryKeys,
  createResumeDocument,
  getCareerOsEvidence,
  listResumeDocumentContent,
  listResumeDocumentLayout,
  listResumeDocuments,
} from "../../api/career-os";
import { createIdempotencyKey, ProductApiError } from "../../api/client";
import { toApplicationCaseView } from "../application-case-view";
import { Icon } from "../components/Icon";
import { ResumeBlockInspector } from "../components/ResumeBlockInspector";
import { findResumeBlock, orderResumeSections } from "../resume-view";

function shouldOpenInspectorByDefault(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
}

function templateLabel(templateKey: string): string {
  return templateKey === "cn_compact_technical" ? "中文紧凑技术" : "中文经典单栏";
}

export function CaseResumeWorkspace({
  applicationCase,
}: {
  applicationCase: ApplicationCaseWithJobContext;
}) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [isInspectorOpen, setInspectorOpen] = useState(shouldOpenInspectorByDefault);
  const createCommandRef = useRef<{ signature: string; key: string } | null>(null);

  const derivedQuery = useQuery({
    queryKey: careerOsQueryKeys.resumeDocuments({
      kind: "case_derived",
      caseId: applicationCase.id,
    }),
    queryFn: ({ signal }) =>
      listResumeDocuments({ kind: "case_derived", caseId: applicationCase.id, limit: 100 }, signal),
  });
  const derivedDocument = derivedQuery.data?.items.find(
    (document): document is Extract<ResumeDocument, { kind: "case_derived" }> =>
      document.kind === "case_derived",
  );
  const baseQuery = useQuery({
    queryKey: careerOsQueryKeys.resumeDocuments({ kind: "base" }),
    queryFn: ({ signal }) => listResumeDocuments({ kind: "base", limit: 100 }, signal),
    enabled: derivedQuery.isSuccess && !derivedDocument,
  });
  const evidenceQuery = useQuery({
    queryKey: careerOsQueryKeys.evidence,
    queryFn: ({ signal }) => getCareerOsEvidence(signal),
    enabled: derivedQuery.isSuccess && !derivedDocument,
  });
  const contentQuery = useQuery({
    queryKey: careerOsQueryKeys.resumeContent(derivedDocument?.id ?? ""),
    queryFn: ({ signal }) => listResumeDocumentContent(derivedDocument?.id ?? "", signal),
    enabled: Boolean(derivedDocument),
  });
  const layoutQuery = useQuery({
    queryKey: careerOsQueryKeys.resumeLayout(derivedDocument?.id ?? ""),
    queryFn: ({ signal }) => listResumeDocumentLayout(derivedDocument?.id ?? "", signal),
    enabled: Boolean(derivedDocument),
  });

  const baseDocuments = useMemo(
    () =>
      (baseQuery.data?.items ?? [])
        .filter(
          (document): document is Extract<ResumeDocument, { kind: "base" }> =>
            document.kind === "base" && document.currentContentRevisionId !== null,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [baseQuery.data?.items],
  );
  const selectedBase =
    baseDocuments.find((document) => document.id === selectedBaseId) ?? baseDocuments[0];
  const hasEvidence = Boolean(
    evidenceQuery.data && "id" in evidenceQuery.data && evidenceQuery.data.evidence.length > 0,
  );

  const createMutation = useMutation({
    mutationFn: ({
      baseDocumentRevisionId,
      idempotencyKey,
    }: {
      baseDocumentRevisionId: string;
      idempotencyKey: string;
    }) =>
      createResumeDocument(
        {
          kind: "case_derived",
          caseId: applicationCase.id,
          baseDocumentRevisionId,
          expectedCaseRevision: applicationCase.revision,
          title:
            `${toApplicationCaseView(applicationCase).companyName} · ${toApplicationCaseView(applicationCase).roleTitle} 岗位简历`.slice(
              0,
              200,
            ),
        },
        idempotencyKey,
      ),
    retry: false,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.resumeDocuments({
            kind: "case_derived",
            caseId: applicationCase.id,
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseDetail(applicationCase.id),
        }),
        queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.caseList() }),
      ]);
    },
    onError: (error) => {
      if (!(error instanceof ProductApiError)) return;
      if (error.code === "RESUME_DOCUMENT_FOR_CASE_EXISTS") {
        void queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.resumeDocuments({
            kind: "case_derived",
            caseId: applicationCase.id,
          }),
        });
      }
      if (error.code === "APPLICATION_CASE_REVISION_CONFLICT") {
        void queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseDetail(applicationCase.id),
        });
      }
    },
  });

  const createDerivedResume = () => {
    const baseDocumentRevisionId = selectedBase?.currentContentRevisionId;
    if (!baseDocumentRevisionId || !hasEvidence) return;
    const signature = `${applicationCase.id}:${applicationCase.revision}:${baseDocumentRevisionId}`;
    if (!createCommandRef.current || createCommandRef.current.signature !== signature) {
      createCommandRef.current = {
        signature,
        key: createIdempotencyKey("case-resume"),
      };
    }
    createMutation.mutate({
      baseDocumentRevisionId,
      idempotencyKey: createCommandRef.current.key,
    });
  };

  const contentRevision = contentQuery.data?.current ?? null;
  const layoutRevision = layoutQuery.data?.current ?? null;
  const sections = useMemo(
    () => (contentRevision ? orderResumeSections(contentRevision, layoutRevision) : []),
    [contentRevision, layoutRevision],
  );
  const requestedBlockId = searchParams.get("block");
  const blockSelection = findResumeBlock(sections, requestedBlockId);
  const selectedBlock = blockSelection.selected;

  useEffect(() => {
    if (!requestedBlockId || sections.length === 0) return;
    if (blockSelection.requestedBlockExists) {
      setInspectorOpen(true);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("block");
    setSearchParams(next, { replace: true });
    const fallback = sections[0]?.blocks[0];
    window.requestAnimationFrame(() => {
      if (fallback) {
        document
          .querySelector<HTMLButtonElement>(`[data-resume-block-trigger="${fallback.id}"]`)
          ?.focus();
      }
    });
  }, [
    blockSelection.requestedBlockExists,
    requestedBlockId,
    searchParams,
    sections,
    setSearchParams,
  ]);

  const selectBlock = useCallback(
    (blockId: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("block", blockId);
      next.delete("requirement");
      setSearchParams(next);
      setInspectorOpen(true);
    },
    [searchParams, setSearchParams],
  );
  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    if (!selectedBlock) return;
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-resume-block-trigger="${selectedBlock.id}"]`)
        ?.focus();
    });
  }, [selectedBlock]);

  if (derivedQuery.isPending) {
    return <output className="career-request-state">正在查找岗位简历…</output>;
  }
  if (derivedQuery.isError) {
    return (
      <div className="career-request-state career-inline-error" role="alert">
        <strong>岗位简历暂时无法读取</strong>
        <span>
          {derivedQuery.error instanceof Error ? derivedQuery.error.message : "请稍后重试。"}
        </span>
        <button type="button" onClick={() => void derivedQuery.refetch()}>
          重新读取
        </button>
      </div>
    );
  }

  if (!derivedDocument) {
    const prerequisiteLoading = baseQuery.isPending || evidenceQuery.isPending;
    const prerequisiteError = baseQuery.error ?? evidenceQuery.error;
    const ready = Boolean(selectedBase?.currentContentRevisionId && hasEvidence);
    return (
      <section className="career-resume-prerequisite" aria-labelledby="resume-prerequisite-title">
        <span className="career-resume-prerequisite__icon">
          <Icon name="document" />
        </span>
        <div>
          <p>M1 · 显式创建</p>
          <h2 id="resume-prerequisite-title">
            {ready ? "创建这份岗位派生简历" : "请先准备并确认基础简历"}
          </h2>
          <p>
            {ready
              ? "系统会固定当前基础内容修订、岗位版本与证据修订；打开页面本身不会写入数据。"
              : "M1 不创建空白正文，也不在这里执行 V1→V2 编辑迁移。"}
          </p>

          {prerequisiteLoading ? <output>正在核对基础简历与证据…</output> : null}
          {prerequisiteError ? (
            <div className="career-inline-error" role="alert">
              <strong>前置条件暂时无法核对</strong>
              <span>
                {prerequisiteError instanceof Error ? prerequisiteError.message : "请稍后重试。"}
              </span>
            </div>
          ) : null}

          {ready ? (
            <label className="career-resume-base-select">
              <span>基础简历</span>
              <select
                value={selectedBase?.id ?? ""}
                disabled={createMutation.isPending}
                onChange={(event) => setSelectedBaseId(event.target.value)}
              >
                {baseDocuments.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {createMutation.isError ? (
            <div className="career-inline-error" role="alert">
              <strong>岗位简历没有创建</strong>
              <span>
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : "请核对后重试。"}
              </span>
            </div>
          ) : null}

          <div className="career-resume-prerequisite__actions">
            {!ready ? (
              <Link className="career-button career-button--quiet" to="/resume">
                前往基础简历
              </Link>
            ) : null}
            {ready ? (
              <button
                className="career-button career-button--primary"
                type="button"
                disabled={createMutation.isPending}
                onClick={createDerivedResume}
              >
                {createMutation.isPending ? "正在创建…" : "创建岗位简历"}
              </button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  if (contentQuery.isPending || layoutQuery.isPending) {
    return <output className="career-request-state">正在读取简历内容与布局…</output>;
  }
  if (contentQuery.isError || layoutQuery.isError) {
    const error = contentQuery.error ?? layoutQuery.error;
    return (
      <div className="career-request-state career-inline-error" role="alert">
        <strong>简历内容或布局暂时无法读取</strong>
        <span>{error instanceof Error ? error.message : "请稍后重试。"}</span>
      </div>
    );
  }
  if (!contentRevision || !layoutRevision || sections.length === 0 || !selectedBlock) {
    return (
      <div className="career-empty-state">
        <strong>这份岗位简历还没有可显示的正文或布局</strong>
        <p>系统不会载入静态简历填补空白。</p>
      </div>
    );
  }

  const applicationCaseView = toApplicationCaseView(applicationCase);
  return (
    <div className="career-case-detail-layout career-resume-layout">
      <div className="career-case-detail-layout__main">
        <header className="career-resume-toolbar">
          <div>
            <p>{derivedDocument.title}</p>
            <strong>只读 · 内容修订 {contentRevision.documentRevision}</strong>
          </div>
          <div className="career-resume-template-readonly">
            <span>模板</span>
            <strong>{templateLabel(layoutRevision.templateKey)}</strong>
          </div>
        </header>

        <div className="career-resume-studio">
          <aside className="career-resume-rail" aria-label="简历结构">
            <section>
              <header>
                <h2>简历结构</h2>
                <span>{sections.length} 节</span>
              </header>
              <nav aria-label="简历章节">
                {sections.map((section) => {
                  const firstBlock = section.blocks[0];
                  if (!firstBlock) return null;
                  const isActive = section.blocks.some((block) => block.id === selectedBlock.id);
                  return (
                    <button
                      key={section.id}
                      type="button"
                      className={isActive ? "is-active" : undefined}
                      onClick={() => selectBlock(firstBlock.id)}
                    >
                      <Icon name="document" size={17} />
                      <span>{section.title}</span>
                      <small>{section.blocks.length}</small>
                      <Icon name="chevron" size={15} />
                    </button>
                  );
                })}
              </nav>
            </section>
          </aside>

          <main className="career-resume-preview" aria-label="A4 简历预览">
            <div className="career-resume-preview__bar">
              <span>A4 只读预览</span>
              <span>{templateLabel(layoutRevision.templateKey)}</span>
            </div>
            <article
              className={`career-resume-sheet career-resume-sheet--${layoutRevision.templateKey === "cn_compact_technical" ? "compact" : "classic"}`}
            >
              <header>
                <div>
                  <h2>{derivedDocument.title}</h2>
                  <p>固定基础内容与已确认证据</p>
                </div>
                <strong>{applicationCaseView.roleTitle}</strong>
              </header>
              {sections.map((section) => (
                <section key={section.id} aria-labelledby={`resume-section-${section.id}`}>
                  <h3 id={`resume-section-${section.id}`}>{section.title}</h3>
                  {section.blocks.map((block) => (
                    <button
                      key={block.id}
                      type="button"
                      className={`career-resume-block${selectedBlock.id === block.id ? " is-selected" : ""}`}
                      aria-pressed={selectedBlock.id === block.id}
                      aria-label={`查看简历区块 ${section.title}`}
                      data-resume-block-trigger={block.id}
                      onClick={() => selectBlock(block.id)}
                    >
                      <span className="career-resume-block__bullet">{block.text}</span>
                    </button>
                  ))}
                </section>
              ))}
            </article>
            <p className="career-resume-preview__note">
              M1 只读取固定内容与布局，不提供编辑、AI 或导出。
            </p>
          </main>
        </div>
      </div>

      <div className={`career-context-panel${isInspectorOpen ? " is-open" : ""}`}>
        <ResumeBlockInspector
          applicationCase={applicationCaseView}
          block={selectedBlock}
          baseDocumentRevisionId={derivedDocument.baseDocumentRevisionId}
          evidenceRevisionId={derivedDocument.evidenceRevisionId}
          onClose={closeInspector}
        />
      </div>
      {isInspectorOpen ? (
        <button
          className="career-context-panel-backdrop"
          type="button"
          aria-label="关闭简历区块检查器"
          onClick={closeInspector}
        />
      ) : null}
    </div>
  );
}
