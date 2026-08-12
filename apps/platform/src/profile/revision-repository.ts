import { randomUUID } from "node:crypto";
import type {
  ConfirmResumeProfileRequest,
  ConfirmResumeProfileResponse,
  JobPreference,
  JobPreferenceRevision,
  ProfileFact,
  ProfileFactRevision,
  ResumeDocumentInput,
  ResumeDocumentRevision,
  ResumeEvidence,
  ResumeEvidenceRevision,
} from "@aijob/contracts";
import { ConfirmResumeProfileResponseSchema } from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { ApiProblem } from "../identity/http.js";
import { assertActiveOwnerEpoch, type OwnerContext } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import {
  deriveResumeEvidenceContent,
  resumeAnalysisCandidateIds,
  resumeAnalysisDocumentBlockIds,
} from "../resume/analysis-service.js";

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
    return writeProfileFactsRevision({ ...input, db: transaction, now });
  });
}

async function writeProfileFactsRevision(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  expectedRevision: number;
  facts: ProfileFact[];
  now: Date;
}): Promise<ProfileFactRevision> {
  const current = await getCurrentProfileFacts({
    db: input.db,
    ownerId: input.owner.ownerId,
  });
  const currentRevision = current?.revision ?? 0;
  if (currentRevision !== input.expectedRevision) {
    throw new ProfileRevisionConflict(currentRevision);
  }
  const revision = currentRevision + 1;
  const id = randomUUID();
  const contentHash = hashCanonicalJson(input.facts);
  await input.db
    .insertInto("profile.profile_fact_revisions")
    .values({
      id,
      owner_id: input.owner.ownerId,
      owner_epoch: input.owner.ownerEpoch,
      revision,
      base_revision: current?.revision ?? null,
      facts: JSON.stringify(input.facts) as unknown as JsonValue,
      content_hash: contentHash,
      confirmed_at: input.now,
      created_at: input.now,
    })
    .execute();
  return {
    id,
    ownerId: input.owner.ownerId,
    revision,
    baseRevision: current?.revision ?? null,
    contentHash,
    confirmedAt: input.now.toISOString(),
    createdAt: input.now.toISOString(),
    facts: input.facts,
  };
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
    return writeJobPreferencesRevision({ ...input, db: transaction, now });
  });
}

async function writeJobPreferencesRevision(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  expectedRevision: number;
  preferences: JobPreference;
  now: Date;
}): Promise<JobPreferenceRevision> {
  const current = await getCurrentJobPreferences({
    db: input.db,
    ownerId: input.owner.ownerId,
  });
  const currentRevision = current?.revision ?? 0;
  if (currentRevision !== input.expectedRevision) {
    throw new ProfileRevisionConflict(currentRevision);
  }
  const revision = currentRevision + 1;
  const id = randomUUID();
  const contentHash = hashCanonicalJson(input.preferences);
  await input.db
    .insertInto("profile.job_preference_revisions")
    .values({
      id,
      owner_id: input.owner.ownerId,
      owner_epoch: input.owner.ownerEpoch,
      revision,
      base_revision: current?.revision ?? null,
      preferences: JSON.stringify(input.preferences) as unknown as JsonValue,
      content_hash: contentHash,
      confirmed_at: input.now,
      created_at: input.now,
    })
    .execute();
  return {
    id,
    ownerId: input.owner.ownerId,
    revision,
    baseRevision: current?.revision ?? null,
    contentHash,
    confirmedAt: input.now.toISOString(),
    createdAt: input.now.toISOString(),
    preferences: input.preferences,
  };
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
  return row ? resumeEvidenceRevisionFromRow(row) : null;
}

function resumeEvidenceRevisionFromRow(row: {
  id: string;
  owner_id: string;
  revision: number;
  base_revision: number | null;
  content_hash: string;
  confirmed_at: Date | string;
  created_at: Date | string;
  resume_analysis_id: string | null;
  schema_version: string;
  document_revision_id: string | null;
  evidence: JsonValue;
}): ResumeEvidenceRevision {
  return {
    id: row.id,
    ownerId: row.owner_id,
    revision: row.revision,
    baseRevision: row.base_revision,
    contentHash: row.content_hash,
    confirmedAt: iso(row.confirmed_at),
    createdAt: iso(row.created_at),
    resumeAnalysisId: row.resume_analysis_id,
    schemaVersion: row.schema_version as "resume-evidence-v1" | "resume-evidence-v2",
    documentRevisionId: row.document_revision_id,
    evidence: json<ResumeEvidence[]>(row.evidence),
  };
}

export async function getResumeEvidenceRevision(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  evidenceRevisionId: string;
}): Promise<ResumeEvidenceRevision | null> {
  const row = await input.db
    .selectFrom("profile.resume_evidence_revisions")
    .selectAll()
    .where("id", "=", input.evidenceRevisionId)
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .executeTakeFirst();
  return row ? resumeEvidenceRevisionFromRow(row) : null;
}

