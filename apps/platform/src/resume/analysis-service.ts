import { createHash } from "node:crypto";
import type { ProfileFact, ResumeDocumentInput, ResumeEvidenceType } from "@aijob/contracts";
import type { Database, JsonValue, ResumeAnalysisStorageMetadata } from "@aijob/database";
import type { Kysely } from "kysely";
import type { OwnerTaskLease } from "../workers/owner-task-lease.js";
import { withOwnerTaskLease } from "../workers/owner-task-lease.js";
import { decryptResumePayload, encryptResumePayload } from "./crypto.js";
import {
  parseResumeBuffer,
  parseResumeText,
  type ResumeParserSandboxOptions,
} from "./parse.js";
import {
  type PersonalInformationFinding,
  ResumeInputError,
  redactPersonalInformation,
} from "./security.js";

interface CandidateEvidence {
  id: string;
  sourceBlockId: string;
  section: string;
  evidenceType: ResumeEvidenceType;
  statement: string;
  skills: string[];
  outcomes: string[];
  confirmed: false;
}

// Bump this storage version whenever candidate paragraph selection or ordering changes.
// The temporary encrypted text can only be hydrated by the parser version that produced it.
const RESUME_ANALYSIS_STORAGE_VERSION = "resume-analysis-storage-v2" as const;
const LEGACY_RESUME_ANALYSIS_STORAGE_VERSION = "resume-analysis-storage-v1" as const;

export interface ResumeAnalysisResult {
  version: "resume-analysis-v2";
  redactedText: string;
  document: ResumeDocumentInput;
  candidateFacts: Array<ProfileFact & { confirmed: false }>;
  candidateEvidence: CandidateEvidence[];
}

export interface LegacyResumeAnalysisResult {
  version: "resume-analysis-v1";
  redactedText: string;
  candidateFacts: Array<ProfileFact & { confirmed: false }>;
  candidateEvidence: Array<{
    id: string;
    section: string;
    originalText: string;
    claim: string;
    skills: string[];
    outcomes: string[];
    confirmed: false;
  }>;
}

export type HydratedResumeAnalysisResult = ResumeAnalysisResult | LegacyResumeAnalysisResult;

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
  const graduationMatch = text.match(
    /(?:毕业(?:时间|年份)?|应届)[^\d]{0,12}(20\d{2})|(20\d{2})[^\r\n。；;]{0,12}(?:毕业|应届)/,
  );
  const graduationYear = graduationMatch?.[1] ?? graduationMatch?.[2];
  if (graduationYear) {
    facts.push({
      key: "graduation_year",
      value: Number(graduationYear),
      confirmed: false,
    });
  }

  if (/(?:在校生|在读学生|本科在读|硕士在读|博士在读|学历在读)/.test(text)) {
    facts.push({ key: "current_student", value: true, confirmed: false });
  }

  const educationLevels = ["大专", "本科", "硕士", "博士"].filter((level) => text.includes(level));
  const highestEducation = educationLevels.at(-1);
  if (highestEducation) {
    facts.push({ key: "education_level", value: highestEducation, confirmed: false });
  }

  const majorCandidates = new Set<string>();
  const prefixedMajorMatch = text.match(
    /(?:^|[\s，,。；;])(?:专业|主修)\s*[：:]?\s*([^\r\n。；;]{2,60})/,
  );
  if (prefixedMajorMatch?.[1]) {
    const majorText = prefixedMajorMatch[1].replace(
      /\s+(?:(?:大专|本科|硕士|博士)(?:学历)?|20\d{2}\s*年|预计|应届|在校|在读).*$/,
      "",
    );
    for (const value of majorText.split(/[、,，/]/)) {
      const candidate = value.trim();
      if (candidate.length >= 2 && candidate.length <= 30) majorCandidates.add(candidate);
    }
  }
  for (const match of text.matchAll(
    /([\u3400-\u9fffA-Za-z][\u3400-\u9fffA-Za-z0-9&+·（）()/-]{1,29})\s*专业/g,
  )) {
    if (match[1]) majorCandidates.add(match[1]);
  }
  const majors = [...majorCandidates].slice(0, 20);
  if (majors.length > 0) facts.push({ key: "majors", value: majors, confirmed: false });

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

