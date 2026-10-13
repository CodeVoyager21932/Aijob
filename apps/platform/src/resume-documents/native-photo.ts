import type { Database } from "@aijob/database";
import type { NativeResumeDocument } from "@aijob/resume-core";
import { type Kysely, sql, type Transaction } from "kysely";
import type { OwnerScope } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";
import { readResumePhoto } from "./template-library.js";

type Db = Kysely<Database> | Transaction<Database>;

export function nativePhotoId(url: string) {
  if (!url || /^data:image\/(png|jpeg);base64,/.test(url)) return null;
  const match =
    /^aijob-photo:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(url);
  if (!match)
    throw new ServiceError(422, "NATIVE_PHOTO_INVALID", "请使用已上传的 JPEG 或 PNG 照片。");
  return match[1] ?? null;
}
export async function assertNativePhoto(db: Db, owner: OwnerScope, document: NativeResumeDocument) {
  const id = nativePhotoId(document.data.picture.url);
  if (!id) return;
  const row = (
    await sql`SELECT id FROM profile.resume_photos WHERE id=${id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND deleted_at IS NULL FOR SHARE`.execute(
      db,
    )
  ).rows[0];
  if (!row)
    throw new ServiceError(
      404,
      "NATIVE_PHOTO_NOT_FOUND",
      "照片已删除或不属于当前账号，当前输入保留。",
    );
}
export async function resolveNativePhoto(
  db: Db,
  owner: OwnerScope,
  document: NativeResumeDocument,
  encryptionKey: string | undefined,
) {
  const resolved = structuredClone(document);
  if (resolved.data.picture.hidden) {
    resolved.data.picture.url = "";
    return resolved;
  }
  const id = nativePhotoId(resolved.data.picture.url);
  if (!id) return resolved;
  if (!encryptionKey)
    throw new ServiceError(
      503,
      "NATIVE_PHOTO_RUNTIME_NOT_READY",
      "照片读取配置未就绪，原稿保持不变。",
    );
  const photo = await readResumePhoto(db, owner, id, encryptionKey);
  if (!photo)
    throw new ServiceError(404, "NATIVE_PHOTO_NOT_FOUND", "照片已删除或不可读取，导出未完成。");
  resolved.data.picture.url = `data:${photo.mediaType};base64,${photo.buffer.toString("base64")}`;
  return resolved;
}
