import { randomUUID } from "node:crypto";
import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { canonicalJson } from "../lib/canonical-json.js";
import type { NormalizedOfficialJob } from "../sources/normalized-official-job.js";
import {
  type NormalizedTencentJob,
  TENCENT_ADAPTER_VERSION,
  TENCENT_NORMALIZER_VERSION,
} from "../sources/tencent-campus-adapter.js";
import type { SafeHttpResult } from "./safe-http.js";
import type { StoredSnapshot } from "./snapshot-store.js";

export interface TaskLease {
  taskId: string;
  leaseOwner: string;
  fencingToken: number;
}

/**
 * Locks the task row and validates the lease in the same transaction as the
 * guarded write. The row lock prevents a concurrent claimant from advancing
 * the fencing token between this check and the caller's database writes.
 */
export async function assertActiveTaskLease(
  db: Kysely<Database>,
  lease: TaskLease,
  now = new Date(),
): Promise<void> {
  const task = await db
    .selectFrom("task_queue.tasks")
    .select(["status", "lease_owner", "lease_until", "fencing_token"])
    .where("id", "=", lease.taskId)
    .forUpdate()
    .executeTakeFirst();

  if (
    !task ||
    task.status !== "running" ||
    task.lease_owner !== lease.leaseOwner ||
    Number(task.fencing_token) !== lease.fencingToken ||
    !task.lease_until ||
    new Date(task.lease_until).getTime() <= now.getTime()
  ) {
    throw new Error("TASK_LEASE_LOST");
  }
}

export async function recordFetchedResponse(input: {
  db: Kysely<Database>;
  sourceId: string;
  crawlRunId: string;
  response: SafeHttpResult;
  snapshot: StoredSnapshot;
  lease: TaskLease;
}): Promise<string> {
  const { db, sourceId, crawlRunId, response, snapshot, lease } = input;
  return db.transaction().execute(async (transaction) => {
    await assertActiveTaskLease(transaction, lease);

    let snapshotObject = await transaction
      .selectFrom("ingestion.snapshot_objects")
      .selectAll()
      .where("source_id", "=", sourceId)
      .where("content_hash", "=", snapshot.contentHash)
      .executeTakeFirst();

    if (!snapshotObject) {
      snapshotObject = await transaction
        .insertInto("ingestion.snapshot_objects")
        .values({
          id: randomUUID(),
          source_id: sourceId,
          content_hash: snapshot.contentHash,
          object_key: snapshot.objectKey,
          original_byte_size: snapshot.originalByteSize,
          stored_byte_size: snapshot.storedByteSize,
          content_type: snapshot.contentType,
          content_encoding: snapshot.contentEncoding,
        })
        .onConflict((conflict) => conflict.columns(["source_id", "content_hash"]).doNothing())
        .returningAll()
        .executeTakeFirst();

      snapshotObject ??= await transaction
        .selectFrom("ingestion.snapshot_objects")
        .selectAll()
        .where("source_id", "=", sourceId)
        .where("content_hash", "=", snapshot.contentHash)
        .executeTakeFirstOrThrow();
    }

    const fetchId = randomUUID();
    await transaction
      .insertInto("ingestion.crawl_fetches")
      .values({
        id: fetchId,
        crawl_run_id: crawlRunId,
        snapshot_object_id: snapshotObject.id,
        method: response.method,
        request_url: response.requestUrl,
        final_url: response.finalUrl,
        request_fingerprint: response.requestFingerprint,
        http_status: response.status,
        content_type: response.contentType,
        response_headers: canonicalJson(response.responseHeaders),
        fetch_result: "success",
        error_code: null,
      })
      .execute();
    return fetchId;
  });
}

export async function markFetchSchemaError(
  db: Kysely<Database>,
  fetchId: string,
  errorCode: string,
  lease: TaskLease,
): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    await assertActiveTaskLease(transaction, lease);
    await transaction
      .updateTable("ingestion.crawl_fetches")
      .set({
        fetch_result: "schema_error",
        error_code: errorCode,
      })
      .where("id", "=", fetchId)
      .execute();
  });
}

export interface PersistNormalizedOfficialJobInput {
  db: Kysely<Database>;
  sourceId: string;
  normalized: NormalizedOfficialJob;
  listFetchId: string;
  detailFetchId: string;
  observedAt: Date;
  lease: TaskLease;
  adapterVersion: string;
  normalizerVersion: string;
}

