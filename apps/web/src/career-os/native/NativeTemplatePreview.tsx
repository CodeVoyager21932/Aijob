import {
  applyNativeTemplate,
  hasVisibleNativeResumeContent,
  type NativeResumeDocument,
  type NativeTemplateId,
} from "@aijob/resume-core";
import { useEffect, useMemo, useState } from "react";
import { apiDownload, apiRequest, createIdempotencyKey } from "../../api/client";
import { NativePdfPreview } from "./NativePdfPreview";
import { templateSpecimens } from "./template-specimens";

export function NativeTemplateSamplePreview({
  document,
  templateId,
}: {
  document: NativeResumeDocument;
  templateId: NativeTemplateId;
}) {
  const [blob, setBlob] = useState<Blob>();
  const [error, setError] = useState("");
  const specimen = templateSpecimens[templateId];
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setBlob(undefined);
    setError("");
    if (specimen)
      void fetch(specimen.pdf, { signal: controller.signal })
        .then(async (result) => {
          if (!result.ok || !result.headers.get("content-type")?.includes("application/pdf"))
            throw new Error("完整样张暂时无法读取，请切换到“用我的内容”。");
          const file = await result.blob();
          if (active) setBlob(file);
        })
        .catch((failure) => {
          if (active) setError(String(failure.message || failure));
        });
    return () => {
      active = false;
      controller.abort();
    };
  }, [specimen]);
  if (!specimen)
    return (
      <div className="native-template-empty">
        <h3>这套版式尚未提供完整样张</h3>
        <p>切换到“用我的内容”查看实际排版。</p>
      </div>
    );
  return (
    <NativePdfPreview
      key={templateId}
      document={document}
      authoritative
      fixedBlob={blob}
      initialZoom="page"
      pendingMessage={error || (blob ? `完整样张 · ${specimen.label}` : "正在打开完整样张…")}
    />
  );
}

export function NativeTemplatePreview({
  document,
  documentId,
  revision,
  templateId,
}: {
  document: NativeResumeDocument;
  documentId: string;
  revision: number;
  templateId: NativeTemplateId;
}) {
  const [blob, setBlob] = useState<Blob>();
  const [state, setState] = useState("正在用当前内容排版…");
  const [retry, setRetry] = useState(0);
  const hasContent = hasVisibleNativeResumeContent(document);
  const candidate = useMemo(
    () => applyNativeTemplate(document, templateId),
    [document, templateId],
  );
  useEffect(() => {
    if (!hasContent) return;
    let active = true;
    setBlob(undefined);
    setState("正在用当前内容排版…");
    const timer = setTimeout(
      () =>
        void (async () => {
          try {
            const result = await apiRequest<{
              artifact: { id: string; state: string };
              pageCount: number;
            }>(`/v2/resume-documents/${documentId}/native/preview`, {
              method: "POST",
              body: { expectedDraftRevision: revision, requestGeneration: retry, templateId },
              idempotencyKey: createIdempotencyKey(),
            });
            if (result.artifact.state !== "ready") throw new Error("预览仍在生成，请重试。");
            const file = await apiDownload(
              `/v2/resume-exports/${result.artifact.id}/file?preview=true`,
            );
            if (active) {
              setBlob(file.blob);
              setState(
                result.pageCount === 1
                  ? "你的内容 · 1 页 A4"
                  : `当前内容 ${result.pageCount} 页 · 需精简后导出`,
              );
            }
          } catch (error) {
            if (active)
              setState(error instanceof Error ? error.message : "模板预览未完成，请重试。");
          }
        })(),
      300,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [documentId, revision, templateId, retry, hasContent]);
  if (!hasContent)
    return (
      <div className="native-template-empty">
        <h3>当前稿件还没有可展示的内容</h3>
        <p>先看完整样张挑选版式，再回到编辑器填写或导入资料。</p>
        <p>应用模板只选择版式，样张内容不会写入你的简历。</p>
      </div>
    );
  return (
    <NativePdfPreview
      document={candidate}
      authoritative
      fixedBlob={blob}
      pendingMessage={state}
      onRetry={() => setRetry((value) => value + 1)}
      initialZoom="page"
    />
  );
}
