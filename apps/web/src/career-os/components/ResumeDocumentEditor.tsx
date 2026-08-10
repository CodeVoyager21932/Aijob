import type {
  ResumeDocument,
  ResumeDocumentContentRevisionReadModel,
  ResumeLayoutSettings,
  ResumeSemanticContent,
  ResumeTemplateKey,
} from "@aijob/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  careerOsQueryKeys,
  getCareerOsEvidence,
  getCareerOsEvidenceRevision,
  listResumeDocumentContent,
  listResumeDocumentLayout,
  putResumeDocumentContent,
  putResumeDocumentLayout,
  resumeDocumentDocxPath,
} from "../../api/career-os";
import { apiDownload, createIdempotencyKey, ProductApiError } from "../../api/client";
import {
  addResumeBlock,
  addResumeSection,
  cloneResumeContent,
  moveResumeBlock,
  moveResumeSectionId,
  reconcileResumeSectionOrder,
  removeResumeBlock,
  removeResumeSection,
  resumeContentEquals,
  toggleResumeBlockEvidence,
  updateResumeBlock,
  updateResumeSection,
  validateResumeDraft,
} from "../resume-editor-state";
import { Icon } from "./Icon";
import { ResumeReviewPanel } from "./ResumeReviewPanel";

const DEFAULT_LAYOUT_SETTINGS: ResumeLayoutSettings = {
  schemaVersion: "resume-layout-settings-v1",
  fontSizeToken: "standard",
  lineSpacingToken: "standard",
  sectionSpacingToken: "standard",
  colorToken: "charcoal",
  pageBreakPolicy: "keep_sections",
};

function toSemanticContent(
  revision: ResumeDocumentContentRevisionReadModel,
): ResumeSemanticContent {
  if (revision.schemaVersion === "resume-content-revision-v1") {
    return cloneResumeContent(revision.content);
  }
  return {
    schemaVersion: "resume-content-v1",
    sections: revision.content.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => ({
        id: block.id,
        ordinal: block.ordinal,
        text: block.text,
        evidenceIds: [],
      })),
    })),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请稍后重试。";
}

function evidenceCopy(evidence: {
  section: string;
  statement?: string;
  claim?: string;
  originalText?: string;
}): string {
  return evidence.statement ?? evidence.claim ?? evidence.originalText ?? evidence.section;
}