function splitAtomicStatements(text: string): string[] {
  const sentences = text
    .split(/(?<=[。；;！？!?])|\r?\n+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const atoms: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= 400) {
      atoms.push(sentence);
      continue;
    }
    const pieces = sentence
      .split(/(?<=[，,])/)
      .map((value) => value.trim())
      .filter(Boolean);
    let buffer = "";
    for (const piece of pieces) {
      if (buffer && buffer.length + piece.length > 400) {
        atoms.push(buffer);
        buffer = piece;
      } else {
        buffer += piece;
      }
    }
    if (buffer) atoms.push(buffer);
  }
  return atoms.flatMap((atom) => {
    if (atom.length <= 500) return [atom];
    const chunks: string[] = [];
    for (let offset = 0; offset < atom.length; offset += 500) {
      chunks.push(atom.slice(offset, offset + 500));
    }
    return chunks;
  });
}

function candidateDocument(text: string, analysisId: string): ResumeDocumentInput {
  const sectionRows: Array<{ title: string; blocks: string[] }> = [];
  let current = { title: "简历内容", blocks: [] as string[] };
  const flush = () => {
    if (current.blocks.length > 0) sectionRows.push(current);
  };
  for (const rawLine of text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)) {
    const section = evidenceSection(rawLine, current.title);
    if (section !== current.title) {
      flush();
      current = { title: section, blocks: [] };
      continue;
    }
    current.blocks.push(...splitAtomicStatements(rawLine));
  }
  flush();
  if (sectionRows.length === 0) {
    sectionRows.push({ title: "简历内容", blocks: splitAtomicStatements(text) });
  }
  let globalBlockOrdinal = 0;
  return {
    schemaVersion: "resume-document-v1",
    sections: sectionRows.map((section, sectionOrdinal) => ({
      id: uuidV5(analysisId, `document-section:${sectionOrdinal}:${section.title}`),
      ordinal: sectionOrdinal,
      title: section.title,
      blocks: section.blocks.map((block, blockOrdinal) => {
        const blockId = uuidV5(analysisId, `document-block-v1:${globalBlockOrdinal}`);
        globalBlockOrdinal += 1;
        return {
          id: blockId,
          ordinal: blockOrdinal,
          text: block.slice(0, 10_000),
        };
      }),
    })),
  };
}

export function evidenceType(section: string, text: string): ResumeEvidenceType {
  const source = `${section} ${text}`;
  if (/(?:教育|学历|学校|专业)/.test(source)) return "education";
  if (/(?:实习|工作)/.test(source)) return "internship";
  if (/(?:项目|作品)/.test(source)) return "project";
  if (/(?:校园|学生会|社团)/.test(source)) return "campus";
  if (/(?:竞赛|比赛|获奖)/.test(source)) return "competition";
  if (/(?:志愿|公益)/.test(source)) return "volunteer";
  if (/(?:证书|资格)/.test(source)) return "certificate";
  if (/(?:技能|工具)/.test(source)) return "skill";
  return "other";
}

