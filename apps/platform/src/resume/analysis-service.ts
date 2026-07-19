import { createHash } from "node:crypto";
import type { ProfileFact } from "@aijob/contracts";
import type { Database, JsonValue, ResumeAnalysisStorageMetadata } from "@aijob/database";
import type { Kysely } from "kysely";
import type { OwnerTaskLease } from "../workers/owner-task-lease.js";
import { withOwnerTaskLease } from "../workers/owner-task-lease.js";
import { decryptResumePayload, encryptResumePayload } from "./crypto.js";
import { parseResumeBuffer, parseResumeText } from "./parse.js";
import {
  type PersonalInformationFinding,
  ResumeInputError,
  redactPersonalInformation,
} from "./security.js";

interface CandidateEvidence {
  id: string;
  section: string;
  originalText: string;
  claim: string;
  skills: string[];
  outcomes: string[];
  confirmed: false;
}

// Bump this storage version whenever candidate paragraph selection or ordering changes.
// The temporary encrypted text can only be hydrated by the parser version that produced it.
const RESUME_ANALYSIS_STORAGE_VERSION = "resume-analysis-storage-v1" as const;

export interface ResumeAnalysisResult {
  version: "resume-analysis-v1";
  redactedText: string;
  candidateFacts: Array<ProfileFact & { confirmed: false }>;
  candidateEvidence: CandidateEvidence[];
}

const SKILL_TERMS = [
  "Axure",
  "Figma",
  "SQL",
  "Python",
  "Excel",
  "Tableau",
  "Power BI",
  "用户研究",
  "数据分析",
  "需求分析",
  "活动运营",
  "内容运营",
  "用户运营",
] as const;

function piiSummary(findings: PersonalInformationFinding[]): JsonValue {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    const kind =
      finding.kind === "mobile"
        ? "phone"
        : finding.kind === "chinese_identity_number"
          ? "national_id"
          : finding.kind;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
}

function candidateFacts(text: string): ResumeAnalysisResult["candidateFacts"] {
  const facts: ResumeAnalysisResult["candidateFacts"] = [];
  const graduationMatch = text.match(/(?:毕业(?:时间|年份)?|应届)[^\d]{0,8}(20\d{2})/);
  if (graduationMatch?.[1]) {
    facts.push({
      key: "graduation_year",
      value: Number(graduationMatch[1]),
      confirmed: false,
    });
  }

  const skills = SKILL_TERMS.filter((term) =>
    text.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
  );
  if (skills.length > 0) {
    facts.push({ key: "skills", value: skills, confirmed: false });
  }
  return facts;
}

function evidenceSection(line: string, currentSection: string): string {
  const trimmed = line.trim();
  if (trimmed.length <= 20 && /(?:经历|项目|实习|教育|技能|实践|校园|工作|作品)/.test(trimmed)) {
    return trimmed.replace(/[：:]+$/, "");
  }
  return currentSection;
}

