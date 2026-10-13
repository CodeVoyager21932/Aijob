import { type NativeResumeDocument, parseNativeResumeDocument } from "@aijob/resume-core";
import { useEffect, useRef, useState } from "react";
import { apiDownload, apiRequest, createIdempotencyKey } from "../../api/client";
import { NativePdfPreview } from "./NativePdfPreview";

interface Version {
  contentRevisionId: string;
  layoutRevisionId: string;
  revision: number;
  createdAt: string;
}
export function NativeVersionHistory({
  documentId,
  close,
  restore,
}: {
  documentId: string;
  close: () => void;
  restore: (value: NativeResumeDocument) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    sequence = useRef(0);
  const [versions, setVersions] = useState<Version[]>([]),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<Version | null>(null),
    [document, setDocument] = useState<NativeResumeDocument | null>(null);
  const [blob,setBlob]=useState<Blob>();
  useEffect(() => {
    let active = true;
    const focus = window.document.activeElement;
    dialog.current?.showModal();
    void apiRequest<{ items: Version[] }>(`/v2/resume-documents/${documentId}/native/versions`)
      .then((value) => {
        if (active) setVersions(value.items);
      })
      .catch(() => {
        if (active) setError("版本暂时无法读取，请关闭后重试。");
      });
    return () => {
      active = false;
      sequence.current++;
      if (focus instanceof HTMLElement) focus.focus();
    };
  }, [documentId]);
  async function inspect(version: Version) {
    const request = ++sequence.current;
    setSelected(version);
    setDocument(null);
    setBlob(undefined);
    setError("");
    try {
      const pair = new URLSearchParams({
        contentRevisionId: version.contentRevisionId,
        layoutRevisionId: version.layoutRevisionId,
      });
      const value = await apiRequest<{ document: NativeResumeDocument }>(
        `/v2/resume-documents/${documentId}/native/version?${pair}`,
      );
      const parsed = parseNativeResumeDocument(value.document);
      if (request === sequence.current) setDocument(parsed);
      const artifact=await apiRequest<{id:string;state:string}>(`/v2/resume-documents/${documentId}/native/exports`,{
        method:"POST",body:{contentRevisionId:version.contentRevisionId,layoutRevisionId:version.layoutRevisionId,format:"pdf"},idempotencyKey:createIdempotencyKey(),
      });
      if(artifact.state!=="ready")throw new Error("预览正在生成");
      const file=await apiDownload(`/v2/resume-exports/${artifact.id}/file?preview=true`);
      if(request===sequence.current)setBlob(file.blob);
    } catch {
      if (request === sequence.current) setError("这份版本暂时无法读取，当前输入保持不变。");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="native-template-dialog native-export-dialog"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <h2>已保存的版本</h2>
          <p>恢复正文和排版到当前稿件，历史投递稿保持原样；可以撤销这次恢复。</p>
        </div>
        <button type="button" onClick={close}>
          返回编辑
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0 }}>
        <nav aria-label="版本列表" style={{ width: 180, overflowY: "auto", flexShrink: 0 }}>
          {!versions.length && <p>还没有固定版本。可在编辑器中保存版本，导出时也会保留。</p>}
          {versions.map((version) => (
            <button
              type="button"
              key={version.contentRevisionId}
              aria-pressed={selected?.contentRevisionId === version.contentRevisionId}
              onClick={() => void inspect(version)}
            >
              版本 {version.revision}
              <br />
              {new Date(version.createdAt).toLocaleString("zh-CN")}
            </button>
          ))}
        </nav>
        <div style={{ flex: 1, minWidth: 0 }}>
          {document ? (
            <NativePdfPreview document={document} authoritative fixedBlob={blob} />
          ) : (
            <p>{selected ? "正在读取…" : "选择一份版本查看"}</p>
          )}
        </div>
      </div>
      <footer>
        <button
          type="button"
          disabled={!document}
          onClick={() => {
            if (document) {
              restore(document);
              close();
            }
          }}
        >
          恢复到当前稿件
        </button>
      </footer>
    </dialog>
  );
}