export function deriveResumeEvidenceContent(
  section: string,
  text: string,
): {
  evidenceType: ResumeEvidenceType;
  statement: string;
  skills: string[];
  outcomes: string[];
} {
  const skills = SKILL_TERMS.filter((term) =>
    text.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
  );
  const outcomes =
    text.match(/[^。；;\n]*(?:\d+(?:\.\d+)?%|\d+\s*(?:人|次|个|万|千|元))[^。；;\n]*/g) ?? [];
  return {
    evidenceType: evidenceType(section, text),
    statement: text.slice(0, 2_000),
    skills: [...skills],
    outcomes: outcomes
      .map((outcome) => outcome.trim())
      .filter(Boolean)
      .slice(0, 20),
  };
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

function candidateEvidence(document: ResumeDocumentInput, analysisId: string): CandidateEvidence[] {
  const evidence: CandidateEvidence[] = [];
  for (const section of document.sections) {
    for (const block of section.blocks) {
      const paragraph = block.text;
      if (paragraph.length < 8) continue;
      const derived = deriveResumeEvidenceContent(section.title, paragraph);
      evidence.push({
        id: uuidV5(analysisId, `candidate-evidence-v2:${evidence.length}`),
        sourceBlockId: block.id,
        section: section.title,
        ...derived,
        confirmed: false,
      });
    }
  }
  return evidence.slice(0, 100);
}

function legacyCandidateEvidence(
  text: string,
  analysisId: string,
): LegacyResumeAnalysisResult["candidateEvidence"] {
  const evidence: LegacyResumeAnalysisResult["candidateEvidence"] = [];
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
  const document = candidateDocument(redactedText, analysisId);
  return {
    findings,
    result: {
      version: "resume-analysis-v2",
      redactedText,
      document,
      candidateFacts: candidateFacts(redactedText),
      candidateEvidence: candidateEvidence(document, analysisId),
    },
  };
}

function parseStorageMetadata(value: JsonValue | string): ResumeAnalysisStorageMetadata {
  const parsed = typeof value === "string" ? (JSON.parse(value) as JsonValue) : value;
  if (
    !parsed ||
    Array.isArray(parsed) ||
    typeof parsed !== "object" ||
    (parsed.version !== RESUME_ANALYSIS_STORAGE_VERSION &&
      parsed.version !== LEGACY_RESUME_ANALYSIS_STORAGE_VERSION) ||
    typeof parsed.candidateEvidenceCount !== "number" ||
    !Number.isInteger(parsed.candidateEvidenceCount) ||
    parsed.candidateEvidenceCount < 0 ||
    parsed.candidateEvidenceCount > 100 ||
    (parsed.version === RESUME_ANALYSIS_STORAGE_VERSION &&
      (typeof parsed.documentBlockCount !== "number" ||
        !Number.isInteger(parsed.documentBlockCount) ||
        parsed.documentBlockCount < 1 ||
        parsed.documentBlockCount > 50_000))
  ) {
    throw new Error("RESUME_ANALYSIS_STORAGE_INVALID");
  }
  return {
    version: parsed.version,
    candidateEvidenceCount: parsed.candidateEvidenceCount,
    ...(typeof parsed.documentBlockCount === "number"
      ? { documentBlockCount: parsed.documentBlockCount }
      : {}),
  };
}

function storageMetadata(result: ResumeAnalysisResult): ResumeAnalysisStorageMetadata {
  return {
    version: RESUME_ANALYSIS_STORAGE_VERSION,
    candidateEvidenceCount: result.candidateEvidence.length,
    documentBlockCount: result.document.sections.reduce(
      (total, section) => total + section.blocks.length,
      0,
    ),
  };
}

export function rebuildResumeAnalysisResult(input: {
  analysisId: string;
  extractedText: string;
  storageMetadata: JsonValue | string;
}): HydratedResumeAnalysisResult {
  const metadata = parseStorageMetadata(input.storageMetadata);
  if (metadata.version === LEGACY_RESUME_ANALYSIS_STORAGE_VERSION) {
    const { redactedText } = redactPersonalInformation(input.extractedText);
    const candidateEvidence = legacyCandidateEvidence(redactedText, input.analysisId);
    if (candidateEvidence.length !== metadata.candidateEvidenceCount) {
      throw new Error("RESUME_ANALYSIS_PARSER_VERSION_MISMATCH");
    }
    return {
      version: "resume-analysis-v1",
      redactedText,
      candidateFacts: candidateFacts(redactedText),
      candidateEvidence,
    };
  }
  const { result } = buildAnalysisResult(input.extractedText, input.analysisId);
  const blockCount = result.document.sections.reduce(
    (total, section) => total + section.blocks.length,
    0,
  );
  if (
    result.candidateEvidence.length !== metadata.candidateEvidenceCount ||
    blockCount !== metadata.documentBlockCount
  ) {
    throw new Error("RESUME_ANALYSIS_PARSER_VERSION_MISMATCH");
  }
  return result;
}

export function resumeAnalysisCandidateIds(input: {
  analysisId: string;
  storageMetadata: JsonValue | string;
}): ReadonlySet<string> {
  const metadata = parseStorageMetadata(input.storageMetadata);
  if (metadata.version !== RESUME_ANALYSIS_STORAGE_VERSION) return new Set();
  return new Set(
    Array.from({ length: metadata.candidateEvidenceCount }, (_item, ordinal) =>
      uuidV5(input.analysisId, `candidate-evidence-v2:${ordinal}`),
    ),
  );
}

export function resumeAnalysisDocumentBlockIds(input: {
  analysisId: string;
  storageMetadata: JsonValue | string;
}): ReadonlySet<string> {
  const metadata = parseStorageMetadata(input.storageMetadata);
  if (
    metadata.version !== RESUME_ANALYSIS_STORAGE_VERSION ||
    metadata.documentBlockCount === undefined
  ) {
    return new Set();
  }
  return new Set(
    Array.from({ length: metadata.documentBlockCount }, (_item, ordinal) =>
      uuidV5(input.analysisId, `document-block-v1:${ordinal}`),
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
  signal?: AbortSignal;
  parserSandbox?: ResumeParserSandboxOptions;
}): Promise<HydratedResumeAnalysisResult> {
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
            ...(input.signal === undefined ? {} : { signal: input.signal }),
            ...(input.parserSandbox === undefined ? {} : { sandbox: input.parserSandbox }),
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