function resumeDocumentRevisionFromRow(row: {
  id: string;
  owner_id: string;
  resume_analysis_id: string | null;
  revision: number;
  base_revision: number | null;
  schema_version: string;
  sections: JsonValue;
  content_hash: string;
  confirmed_at: Date | string;
  created_at: Date | string;
}): ResumeDocumentRevision {
  return {
    id: row.id,
    ownerId: row.owner_id,
    resumeAnalysisId: row.resume_analysis_id,
    revision: row.revision,
    baseRevision: row.base_revision,
    schemaVersion: "resume-document-v1",
    sections: json<ResumeDocumentInput["sections"]>(row.sections),
    contentHash: row.content_hash,
    confirmedAt: iso(row.confirmed_at),
    createdAt: iso(row.created_at),
  };
}

export async function getCurrentResumeDocument(input: {
  db: Kysely<Database>;
  ownerId: string;
  ownerEpoch?: number;
}): Promise<ResumeDocumentRevision | null> {
  let query = input.db
    .selectFrom("profile.resume_document_revisions")
    .selectAll()
    .where("owner_id", "=", input.ownerId)
    .where("schema_version", "=", "resume-document-v1")
    .where("document_id", "is", null);
  if (input.ownerEpoch !== undefined) {
    query = query.where("owner_epoch", "=", input.ownerEpoch);
  }
  const row = await query.orderBy("revision", "desc").executeTakeFirst();
  return row ? resumeDocumentRevisionFromRow(row) : null;
}

function validateEvidenceReferences(
  resumeAnalysisId: string | null,
  evidence: ResumeEvidence[],
  document: ResumeDocumentInput | null,
): void {
  const documentBlockIds = new Set(
    document?.sections.flatMap((section) => section.blocks.map(({ id }) => id)) ?? [],
  );
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
    if (!documentBlockIds.has(item.sourceBlockId)) {
      throw new ApiProblem(
        400,
        "EVIDENCE_SOURCE_BLOCK_UNKNOWN",
        "经历证据没有对应的简历区块",
        "请刷新解析结果，只确认当前文档区块中的原子证据。",
      );
    }
  }
}

