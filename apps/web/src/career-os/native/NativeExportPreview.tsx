import type { NativeResumeDocument } from "@aijob/resume-core";
import { useEffect, useRef } from "react";
import { NativePdfPreview } from "./NativePdfPreview";
export function NativeExportPreview({
  blob,
  document,
  close,
}: {
  blob: Blob;
  document: NativeResumeDocument;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = window.document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
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
          <h2>实际下载稿</h2>
          <p>这就是保存的 PDF 文件。之后的编辑不会改变它。</p>
        </div>
        <button type="button" onClick={close}>
          返回编辑
        </button>
      </header>
      <NativePdfPreview document={document} fixedBlob={blob} />
    </dialog>
  );
}
