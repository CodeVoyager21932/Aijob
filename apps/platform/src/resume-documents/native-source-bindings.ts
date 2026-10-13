import type { Database } from "@aijob/database";
import type { NativeResumeDocument } from "@aijob/resume-core";
import { sql, type Transaction } from "kysely";
import type { OwnerScope } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";

/** Reassigning existing provenance is allowed after original deletion; adding foreign provenance is not. */
export async function assertNativeSourceBindings(
  tx: Transaction<Database>,
  owner: OwnerScope,
  document: NativeResumeDocument,
  previous?: NativeResumeDocument,
) {
  const known = new Set(
    (previous?.sourceBindings ?? []).map((value) =>
      JSON.stringify([value.originalId, value.blockId]),
    ),
  );
  const added = (document.sourceBindings ?? []).filter(
    (value) => !known.has(JSON.stringify([value.originalId, value.blockId])),
  );
  if (!added.length) return;
  const ids = [...new Set(added.map((value) => value.originalId))];
  if (ids.length > 200)
    throw new ServiceError(400, "INVALID_RESUME_SOURCE_BINDINGS", "来源记录过多，请分批整理。");
  const rows = (
    await sql<{ id: string; parsed_content: unknown }>`
    SELECT id,parsed_content FROM profile.resume_originals
    WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}
    AND id::text IN (${sql.join(ids)})
  `.execute(tx)
  ).rows;
  for (const row of rows) {
    const value = row.parsed_content as { blocks?: { id?: unknown }[] } | null;
    if (Array.isArray(value?.blocks))
      for (const block of value.blocks)
        if (typeof block.id === "string") known.add(JSON.stringify([row.id, block.id]));
  }
  // Restoring a retained version after its original was deleted preserves provenance only.
  // Read pairs, never historical resume text; foreign owners and deleted documents are excluded.
  if (added.some((value) => !known.has(JSON.stringify([value.originalId, value.blockId])))) {
    const historical = (
      await sql<{ original_id: string; block_id: string }>`
      SELECT DISTINCT binding->>'originalId' original_id,binding->>'blockId' block_id
      FROM profile.resume_document_revisions r
      JOIN profile.resume_documents d ON d.id=r.document_id AND d.owner_id=r.owner_id AND d.owner_epoch=r.owner_epoch
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.studio_content->'sourceBindings','[]'::jsonb)) binding
      WHERE r.owner_id=${owner.ownerId} AND r.owner_epoch=${owner.ownerEpoch} AND d.deleted_at IS NULL
      AND binding->>'originalId' IN (${sql.join(ids)})
    `.execute(tx)
    ).rows;
    for (const row of historical) known.add(JSON.stringify([row.original_id, row.block_id]));
  }
  if (added.some((value) => !known.has(JSON.stringify([value.originalId, value.blockId]))))
    throw new ServiceError(
      400,
      "INVALID_RESUME_SOURCE_BINDINGS",
      "来源关联已变化，请重新打开原件后整理。正文仍保留。",
    );
}
