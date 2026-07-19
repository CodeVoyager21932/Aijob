import { randomUUID } from "node:crypto";
import type {
  JobPreference,
  JobPreferenceRevision,
  ProfileFact,
  ProfileFactRevision,
  ResumeEvidence,
  ResumeEvidenceRevision,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { ApiProblem } from "../identity/http.js";
import { assertActiveOwnerEpoch, type OwnerContext } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { resumeAnalysisCandidateIds } from "../resume/analysis-service.js";

export class ProfileRevisionConflict extends ApiProblem {
  constructor(readonly currentRevision: number) {
    super(
      409,
      "PROFILE_REVISION_CONFLICT",
      "资料已在其他页面更新",
      `当前修订版本为 ${currentRevision}，请刷新后确认再提交。`,
    );
  }
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function json<T>(value: JsonValue | string): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

async function lockOwnerRevision(
  db: Kysely<Database>,
  owner: OwnerContext,
  scope: string,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`${scope}:${owner.ownerId}`}, 0))`.execute(
    db,
  );
  await assertActiveOwnerEpoch(db, owner.ownerId, owner.ownerEpoch);
}

export async function getCurrentProfileFacts(input: {
  db: Kysely<Database>;
  ownerId: string;
}): Promise<ProfileFactRevision | null> {
  const row = await input.db
    .selectFrom("profile.profile_fact_revisions")
    .selectAll()
    .where("owner_id", "=", input.ownerId)
    .orderBy("revision", "desc")
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    revision: row.revision,
    baseRevision: row.base_revision,
    contentHash: row.content_hash,
    confirmedAt: iso(row.confirmed_at),
    createdAt: iso(row.created_at),
    facts: json<ProfileFact[]>(row.facts),
  };
}

export async function putProfileFacts(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  expectedRevision: number;
  facts: ProfileFact[];
  now?: Date;
}): Promise<ProfileFactRevision> {
  const now = input.now ?? new Date();
  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerRevision(transaction, input.owner, "profile-facts");
    const current = await getCurrentProfileFacts({
      db: transaction,
      ownerId: input.owner.ownerId,
    });
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== input.expectedRevision) {
      throw new ProfileRevisionConflict(currentRevision);
    }
    const revision = currentRevision + 1;
    const id = randomUUID();
    const contentHash = hashCanonicalJson(input.facts);
    await transaction
      .insertInto("profile.profile_fact_revisions")
      .values({
        id,
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        revision,
        base_revision: current?.revision ?? null,
        facts: JSON.stringify(input.facts) as unknown as JsonValue,
        content_hash: contentHash,
        confirmed_at: now,
        created_at: now,
      })
      .execute();
    return {
      id,
      ownerId: input.owner.ownerId,
      revision,
      baseRevision: current?.revision ?? null,
      contentHash,
      confirmedAt: now.toISOString(),
      createdAt: now.toISOString(),
      facts: input.facts,
    };
  });
}

export async function getCurrentJobPreferences(input: {
  db: Kysely<Database>;
  ownerId: string;
}): Promise<JobPreferenceRevision | null> {
  const row = await input.db
    .selectFrom("profile.job_preference_revisions")
    .selectAll()
    .where("owner_id", "=", input.ownerId)
    .orderBy("revision", "desc")
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    revision: row.revision,
    baseRevision: row.base_revision,
    contentHash: row.content_hash,
    confirmedAt: iso(row.confirmed_at),
    createdAt: iso(row.created_at),
    preferences: json<JobPreference>(row.preferences),
  };
}

export async function putJobPreferences(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  expectedRevision: number;
  preferences: JobPreference;
  now?: Date;
}): Promise<JobPreferenceRevision> {
  const now = input.now ?? new Date();
  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerRevision(transaction, input.owner, "job-preferences");
    const current = await getCurrentJobPreferences({
      db: transaction,
      ownerId: input.owner.ownerId,
    });
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== input.expectedRevision) {
      throw new ProfileRevisionConflict(currentRevision);
    }
    const revision = currentRevision + 1;
    const id = randomUUID();
    const contentHash = hashCanonicalJson(input.preferences);
    await transaction
      .insertInto("profile.job_preference_revisions")
      .values({
        id,
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        revision,
        base_revision: current?.revision ?? null,
        preferences: JSON.stringify(input.preferences) as unknown as JsonValue,
        content_hash: contentHash,
        confirmed_at: now,
        created_at: now,
      })
      .execute();
    return {
      id,
      ownerId: input.owner.ownerId,
      revision,
      baseRevision: current?.revision ?? null,
      contentHash,
      confirmedAt: now.toISOString(),
      createdAt: now.toISOString(),
      preferences: input.preferences,
    };
  });
}

export async function getCurrentResumeEvidence(input: {
  db: Kysely<Database>;
  ownerId: string;
}): Promise<ResumeEvidenceRevision | null> {
  const row = await input.db
    .selectFrom("profile.resume_evidence_revisions")
    .selectAll()
    .where("owner_id", "=", input.ownerId)
    .orderBy("revision", "desc")
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    revision: row.revision,
    baseRevision: row.base_revision,
    contentHash: row.content_hash,
    confirmedAt: iso(row.confirmed_at),
    createdAt: iso(row.created_at),
    resumeAnalysisId: row.resume_analysis_id,
    evidence: json<ResumeEvidence[]>(row.evidence),
  };
}

function validateEvidenceReferences(
  resumeAnalysisId: string | null,
  evidence: ResumeEvidence[],
): void {
  const ids = new Set<string>();
  for (const item of evidence) {
    if (ids.has(item.id)) {
      throw new ApiProblem(
        400,
        "DUPLICATE_EVIDENCE_ID",
        "经历证据编号重复",
        "请刷新解析结果后重新确认经历证据。",
      );
    }
    ids.add(item.id);
    if (item.resumeAnalysisId !== resumeAnalysisId) {
      throw new ApiProblem(
        400,
        "EVIDENCE_ANALYSIS_MISMATCH",
        "经历证据来源不一致",
        "同一次确认中的证据必须来自所选简历解析记录。",
      );
    }
  }
}

export async function putResumeEvidence(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  expectedRevision: number;
  resumeAnalysisId: string | null;
  evidence: ResumeEvidence[];
  now?: Date;
}): Promise<ResumeEvidenceRevision> {
  validateEvidenceReferences(input.resumeAnalysisId, input.evidence);
  const now = input.now ?? new Date();
  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerRevision(transaction, input.owner, "resume-evidence");
    const current = await getCurrentResumeEvidence({
      db: transaction,
      ownerId: input.owner.ownerId,
    });
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== input.expectedRevision) {
      throw new ProfileRevisionConflict(currentRevision);
    }

    if (input.resumeAnalysisId) {
      const analysis = await transaction
        .selectFrom("profile.resume_analyses")
        .select(["status", "owner_epoch", "analysis_result", "purge_after", "purged_at"])
        .where("id", "=", input.resumeAnalysisId)
        .where("owner_id", "=", input.owner.ownerId)
        .executeTakeFirst();
      if (
        !analysis ||
        analysis.status !== "succeeded" ||
        Number(analysis.owner_epoch) !== input.owner.ownerEpoch ||
        analysis.purged_at !== null ||
        new Date(analysis.purge_after).getTime() <= now.getTime() ||
        !analysis.analysis_result
      ) {
        throw new ApiProblem(
          409,
          "RESUME_ANALYSIS_NOT_CONFIRMABLE",
          "当前简历解析不能确认",
          "请等待解析完成，或重新提交一份可读取的简历。",
        );
      }

      let candidateIds: ReadonlySet<string>;
      try {
        candidateIds = resumeAnalysisCandidateIds({
          analysisId: input.resumeAnalysisId,
          storageMetadata: analysis.analysis_result,
        });
      } catch {
        throw new ApiProblem(
          409,
          "RESUME_ANALYSIS_NOT_CONFIRMABLE",
          "当前简历解析不能确认",
          "候选证据元数据已失效，请重新提交简历。",
        );
      }
      if (input.evidence.some((item) => !candidateIds.has(item.id))) {
        throw new ApiProblem(
          400,
          "EVIDENCE_CANDIDATE_UNKNOWN",
          "经历证据不属于当前解析结果",
          "请刷新解析结果，只确认当前页面提供的候选证据。",
        );
      }
    }

    const revision = currentRevision + 1;
    const id = randomUUID();
    const contentHash = hashCanonicalJson({
      resumeAnalysisId: input.resumeAnalysisId,
      evidence: input.evidence,
    });
    await transaction
      .insertInto("profile.resume_evidence_revisions")
      .values({
        id,
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        resume_analysis_id: input.resumeAnalysisId,
        revision,
        base_revision: current?.revision ?? null,
        evidence: JSON.stringify(input.evidence) as unknown as JsonValue,
        content_hash: contentHash,
        confirmed_at: now,
        created_at: now,
      })
      .execute();

    if (input.resumeAnalysisId) {
      await transaction
        .updateTable("profile.resume_analyses")
        .set({
          raw_ciphertext: null,
          raw_nonce: null,
          raw_auth_tag: null,
          extracted_text_ciphertext: null,
          extracted_text_nonce: null,
          extracted_text_auth_tag: null,
          analysis_result: null,
          original_filename: null,
          privacy_confirmed_at: now,
          purged_at: now,
          updated_at: now,
        })
        .where("id", "=", input.resumeAnalysisId)
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .execute();
    }

    return {
      id,
      ownerId: input.owner.ownerId,
      revision,
      baseRevision: current?.revision ?? null,
      contentHash,
      confirmedAt: now.toISOString(),
      createdAt: now.toISOString(),
      resumeAnalysisId: input.resumeAnalysisId,
      evidence: input.evidence,
    };
  });
}
