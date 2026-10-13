import { randomUUID } from "node:crypto";
import {
  blankResumeStudioContent,
  type ResumeSectionKind,
  ResumeStudioEntrySchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import {
  type NativeExperience,
  type NativeResumeDocument,
  nativeExperienceEntries,
  parseNativeExperience,
} from "@aijob/resume-core";
import { type Kysely, sql, type Transaction } from "kysely";
import {
  assertActiveOwnerEpoch,
  type OwnerScope,
  retainOwnerAssetsAfterMaterialSave,
} from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { convertLegacyStudioContent } from "./native-legacy-content.js";

type Db = Kysely<Database> | Transaction<Database>;
function substantive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(substantive);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["id", "hidden"].includes(key))
        .map(([key, item]) => [key, substantive(item)]),
    );
  return value;
}
const content = (source: NativeExperience) => substantive(source);
function hasText(value: unknown): boolean {
  if (typeof value === "string")
    return (
      value
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .trim().length > 0
    );
  if (Array.isArray(value)) return value.some(hasText);
  if (value && typeof value === "object") return Object.values(value).some(hasText);
  return false;
}
const meaningful = (source: NativeExperience) => hasText(substantive(source.entry));
const title = (source: NativeExperience) =>
  String(source.entry.name || source.entry.company || source.entry.organization || "我的经历");
