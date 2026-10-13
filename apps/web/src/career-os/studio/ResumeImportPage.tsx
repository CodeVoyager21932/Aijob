import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createIdempotencyKey } from "../../api/client";
import { importStudio } from "../../api/resume-studio";
import "./studio.css";
export function ResumeImportPage() {
  const [text, setText] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [mode, setMode] = useState<"file" | "text">("file"),
    navigate = useNavigate();
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  async function submit() {
    if ((mode === "file" && !file) || (mode === "text" && !text.trim())) return;
    setBusy(true);
    setError("");
    const signature = mode === "file" ? `${file?.name}:${file?.size}:${file?.lastModified}` : text;
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: createIdempotencyKey() };
    try {
      const form = new FormData();
      if (file) form.append("file", file);
      const result = await importStudio(
        mode === "file" ? form : { text, title: "导入的简历" },
        attempt.current.key,
      );
      navigate(`/resumes/${result.draft.documentId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入暂时失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="studio-import-page resume-studio">
      <Link to="/resumes">← 返回我的简历</Link>
      <h1>从已有的简历继续</h1>
      <p>解析完成后直接编辑。识别不准确的地方，在对应条目中改就好。</p>
      <div className="studio-tabs" role="tablist" aria-label="导入方式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "file"}
          onClick={() => setMode("file")}
        >
          上传文件
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "text"}
          onClick={() => setMode("text")}
        >
          粘贴文字
        </button>
      </div>
      {mode === "file" ? (
        <label
          className="studio-upload-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
          }}
        >
          <strong>{file?.name || "选择或拖入简历文件"}</strong>
          <span>PDF / DOCX · 最大 5 MiB</span>
          <input
            type="file"
            accept=".pdf,.docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      ) : (
        <label className="studio-label">
          简历文字
          <textarea
            rows={15}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="粘贴简历的完整内容，也可以先粘贴一段经历。"
          />
        </label>
      )}
      {error ? (
        <p role="alert" className="studio-alert">
          {error}
        </p>
      ) : null}
      <button
        className="studio-primary"
        type="button"
        disabled={busy || (mode === "file" ? !file : !text.trim())}
        onClick={() => void submit()}
      >
        {busy ? "正在上传…" : "导入并开始编辑"}
      </button>
      <p className="studio-import-note">上传原件会保存在这份简历的导入记录中，可随时下载或删除。</p>
    </section>
  );
}
