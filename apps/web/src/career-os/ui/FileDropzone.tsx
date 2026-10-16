import { useRef, useState } from "react";
import { Icon } from "../components/Icon";

export function resumeFileError(file: File): string | null {
  if (!/\.(pdf|docx)$/i.test(file.name)) return "请选择 PDF 或 DOCX 文件。";
  if (file.size > 5 * 1024 * 1024) return "文件超过 5 MB，请选择较小的 PDF 或 DOCX。";
  if (!file.size) return "这份文件是空的，请重新选择。";
  return null;
}

export function FileDropzone({
  onFile,
  disabled = false,
  onError,
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
  onError: (message: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const accept = (files: FileList | null) => {
    if (disabled || !files?.length) return;
    if (files.length > 1) return onError("一次导入一份简历；其他材料可以之后继续添加。");
    const file = files[0];
    if (!file) return;
    const error = resumeFileError(file);
    if (error) return onError(error);
    onError("");
    onFile(file);
  };
  return (
    <label
      className="ui-file-dropzone"
      data-dragging={dragging}
      data-disabled={disabled}
      onDragEnter={(event) => {
        event.preventDefault();
        depth.current++;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (--depth.current <= 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        accept(event.dataTransfer.files);
      }}
    >
      <Icon name="document" aria-hidden="true" />
      <strong>
        {disabled ? "正在整理简历…" : dragging ? "松开即可导入" : "把简历拖到这里，或点击选择"}
      </strong>
      <span>PDF / DOCX · 最大 5 MB · 原件完整保留</span>
      <input
        aria-label="上传简历文件"
        type="file"
        accept=".pdf,.docx"
        disabled={disabled}
        onChange={(event) => {
          accept(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}
