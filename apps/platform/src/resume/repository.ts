import { randomUUID } from "node:crypto";
import type { ResumeInputKind } from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { ApiProblem } from "../identity/http.js";
import { assertActiveOwnerEpoch, type OwnerContext } from "../identity/session-repository.js";
import { hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import {
  type HydratedResumeAnalysisResult,
  rebuildResumeAnalysisResult,
} from "./analysis-service.js";
import { decryptResumePayload, encryptResumePayload } from "./crypto.js";

const BACKOFF_POLICY = {
  baseMilliseconds: 500,
  maximumMilliseconds: 5_000,
  jitter: "full",
};

export interface StoredResumeAnalysis {
  id: string;
  ownerId: string;
  inputKind: ResumeInputKind;
  status: "queued" | "processing" | "needs_input" | "succeeded" | "failed" | "deleted";
  piiFindings: Array<{
    kind: "phone" | "email" | "national_id" | "address" | "other";
    count: number;
  }>;
  requiresPrivacyConfirmation: boolean;
  purgeAfter: string;
  confirmedAt: string | null;
  purgedAt: string | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  result: HydratedResumeAnalysisResult | null;
}

export interface SubmitResumeAnalysisInput {
  db: Kysely<Database>;
  owner: OwnerContext;
  idempotencyKey: string;
  inputKind: ResumeInputKind;
  filename: string | null;
  mediaType: string;
  plaintext: Buffer;
  encryptionKey: string;
  encryptionKeyVersion?: string;
  piiSummary?: StoredResumeAnalysis["piiFindings"];
  now?: Date;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function parseJsonValue(value: JsonValue | string): JsonValue {
  return typeof value === "string" ? (JSON.parse(value) as JsonValue) : value;
}

function parsePiiSummary(value: JsonValue | string): StoredResumeAnalysis["piiFindings"] {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (
      !item ||
      Array.isArray(item) ||
      typeof item !== "object" ||
      typeof item.kind !== "string" ||
      typeof item.count !== "number"
    ) {
      return [];
    }
    if (!["phone", "email", "national_id", "address", "other"].includes(item.kind)) {
      return [];
    }
    return [
      {
        kind: item.kind as StoredResumeAnalysis["piiFindings"][number]["kind"],
        count: item.count,
      },
    ];
  });
}

export function mapResumeAnalysisRow(
  row: {
    id: string;
    owner_id: string;
    input_kind: string;
    status: string;
    pii_summary: JsonValue;
    purge_after: Date | string;
    privacy_confirmed_at: Date | string | null;
    purged_at: Date | string | null;
    failure_code: string | null;
    created_at: Date | string;
    updated_at: Date | string;
  },
  result: HydratedResumeAnalysisResult | null,
): StoredResumeAnalysis {
  const piiFindings = parsePiiSummary(row.pii_summary);
  return {
    id: row.id,
    ownerId: row.owner_id,
    inputKind: row.input_kind as ResumeInputKind,
    status: row.status as StoredResumeAnalysis["status"],
    piiFindings,
    requiresPrivacyConfirmation: piiFindings.length > 0,
    purgeAfter: asDate(row.purge_after).toISOString(),
    confirmedAt: row.privacy_confirmed_at ? asDate(row.privacy_confirmed_at).toISOString() : null,
    purgedAt: row.purged_at ? asDate(row.purged_at).toISOString() : null,
    failureCode: row.failure_code,
    createdAt: asDate(row.created_at).toISOString(),
    updatedAt: asDate(row.updated_at).toISOString(),
    result,
  };
}

function requiredBytes(value: Uint8Array | null): Buffer {
  if (!value) throw new Error("RESUME_CIPHERTEXT_MISSING");
  return Buffer.from(value);
}

