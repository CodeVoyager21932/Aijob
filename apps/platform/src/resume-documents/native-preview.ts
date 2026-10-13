import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import type { OwnerScope } from "../identity/session-repository.js";
import { checkpointNativeDraft } from "./native-checkpoint.js";
import { createNativeExport } from "./native-export.js";

export async function createNativePreview(input: {
  db: Kysely<Database>; owner: OwnerScope; documentId: string;
  expectedDraftRevision: number; requestGeneration: number;
  idempotencyKey: string; encryptionKey: string;
}) {
  const pair = await checkpointNativeDraft(input.db, input.owner, input.documentId, input.expectedDraftRevision, "preview");
  const artifact = await createNativeExport({
    ...input, request: { ...pair, format: "pdf" }, purpose: "preview",
  });
  const metadata = (await sql<{render_metadata: {anchors?: unknown[]; diagnostics?: unknown; pageMap?: unknown}}> `
    SELECT render_metadata FROM profile.resume_export_artifacts WHERE id=${artifact.id}
      AND owner_id=${input.owner.ownerId} AND owner_epoch=${input.owner.ownerEpoch}`.execute(input.db)).rows[0]?.render_metadata;
  return {
    ...pair, artifact, draftRevision: input.expectedDraftRevision,
    requestGeneration: input.requestGeneration,
    pageCount: artifact.pageCount, pageMap: metadata?.pageMap ?? null,
    anchors: metadata?.anchors ?? [], diagnostics: metadata?.diagnostics ?? [],
  };
}
