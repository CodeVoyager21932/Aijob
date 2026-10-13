import {
  applyNativeImportCorrection,
  type NativeImportBlock,
  type NativeLocalImportCorrection,
  type NativeResumeDocument,
  nativeCorrectionEntries,
  nativeDescriptionSegments,
} from "@aijob/resume-core";
import { useState } from "react";

const choices = [
  ["education", "教育经历"],
  ["experience", "实习／工作"],
  ["projects", "项目经历"],
  ["research", "科研经历"],
  ["volunteer", "校园／志愿"],
] as const;
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Optional local corrections always start from the latest edited draft, never a reparse. */
export function NativeImportCorrection({
  currentDocument,
  blocks,
  originalId,
  apply,
}: {
  currentDocument: NativeResumeDocument;
  blocks: NativeImportBlock[];
  originalId: string;
  apply: (document: NativeResumeDocument) => void;
}) {
  const [itemId, setItemId] = useState("");
  const [target, setTarget] = useState<(typeof choices)[number][0]>("experience");
  const [boundary, setBoundary] = useState(0);
  const [blockId, setBlockId] = useState("");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const entries = nativeCorrectionEntries(currentDocument);
  const selected = entries.find((entry) => entry.id === itemId);
  const segments = selected ? nativeDescriptionSegments(selected.description) : [];
  const sourceBlock = blocks.find((block) => block.id === blockId);
  const selectedField = selected?.fields.find((candidate) => candidate.key === field);
  const canSplit =
    selected &&
    ["education", "experience", "projects", "research", "volunteer", "summary"].includes(
      selected.kind,
    );
  function correct(correction: NativeLocalImportCorrection) {
    try {
      apply(applyNativeImportCorrection(currentDocument, correction, { originalId, blocks }));
      setMessage("已更新这一处，可在编辑器撤销。");
    } catch {
      setMessage("这一处未能更新。当前正文仍保留，请重新选择条目后重试。");
    }
  }
  return (
    <>
      <details className="native-local-correction">
        <summary>调整条目归属或拆开合并的经历</summary>
        <p>只修改所选条目，保留当前已写内容；其他内容可直接在编辑器继续写。</p>
        <label>
          当前稿中的条目
          <select
            value={itemId}
            onChange={(event) => {
              setItemId(event.target.value);
              setBoundary(0);
              setField("");
              setMessage("");
            }}
          >
            <option value="">选择需要调整的条目</option>
            {entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.sectionTitle} · {entry.title}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <>
            <label>
              移至模块
              <select
                value={target}
                onChange={(event) => setTarget(event.target.value as typeof target)}
              >
                {choices.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={selected.kind === target}
              onClick={() => correct({ type: "move-entry", itemId, target })}
            >
              移动这个条目
            </button>
            {canSplit && segments.length > 0 && (
              <>
                <label>
                  从这段正文起拆为新条目
                  <select
                    value={boundary}
                    onChange={(event) => setBoundary(Number(event.target.value))}
                  >
                    {segments.map((segment, index) => (
                      <option key={`${index}:${segment.length}`} value={index}>
                        {index + 1}. {plain(segment).slice(0, 100)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    correct({
                      type: "split-entry",
                      itemId,
                      segmentIndex: boundary,
                      newItemId: crypto.randomUUID(),
                    })
                  }
                >
                  拆开这段经历
                </button>
                <p>新条目只带走选中的正文及后续段落，单位和时间留空，可继续填写。</p>
              </>
            )}
            <details>
              <summary>把一处原文放入具体字段</summary>
              <label>
                原文
                <select
                  value={blockId}
                  onChange={(event) => {
                    setBlockId(event.target.value);
                    setValue(blocks.find((block) => block.id === event.target.value)?.text ?? "");
                  }}
                >
                  <option value="">选择一处原文</option>
                  {blocks.map((block, index) => (
                    <option key={block.id} value={block.id}>
                      {index + 1}. {block.text.slice(0, 110)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                放入字段
                <select value={field} onChange={(event) => setField(event.target.value)}>
                  <option value="">选择字段</option>
                  {selected.fields.map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </label>
              {sourceBlock && (
                <label>
                  这次填入的文字
                  <textarea
                    rows={3}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </label>
              )}
              {selectedField && !["description", "content"].includes(field) && (
                <p>
                  目前的{selectedField.label}：{selectedField.value || "尚未填写"}
                  。采用后只替换这个字段。
                </p>
              )}
              <button
                type="button"
                disabled={!sourceBlock || !selectedField || !value.trim()}
                onClick={() =>
                  correct({ type: "assign-field", itemId, field, value, originalId, blockId })
                }
              >
                {["description", "content"].includes(field) ? "追加到正文" : "更新这个字段"}
              </button>
            </details>
          </>
        )}
        {message && <output>{message}</output>}
      </details>
      <details>
        <summary>查看提取到的原文</summary>
        {blocks.map((block, index) => (
          <div key={block.id} className="native-import-block">
            <p>
              <small>
                {block.source.kind === "pdf" ? `第 ${block.source.page} 页` : `原文 ${index + 1}`}
              </small>{" "}
              {block.text}
            </p>
          </div>
        ))}
      </details>
    </>
  );
}
