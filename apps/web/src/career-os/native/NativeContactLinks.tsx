import type { NativeResumeDocument } from "@aijob/resume-core";

export function NativeContactLinks({
  document,
  edit,
}: {
  document: NativeResumeDocument;
  edit: (key: string, change: (draft: NativeResumeDocument) => void) => void;
}) {
  const basics = document.data.basics;
  return (
    <details className="native-contact-links">
      <summary>作品与个人链接</summary>
      <div className="native-fields">
        <label>
          个人网站名称
          <input
            value={basics.website.label}
            onChange={(event) =>
              edit("website-label", (draft) => {
                draft.data.basics.website.label = event.target.value;
              })
            }
          />
        </label>
        <label>
          个人网站地址
          <input
            type="url"
            inputMode="url"
            placeholder="https://"
            value={basics.website.url}
            onChange={(event) =>
              edit("website-url", (draft) => {
                draft.data.basics.website.url = event.target.value;
              })
            }
          />
        </label>
      </div>
      {basics.customFields.map((field) => (
        <fieldset className="native-contact-entry" key={field.id}>
          <legend>附加信息</legend>
          <div className="native-fields">
            <label>
              显示文字
              <input
                value={field.text}
                onChange={(event) =>
                  edit(`contact:${field.id}:text`, (draft) => {
                    const target = draft.data.basics.customFields.find(
                      (item) => item.id === field.id,
                    );
                    if (target) target.text = event.target.value;
                  })
                }
              />
            </label>
            <label>
              链接地址（选填）
              <input
                type="url"
                inputMode="url"
                value={field.link}
                onChange={(event) =>
                  edit(`contact:${field.id}:link`, (draft) => {
                    const target = draft.data.basics.customFields.find(
                      (item) => item.id === field.id,
                    );
                    if (target) target.link = event.target.value;
                  })
                }
              />
            </label>
          </div>
          <button
            type="button"
            className="native-delete"
            onClick={() =>
              edit(`contact:${field.id}:delete`, (draft) => {
                draft.data.basics.customFields = draft.data.basics.customFields.filter(
                  (item) => item.id !== field.id,
                );
              })
            }
          >
            删除这项信息
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          edit(`contact:add:${crypto.randomUUID()}`, (draft) => {
            draft.data.basics.customFields.push({
              id: crypto.randomUUID(),
              icon: "",
              text: "",
              link: "",
            });
          })
        }
      >
        添加链接或附加信息
      </button>
    </details>
  );
}