export async function persistNormalizedOfficialJob(
  input: PersistNormalizedOfficialJobInput,
): Promise<{ recordId: string; revisionId: string; createdRevision: boolean }> {
  const { db, sourceId, normalized, listFetchId, detailFetchId, observedAt, lease } = input;
  return db.transaction().execute(async (transaction) => {
    await assertActiveTaskLease(transaction, lease);

    const record = await transaction
      .insertInto("ingestion.source_job_records")
      .values({
        id: randomUUID(),
        source_id: sourceId,
        source_job_id: normalized.sourceJobId,
        canonical_source_url: normalized.sourceUrl,
        first_seen_at: observedAt,
        last_seen_at: observedAt,
      })
      .onConflict((conflict) =>
        conflict.columns(["source_id", "source_job_id"]).doUpdateSet({
          canonical_source_url: normalized.sourceUrl,
          last_seen_at: sql`greatest(ingestion.source_job_records.last_seen_at, ${observedAt})`,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    let revision = await transaction
      .insertInto("ingestion.source_job_revisions")
      .values({
        id: randomUUID(),
        source_job_record_id: record.id,
        revision_content_hash: normalized.revisionContentHash,
        import_mode: "collector",
        adapter_version: input.adapterVersion,
        normalizer_version: input.normalizerVersion,
        company_name: normalized.companyName,
        title: normalized.title,
        job_family: canonicalJson(normalized.jobFamily),
        locations: canonicalJson(normalized.locations),
        business_groups: canonicalJson(normalized.businessGroups),
        entry_scope: normalized.entryScope,
        source_project_name: normalized.sourceProjectName,
        recruit_label_name: normalized.recruitLabelName,
        recruitment_type: canonicalJson(normalized.recruitmentType),
        responsibilities: normalized.responsibilities,
        requirements: normalized.requirements,
        structured_fields: canonicalJson(normalized.structuredFields),
        ingestion_state: normalized.ingestionState,
        publication_state: normalized.publicationState,
        activity_state: normalized.activityState,
        source_url: normalized.sourceUrl,
        apply_url: normalized.applyUrl,
        quality_flags: canonicalJson(normalized.qualityFlags),
      })
      .onConflict((conflict) =>
        conflict.columns(["source_job_record_id", "revision_content_hash"]).doNothing(),
      )
      .returningAll()
      .executeTakeFirst();
    const createdRevision = revision !== undefined;

    revision ??= await transaction
      .selectFrom("ingestion.source_job_revisions")
      .selectAll()
      .where("source_job_record_id", "=", record.id)
      .where("revision_content_hash", "=", normalized.revisionContentHash)
      .executeTakeFirstOrThrow();

    for (const evidence of normalized.evidence) {
      const crawlFetchId = evidence.role === "list" ? listFetchId : detailFetchId;
      await transaction
        .insertInto("ingestion.source_job_revision_evidence")
        .values({
          id: randomUUID(),
          revision_id: revision.id,
          crawl_fetch_id: crawlFetchId,
          evidence_role: evidence.role,
          field_name: evidence.fieldName,
          json_pointer: evidence.jsonPointer,
          raw_value_hash: evidence.rawValueHash,
        })
        .onConflict((conflict) =>
          conflict
            .columns([
              "revision_id",
              "crawl_fetch_id",
              "evidence_role",
              "field_name",
              "json_pointer",
            ])
            .doNothing(),
        )
        .execute();
    }

    for (const reason of normalized.reviewReasons) {
      await transaction
        .insertInto("ingestion.review_items")
        .values({
          id: randomUUID(),
          revision_id: revision.id,
          reason_code: reason.code,
          status: "open",
          details: canonicalJson(reason.details),
          resolved_at: null,
        })
        .onConflict((conflict) => conflict.columns(["revision_id", "reason_code"]).doNothing())
        .execute();
    }

    return {
      recordId: record.id,
      revisionId: revision.id,
      createdRevision,
    };
  });
}

export async function persistNormalizedTencentJob(input: {
  db: Kysely<Database>;
  sourceId: string;
  normalized: NormalizedTencentJob;
  listFetchId: string;
  detailFetchId: string;
  observedAt: Date;
  lease: TaskLease;
}): Promise<{ recordId: string; revisionId: string; createdRevision: boolean }> {
  return persistNormalizedOfficialJob({
    ...input,
    adapterVersion: TENCENT_ADAPTER_VERSION,
    normalizerVersion: TENCENT_NORMALIZER_VERSION,
  });
}
