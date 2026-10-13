import type { RecordManualApplicationRequest, ResumeExportArtifact, SubmittedMaterial } from "@aijob/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { listResumeDocuments } from "../../api/career-os";
import {
  apiDownload,
  apiRequest,
  createIdempotencyKey,
  currentWorkspaceOwnerKey,
  ProductApiError,
} from "../../api/client";
import { deleteSubmittedMaterial, listSubmittedMaterials, materialKeys } from "../../api/materials";
import { checkpointStudio, getStudio, getStudioHistory } from "../../api/resume-studio";
import { nativeRecoveryKey, readNativeRecovery } from "../native/recovery";
import { flushOpenStudioDraft } from "../studio/use-studio-draft";
import { ModalSurface } from "./ModalSurface";
import "../product-core.css";
const NativeSubmittedPreview = lazy(() => import("../native/NativeSubmittedPreview"));
export type SubmissionReference = RecordManualApplicationRequest["submittedResume"];
export function SubmittedResumePicker({
  onChange,
}: {
  onChange: (reference: SubmissionReference, ready: boolean) => void;
}) {
  const [documentId, setDocumentId] = useState("");
  const [pairs, setPairs] = useState<
    { contentRevisionId: string; layoutRevisionId: string; version: number; createdAt: string }[]
  >([]);
  const [selected, setSelected] = useState("");
  const [files,setFiles]=useState<ResumeExportArtifact[]>([]);
  const [selectedFile,setSelectedFile]=useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef(0);
  const documents = useQuery({
    queryKey: ["career-os", "submission-document-options"],
    queryFn: ({ signal }) => listResumeDocuments({ limit: 100 }, signal),
  });
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function choose(id: string) {
    const sequence = ++request.current;
    setDocumentId(id);
    setPairs([]);
    setSelected("");
    setFiles([]);
    setSelectedFile("");
    setError("");
    onChange(undefined, !id);
    if (!id) {
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      let pair: { contentRevisionId: string; layoutRevisionId: string },
        history: { items: typeof pairs };
      let native: { revision: number; document: unknown; title: string } | null = null;
      try {
        native = await apiRequest(`/v2/resume-documents/${id}/native`);
      } catch (error) {
        if (
          !(error instanceof ProductApiError) ||
          !["RESUME_CORE_VERSION_MISMATCH", "RESUME_NOT_FOUND"].includes(error.code ?? "")
        )
          throw error;
      }
      if (native) {
        const recovery = readNativeRecovery(
          localStorage,
          nativeRecoveryKey(currentWorkspaceOwnerKey(), id),
          {
            baseRevision: native.revision,
            document: native.document as Parameters<typeof readNativeRecovery>[2]["document"],
            title: native.title,
          },
        );
        if (recovery)
          throw new Error("这份新版简历还有未同步输入，请回到编辑页保存后再选择投递稿。");
        pair = await apiRequest(`/v2/resume-documents/${id}/native/checkpoint`, {
          method: "POST",
          body: { expectedRevision: native.revision },
        });
        const versions = await apiRequest<{
          items: {
            contentRevisionId: string;
            layoutRevisionId: string;
            revision: number;
            createdAt: string;
          }[];
        }>(`/v2/resume-documents/${id}/native/versions`);
        history = { items: versions.items.map((item) => ({ ...item, version: item.revision })) };
      } else {
        await flushOpenStudioDraft(id);
        const draft = await getStudio(id);
        pair = await checkpointStudio(id, draft.revision);
        history = await getStudioHistory(id);
      }
      if (sequence !== request.current) return;
      const exports = await apiRequest<{items:ResumeExportArtifact[]}>(`/v1/resume-documents/${id}/exports`);
      if(sequence!==request.current)return;
      setFiles(exports.items.filter(file=>file.state==="ready"));
      setPairs(history.items);
      setSelected(pair.contentRevisionId);
      onChange({ documentId: id, ...pair }, true);
    } catch (e) {
      if (sequence === request.current)
        setError(e instanceof Error ? e.message : "暂时无法读取简历版本。");
    } finally {
      if (sequence === request.current) setBusy(false);
    }
  }
  return (
    <fieldset className="core-submission-picker">
      <legend>保留实际投递的简历</legend>
      <p className="core-note">
        选择你实际使用的稿件。正文与排版一起保存，之后改简历不会覆盖这次投递。
      </p>
      <label>
        投递简历
        <select aria-label="投递简历" value={documentId} onChange={(e) => void choose(e.target.value)}>
          <option value="">本次不关联站内简历</option>
          {documents.data?.items.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </label>
      {busy ? <output>正在保存当前稿并读取版本…</output> : null}
      {pairs.length ? (
        <label>
          实际使用的版本
          <select
            aria-label="实际使用的版本"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setSelectedFile("");
              const pair = pairs.find((p) => p.contentRevisionId === e.target.value);
              onChange(
                pair
                  ? {
                      documentId,
                      contentRevisionId: pair.contentRevisionId,
                      layoutRevisionId: pair.layoutRevisionId,
                    }
                  : undefined,
                Boolean(pair),
              );
            }}
          >
            {pairs.map((p, index) => (
              <option key={p.contentRevisionId} value={p.contentRevisionId}>
                {index === 0 ? "当前保存稿" : "历史稿"} · 第{p.version}版 ·{" "}
                {new Date(p.createdAt).toLocaleString("zh-CN")}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {selected && files.some(file=>file.contentRevisionId===selected) ? <label>
        实际投递文件
        <select aria-label="实际投递文件" value={selectedFile} onChange={event=>{
          const id=event.target.value;setSelectedFile(id);
          const pair=pairs.find(pair=>pair.contentRevisionId===selected);
          if(pair)onChange({documentId,contentRevisionId:pair.contentRevisionId,layoutRevisionId:pair.layoutRevisionId,...(id?{exportArtifactId:id}:{})},true);
        }}><option value="">仅保留正文与版式</option>
          {files.filter(file=>file.contentRevisionId===selected).map(file=><option key={file.id} value={file.id}>{file.format.toUpperCase()} · {file.fileName}</option>)}
        </select>
      </label> : null}
      {error || documents.isError ? (
        <p role="alert">
          {error || "暂时无法读取简历列表。"}{" "}
          <button
            type="button"
            onClick={() => void (documentId ? choose(documentId) : documents.refetch())}
          >
            重试
          </button>
        </p>
      ) : null}
    </fieldset>
  );
}
export function SubmittedMaterials({ caseId }: { caseId: string }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: materialKeys.submissions(caseId),
    queryFn: ({ signal }) => listSubmittedMaterials(caseId, signal),
  });
  const [view, setView] = useState<SubmittedMaterial | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const download = useMutation({
    mutationFn: ({ id, format }: { id: string; format: "pdf" | "docx" }) =>
      apiDownload(`/v1/application-cases/${caseId}/submitted-materials/${id}/${format}`),
    retry: false,
    onSuccess: ({ blob, fileName }, variables) => {
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = fileName ?? `已投递稿.${variables.format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 0);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSubmittedMaterial(caseId, id, createIdempotencyKey()),
    retry: false,
    onSuccess: async () => {
      setDeleteId(null);
      setView(null);
      await client.invalidateQueries({ queryKey: materialKeys.submissions(caseId) });
    },
  });
  return (
    <section className="core-submitted-materials">
      <h2>实际投递稿</h2>
      <p className="core-note">这里展示投递记录所保留的内容。未关联简历的旧记录不会补造投递稿。</p>
      {query.isPending ? (
        <output>正在读取投递稿…</output>
      ) : query.isError ? (
        <p role="alert">
          投递稿暂时无法读取。
          <button type="button" onClick={() => void query.refetch()}>
            重试
          </button>
        </p>
      ) : query.data?.items.length === 0 ? (
        <p>还没有留存投递稿。</p>
      ) : null}
      {query.data?.items.map((item) => (
        <article key={item.id} className="core-snippet-card">
          <h3>{item.title}</h3>
          {item.submittedFile ? <p>已保留原文件：{item.submittedFile.fileName}</p> : null}
          <p className="core-note">
            投递时间{" "}
            {new Date(item.submittedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
            （北京时间）
          </p>
          <div className="core-actions">
            <button className="career-button" type="button" onClick={() => setView(item)}>
              查看实际正文
            </button>
            {(["pdf", "docx"] as const).map((format) => (
              <button
                className="career-button"
                type="button"
                disabled={download.isPending}
                key={format}
                onClick={() => download.mutate({ id: item.id, format })}
              >
                下载 {format.toUpperCase()}
              </button>
            ))}
            {deleteId === item.id ? (
              <>
                <button
                  type="button"
                  className="career-button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(item.id)}
                >
                  确认删除留存稿
                </button>
                <button className="career-button" type="button" onClick={() => setDeleteId(null)}>
                  取消
                </button>
              </>
            ) : (
              <button className="career-button" type="button" onClick={() => setDeleteId(item.id)}>
                删除留存稿
              </button>
            )}
          </div>
        </article>
      ))}
      {download.isError || remove.isError ? (
        <p role="alert">
          {(download.error ?? remove.error) instanceof Error
            ? (download.error ?? remove.error)?.message
            : "操作未完成，请重试。"}
        </p>
      ) : null}
      {view ? (
        <ModalSurface
          className="core-editor"
          ariaLabel="实际投递正文"
          onClose={() => setView(null)}
          closeLabel="关闭投递正文"
        >
          <button className="career-button" type="button" onClick={() => setView(null)}>
            关闭正文
          </button>
          <h2>{view.title}</h2>
          {view.editorCore === "native-v1" ? (
            <Suspense fallback={<output>正在载入投递稿…</output>}>
              <NativeSubmittedPreview material={view} />
            </Suspense>
          ) : (
            view.layout.sectionOrder
              .map((id) => view.content.sections.find((section) => section.id === id))
              .filter((section) => section !== undefined)
              .map((section) => (
                <section key={section.id}>
                  <h3>{section.title}</h3>
                  {section.blocks.map((block) => (
                    <p key={block.id} style={{ whiteSpace: "pre-wrap" }}>
                      {block.text}
                    </p>
                  ))}
                </section>
              ))
          )}
        </ModalSurface>
      ) : null}
    </section>
  );
}