function taskPayload(value: JsonValue | string): {
  analysisId?: string;
  requestHash?: string;
} {
  const parsed = parseJsonValue(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return {};
  return {
    ...(typeof parsed.analysisId === "string" ? { analysisId: parsed.analysisId } : {}),
    ...(typeof parsed.requestHash === "string" ? { requestHash: parsed.requestHash } : {}),
  };
}

export async function getResumeAnalysis(input: {
  db: Kysely<Database>;
  ownerId: string;
  ownerEpoch: number;
  analysisId: string;
  encryptionKey: string;
  now?: Date;
}): Promise<StoredResumeAnalysis | null> {
  const now = input.now ?? new Date();
  await assertActiveOwnerEpoch(input.db, input.ownerId, input.ownerEpoch, now);
  const row = await input.db
    .selectFrom("profile.resume_analyses")
    .select([
      "id",
      "owner_id",
      "owner_epoch",
      "input_kind",
      "status",
      "pii_summary",
      "purge_after",
      "privacy_confirmed_at",
      "purged_at",
      "failure_code",
      "created_at",
      "updated_at",
      "analysis_result",
      "extracted_text_ciphertext",
      "extracted_text_nonce",
      "extracted_text_auth_tag",
    ])
    .where("id", "=", input.analysisId)
    .where("owner_id", "=", input.ownerId)
    .where("owner_epoch", "=", input.ownerEpoch)
    .executeTakeFirst();
  if (!row) return null;

  let result: HydratedResumeAnalysisResult | null = null;
  if (row.analysis_result && !row.purged_at && asDate(row.purge_after).getTime() > now.getTime()) {
    const extractedText = decryptResumePayload(
      {
        ciphertext: requiredBytes(row.extracted_text_ciphertext),
        initializationVector: requiredBytes(row.extracted_text_nonce),
        authenticationTag: requiredBytes(row.extracted_text_auth_tag),
      },
      input.encryptionKey,
    ).toString("utf8");
    result = rebuildResumeAnalysisResult({
      analysisId: row.id,
      extractedText,
      storageMetadata: row.analysis_result,
    });
  }
  return mapResumeAnalysisRow(row, result);
}

export async function submitResumeAnalysis(
  input: SubmitResumeAnalysisInput,
): Promise<{ analysis: StoredResumeAnalysis; created: boolean }> {
  const now = input.now ?? new Date();
  const encrypted = encryptResumePayload(input.plaintext, input.encryptionKey);
  const requestHash = hashCanonicalJson({
    inputKind: input.inputKind,
    filename: input.filename,
    mediaType: input.mediaType,
    byteSize: input.plaintext.byteLength,
    contentSha256: encrypted.plaintextSha256,
  });
  const taskIdempotencyKey = `resume-analysis:${sha256(
    `${input.owner.ownerId}:${input.idempotencyKey}`,
  )}`;

  return input.db.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${taskIdempotencyKey}, 0))`.execute(
      transaction,
    );
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);

    const existingTask = await transaction
      .selectFrom("task_queue.tasks")
      .select(["payload"])
      .where("idempotency_key", "=", taskIdempotencyKey)
      .executeTakeFirst();
    if (existingTask) {
      const payload = taskPayload(existingTask.payload);
      if (payload.requestHash !== requestHash) {
        throw new ApiProblem(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "幂等键已用于其他简历",
          "请为不同的简历内容使用新的 Idempotency-Key。",
        );
      }
      if (!payload.analysisId) {
        throw new Error("RESUME_TASK_PAYLOAD_INVALID");
      }
      const existing = await getResumeAnalysis({
        db: transaction,
        ownerId: input.owner.ownerId,
        ownerEpoch: input.owner.ownerEpoch,
        analysisId: payload.analysisId,
        encryptionKey: input.encryptionKey,
      });
      if (!existing) throw new Error("RESUME_ANALYSIS_NOT_FOUND_FOR_TASK");
      return { analysis: existing, created: false };
    }

    const analysisId = randomUUID();
    await transaction
      .insertInto("profile.resume_analyses")
      .values({
        id: analysisId,
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        input_kind: input.inputKind,
        status: "queued",
        original_filename: input.filename,
        media_type: input.mediaType,
        byte_size: input.plaintext.byteLength,
        content_sha256: encrypted.plaintextSha256,
        encryption_key_version: input.encryptionKeyVersion ?? "local-v1",
        raw_ciphertext: encrypted.ciphertext,
        raw_nonce: encrypted.initializationVector,
        raw_auth_tag: encrypted.authenticationTag,
        extracted_text_ciphertext: null,
        extracted_text_nonce: null,
        extracted_text_auth_tag: null,
        pii_summary: JSON.stringify(input.piiSummary ?? []),
        analysis_result: null,
        privacy_confirmed_at: null,
        purge_after: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
        purged_at: null,
        failure_code: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await transaction
      .insertInto("task_queue.tasks")
      .values({
        id: randomUUID(),
        task_type: "resume_analysis",
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        payload: JSON.stringify({ analysisId, requestHash }),
        idempotency_key: taskIdempotencyKey,
        status: "queued",
        attempt: 0,
        max_attempts: 3,
        available_at: now,
        backoff_policy: JSON.stringify(BACKOFF_POLICY),
        lease_owner: null,
        lease_until: null,
        heartbeat_at: null,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();

    const analysis = await getResumeAnalysis({
      db: transaction,
      ownerId: input.owner.ownerId,
      ownerEpoch: input.owner.ownerEpoch,
      analysisId,
      encryptionKey: input.encryptionKey,
    });
    if (!analysis) throw new Error("RESUME_ANALYSIS_INSERT_FAILED");
    return { analysis, created: true };
  });
}