export async function listNativeExperiences(db: Db, owner: OwnerScope, ids?: readonly string[]) {
  if (ids?.length === 0) return [];
  // Selected originals are resolved by identity, independently of the recent-list window.
  const selection = ids ? sql`AND id IN (${sql.join(ids)})` : sql``;
  const limit = ids ? sql`` : sql`LIMIT 500`;
  const rows = (
    await sql<{
      id: string;
      kind: string;
      title: string;
      entry: unknown;
      revision: number;
      updated_at: Date;
    }>`SELECT id,kind,title,entry,revision,updated_at FROM profile.experiences WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND entry->>'schemaVersion'='aijob-native-experience-v1' ${selection} ORDER BY updated_at DESC,id ${limit}`.execute(
      db,
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    experience: parseNativeExperience(row.entry),
    revision: Number(row.revision),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

/** Explicit read conversion for reuse. Old originals and their revisions are never rewritten. */
export async function listReusableNativeExperiences(
  db: Db,
  owner: OwnerScope,
  ids?: readonly string[],
) {
  const native = (await listNativeExperiences(db, owner, ids)).map((item) => ({
    ...item,
    legacy: false,
  }));
  if (ids?.length === 0) return native;
  const selection = ids ? sql`AND id IN (${sql.join(ids)})` : sql``;
  const limit = ids ? sql`` : sql`LIMIT 500`;
  const rows = (
    await sql<{
      id: string;
      kind: string;
      title: string;
      entry: unknown;
      revision: number;
      updated_at: Date;
    }>`
    SELECT id,kind,title,entry,revision,updated_at FROM profile.experiences
    WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}
    AND entry->>'schemaVersion' IS DISTINCT FROM 'aijob-native-experience-v1'
    AND kind IN ('internship','project','research','activity') ${selection}
    ORDER BY updated_at DESC,id ${limit}`.execute(db)
  ).rows;
  return [
    ...native,
    ...rows.map((row) => {
      const content = blankResumeStudioContent();
      content.sections.push({
        id: row.id,
        kind: row.kind as ResumeSectionKind,
        title: "已有经历",
        column: "main",
        hidden: false,
        pageBreakBefore: false,
        entries: [ResumeStudioEntrySchema.parse(row.entry)],
      });
      const converted = convertLegacyStudioContent(content);
      const experience = nativeExperienceEntries(converted.document)[0];
      if (!experience)
        throw new ServiceError(
          422,
          "EXPERIENCE_CONVERSION_FAILED",
          "这段经历未能转换，原稿仍保留。",
        );
      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        experience,
        revision: Number(row.revision),
        updatedAt: new Date(row.updated_at).toISOString(),
        legacy: true,
      };
    }),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
/** Called under the existing owner/document transaction locks. Native content is never projected through legacy entries. */
export async function captureNativeExperiences(
  tx: Transaction<Database>,
  owner: OwnerScope,
  documentId: string,
  document: NativeResumeDocument,
) {
  const links = (
    await sql<{
      entry_id: string;
      experience_id: string | null;
      capture_open: boolean;
    }>`SELECT entry_id,experience_id,capture_open FROM profile.resume_experience_links WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND document_id=${documentId}`.execute(
      tx,
    )
  ).rows;
  const byId = new Map(links.map((link) => [link.entry_id, link]));
  for (const source of nativeExperienceEntries(document)) {
    if (!meaningful(source)) continue;
    const link = byId.get(source.entry.id);
    // A deleted original or a captured/linked direction draft must not recreate or overwrite it.
    if (link && (!link.capture_open || !link.experience_id)) continue;
    const hash = hashCanonicalJson(content(source));
    const same = (
      await sql<{
        id: string;
        revision: number;
      }>`SELECT id,revision FROM profile.experiences WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND capture_hash=${hash}`.execute(
        tx,
      )
    ).rows[0];
    if (link?.experience_id) {
      const previous = (
        await sql<{
          entry: unknown;
          revision: number;
        }>`SELECT entry,revision FROM profile.experiences WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND id=${link.experience_id}`.execute(
          tx,
        )
      ).rows[0];
      if (
        !previous ||
        !(
          typeof previous.entry === "object" &&
          previous.entry !== null &&
          "schemaVersion" in previous.entry &&
          previous.entry.schemaVersion === "aijob-native-experience-v1"
        )
      )
        continue;
      if (same?.id === link.experience_id) continue;
      if (same) {
        await sql`UPDATE profile.resume_experience_links SET experience_id=${same.id},capture_revision=${same.revision},capture_open=false WHERE owner_id=${owner.ownerId} AND document_id=${documentId} AND entry_id=${source.entry.id}`.execute(
          tx,
        );
        // Keep the earlier original and immutable revisions: it may already be referenced by materials.
        continue;
      }
      const nextRevision = Number(previous.revision) + 1;
      await sql`UPDATE profile.experiences SET entry=${JSON.stringify(source)}::jsonb,title=${title(source)},capture_hash=${hash},revision=${nextRevision},updated_at=clock_timestamp() WHERE owner_id=${owner.ownerId} AND id=${link.experience_id}`.execute(
        tx,
      );
      await sql`INSERT INTO profile.experience_revisions(id,owner_id,owner_epoch,experience_id,revision,entry) VALUES(${randomUUID()},${owner.ownerId},${owner.ownerEpoch},${link.experience_id},${nextRevision},${JSON.stringify(source)}::jsonb)`.execute(
        tx,
      );
      await sql`UPDATE profile.resume_experience_links SET capture_revision=${nextRevision} WHERE owner_id=${owner.ownerId} AND document_id=${documentId} AND entry_id=${source.entry.id}`.execute(
        tx,
      );
      continue;
    }
    const id = same?.id ?? randomUUID(),
      revision = Number(same?.revision ?? 1);
    if (!same) {
      await sql`INSERT INTO profile.experiences(id,owner_id,owner_epoch,kind,title,entry,capture_hash) VALUES(${id},${owner.ownerId},${owner.ownerEpoch},${source.kind},${title(source)},${JSON.stringify(source)}::jsonb,${hash})`.execute(
        tx,
      );
      await sql`INSERT INTO profile.experience_revisions(id,owner_id,owner_epoch,experience_id,revision,entry) VALUES(${randomUUID()},${owner.ownerId},${owner.ownerEpoch},${id},1,${JSON.stringify(source)}::jsonb)`.execute(
        tx,
      );
    }
    await sql`INSERT INTO profile.resume_experience_links(owner_id,owner_epoch,document_id,entry_id,experience_id,capture_revision,capture_open) VALUES(${owner.ownerId},${owner.ownerEpoch},${documentId},${source.entry.id},${id},${revision},${!same})`.execute(
      tx,
    );
  }
}

export async function updateNativeExperience(
  db: Kysely<Database>,
  owner: OwnerScope,
  id: string,
  expectedRevision: number,
  input: unknown,
) {
  return db
    .transaction()
    .execute((tx) => updateNativeExperienceInTransaction(tx, owner, id, expectedRevision, input));
}
export async function updateNativeExperienceInTransaction(
  tx: Transaction<Database>,
  owner: OwnerScope,
  id: string,
  expectedRevision: number,
  input: unknown,
) {
  const next = parseNativeExperience(input);
  await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
  const row = (
    await sql<{
      entry: unknown;
      revision: number;
    }>`SELECT entry,revision FROM profile.experiences WHERE id=${id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} FOR UPDATE`.execute(
      tx,
    )
  ).rows[0];
  if (!row) throw new ServiceError(404, "EXPERIENCE_NOT_FOUND", "这段经历不存在或已删除。");
  const previous = parseNativeExperience(row.entry);
  if (next.type !== previous.type || next.kind !== previous.kind)
    throw new ServiceError(422, "EXPERIENCE_TYPE_MISMATCH", "请选择相同类型的经历条目。");
  next.entry.id = previous.entry.id;
  const hash = hashCanonicalJson(content(next));
  if (
    Number(row.revision) === expectedRevision + 1 &&
    hashCanonicalJson(content(previous)) === hash
  )
    return (await listNativeExperiences(tx, owner, [id]))[0];
  if (Number(row.revision) !== expectedRevision)
    throw new ServiceError(
      409,
      "EXPERIENCE_REVISION_CONFLICT",
      "经历原稿已有更新；当前简历保持不变，请重新对照。",
    );
  if (hashCanonicalJson(content(previous)) === hash)
    return (await listNativeExperiences(tx, owner, [id]))[0];
  const duplicate = (
    await sql`SELECT id FROM profile.experiences WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND capture_hash=${hash} AND id<>${id}`.execute(
      tx,
    )
  ).rows[0];
  if (duplicate)
    throw new ServiceError(409, "EXPERIENCE_ALREADY_EXISTS", "相同经历已在材料库中，请直接取用。");
  await retainOwnerAssetsAfterMaterialSave(tx, owner);
  await sql`UPDATE profile.experiences SET entry=${JSON.stringify(next)}::jsonb,title=${title(next)},capture_hash=${hash},revision=revision+1,updated_at=clock_timestamp() WHERE owner_id=${owner.ownerId} AND id=${id}`.execute(
    tx,
  );
  await sql`INSERT INTO profile.experience_revisions(id,owner_id,owner_epoch,experience_id,revision,entry) VALUES(${randomUUID()},${owner.ownerId},${owner.ownerEpoch},${id},${expectedRevision + 1},${JSON.stringify(next)}::jsonb)`.execute(
    tx,
  );
  await sql`UPDATE profile.resume_experience_links SET capture_open=false WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND experience_id=${id}`.execute(
    tx,
  );
  return (await listNativeExperiences(tx, owner, [id]))[0];
}
