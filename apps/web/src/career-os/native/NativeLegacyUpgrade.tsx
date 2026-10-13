import type { ResumeStudioDraft } from "@aijob/contracts";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, createIdempotencyKey } from "../../api/client";

export function NativeLegacyUpgrade({ documentId }: { documentId?: string }) {
  const navigate = useNavigate();
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [items, setItems] = useState<{ id: string; title: string }[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState(documentId ?? "");
  const receipt = useRef<{ fingerprint: string; key: string } | null>(null);
  async function load(next?: string) {
    setOpened(true);
    setBusy(true);
    setError("");
    try {
      const page = await apiRequest<{ items: typeof items; nextCursor: string | null }>(
        `/v1/resume-documents?limit=50${next ? `&cursor=${encodeURIComponent(next)}` : ""}`,
      );
      setItems((current) => (next ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch {
      setError("稿件列表读取失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function upgrade() {
    setBusy(true);
    setError("");
    try {
      const draft = await apiRequest<ResumeStudioDraft>(`/v1/resume-documents/${selected}/studio`);
      const pair = await apiRequest<{ contentRevisionId: string; layoutRevisionId: string }>(
        `/v1/resume-documents/${selected}/checkpoint`,
        {
          method: "POST",
          body: { expectedRevision: draft.revision },
          idempotencyKey: createIdempotencyKey(),
        },
      );
      const fingerprint = JSON.stringify({ selected, ...pair });
      if (receipt.current?.fingerprint !== fingerprint)
        receipt.current = { fingerprint, key: createIdempotencyKey() };
      const result = await apiRequest<{ resumeDocument: { id: string } }>("/v1/resume-documents", {
        method: "POST",
        idempotencyKey: receipt.current.key,
        body: {
          kind: "base",
          title: `${draft.title} · 新版`.slice(0, 200),
          copyFrom: { documentId: selected, ...pair, targetCore: "native-v1" },
        },
      });
      navigate(`/resumes/${result.resumeDocument.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "转换未完成，旧稿保持不变。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <button
        type="button"
        disabled={busy}
        onClick={() => (documentId ? setOpened(!opened) : void load())}
      >
        {documentId ? "复制到新版工作室" : "从已有旧稿创建新版"}
      </button>
      {opened && (
        <>
          <p>正文与经历关联复制到新稿，旧稿和历史投递版本保留；新版采用中文单栏，可再换模板。</p>
          {!documentId && (
            <label>
              选择已有稿件
              <select
                aria-label="选择已有稿件"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={busy}
              >
                <option value="">请选择</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {cursor && (
            <button type="button" disabled={busy} onClick={() => void load(cursor)}>
              加载更多稿件
            </button>
          )}
          <button type="button" disabled={!selected || busy} onClick={() => void upgrade()}>
            {busy ? "正在处理…" : "创建并打开新版"}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
