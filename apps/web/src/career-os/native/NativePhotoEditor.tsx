import type { NativeResumeDocument } from "@aijob/resume-core";
import { useState } from "react";
import { apiRequest, createIdempotencyKey } from "../../api/client";
import { Icon } from "../components/Icon";

export function NativePhotoEditor({
  document,
  edit,
}: {
  document: NativeResumeDocument;
  edit: (key: string, change: (draft: NativeResumeDocument) => void) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="native-photo-editor">
      <label className="native-photo-upload">
        <Icon name="user" size={22} />
        <span>
          {busy ? "正在上传…" : document.data.picture.url ? "更换照片" : "添加照片（可选）"}
        </span>
        <input
          aria-label="照片（可选）"
          type="file"
          accept="image/png,image/jpeg"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            const data = new FormData();
            data.append("file", file);
            setBusy(true);
            setError("");
            void apiRequest<{ id: string }>("/v1/resume-photos", {
              method: "POST",
              body: data,
              idempotencyKey: createIdempotencyKey(),
            })
              .then((result) => {
                edit("photo", (draft) => {
                  draft.data.picture.url = `aijob-photo:${result.id}`;
                  draft.data.picture.hidden = false;
                });
              })
              .catch(() => setError("照片上传未完成，请使用 5 MB 内的 JPEG 或 PNG。"))
              .finally(() => setBusy(false));
          }}
        />
      </label>
      {document.data.picture.url && (
        <>
          <button
            type="button"
            onClick={() =>
              edit("photo-visible", (draft) => {
                draft.data.picture.hidden = !draft.data.picture.hidden;
              })
            }
          >
            {document.data.picture.hidden ? "显示照片" : "隐藏照片"}
          </button>
          <button
            type="button"
            onClick={() =>
              edit("photo-remove", (draft) => {
                draft.data.picture.url = "";
                draft.data.picture.hidden = true;
              })
            }
          >
            从此稿移除照片
          </button>
          <label>
            照片尺寸（pt）
            <input
              type="number"
              min={32}
              max={160}
              value={document.data.picture.size}
              onChange={(event) => {
                const size = Number(event.target.value);
                if (size >= 32 && size <= 160)
                  edit("photo-size", (draft) => {
                    draft.data.picture.size = size;
                  });
              }}
            />
          </label>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
