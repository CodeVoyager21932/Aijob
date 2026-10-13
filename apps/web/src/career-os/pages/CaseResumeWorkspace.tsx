import type { ApplicationCaseWithJobContext, ResumeDocument } from "@aijob/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  careerOsQueryKeys,
  createResumeDocument,
  deleteResumeDocument,
  listResumeDocuments,
} from "../../api/career-os";
import { apiRequest, createIdempotencyKey, ProductApiError } from "../../api/client";
import { checkpointStudio, getStudio } from "../../api/resume-studio";
import { toApplicationCaseView } from "../application-case-view";
import { AssetDeletionDialog } from "../components/AssetDeletionDialog";
import { Icon } from "../components/Icon";
import { flushOpenStudioDraft } from "../studio/use-studio-draft";

export function CaseResumeWorkspace({
  applicationCase,
}: {
  applicationCase: ApplicationCaseWithJobContext;
}) {
  const queryClient = useQueryClient();
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
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
  const baseDocuments = useMemo(
    () =>
      (baseQuery.data?.items ?? [])
        .filter(
          (document): document is Extract<ResumeDocument, { kind: "base" }> =>
            document.kind === "base",
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [baseQuery.data?.items],
  );
  const selectedBase =
    baseDocuments.find((document) => document.id === selectedBaseId) ?? baseDocuments[0];
  const createMutation = useMutation({
    mutationFn: async ({
      baseDocumentId,
      idempotencyKey,
    }: {
      baseDocumentId: string;
      idempotencyKey: string;
    }) => {
      let baseDocumentRevisionId: string;
      try {
        const draft = await apiRequest<{revision:number}>(`/v2/resume-documents/${baseDocumentId}/native`);
        ({contentRevisionId:baseDocumentRevisionId} = await apiRequest<{contentRevisionId:string}>(
          `/v2/resume-documents/${baseDocumentId}/native/checkpoint`, {method:"POST",body:{expectedRevision:draft.revision}}));
      } catch (error) {
        if (!(error instanceof ProductApiError) || error.code !== "RESUME_CORE_VERSION_MISMATCH" && error.status !== 404) throw error;
        await flushOpenStudioDraft(baseDocumentId);
        const draft = await getStudio(baseDocumentId);
        ({contentRevisionId:baseDocumentRevisionId} = await checkpointStudio(baseDocumentId,draft.revision));
      }
      return createResumeDocument(
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
      );
    },
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

  const deleteMutation = useMutation({
    mutationFn: ({
      documentId,
      expectedRevision,
    }: {
      documentId: string;
      expectedRevision: number;
    }) => deleteResumeDocument(documentId, { expectedRevision }),
    retry: false,
    onSuccess: async (_result, variables) => {
      setDeleteOpen(false);
      queryClient.removeQueries({
        queryKey: careerOsQueryKeys.resumeDocument(variables.documentId),
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.resumeDocuments({
            kind: "case_derived",
            caseId: applicationCase.id,
          }),
        }),
        queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.resumeDocumentLists }),
      ]);
    },
    onError: async (error) => {
      if (
        error instanceof ProductApiError &&
        (error.code === "RESUME_DOCUMENT_REVISION_CONFLICT" || error.status === 404)
      ) {
        await queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.resumeDocuments({
            kind: "case_derived",
            caseId: applicationCase.id,
          }),
        });
      }
    },
  });

  const createDerivedResume = () => {
    const baseDocumentId = selectedBase?.id;
    if (!baseDocumentId) return;
    const signature = `${applicationCase.id}:${applicationCase.revision}:${baseDocumentId}`;
    if (!createCommandRef.current || createCommandRef.current.signature !== signature) {
      createCommandRef.current = {
        signature,
        key: createIdempotencyKey("case-resume"),
      };
    }
    createMutation.mutate({
      baseDocumentId,
      idempotencyKey: createCommandRef.current.key,
    });
  };

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
    const prerequisiteLoading = baseQuery.isPending;
    const prerequisiteError = baseQuery.error;
    const ready = Boolean(selectedBase);
    return (
      <section className="career-resume-prerequisite" aria-labelledby="resume-prerequisite-title">
        <span className="career-resume-prerequisite__icon">
          <Icon name="document" />
        </span>
        <div>
          <p>岗位简历</p>
          <h2 id="resume-prerequisite-title">
            {ready ? "创建这份岗位简历" : "选择一份简历，开始准备这份申请"}
          </h2>
          <p>
            {ready
              ? "以所选简历的当前内容和版式创建岗位稿，后续修改只影响这份稿件。"
              : "你可以从空白开始、导入已有简历，或用已有经历写一份简历。"}
          </p>

          {prerequisiteLoading ? <output>正在读取你的简历…</output> : null}
          {prerequisiteError ? (
            <div className="career-inline-error" role="alert">
              <strong>暂时无法读取简历</strong>
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
              <Link className="career-button career-button--quiet" to="/resumes">
                开始写简历
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

  const applicationCaseView = toApplicationCaseView(applicationCase);
  return (
    <>
      <div className="career-asset-actions">
        <span>岗位简历修订 {derivedDocument.revision}</span>
        <button
          className="career-button career-button--danger-quiet"
          type="button"
          onClick={() => setDeleteOpen(true)}
        >
          删除这份岗位简历
        </button>
      </div>
      <section className="career-resume-prerequisite">
        <div><h2>{applicationCaseView.companyName} · {applicationCaseView.roleTitle}</h2>
          <p>这是一份独立岗位稿。选材、调整表达、模板和下载都在同一个编辑器完成。</p>
          <Link className="career-button career-button--primary" to={`/resumes/${derivedDocument.id}?caseId=${applicationCase.id}`}>继续准备岗位简历</Link>
        </div>
      </section>
      <AssetDeletionDialog
        open={deleteOpen}
        title="删除这份岗位简历？"
        description="只删除当前岗位简历及其简历审阅记录，不删除基础简历或求职项目。"
        consequence="已经固定此简历修订的面试记录不会被连带删除；其中的来源 ID 仍作为历史引用保留。"
        pending={deleteMutation.isPending}
        error={deleteMutation.error}
        onClose={() => {
          if (deleteMutation.isPending) return;
          setDeleteOpen(false);
          deleteMutation.reset();
        }}
        onConfirm={() =>
          deleteMutation.mutate({
            documentId: derivedDocument.id,
            expectedRevision: derivedDocument.revision,
          })
        }
      />
    </>
  );
}