export async function putResumeEvidence(input: {
  db: Kysely<Database>;
  existingTransaction?: Kysely<Database>;
  owner: OwnerContext;
  expectedRevision: number;
  resumeAnalysisId: string | null;
  document: ResumeDocumentInput | null;
  evidence: ResumeEvidence[];
  now?: Date;
}): Promise<ResumeEvidenceRevision> {
  validateEvidenceReferences(input.resumeAnalysisId, input.evidence, input.document);
  const now = input.now ?? new Date();
  const execute = async (transaction: Kysely<Database>): Promise<ResumeEvidenceRevision> => {
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
      let candidateBlockIds: ReadonlySet<string>;
      try {
        candidateIds = resumeAnalysisCandidateIds({
          analysisId: input.resumeAnalysisId,
          storageMetadata: analysis.analysis_result,
        });
        candidateBlockIds = resumeAnalysisDocumentBlockIds({
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
      const submittedBlockIds =
        input.document?.sections.flatMap((section) => section.blocks.map(({ id }) => id)) ?? [];
      if (
        !input.document ||
        submittedBlockIds.length !== candidateBlockIds.size ||
        submittedBlockIds.some((id) => !candidateBlockIds.has(id))
      ) {
        throw new ApiProblem(
          400,
          "RESUME_DOCUMENT_BLOCK_UNKNOWN",
          "简历区块不属于当前解析结果",
          "请刷新解析结果后重新确认有序简历区块。",
        );
      }
    }

    const revision = currentRevision + 1;
    const id = randomUUID();
    let documentRevisionId: string | null = null;
    if (input.document) {
      const [currentDocument, currentGlobalDocumentRevision] = await Promise.all([
        transaction
          .selectFrom("profile.resume_document_revisions")
          .select(["id", "revision"])
          .where("owner_id", "=", input.owner.ownerId)
          .where("owner_epoch", "=", input.owner.ownerEpoch)
          .where("schema_version", "=", "resume-document-v1")
          .where("document_id", "is", null)
          .orderBy("revision", "desc")
          .executeTakeFirst(),
        transaction
          .selectFrom("profile.resume_document_revisions")
          .select("revision")
          .where("owner_id", "=", input.owner.ownerId)
          .orderBy("revision", "desc")
          .executeTakeFirst(),
      ]);
      documentRevisionId = randomUUID();
      await transaction
        .insertInto("profile.resume_document_revisions")
        .values({
          id: documentRevisionId,
          owner_id: input.owner.ownerId,
          owner_epoch: input.owner.ownerEpoch,
          resume_analysis_id: input.resumeAnalysisId,
          revision: (currentGlobalDocumentRevision?.revision ?? 0) + 1,
          base_revision: currentDocument?.revision ?? null,
          schema_version: input.document.schemaVersion,
          sections: JSON.stringify(input.document.sections) as unknown as JsonValue,
          content_hash: hashCanonicalJson(input.document),
          confirmed_at: now,
          created_at: now,
        })
        .execute();
    }
    const contentHash = hashCanonicalJson({
      resumeAnalysisId: input.resumeAnalysisId,
      documentRevisionId,
      evidence: input.evidence,
    });
    await transaction
      .insertInto("profile.resume_evidence_revisions")
      .values({
        id,
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        resume_analysis_id: input.resumeAnalysisId,
        schema_version: "resume-evidence-v2",
        document_revision_id: documentRevisionId,
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
      schemaVersion: "resume-evidence-v2",
      documentRevisionId,
      evidence: input.evidence,
    };
  };
  return input.existingTransaction
    ? execute(input.existingTransaction)
    : input.db.transaction().execute(execute);
}

export async function confirmResumeProfile(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  request: ConfirmResumeProfileRequest;
  now?: Date;
}): Promise<ConfirmResumeProfileResponse> {
  validateEvidenceReferences(
    input.request.evidence.resumeAnalysisId,
    input.request.evidence.evidence,
    input.request.evidence.document,
  );
  const now = input.now ?? new Date();
  return input.db.transaction().execute(async (transaction) => {
    // Keep the order stable so two confirmations cannot deadlock each other.
    await lockOwnerRevision(transaction, input.owner, "job-preferences");
    await lockOwnerRevision(transaction, input.owner, "profile-facts");
    const factsRevision = await writeProfileFactsRevision({
      db: transaction,
      owner: input.owner,
      expectedRevision: input.request.facts.expectedRevision,
      facts: input.request.facts.facts,
      now,
    });
    const preferencesRevision = await writeJobPreferencesRevision({
      db: transaction,
      owner: input.owner,
      expectedRevision: input.request.preferences.expectedRevision,
      preferences: input.request.preferences.preferences,
      now,
    });
    const evidenceRevision = await putResumeEvidence({
      db: input.db,
      existingTransaction: transaction,
      owner: input.owner,
      ...input.request.evidence,
      now,
    });
    return ConfirmResumeProfileResponseSchema.parse({
      factsRevision,
      preferencesRevision,
      evidenceRevision,
    });
  });
}

export async function putSavedResumeEvidenceSelection(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  expectedRevision: number;
  documentRevisionId: string;
  sourceBlockIds: string[];
  now?: Date;
}): Promise<ResumeEvidenceRevision> {
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

    const document = await getCurrentResumeDocument({
      db: transaction,
      ownerId: input.owner.ownerId,
      ownerEpoch: input.owner.ownerEpoch,
    });
    if (!document || document.id !== input.documentRevisionId) {
      throw new ApiProblem(
        409,
        "RESUME_DOCUMENT_REVISION_STALE",
        "已保存简历资料已经更新",
        "请刷新页面后，基于最新保存的简历区块重新选择经历证据。",
      );
    }

    const blocks = new Map(
      document.sections.flatMap((section) =>
        section.blocks.map((block) => [block.id, { section: section.title, block }] as const),
      ),
    );
    const unknownBlockId = input.sourceBlockIds.find((id) => !blocks.has(id));
    if (unknownBlockId) {
      throw new ApiProblem(
        400,
        "EVIDENCE_SOURCE_BLOCK_UNKNOWN",
        "经历证据没有对应的简历区块",
        "请刷新页面，只选择当前已保存简历中的区块。",
      );
    }

    const evidence: ResumeEvidence[] = input.sourceBlockIds.map((sourceBlockId) => {
      const source = blocks.get(sourceBlockId);
      if (!source) throw new Error("RESUME_DOCUMENT_BLOCK_LOOKUP_FAILED");
      return {
        id: randomUUID(),
        resumeAnalysisId: document.resumeAnalysisId,
        sourceBlockId,
        section: source.section,
        ...deriveResumeEvidenceContent(source.section, source.block.text),
        confirmed: true,
      };
    });
    const revision = currentRevision + 1;
    const id = randomUUID();
    const contentHash = hashCanonicalJson({
      resumeAnalysisId: document.resumeAnalysisId,
      documentRevisionId: document.id,
      evidence,
    });
    await transaction
      .insertInto("profile.resume_evidence_revisions")
      .values({
        id,
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        resume_analysis_id: document.resumeAnalysisId,
        schema_version: "resume-evidence-v2",
        document_revision_id: document.id,
        revision,
        base_revision: current?.revision ?? null,
        evidence: JSON.stringify(evidence) as unknown as JsonValue,
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
      resumeAnalysisId: document.resumeAnalysisId,
      schemaVersion: "resume-evidence-v2",
      documentRevisionId: document.id,
      evidence,
    };
  });
}
