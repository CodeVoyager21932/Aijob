import type { NativeResumeData } from "@aijob/resume-core";
import type { ReactNode } from "react";

type Roles = NativeResumeData["sections"]["experience"]["items"][number]["roles"];
export function NativeExperienceRoles({
  roles,
  change,
  text,
}: {
  roles: Roles;
  change: (key: string, update: (roles: Roles) => void) => void;
  text: (label: string, value: string, change: (value: string) => void) => ReactNode;
}) {
  return (
    <details open={roles.length > 0}>
      <summary>
        同一企业中的不同岗位 <small>按需填写</small>
      </summary>
      {roles.map((role, index) => (
        <fieldset className="native-contact-entry" key={role.id}>
          <legend>{role.position || `岗位 ${index + 1}`}</legend>
          <div className="native-fields">
            {(
              [
                ["position", "该阶段职位"],
                ["period", "该阶段时间"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={role[key]}
                  onChange={(event) =>
                    change(`${role.id}:${key}`, (items) => {
                      const target = items.find((item) => item.id === role.id);
                      if (target) target[key] = event.target.value;
                    })
                  }
                />
              </label>
            ))}
          </div>
          {text("该岗位内容与成果", role.description, (value) =>
            change(`${role.id}:description`, (items) => {
              const target = items.find((item) => item.id === role.id);
              if (target) target.description = value;
            }),
          )}
          <div className="native-item-actions">
            <button
              type="button"
              disabled={index === 0}
              onClick={() =>
                change(`${role.id}:up`, (items) => {
                  const entry = items.splice(index, 1)[0];
                  if (entry) items.splice(index - 1, 0, entry);
                })
              }
            >
              上移岗位
            </button>
            <button
              type="button"
              disabled={index === roles.length - 1}
              onClick={() =>
                change(`${role.id}:down`, (items) => {
                  const entry = items.splice(index, 1)[0];
                  if (entry) items.splice(index + 1, 0, entry);
                })
              }
            >
              下移岗位
            </button>
            <button
              type="button"
              onClick={() =>
                change(`${role.id}:delete`, (items) => {
                  const at = items.findIndex((item) => item.id === role.id);
                  if (at >= 0) items.splice(at, 1);
                })
              }
            >
              删除这个岗位
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          change(`add:${crypto.randomUUID()}`, (items) => {
            items.push({ id: crypto.randomUUID(), position: "", period: "", description: "" });
          })
        }
      >
        添加该企业的另一岗位
      </button>
    </details>
  );
}
