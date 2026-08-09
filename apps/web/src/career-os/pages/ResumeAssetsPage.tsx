import type { ResumeDocument } from "@aijob/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  careerOsQueryKeys,
  createResumeDocument,
  getLegacyResumeContentConversion,
  getResumeDocument,
  listResumeDocumentContent,
  listResumeDocumentLayout,
  listResumeDocuments,
  putResumeDocumentContent,
} from "../../api/career-os";
import { createIdempotencyKey, ProductApiError } from "../../api/client";
import { Icon } from "../components/Icon";
import {
  findRecoverableEmptyBaseDocument,
  resolveBaseResumeDocument,
  resumeAssetStatus,
  sortBaseResumeDocuments,
} from "../resume-assets-state";
import { orderResumeSections } from "../resume-view";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function isBaseDocument(
  document: ResumeDocument | undefined,
): document is Extract<ResumeDocument, { kind: "base" }> {
  return document?.kind === "base";
}

export function ResumeAssetsPage() {
  const { documentId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const importCommandRef = useRef<{
    sourceId: string;
    createKey: string;
    contentKey: string;
  } | null>(null);

  const assetsQuery = useInfiniteQuery({
    queryKey: careerOsQueryKeys.resumeDocuments({ kind: "base" }),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      listResumeDocuments(
        { kind: "base", limit: 100, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const baseDocuments = useMemo(
    () => sortBaseResumeDocuments((assetsQuery.data?.pages ?? []).flatMap((page) => page.items)),
    [assetsQuery.data?.pages],
  );
  const legacySource = assetsQuery.data?.pages[0]?.legacySource ?? null;

  const detailQuery = useQuery({
    queryKey: careerOsQueryKeys.resumeDocument(documentId ?? ""),
    queryFn: ({ signal }) => getResumeDocument(documentId ?? "", signal),
    enabled: Boolean(documentId),
    retry: (failureCount, error) =>
      error instanceof ProductApiError && error.status === 404 ? false : failureCount < 1,
  });
  const listedSelection = resolveBaseResumeDocument(baseDocuments, documentId);
  const selectedDocument = isBaseDocument(detailQuery.data) ? detailQuery.data : listedSelection;

  const conversionQuery = useQuery({
    queryKey: careerOsQueryKeys.legacyResumeSource(legacySource?.legacySourceRevisionId ?? ""),
    queryFn: ({ signal }) =>
      getLegacyResumeContentConversion(legacySource?.legacySourceRevisionId ?? "", signal),
    enabled: Boolean(legacySource),
    retry: false,
  });
  const contentQuery = useQuery({
    queryKey: careerOsQueryKeys.resumeContent(selectedDocument?.id ?? ""),
    queryFn: ({ signal }) => listResumeDocumentContent(selectedDocument?.id ?? "", signal),
    enabled: Boolean(selectedDocument?.currentContentRevisionId),
  });
  const layoutQuery = useQuery({
    queryKey: careerOsQueryKeys.resumeLayout(selectedDocument?.id ?? ""),
    queryFn: ({ signal }) => listResumeDocumentLayout(selectedDocument?.id ?? "", signal),
    enabled: Boolean(selectedDocument?.currentLayoutRevisionId),
  });
  const currentSections = useMemo(
    () =>
      contentQuery.data?.current
        ? orderResumeSections(contentQuery.data.current, layoutQuery.data?.current ?? null)
        : [],
    [contentQuery.data?.current, layoutQuery.data?.current],
  );

  const importMutation = useMutation({
    mutationFn: async () => {
      const conversion = conversionQuery.data;
      if (!conversion) throw new Error("旧版简历来源尚未读取完成。");
      if (conversion.legacySource.migratedDocumentId) {
        return conversion.legacySource.migratedDocumentId;
      }
      const sourceId = conversion.legacySource.legacySourceRevisionId;
      if (!importCommandRef.current || importCommandRef.current.sourceId !== sourceId) {
        importCommandRef.current = {
          sourceId,
          createKey: createIdempotencyKey("base-resume"),
          contentKey: createIdempotencyKey("base-resume-content"),
        };
      }
      const recoverable = findRecoverableEmptyBaseDocument(baseDocuments);
      const document = recoverable
        ? recoverable
        : (
            await createResumeDocument(
              { kind: "base", title: "我的基础简历" },
              importCommandRef.current.createKey,
            )
          ).resumeDocument;
      if (document.kind !== "base") throw new Error("基础简历初始化返回了错误的文档类型。");
      await putResumeDocumentContent(
        document.id,
        {
          expectedRevision: 0,
          legacySourceRevisionId: sourceId,
          content: conversion.content,
        },
        importCommandRef.current.contentKey,
      );
      return document.id;
    },
    retry: false,
    onSuccess: async (createdDocumentId) => {
      await queryClient.invalidateQueries({
        queryKey: careerOsQueryKeys.resumeDocuments({ kind: "base" }),
      });
      navigate(`/resumes/${createdDocumentId}?source=initialized`);
    },
    onError: (error) => {
      if (
        error instanceof ProductApiError &&
        error.code === "LEGACY_RESUME_SOURCE_ALREADY_MIGRATED"
      ) {
        void queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.resumeDocuments({ kind: "base" }),
        });
      }
    },
  });

  const confirmedNow = searchParams.get("source") === "confirmed";
  const initializedNow = searchParams.get("source") === "initialized";
  const legacySections = conversionQuery.data?.content.sections ?? [];

  return (
    <section className="career-resume-assets" aria-labelledby="resume-assets-title">
      <header className="career-resume-assets__hero">
        <div>
          <p>职业资产 · M2</p>
          <h1 id="resume-assets-title">一份可信基础，服务每个岗位版本</h1>
          <span>
            基础简历保存你的长期职业资产；岗位简历只在真实 Case 中派生，不会反向覆盖这里。
          </span>
        </div>
        <Link className="career-button career-button--primary" to="/resume">
          <Icon name="document" size={17} />
          准备或更新简历
        </Link>
      </header>

      {confirmedNow ? (
        <output className="career-resume-assets__notice">
          <Icon name="check" size={18} />
          <span>
            <strong>事实与证据已经确认</strong>
            <span>原文件与原文已进入删除流程；请在下方显式初始化可编辑基础简历。</span>
          </span>
        </output>
      ) : null}
      {initializedNow ? (
        <output className="career-resume-assets__notice">
          <Icon name="check" size={18} />
          <span>
            <strong>可编辑基础简历已经建立</strong>
            <span>V1 来源仍保持只读，后续修改都会形成新的不可变修订。</span>
          </span>
        </output>
      ) : null}

      <div className="career-resume-assets__layout">
        <aside className="career-resume-library" aria-label="基础简历资产">
          <header>
            <div>
              <p>资产目录</p>
              <h2>基础简历</h2>
            </div>
            <span>{baseDocuments.length}</span>
          </header>

          {assetsQuery.isPending ? (
            <output className="career-request-state">正在读取简历资产…</output>
          ) : assetsQuery.isError ? (
            <div className="career-inline-error" role="alert">
              <strong>简历资产暂时无法读取</strong>
              <span>
                {assetsQuery.error instanceof Error ? assetsQuery.error.message : "请稍后重试。"}
              </span>
              <button type="button" onClick={() => void assetsQuery.refetch()}>
                重新读取
              </button>
            </div>
          ) : (
            <nav aria-label="基础简历列表">
              {baseDocuments.map((document) => {
                const status = resumeAssetStatus(document);
                return (
                  <Link
                    key={document.id}
                    className={document.id === documentId ? "is-active" : undefined}
                    to={`/resumes/${document.id}`}
                  >
                    <span className="career-resume-library__mark">
                      <Icon name="document" size={18} />
                    </span>
                    <span>
                      <strong>{document.title}</strong>
                      <small className={`is-${status.tone}`}>{status.label}</small>
                      <time dateTime={document.updatedAt}>
                        更新于 {formatDate(document.updatedAt)}
                      </time>
                    </span>
                    <Icon name="chevron" size={16} />
                  </Link>
                );
              })}
            </nav>
          )}

          {assetsQuery.hasNextPage ? (
            <button
              className="career-resume-library__more"
              type="button"
              disabled={assetsQuery.isFetchingNextPage}
              onClick={() => void assetsQuery.fetchNextPage()}
            >
              {assetsQuery.isFetchingNextPage ? "正在加载…" : "继续加载"}
            </button>
          ) : null}

          <section className="career-resume-legacy-card" aria-labelledby="legacy-resume-title">
            <div className="career-resume-legacy-card__label">V1 · 只读来源</div>
            <h3 id="legacy-resume-title">已确认简历快照</h3>
            {legacySource ? (
              <>
                <p>
                  修订 {legacySource.legacyRevision} · 确认于 {formatDate(legacySource.confirmedAt)}
                </p>
                <p>原文件与原文不在这里保存；结构化职业资产默认长期保留，由你主动删除。</p>
                {legacySource.migratedDocumentId ? (
                  <Link
                    className="career-button career-button--quiet"
                    to={`/resumes/${legacySource.migratedDocumentId}`}
                  >
                    打开可编辑版本
                    <Icon name="chevron" size={15} />
                  </Link>
                ) : (
                  <button
                    className="career-button career-button--primary"
                    type="button"
                    disabled={conversionQuery.isPending || importMutation.isPending}
                    onClick={() => importMutation.mutate()}
                  >
                    {importMutation.isPending ? "正在初始化…" : "初始化为可编辑简历"}
                  </button>
                )}
                {conversionQuery.isError || importMutation.isError ? (
                  <div className="career-inline-error" role="alert">
                    <strong>旧版来源暂时无法初始化</strong>
                    <span>
                      {(importMutation.error ?? conversionQuery.error) instanceof Error
                        ? (importMutation.error ?? (conversionQuery.error as Error)).message
                        : "请刷新后重试。"}
                    </span>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p>还没有经过你确认的简历来源。</p>
                <Link className="career-button career-button--quiet" to="/resume">
                  解析并确认简历
                </Link>
              </>
            )}
          </section>
        </aside>

        <main className="career-resume-asset-stage">
          {documentId && detailQuery.isPending ? (
            <output className="career-request-state">正在读取基础简历…</output>
          ) : documentId && detailQuery.isError ? (
            <div className="career-empty-state" role="alert">
              <strong>没有找到这份基础简历</strong>
              <p>记录不存在、已删除或不属于当前账户。</p>
              <Link className="career-button career-button--quiet" to="/resumes">
                返回简历资产
              </Link>
            </div>
          ) : detailQuery.data && detailQuery.data.kind !== "base" ? (
            <div className="career-empty-state" role="alert">
              <strong>这不是基础简历</strong>
              <p>岗位派生简历需要从对应的求职项目中打开。</p>
              <Link className="career-button career-button--quiet" to="/applications">
                前往我的求职
              </Link>
            </div>
          ) : selectedDocument ? (
            <section
              className="career-resume-asset-preview"
              aria-labelledby="selected-resume-title"
            >
              <header>
                <div>
                  <p>Base Resume V2</p>
                  <h2 id="selected-resume-title">{selectedDocument.title}</h2>
                  <span>
                    聚合修订 {selectedDocument.revision} · 更新于{" "}
                    {formatDate(selectedDocument.updatedAt)}
                  </span>
                </div>
                <span className="career-resume-asset-preview__status">
                  {selectedDocument.currentContentRevisionId ? "可编辑资产" : "初始化未完成"}
                </span>
              </header>

              {selectedDocument.currentContentRevisionId &&
              (contentQuery.isPending || layoutQuery.isPending) ? (
                <output className="career-request-state">正在读取当前内容修订…</output>
              ) : contentQuery.isError || layoutQuery.isError ? (
                <div className="career-inline-error" role="alert">
                  <strong>当前内容或布局暂时无法读取</strong>
                  <span>
                    {(contentQuery.error ?? layoutQuery.error) instanceof Error
                      ? (contentQuery.error ?? (layoutQuery.error as Error)).message
                      : "请稍后重试。"}
                  </span>
                </div>
              ) : currentSections.length > 0 ? (
                <div className="career-resume-asset-preview__document">
                  <div>
                    <span>{currentSections.length} 个章节</span>
                    <span>
                      {currentSections.reduce((total, section) => total + section.blocks.length, 0)}{" "}
                      个区块
                    </span>
                    <span>当前只读核对</span>
                  </div>
                  {currentSections.map((section) => (
                    <section key={section.id}>
                      <h3>{section.title}</h3>
                      <ul>
                        {section.blocks.map((block) => (
                          <li key={block.id}>{block.text}</li>
                        ))}
                      </ul>
                    </section>
                  ))}
                  <p>M2-1 已接通真实资产；结构调整、正文编辑和不可变保存将在下一切片启用。</p>
                </div>
              ) : (
                <div className="career-empty-state">
                  <strong>这份基础简历尚未完成初始化</strong>
                  <p>可从左侧已确认的 V1 来源继续，不会创建第二套解析数据。</p>
                  {legacySource && !legacySource.migratedDocumentId ? (
                    <button
                      className="career-button career-button--primary"
                      type="button"
                      disabled={conversionQuery.isPending || importMutation.isPending}
                      onClick={() => importMutation.mutate()}
                    >
                      {importMutation.isPending ? "正在继续…" : "继续初始化"}
                    </button>
                  ) : null}
                </div>
              )}
            </section>
          ) : legacySource ? (
            <section
              className="career-resume-source-preview"
              aria-labelledby="legacy-preview-title"
            >
              <header>
                <p>来源核对</p>
                <h2 id="legacy-preview-title">已确认的只读结构</h2>
                <span>首次编辑会生成 V2，V1 本身永远不被覆盖。</span>
              </header>
              {conversionQuery.isPending ? (
                <output className="career-request-state">正在读取只读结构…</output>
              ) : legacySections.length > 0 ? (
                <div>
                  {legacySections.map((section) => (
                    <section key={section.id}>
                      <h3>{section.title}</h3>
                      <ul>
                        {section.blocks.map((block) => (
                          <li key={block.id}>{block.text}</li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="career-empty-state">
                  <strong>只读结构暂时不可用</strong>
                  <p>请重新读取或返回简历确认页检查来源。</p>
                </div>
              )}
            </section>
          ) : (
            <div className="career-empty-state career-empty-state--actions">
              <span className="career-empty-state__icon">
                <Icon name="document" size={24} />
              </span>
              <strong>先建立你的第一份基础简历</strong>
              <p>解析结果不会直接成为事实；只有你确认的结构化内容才会进入职业资产。</p>
              <Link className="career-button career-button--primary" to="/resume">
                解析并确认简历
              </Link>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