function sectionOrderEquals(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function ResumeDocumentEditor({
  resumeDocument,
  contextLabel = "基础简历",
  evidenceRevisionId,
}: {
  resumeDocument: ResumeDocument;
  contextLabel?: string;
  evidenceRevisionId?: string;
}) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draftContent, setDraftContent] = useState<ResumeSemanticContent | null>(null);
  const [contentBaseRevisionId, setContentBaseRevisionId] = useState<string | null>(null);
  const [contentTouched, setContentTouched] = useState(false);
  const [layoutOrderDraft, setLayoutOrderDraft] = useState<string[]>([]);
  const [templateDraft, setTemplateDraft] = useState<ResumeTemplateKey>("cn_classic_single_column");
  const [layoutTouched, setLayoutTouched] = useState(false);
  const [contentConflict, setContentConflict] = useState(false);
  const [layoutConflict, setLayoutConflict] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const contentCommandRef = useRef<{ signature: string; key: string } | null>(null);
  const layoutCommandRef = useRef<{ signature: string; key: string } | null>(null);

  const contentQuery = useQuery({
    queryKey: careerOsQueryKeys.resumeContent(resumeDocument.id),
    queryFn: ({ signal }) => listResumeDocumentContent(resumeDocument.id, signal),
  });
  const layoutQuery = useQuery({
    queryKey: careerOsQueryKeys.resumeLayout(resumeDocument.id),
    queryFn: ({ signal }) => listResumeDocumentLayout(resumeDocument.id, signal),
  });
  const evidenceQuery = useQuery({
    queryKey: evidenceRevisionId
      ? careerOsQueryKeys.evidenceRevision(evidenceRevisionId)
      : careerOsQueryKeys.evidence,
    queryFn: ({ signal }) =>
      evidenceRevisionId
        ? getCareerOsEvidenceRevision(evidenceRevisionId, signal)
        : getCareerOsEvidence(signal),
  });

  const serverContentRevision = contentQuery.data?.current ?? null;
  const serverContent = useMemo(
    () => (serverContentRevision ? toSemanticContent(serverContentRevision) : null),
    [serverContentRevision],
  );
  const serverLayout = layoutQuery.data?.current ?? null;
  const serverSectionOrder = useMemo(
    () =>
      serverContent
        ? reconcileResumeSectionOrder(serverLayout?.sectionOrder ?? [], serverContent)
        : [],
    [serverContent, serverLayout?.sectionOrder],
  );

  useEffect(() => {
    if (!serverContentRevision || !serverContent) return;
    if (
      draftContent === null ||
      contentBaseRevisionId === null ||
      (serverContentRevision.id !== contentBaseRevisionId && !contentTouched && !contentConflict)
    ) {
      setDraftContent(cloneResumeContent(serverContent));
      setContentBaseRevisionId(serverContentRevision.id);
      setContentTouched(false);
    }
  }, [
    contentBaseRevisionId,
    contentConflict,
    contentTouched,
    draftContent,
    serverContent,
    serverContentRevision,
  ]);

  useEffect(() => {
    if (!serverContent) return;
    if (layoutOrderDraft.length === 0 || (!layoutTouched && !layoutConflict)) {
      setLayoutOrderDraft(serverSectionOrder);
      setTemplateDraft(serverLayout?.templateKey ?? "cn_classic_single_column");
    }
  }, [
    layoutConflict,
    layoutOrderDraft.length,
    layoutTouched,
    serverContent,
    serverLayout?.templateKey,
    serverSectionOrder,
  ]);

  const contentDirty = Boolean(
    draftContent && serverContent && !resumeContentEquals(draftContent, serverContent),
  );
  const reconciledLayoutOrder = useMemo(
    () =>
      draftContent ? reconcileResumeSectionOrder(layoutOrderDraft, draftContent) : layoutOrderDraft,
    [draftContent, layoutOrderDraft],
  );
  const layoutDirty = Boolean(
    serverContent &&
      (!sectionOrderEquals(reconciledLayoutOrder, serverSectionOrder) ||
        templateDraft !== serverLayout?.templateKey),
  );
  const hasUnsavedChanges = contentDirty || layoutDirty;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges]);

  const orderedSections = useMemo(() => {
    if (!draftContent) return [];
    const byId = new Map(draftContent.sections.map((section) => [section.id, section]));
    return reconciledLayoutOrder.flatMap((sectionId) => {
      const section = byId.get(sectionId);
      if (!section) return [];
      return [
        {
          ...section,
          blocks: [...section.blocks].sort(
            (left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id),
          ),
        },
      ];
    });
  }, [draftContent, reconciledLayoutOrder]);

  const requestedBlockId = searchParams.get("block");
  const allBlocks = orderedSections.flatMap((section) =>
    section.blocks.map((block) => ({ section, block })),
  );
  const selectedEntry =
    allBlocks.find(({ block }) => block.id === requestedBlockId) ?? allBlocks[0] ?? null;

  useEffect(() => {
    if (!requestedBlockId || allBlocks.length === 0) return;
    if (allBlocks.some(({ block }) => block.id === requestedBlockId)) return;
    const next = new URLSearchParams(searchParams);
    next.delete("block");
    setSearchParams(next, { replace: true });
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-resume-editor-block="${allBlocks[0]?.block.id}"]`)
        ?.focus();
    });
  }, [allBlocks, requestedBlockId, searchParams, setSearchParams]);

  const updateDraft = (updater: (current: ResumeSemanticContent) => ResumeSemanticContent) => {
    setDraftContent((current) => (current ? updater(current) : current));
    setContentTouched(true);
    setSavedMessage(null);
  };
  const selectBlock = (blockId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("block", blockId);
    next.delete("requirement");
    setSearchParams(next);
  };

  const contentMutation = useMutation({
    mutationFn: async () => {
      if (!draftContent || !contentBaseRevisionId || !contentQuery.data) {
        throw new Error("当前正文修订尚未读取完成。");
      }
      const validationErrors = validateResumeDraft(draftContent);
      if (validationErrors.length > 0) throw new Error(validationErrors[0]);
      const request = {
        expectedRevision: contentQuery.data.documentRevision,
        baseDocumentRevisionId: contentBaseRevisionId,
        content: draftContent,
      };
      const signature = JSON.stringify(request);
      if (!contentCommandRef.current || contentCommandRef.current.signature !== signature) {
        contentCommandRef.current = {
          signature,
          key: createIdempotencyKey("resume-content"),
        };
      }
      return putResumeDocumentContent(resumeDocument.id, request, contentCommandRef.current.key);
    },
    retry: false,
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.resumeContent(resumeDocument.id),
        }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.resumeLayout(resumeDocument.id),
        }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.resumeDocument(resumeDocument.id),
        }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.resumeDocuments({ kind: resumeDocument.kind }),
        }),
      ]);
      setDraftContent(cloneResumeContent(response.contentRevision.content));
      setContentBaseRevisionId(response.contentRevision.id);
      setContentTouched(false);
      setContentConflict(false);
      setSavedMessage(`正文已保存为内容修订 ${response.contentRevision.documentRevision}`);
    },
    onError: (error) => {
      if (error instanceof ProductApiError && error.code === "RESUME_DOCUMENT_REVISION_CONFLICT") {
        setContentConflict(true);
        void Promise.all([contentQuery.refetch(), layoutQuery.refetch()]);
      }
    },
  });

  const layoutMutation = useMutation({
    mutationFn: async () => {
      if (!layoutQuery.data || !serverLayout || !serverContent) {
        throw new Error("当前布局修订尚未读取完成。");
      }
      const settings =
        serverLayout.schemaVersion === "resume-layout-v2"
          ? serverLayout.settings
          : DEFAULT_LAYOUT_SETTINGS;
      const request = {
        expectedRevision: layoutQuery.data.documentRevision,
        templateKey: templateDraft,
        sectionOrder: reconciledLayoutOrder,
        settings,
      };
      const signature = JSON.stringify(request);
      if (!layoutCommandRef.current || layoutCommandRef.current.signature !== signature) {
        layoutCommandRef.current = {
          signature,
          key: createIdempotencyKey("resume-layout"),
        };
      }
      return putResumeDocumentLayout(resumeDocument.id, request, layoutCommandRef.current.key);
    },
    retry: false,
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.resumeContent(resumeDocument.id),
        }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.resumeLayout(resumeDocument.id),
        }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.resumeDocument(resumeDocument.id),
        }),
      ]);
      setLayoutOrderDraft(response.layoutRevision.sectionOrder);
      setTemplateDraft(response.layoutRevision.templateKey);
      setLayoutTouched(false);
      setLayoutConflict(false);
      setSavedMessage(`模板与章节顺序已保存为布局修订 ${response.layoutRevision.layoutRevision}`);
    },
    onError: (error) => {
      if (error instanceof ProductApiError && error.code === "RESUME_DOCUMENT_REVISION_CONFLICT") {
        setLayoutConflict(true);
        void Promise.all([contentQuery.refetch(), layoutQuery.refetch()]);
      }
    },
  });

  const docxMutation = useMutation({
    mutationFn: async () => {
      if (!serverContentRevision || !serverLayout) {
        throw new Error("当前正文或布局修订尚未读取完成。");
      }
      return apiDownload(
        resumeDocumentDocxPath({
          documentId: resumeDocument.id,
          contentRevisionId: serverContentRevision.id,
          layoutRevisionId: serverLayout.id,
        }),
      );
    },
    retry: false,
    onSuccess: ({ blob, fileName }) => {
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = fileName ?? "Aijob-简历.docx";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
      setSavedMessage("DOCX 已按当前固定修订生成，文件未在服务器落盘");
    },
  });

  if (contentQuery.isPending || layoutQuery.isPending) {
    return <output className="career-request-state">正在打开结构化编辑器…</output>;
  }
  if (contentQuery.isError || layoutQuery.isError) {
    return (
      <div className="career-inline-error" role="alert">
        <strong>简历正文或布局暂时无法读取</strong>
        <span>{errorMessage(contentQuery.error ?? layoutQuery.error)}</span>
        <button
          type="button"
          onClick={() => void Promise.all([contentQuery.refetch(), layoutQuery.refetch()])}
        >
          重新读取
        </button>
      </div>
    );
  }
  if (!draftContent || !serverContentRevision || !serverLayout || orderedSections.length === 0) {
    return (
      <div className="career-empty-state">
        <strong>当前修订没有可编辑的正文或布局</strong>
        <p>系统不会用静态简历填补空白。</p>
      </div>
    );
  }

  const validationErrors = validateResumeDraft(draftContent);
  const confirmedEvidence =
    evidenceQuery.data && "evidence" in evidenceQuery.data ? evidenceQuery.data.evidence : [];
  const selectedEvidenceIds = selectedEntry?.block.evidenceIds ?? [];
  const busy =
    contentMutation.isPending || layoutMutation.isPending || docxMutation.isPending || reviewBusy;
  const printDocument =
    typeof document === "undefined"
      ? null
      : createPortal(
          <article
            className={`career-resume-print-document${
              templateDraft === "cn_compact_technical" ? " is-compact-technical" : " is-classic"
            }`}
            aria-hidden="true"
          >
            <h1>{resumeDocument.title}</h1>
            {orderedSections.map((section) => (
              <section key={section.id}>
                <h2>{section.title}</h2>
                {section.blocks.map((block) => (
                  <p key={block.id}>{block.text}</p>
                ))}
              </section>
            ))}
          </article>,
          document.body,
        );

  return (
    <section className="career-resume-editor" aria-label={`${contextLabel}结构化编辑器`}>
      <header className="career-resume-editor__toolbar">
        <div>
          <p>{contextLabel} · 不可变修订</p>
          <strong>{resumeDocument.title}</strong>
          <span>
            正文修订 {serverContentRevision.documentRevision} · 布局修订{" "}
            {serverLayout.layoutRevision}
          </span>
        </div>
        <div className="career-resume-editor__save-actions">
          <span className={hasUnsavedChanges ? "is-dirty" : "is-saved"}>
            {hasUnsavedChanges ? "有未保存修改" : (savedMessage ?? "已与服务器同步")}
          </span>
          <label className="career-resume-editor__template-picker">
            <span>中文模板</span>
            <select
              value={templateDraft}
              disabled={busy}
              onChange={(event) => {
                const nextTemplate = event.currentTarget.value as ResumeTemplateKey;
                setTemplateDraft(nextTemplate);
                setLayoutTouched(
                  nextTemplate !== serverLayout.templateKey ||
                    !sectionOrderEquals(reconciledLayoutOrder, serverSectionOrder),
                );
                setSavedMessage(null);
              }}
            >
              <option value="cn_classic_single_column">经典单栏</option>
              <option value="cn_compact_technical">紧凑技术</option>
            </select>
          </label>
          <button
            className="career-button career-button--quiet"
            type="button"
            disabled={!hasUnsavedChanges || busy}
            onClick={() => {
              if (!serverContent || !serverContentRevision) return;
              setDraftContent(cloneResumeContent(serverContent));
              setContentBaseRevisionId(serverContentRevision.id);
              setContentTouched(false);
              setLayoutOrderDraft(serverSectionOrder);
              setTemplateDraft(serverLayout.templateKey);
              setLayoutTouched(false);
              setContentConflict(false);
              setLayoutConflict(false);
              setSavedMessage("已放弃本地未保存修改");
            }}
          >
            放弃修改
          </button>
          <button
            className="career-button career-button--quiet"
            type="button"
            disabled={!layoutDirty || contentDirty || busy || layoutConflict}
            onClick={() => layoutMutation.mutate()}
          >
            保存模板与排序
          </button>
          <button
            className="career-button career-button--primary"
            type="button"
            disabled={!contentDirty || busy || contentConflict || validationErrors.length > 0}
            onClick={() => contentMutation.mutate()}
          >
            {contentMutation.isPending ? "正在保存…" : "保存正文修订"}
          </button>
          <button
            className="career-button career-button--quiet"
            type="button"
            disabled={hasUnsavedChanges || busy || contentConflict || layoutConflict}
            onClick={() => window.print()}
          >
            浏览器打印
          </button>
          <button
            className="career-button career-button--quiet"
            type="button"
            disabled={hasUnsavedChanges || busy || contentConflict || layoutConflict}
            onClick={() => docxMutation.mutate()}
          >
            {docxMutation.isPending ? "正在生成 DOCX…" : "下载 DOCX"}
          </button>
        </div>
      </header>

      {contentConflict ? (
        <section className="career-resume-editor__conflict" role="alert">
          <Icon name="warning" size={19} />
          <div>
            <strong>服务器已有更新，本地草稿没有被覆盖</strong>
            <p>最新修订已重新读取。请先选择保留本地草稿继续核对，或放弃草稿加载最新版本。</p>
            <div>
              <button
                type="button"
                onClick={() => {
                  if (!serverContentRevision) return;
                  setContentBaseRevisionId(serverContentRevision.id);
                  setContentConflict(false);
                }}
              >
                保留草稿并重新核对
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!serverContent || !serverContentRevision) return;
                  setDraftContent(cloneResumeContent(serverContent));
                  setContentBaseRevisionId(serverContentRevision.id);
                  setContentTouched(false);
                  setContentConflict(false);
                }}
              >
                放弃草稿，加载最新
              </button>
            </div>
          </div>
        </section>
      ) : null}
      {layoutConflict ? (
        <section className="career-resume-editor__conflict" role="alert">
          <Icon name="warning" size={19} />
          <div>
            <strong>模板或章节顺序已在其他页面更新</strong>
            <p>你的布局草稿仍保留。核对最新布局后，可明确选择继续使用本地设置。</p>
            <div>
              <button
                type="button"
                onClick={() => {
                  setLayoutConflict(false);
                  setLayoutTouched(true);
                }}
              >
                保留本地布局
              </button>
              <button
                type="button"
                onClick={() => {
                  setLayoutOrderDraft(serverSectionOrder);
                  setTemplateDraft(serverLayout.templateKey);
                  setLayoutTouched(false);
                  setLayoutConflict(false);
                }}
              >
                加载服务器布局
              </button>
            </div>
          </div>
        </section>
      ) : null}
      {contentMutation.isError && !contentConflict ? (
        <div className="career-inline-error" role="alert">
          <strong>正文没有保存</strong>
          <span>{errorMessage(contentMutation.error)}</span>
        </div>
      ) : null}
      {layoutMutation.isError && !layoutConflict ? (
        <div className="career-inline-error" role="alert">
          <strong>章节顺序没有保存</strong>
          <span>{errorMessage(layoutMutation.error)}</span>
        </div>
      ) : null}
      {docxMutation.isError ? (
        <div className="career-inline-error" role="alert">
          <strong>DOCX 没有生成</strong>
          <span>{errorMessage(docxMutation.error)}</span>
        </div>
      ) : null}
      {validationErrors.length > 0 ? (
        <output className="career-resume-editor__validation">
          <Icon name="warning" size={17} />
          <span>{validationErrors[0]}</span>
        </output>
      ) : null}

      <div className="career-resume-editor__body">
        <aside className="career-resume-editor__structure" aria-label="简历章节结构">
          <header>
            <strong>章节结构</strong>
            <span>{orderedSections.length}</span>
          </header>
          <ol>
            {orderedSections.map((section, index) => {
              const active = selectedEntry?.section.id === section.id;
              return (
                <li key={section.id} className={active ? "is-active" : undefined}>
                  <button type="button" onClick={() => selectBlock(section.blocks[0]?.id ?? "")}>
                    <span>{section.title || "未命名章节"}</span>
                    <small>{section.blocks.length} 段</small>
                  </button>
                  <div>
                    <button
                      type="button"
                      aria-label={`上移章节 ${section.title}`}
                      disabled={index === 0 || busy}
                      onClick={() => {
                        setLayoutOrderDraft((current) =>
                          moveResumeSectionId(current, section.id, "up"),
                        );
                        setLayoutTouched(true);
                        setSavedMessage(null);
                      }}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      aria-label={`下移章节 ${section.title}`}
                      disabled={index === orderedSections.length - 1 || busy}
                      onClick={() => {
                        setLayoutOrderDraft((current) =>
                          moveResumeSectionId(current, section.id, "down"),
                        );
                        setLayoutTouched(true);
                        setSavedMessage(null);
                      }}
                    >
                      下移
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <button
            className="career-resume-editor__add-section"
            type="button"
            disabled={busy || draftContent.sections.length >= 100}
            onClick={() => {
              const sectionId = crypto.randomUUID();
              const blockId = crypto.randomUUID();
              updateDraft((current) => addResumeSection(current, { sectionId, blockId }));
              setLayoutOrderDraft((current) => [...current, sectionId]);
              selectBlock(blockId);
            }}
          >
            + 新增章节
          </button>
        </aside>

        <main className="career-resume-editor__document" aria-label="结构化简历正文">
          <div className="career-resume-editor__paper-meta">
            <span>A4 结构编辑</span>
            <span>自动保存已关闭</span>
          </div>
          <article
            className={
              templateDraft === "cn_compact_technical"
                ? "career-resume-editor__paper is-compact-technical"
                : "career-resume-editor__paper is-classic"
            }
          >
            {orderedSections.map((section) => (
              <section key={section.id}>
                <header>
                  <label>
                    <span className="sr-only">章节标题</span>
                    <input
                      value={section.title}
                      maxLength={100}
                      disabled={busy}
                      onChange={(event) =>
                        updateDraft((current) =>
                          updateResumeSection(current, section.id, { title: event.target.value }),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || draftContent.sections.length <= 1}
                    onClick={() => {
                      updateDraft((current) => removeResumeSection(current, section.id));
                      setLayoutOrderDraft((current) =>
                        current.filter((sectionId) => sectionId !== section.id),
                      );
                    }}
                  >
                    删除章节
                  </button>
                </header>
                <div>
                  {section.blocks.map((block, blockIndex) => (
                    <section
                      key={block.id}
                      className={`career-resume-editor__block${selectedEntry?.block.id === block.id ? " is-selected" : ""}`}
                    >
                      <header>
                        <button
                          type="button"
                          data-resume-editor-block={block.id}
                          aria-pressed={selectedEntry?.block.id === block.id}
                          onClick={() => selectBlock(block.id)}
                        >
                          区块 {blockIndex + 1}
                          <span>{block.evidenceIds.length} 条证据</span>
                        </button>
                        <div>
                          <button
                            type="button"
                            aria-label={`上移 ${section.title} 的第 ${blockIndex + 1} 个区块`}
                            disabled={blockIndex === 0 || busy}
                            onClick={() =>
                              updateDraft((current) =>
                                moveResumeBlock(current, section.id, block.id, "up"),
                              )
                            }
                          >
                            上移
                          </button>
                          <button
                            type="button"
                            aria-label={`下移 ${section.title} 的第 ${blockIndex + 1} 个区块`}
                            disabled={blockIndex === section.blocks.length - 1 || busy}
                            onClick={() =>
                              updateDraft((current) =>
                                moveResumeBlock(current, section.id, block.id, "down"),
                              )
                            }
                          >
                            下移
                          </button>
                          <button
                            type="button"
                            disabled={section.blocks.length <= 1 || busy}
                            onClick={() =>
                              updateDraft((current) =>
                                removeResumeBlock(current, section.id, block.id),
                              )
                            }
                          >
                            删除
                          </button>
                        </div>
                      </header>
                      <textarea
                        rows={4}
                        maxLength={10_000}
                        disabled={busy}
                        value={block.text}
                        aria-label={`${section.title} 第 ${blockIndex + 1} 个区块正文`}
                        onFocus={() => selectBlock(block.id)}
                        onChange={(event) =>
                          updateDraft((current) =>
                            updateResumeBlock(current, section.id, block.id, {
                              text: event.target.value,
                            }),
                          )
                        }
                      />
                      <small>{block.text.length.toLocaleString("zh-CN")} / 10,000 字符</small>
                    </section>
                  ))}
                </div>
                <button
                  className="career-resume-editor__add-block"
                  type="button"
                  disabled={busy || section.blocks.length >= 500}
                  onClick={() => {
                    const blockId = crypto.randomUUID();
                    updateDraft((current) => addResumeBlock(current, section.id, blockId));
                    selectBlock(blockId);
                  }}
                >
                  + 添加内容区块
                </button>
              </section>
            ))}
          </article>
        </main>

        <aside className="career-resume-editor__evidence" aria-label="当前区块证据">
          <header>
            <p>事实边界</p>
            <strong>已确认证据</strong>
            <span>
              {selectedEntry ? `当前区块已关联 ${selectedEvidenceIds.length} 条` : "未选择区块"}
            </span>
          </header>
          {evidenceQuery.isPending ? (
            <output>正在读取证据…</output>
          ) : evidenceQuery.isError ? (
            <div className="career-inline-error" role="alert">
              <span>{errorMessage(evidenceQuery.error)}</span>
            </div>
          ) : confirmedEvidence.length === 0 ? (
            <div className="career-resume-editor__evidence-empty">
              <p>尚无已确认的经历证据。正文仍可编辑，但专业建议不会使用未确认事实。</p>
              <Link to="/resume">前往确认简历证据</Link>
            </div>
          ) : selectedEntry ? (
            <ul>
              {confirmedEvidence.map((evidence) => (
                <li key={evidence.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedEvidenceIds.includes(evidence.id)}
                      disabled={busy}
                      onChange={() =>
                        updateDraft((current) =>
                          toggleResumeBlockEvidence(
                            current,
                            selectedEntry.section.id,
                            selectedEntry.block.id,
                            evidence.id,
                          ),
                        )
                      }
                    />
                    <span>
                      <strong>{evidence.section}</strong>
                      <small>{evidenceCopy(evidence)}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          <footer>
            <Icon name="check" size={16} />
            只有已确认、属于当前账户的证据 ID 才能保存。
          </footer>
        </aside>
      </div>
      {printDocument}
      {resumeDocument.kind === "case_derived" ? (
        <ResumeReviewPanel
          documentId={resumeDocument.id}
          documentRevision={contentQuery.data.documentRevision}
          currentContentRevisionId={serverContentRevision.id}
          contentRevisions={contentQuery.data.items}
          selectedBlockId={selectedEntry?.block.id ?? null}
          disabled={hasUnsavedChanges || contentConflict || layoutConflict || busy}
          onBusyChange={setReviewBusy}
          onSelectBlock={selectBlock}
        />
      ) : null}
    </section>
  );
}