function uuidV5(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  if (namespaceBytes.length !== 16) throw new Error("RESUME_ANALYSIS_ID_INVALID");
  const bytes = createHash("sha1").update(namespaceBytes).update(name).digest().subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

function candidateEvidence(text: string, analysisId: string): CandidateEvidence[] {
  const evidence: CandidateEvidence[] = [];
  let section = "简历内容";
  const paragraphs = text
    .split(/\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12);

  for (const paragraph of paragraphs.slice(0, 100)) {
    const nextSection = evidenceSection(paragraph, section);
    if (nextSection !== section) {
      section = nextSection;
      continue;
    }
    const skills = SKILL_TERMS.filter((term) =>
      paragraph.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
    );
    const outcomes =
      paragraph.match(/[^。；;\n]*(?:\d+(?:\.\d+)?%|\d+\s*(?:人|次|个|万|千|元))[^。；;\n]*/g) ??
      [];
    evidence.push({
      id: uuidV5(analysisId, `candidate-evidence:${evidence.length}`),
      section,
      originalText: paragraph.slice(0, 10_000),
      claim: paragraph.slice(0, 2_000),
      skills,
      outcomes: outcomes
        .map((outcome) => outcome.trim())
        .filter(Boolean)
        .slice(0, 20),
      confirmed: false,
    });
  }
  return evidence;
}

function buildAnalysisResult(
  text: string,
  analysisId: string,
): {
  result: ResumeAnalysisResult;
  findings: PersonalInformationFinding[];
} {
  const { redactedText, findings } = redactPersonalInformation(text);
  return {
    findings,
    result: {
      version: "resume-analysis-v1",
      redactedText,
      candidateFacts: candidateFacts(redactedText),
      candidateEvidence: candidateEvidence(redactedText, analysisId),
    },
  };
}

function parseStorageMetadata(value: JsonValue | string): ResumeAnalysisStorageMetadata {
  const parsed = typeof value === "string" ? (JSON.parse(value) as JsonValue) : value;
  if (
    !parsed ||
    Array.isArray(parsed) ||
    typeof parsed !== "object" ||
    parsed.version !== RESUME_ANALYSIS_STORAGE_VERSION ||
    typeof parsed.candidateEvidenceCount !== "number" ||
    !Number.isInteger(parsed.candidateEvidenceCount) ||
    parsed.candidateEvidenceCount < 0 ||
    parsed.candidateEvidenceCount > 100
  ) {
    throw new Error("RESUME_ANALYSIS_STORAGE_INVALID");
  }
  return {
    version: RESUME_ANALYSIS_STORAGE_VERSION,
    candidateEvidenceCount: parsed.candidateEvidenceCount,
  };
}

function storageMetadata(result: ResumeAnalysisResult): ResumeAnalysisStorageMetadata {
  return {
    version: RESUME_ANALYSIS_STORAGE_VERSION,
    candidateEvidenceCount: result.candidateEvidence.length,
  };
}

export function rebuildResumeAnalysisResult(input: {
  analysisId: string;
  extractedText: string;
  storageMetadata: JsonValue | string;
}): ResumeAnalysisResult {
  const metadata = parseStorageMetadata(input.storageMetadata);
  const { result } = buildAnalysisResult(input.extractedText, input.analysisId);
  if (result.candidateEvidence.length !== metadata.candidateEvidenceCount) {
    throw new Error("RESUME_ANALYSIS_PARSER_VERSION_MISMATCH");
  }
  return result;
}

export function resumeAnalysisCandidateIds(input: {
  analysisId: string;
  storageMetadata: JsonValue | string;
}): ReadonlySet<string> {
  const metadata = parseStorageMetadata(input.storageMetadata);
  return new Set(
    Array.from({ length: metadata.candidateEvidenceCount }, (_item, ordinal) =>
      uuidV5(input.analysisId, `candidate-evidence:${ordinal}`),
    ),
  );
}

function bytes(value: Uint8Array | null): Buffer {
  if (!value) throw new Error("RESUME_CIPHERTEXT_MISSING");
  return Buffer.from(value);
}

export async function processResumeAnalysis(input: {
  db: Kysely<Database>;
  analysisId: string;
  ownerId: string;
  ownerEpoch: number;
  encryptionKey: string;
  lease: OwnerTaskLease;
  now?: Date;
}): Promise<ResumeAnalysisResult> {
  const now = input.now ?? new Date();
  const claimed = await withOwnerTaskLease(input.db, input.lease, async (transaction) => {
    const current = await transaction
      .selectFrom("profile.resume_analyses")
      .selectAll()
      .where("id", "=", input.analysisId)
      .where("owner_id", "=", input.ownerId)
      .where("owner_epoch", "=", input.ownerEpoch)
      .forUpdate()
      .executeTakeFirst();
    if (current?.status === "succeeded" && current.analysis_result) {
      return { current, alreadyCompleted: true as const };
    }
    if (!current || (current.status !== "queued" && current.status !== "processing")) {
      throw new Error("RESUME_ANALYSIS_NOT_CLAIMABLE");
    }
    if (current.status === "queued") {
      await transaction
        .updateTable("profile.resume_analyses")
        .set({ status: "processing", updated_at: now })
        .where("id", "=", current.id)
        .executeTakeFirstOrThrow();
    }
    return { current, alreadyCompleted: false as const };
  });

  if (claimed.alreadyCompleted) {
    const extractedText = decryptResumePayload(
      {
        ciphertext: bytes(claimed.current.extracted_text_ciphertext),
        initializationVector: bytes(claimed.current.extracted_text_nonce),
        authenticationTag: bytes(claimed.current.extracted_text_auth_tag),
      },
      input.encryptionKey,
    ).toString("utf8");
    return rebuildResumeAnalysisResult({
      analysisId: input.analysisId,
      extractedText,
      storageMetadata: claimed.current.analysis_result,
    });
  }
  const analysis = claimed.current;

  try {
    const owner = await input.db
      .selectFrom("identity.owners")
      .select(["status", "epoch"])
      .where("id", "=", input.ownerId)
      .executeTakeFirst();
    if (!owner || owner.status !== "active" || Number(owner.epoch) !== input.ownerEpoch) {
      throw new Error("OWNER_EPOCH_STALE");
    }

    const plaintext = decryptResumePayload(
      {
        ciphertext: bytes(analysis.raw_ciphertext),
        initializationVector: bytes(analysis.raw_nonce),
        authenticationTag: bytes(analysis.raw_auth_tag),
      },
      input.encryptionKey,
    );
    const text =
      analysis.input_kind === "pasted_text"
        ? parseResumeText(plaintext.toString("utf8"))
        : await parseResumeBuffer({
            kind: analysis.input_kind as "pdf" | "docx",
            buffer: plaintext,
          });
    const { result, findings } = buildAnalysisResult(text, input.analysisId);
    const extracted = encryptResumePayload(Buffer.from(text, "utf8"), input.encryptionKey);

    const completedAt = new Date();
    const stored = await withOwnerTaskLease(input.db, input.lease, async (transaction) => {
      const current = await transaction
        .selectFrom("profile.resume_analyses")
        .select(["status", "purged_at", "purge_after"])
        .where("id", "=", input.analysisId)
        .where("owner_id", "=", input.ownerId)
        .where("owner_epoch", "=", input.ownerEpoch)
        .forUpdate()
        .executeTakeFirst();
      if (
        !current ||
        current.status !== "processing" ||
        current.purged_at !== null ||
        new Date(current.purge_after).getTime() <= completedAt.getTime()
      ) {
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
            purged_at: current?.purged_at ?? completedAt,
            updated_at: completedAt,
          })
          .where("id", "=", input.analysisId)
          .where("owner_id", "=", input.ownerId)
          .where("owner_epoch", "=", input.ownerEpoch)
          .where("status", "=", "processing")
          .execute();
        return false;
      }
      const updated = await transaction
        .updateTable("profile.resume_analyses")
        .set({
          status: "succeeded",
          extracted_text_ciphertext: extracted.ciphertext,
          extracted_text_nonce: extracted.initializationVector,
          extracted_text_auth_tag: extracted.authenticationTag,
          pii_summary: JSON.stringify(piiSummary(findings)),
          analysis_result: JSON.stringify(storageMetadata(result)) as unknown as JsonValue,
          failure_code: null,
          updated_at: completedAt,
        })
        .where("id", "=", input.analysisId)
        .where("owner_id", "=", input.ownerId)
        .where("owner_epoch", "=", input.ownerEpoch)
        .where("status", "=", "processing")
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1) {
        throw new Error("OWNER_EPOCH_STALE");
      }
      return true;
    });
    if (!stored) {
      throw new Error("RESUME_ANALYSIS_EXPIRED");
    }
    return result;
  } catch (error) {
    const failureCode = error instanceof ResumeInputError ? error.code : "RESUME_ANALYSIS_FAILED";
    await withOwnerTaskLease(input.db, input.lease, async (transaction) => {
      await transaction
        .updateTable("profile.resume_analyses")
        .set({
          status:
            error instanceof ResumeInputError && error.code === "RESUME_SCANNED_OR_EMPTY"
              ? "needs_input"
              : "failed",
          raw_ciphertext: null,
          raw_nonce: null,
          raw_auth_tag: null,
          extracted_text_ciphertext: null,
          extracted_text_nonce: null,
          extracted_text_auth_tag: null,
          analysis_result: null,
          original_filename: null,
          failure_code: failureCode,
          purged_at: now,
          updated_at: now,
        })
        .where("id", "=", input.analysisId)
        .where("owner_id", "=", input.ownerId)
        .where("owner_epoch", "=", input.ownerEpoch)
        .where("status", "=", "processing")
        .execute();
    });
    throw error;
  }
}

export async function purgeExpiredResumeContent(input: {
  db: Kysely<Database>;
  now?: Date;
  ownerId?: string;
}): Promise<number> {
  const now = input.now ?? new Date();
  let query = input.db
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
      purged_at: now,
      updated_at: now,
    })
    .where("purged_at", "is", null)
    .where("purge_after", "<=", now);
  if (input.ownerId) query = query.where("owner_id", "=", input.ownerId);
  const result = await query.executeTakeFirst();
  return Number(result.numUpdatedRows);
}
