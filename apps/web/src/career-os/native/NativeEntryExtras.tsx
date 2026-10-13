import type { NativeResumeDocument } from "@aijob/resume-core";

type Edit = (key: string, change: (draft: NativeResumeDocument) => void) => void;
function find(document: NativeResumeDocument, id: string) {
  return [...Object.values(document.data.sections), ...document.data.customSections]
    .flatMap((section) => section.items)
    .find((item) => item.id === id);
}
export function NativeEntryExtras({
  document,
  id,
  edit,
}: {
  document: NativeResumeDocument;
  id: string;
  edit: Edit;
}) {
  const item = find(document, id);
  if (!item) return null;
  const website = "website" in item ? item.website : null;
  const keywords: string[] | null = "keywords" in item ? item.keywords : null;
  if (!website && !keywords) return null;
  const setLink = (key: "url" | "label", value: string) =>
    edit(`${id}:website:${key}`, (draft) => {
      const target = find(draft, id);
      if (target && "website" in target) target.website[key] = value;
    });
  return (
    <details className="native-entry-extras">
      <summary>链接与补充信息{website?.url ? " · 已添加链接" : ""}</summary>
      {website && (
        <div className="native-fields">
          <label>
            相关链接
            <input
              type="url"
              value={website.url}
              placeholder="https://"
              onChange={(e) => setLink("url", e.target.value)}
            />
          </label>
          <label>
            链接显示文字
            <input
              value={website.label}
              placeholder="作品、报告或成果原文"
              onChange={(e) => setLink("label", e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={website.inlineLink}
              onChange={(e) =>
                edit(`${id}:website:inline`, (draft) => {
                  const target = find(draft, id);
                  if (target && "website" in target) target.website.inlineLink = e.target.checked;
                })
              }
            />
            将链接附在条目标题上
          </label>
        </div>
      )}
      {keywords && (
        <fieldset>
          <legend>具体项目／工具名称</legend>
          {keywords.map((value, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Native keywords are strings; these controlled inputs have no per-row state.
            <div className="native-item-actions" key={`${id}:keyword:${index}`}>
              <input
                aria-label={`具体项目／工具 ${index + 1}`}
                value={value}
                onChange={(e) =>
                  edit(`${id}:keyword:${index}`, (draft) => {
                    const target = find(draft, id);
                    if (target && "keywords" in target) target.keywords[index] = e.target.value;
                  })
                }
              />
              <button
                type="button"
                onClick={() =>
                  edit(`${id}:keyword:remove:${index}`, (draft) => {
                    const target = find(draft, id);
                    if (target && "keywords" in target) target.keywords.splice(index, 1);
                  })
                }
              >
                移除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              edit(`${id}:keyword:add`, (draft) => {
                const target = find(draft, id);
                if (target && "keywords" in target) target.keywords.push("");
              })
            }
          >
            添加具体项目／工具
          </button>
        </fieldset>
      )}
    </details>
  );
}
