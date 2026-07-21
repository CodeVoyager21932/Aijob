import { randomUUID } from "node:crypto";
import type {
  CreateJobInsightRunRequest,
  JobInsightPersonalStatus,
  JobInsightRequirement,
  JobInsightResult,
  JobInsightRun,
  JobInsightScope,
  JobRequirement,
  RequirementKind,
  ResumeEvidence,
} from "@aijob/contracts";
import {
  fieldValueSchema,
  JobFamilySchema,
  JobInsightResultSchema,
  JobInsightRunSchema,
  JobInsightScopeSchema,
  JobRequirementSchema,
  ResumeEvidenceSchema,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Insertable, type Kysely, type Selectable, sql } from "kysely";
import { z } from "zod";
import type { OwnerContext } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { inferCapabilities, isSpecificToolTerm } from "../matching/capabilities.js";

export const JOB_INSIGHT_ALGORITHM_VERSION = "job-market-insight-v1" as const;

const MIN_JOBS = 20;
const MIN_COMPANIES = 5;
const MIN_REQUIREMENT_COVERAGE = 0.7;
const MIN_ITEM_JOBS = 3;
const MIN_ITEM_COMPANIES = 2;

export interface InsightJobRecord {
  jobId: string;
  jobVersionId: string;
  requirementSetId: string | null;
  sourceId: string;
  companyId: string;
  companyName: string;
  companyScaleBand: "small" | "medium" | "large" | "unknown";
  title: string;
  jobFamily: string;
  locations: string[];
  lastVerifiedAt: string;
  requirements: JobRequirement[];
}

interface RequirementAtom {
  key: string;
  label: string;
  kind: RequirementKind;
  matchMode: "capability" | "term" | "profile_fact";
  matchValue: string;
}

interface Aggregate {
  atom: RequirementAtom;
  jobIds: Set<string>;
  companyIds: Set<string>;
  necessityJobs: Record<"required" | "preferred" | "optional" | "unknown", Set<string>>;
  examples: Array<{
    jobId: string;
    jobTitle: string;
    companyName: string;
    sourceText: string;
  }>;
}

interface EvidenceText {
  id: string;
  sourceBlockId: string | null;
  text: string;
  capabilityKeys: Set<string>;
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return [...value].map(String).sort().join("|");
  return String(value ?? "");
}

function expectedValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return value === null || value === undefined || value === "" ? [] : [String(value)];
}

function structuredLabel(requirement: JobRequirement): string | null {
  const values = expectedValues(requirement.expectedValue);
  if (values.length === 0 || requirement.operator === "unknown") return null;
  if (requirement.kind === "student_status") return "在校 / 在读";
  if (requirement.kind === "weekly_attendance") return `每周至少 ${values[0]} 天`;
  if (requirement.kind === "duration") return `至少实习 ${values[0]} 个月`;
  if (requirement.kind === "graduation_year") return `${values.join("、")} 届`;
  if (
    requirement.kind === "education" &&
    values.includes("本科") &&
    values.includes("硕士") &&
    values.includes("博士")
  ) {
    return "本科及以上学历";
  }
  if (requirement.kind === "arrival_date") return `最晚 ${values[0]} 到岗`;
  if (requirement.kind === "education") return `${values.join("、")}学历`;
  if (requirement.kind === "major") return `${values.join("、")}相关专业`;
  if (requirement.kind === "language") return values.join("、");
  return null;
}

function requirementAtoms(requirement: JobRequirement): RequirementAtom[] {
  if (["city", "other"].includes(requirement.kind)) return [];

  if (requirement.kind !== "skill" && requirement.kind !== "experience") {
    const label = structuredLabel(requirement);
    if (!label) return [];
    const value = stableValue(requirement.expectedValue);
    return [
      {
        key: `${requirement.kind}:${normalized(value)}`,
        label,
        kind: requirement.kind,
        matchMode: "profile_fact",
        matchValue: value,
      },
    ];
  }

  const terms = expectedValues(requirement.expectedValue);
  const specificTools = terms.filter(isSpecificToolTerm);
  const capabilities = inferCapabilities(requirement.sourceText);
  const atoms: RequirementAtom[] = specificTools.map((term) => ({
    key: `tool:${normalized(term)}`,
    label: term,
    kind: requirement.kind,
    matchMode: "term" as const,
    matchValue: term,
  }));
  for (const capability of capabilities) {
    if (atoms.some((atom) => atom.key === `capability:${capability.key}`)) continue;
    atoms.push({
      key: `capability:${capability.key}`,
      label: capability.label,
      kind: requirement.kind,
      matchMode: "capability",
      matchValue: capability.key,
    });
  }
  if (atoms.length === 0) {
    for (const term of terms) {
      atoms.push({
        key: `term:${normalized(term)}`,
        label: term,
        kind: requirement.kind,
        matchMode: "term",
        matchValue: term,
      });
    }
  }
  return atoms;
}

function evidenceTexts(evidence: ResumeEvidence[] | null): EvidenceText[] | null {
  if (!evidence) return null;
  return evidence.map((item) => {
    const text = [item.statement, ...item.skills, ...item.outcomes].join(" ");
    return {
      id: item.id,
      sourceBlockId: item.sourceBlockId,
      text,
      capabilityKeys: new Set(inferCapabilities(text).map(({ key }) => key)),
    };
  });
}

function containsTerm(text: string, term: string): boolean {
  const haystack = normalized(text);
  const needle = normalized(term);
  if (!/[a-z0-9+#]/i.test(needle)) return haystack.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_])${escaped}($|[^a-z0-9_])`, "i").test(haystack);
}

function personalComparison(
  atom: RequirementAtom,
  evidence: EvidenceText[] | null,
): {
  status: JobInsightPersonalStatus | null;
  evidenceIds: string[];
  sourceBlockIds: string[];
} {
  if (!evidence) return { status: null, evidenceIds: [], sourceBlockIds: [] };
  if (atom.matchMode === "profile_fact") {
    return { status: "needs_confirmation", evidenceIds: [], sourceBlockIds: [] };
  }
  const matched = evidence.filter((item) =>
    atom.matchMode === "capability"
      ? item.capabilityKeys.has(atom.matchValue)
      : containsTerm(item.text, atom.matchValue),
  );
  return {
    status: matched.length > 0 ? "confirmed_evidence" : "not_in_resume",
    evidenceIds: matched.map(({ id }) => id),
    sourceBlockIds: matched.flatMap(({ sourceBlockId }) => (sourceBlockId ? [sourceBlockId] : [])),
  };
}

function toInsightRequirement(
  aggregate: Aggregate,
  evidence: EvidenceText[] | null,
): JobInsightRequirement {
  const comparison = personalComparison(aggregate.atom, evidence);
  const necessityCounts = {
    required: aggregate.necessityJobs.required.size,
    preferred: aggregate.necessityJobs.preferred.size,
    optional: aggregate.necessityJobs.optional.size,
    unknown: aggregate.necessityJobs.unknown.size,
  };
  const primaryNecessity = (
    Object.entries(necessityCounts) as Array<[keyof typeof necessityCounts, number]>
  ).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
  return {
    key: aggregate.atom.key,
    label: aggregate.atom.label,
    kind: aggregate.atom.kind,
    primaryNecessity: primaryNecessity ?? "unknown",
    jobCount: aggregate.jobIds.size,
    companyCount: aggregate.companyIds.size,
    necessityCounts,
    examples: aggregate.examples.slice(0, 3),
    personalStatus: comparison.status,
    evidenceIds: comparison.evidenceIds,
    sourceBlockIds: comparison.sourceBlockIds,
  };
}

function rankedItems(
  aggregates: Iterable<Aggregate>,
  evidence: EvidenceText[] | null,
): JobInsightRequirement[] {
  return [...aggregates]
    .filter(
      (aggregate) =>
        aggregate.jobIds.size >= MIN_ITEM_JOBS && aggregate.companyIds.size >= MIN_ITEM_COMPANIES,
    )
    .sort(
      (left, right) =>
        right.companyIds.size - left.companyIds.size ||
        right.jobIds.size - left.jobIds.size ||
        left.atom.key.localeCompare(right.atom.key),
    )
    .slice(0, 12)
    .map((aggregate) => toInsightRequirement(aggregate, evidence));
}

export function buildJobInsightResult(
  records: InsightJobRecord[],
  resumeEvidence: ResumeEvidence[] | null,
): JobInsightResult {
  const companies = new Set(records.map(({ companyId }) => companyId));
  const companiesWithKnownScale = new Set(
    records
      .filter(({ companyScaleBand }) => companyScaleBand !== "unknown")
      .map(({ companyId }) => companyId),
  );
  const structuredRequirementJobCount = records.filter(
    ({ requirements }) => requirements.length > 0,
  ).length;
  const requirementCoverage =
    records.length > 0 ? structuredRequirementJobCount / records.length : 0;
  const insufficiencyReasons: JobInsightResult["insufficiencyReasons"] = [];
  if (records.length < MIN_JOBS) insufficiencyReasons.push("too_few_jobs");
  if (companies.size < MIN_COMPANIES) insufficiencyReasons.push("too_few_companies");
  if (requirementCoverage < MIN_REQUIREMENT_COVERAGE) {
    insufficiencyReasons.push("low_requirement_coverage");
  }

  const groups = {
    hard: new Map<string, Aggregate>(),
    capability: new Map<string, Aggregate>(),
    preferred: new Map<string, Aggregate>(),
  };
  for (const record of records) {
    for (const requirement of record.requirements) {
      if (requirement.necessity === "unknown") continue;
      const section =
        requirement.necessity === "preferred" || requirement.necessity === "optional"
          ? "preferred"
          : requirement.kind === "skill" || requirement.kind === "experience"
            ? "capability"
            : "hard";
      for (const atom of requirementAtoms(requirement)) {
        const aggregateKey = `${section}:${atom.key}`;
        let aggregate = groups[section].get(aggregateKey);
        if (!aggregate) {
          aggregate = {
            atom,
            jobIds: new Set(),
            companyIds: new Set(),
            necessityJobs: {
              required: new Set(),
              preferred: new Set(),
              optional: new Set(),
              unknown: new Set(),
            },
            examples: [],
          };
          groups[section].set(aggregateKey, aggregate);
        }
        aggregate.jobIds.add(record.jobId);
        aggregate.companyIds.add(record.companyId);
        aggregate.necessityJobs[requirement.necessity].add(record.jobId);
        if (
          aggregate.examples.length < 3 &&
          !aggregate.examples.some(({ companyName }) => companyName === record.companyName)
        ) {
          aggregate.examples.push({
            jobId: record.jobId,
            jobTitle: record.title,
            companyName: record.companyName,
            sourceText: requirement.sourceText,
          });
        }
      }
    }
  }

  const dataSufficient = insufficiencyReasons.length === 0;
  const evidence = evidenceTexts(resumeEvidence);
  const verifiedTimes = records
    .map(({ lastVerifiedAt }) => new Date(lastVerifiedAt))
    .filter((date) => !Number.isNaN(date.valueOf()))
    .sort((left, right) => right.valueOf() - left.valueOf());
  return JobInsightResultSchema.parse({
    algorithmVersion: JOB_INSIGHT_ALGORITHM_VERSION,
    dataSufficient,
    insufficiencyReasons,
    sample: {
      jobCount: records.length,
      companyCount: companies.size,
      knownScaleCompanyCount: companiesWithKnownScale.size,
      structuredRequirementJobCount,
      requirementCoverage,
      lastVerifiedAt: verifiedTimes[0]?.toISOString() ?? null,
    },
    commonHardRequirements: dataSufficient ? rankedItems(groups.hard.values(), evidence) : [],
    frequentCapabilities: dataSufficient ? rankedItems(groups.capability.values(), evidence) : [],
    preferredRequirements: dataSufficient ? rankedItems(groups.preferred.values(), evidence) : [],
  });
}

interface InsightDatabaseRow {
  job_id: string;
  job_version_id: string;
  requirement_set_id: string | null;
  source_id: string;
  organization_id: string;
  company_name: string;
  scale_band: string;
  title: string;
  job_family: JsonValue;
  locations: JsonValue;
  last_verified_at: Date | string;
  requirements: JsonValue | null;
  policy_status: string;
  publication_state: string;
}

async function loadInsightRecords(
  db: Kysely<Database>,
  scope: JobInsightScope,
  enableLocalMvp: boolean,
): Promise<InsightJobRecord[]> {
  const result = await sql<InsightDatabaseRow>`
    SELECT
      job.id AS job_id,
      version.id AS job_version_id,
      requirement_set.id AS requirement_set_id,
      source.id AS source_id,
      organization.id AS organization_id,
      version.company_name,
      organization.scale_band,
      version.title,
      version.job_family,
      COALESCE(projection.locations, version.locations) AS locations,
      record.last_seen_at AS last_verified_at,
      requirement_set.requirements,
      policy.policy_status,
      revision.publication_state
    FROM catalog.published_jobs AS job
    JOIN catalog.published_job_versions AS version
      ON version.id = job.current_version_id
    LEFT JOIN catalog.job_requirement_sets AS requirement_set
      ON requirement_set.id = version.active_requirement_set_id
    LEFT JOIN catalog.job_condition_projections AS projection
      ON projection.published_job_version_id = version.id
      AND projection.requirement_set_id = requirement_set.id
    JOIN ingestion.source_job_revisions AS revision
      ON revision.id = version.source_job_revision_id
    JOIN ingestion.source_job_records AS record
      ON record.id = revision.source_job_record_id
    JOIN source_control.sources AS source
      ON source.id = record.source_id
    JOIN source_control.organizations AS organization
      ON organization.id = source.organization_id
    JOIN source_control.source_policy_versions AS policy
      ON policy.source_id = source.id
      AND policy.version = source.current_policy_version
    WHERE version.activity_state = 'active'
      AND revision.ingestion_state = 'validated'
    ORDER BY version.company_name, version.title, version.id
  `.execute(db);

  return result.rows.flatMap((row) => {
    if (
      enableLocalMvp
        ? !["pending_review", "approved"].includes(row.policy_status) ||
          !["review", "published"].includes(row.publication_state)
        : row.policy_status !== "approved" || row.publication_state !== "published"
    ) {
      return [];
    }
    const family = fieldValueSchema(JobFamilySchema).safeParse(row.job_family);
    const locations = fieldValueSchema(z.array(z.string().trim().min(1)).min(1)).safeParse(
      row.locations,
    );
    if (family.success && family.data.state === "known") {
      if (family.data.value !== scope.jobFamily) return [];
    } else {
      return [];
    }
    const knownLocations =
      locations.success && locations.data.state === "known" ? locations.data.value : [];
    if (
      scope.cities.length > 0 &&
      !knownLocations.some((location) => scope.cities.some((city) => location.includes(city)))
    ) {
      return [];
    }
    if (
      scope.companyScaleBands.length > 0 &&
      !scope.companyScaleBands.includes(row.scale_band as InsightJobRecord["companyScaleBand"])
    ) {
      return [];
    }
    const requirements = z.array(JobRequirementSchema).safeParse(row.requirements);
    return [
      {
        jobId: row.job_id,
        jobVersionId: row.job_version_id,
        requirementSetId: row.requirement_set_id,
        sourceId: row.source_id,
        companyId: row.organization_id,
        companyName: row.company_name,
        companyScaleBand: ["small", "medium", "large"].includes(row.scale_band)
          ? (row.scale_band as "small" | "medium" | "large")
          : "unknown",
        title: row.title,
        jobFamily: family.data.value,
        locations: knownLocations,
        lastVerifiedAt: new Date(row.last_verified_at).toISOString(),
        requirements: requirements.success ? requirements.data : [],
      },
    ];
  });
}

function rowToRun(row: Selectable<Database["matching.job_insight_runs"]>): JobInsightRun {
  return JobInsightRunSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    scope: row.scope,
    evidenceRevisionId: row.evidence_revision_id,
    candidateJobVersionIds: row.candidate_job_version_ids,
    candidateRequirementSetIds: row.candidate_requirement_set_ids,
    candidateSourceVerifications: row.candidate_source_verifications,
    dataVersionHash: row.data_version_hash,
    algorithmVersion: row.algorithm_version,
    result: row.result,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: new Date(row.completed_at).toISOString(),
  });
}

async function loadEvidence(
  db: Kysely<Database>,
  owner: OwnerContext,
  evidenceRevisionId: string | null,
): Promise<ResumeEvidence[] | null> {
  if (!evidenceRevisionId) return null;
  const row = await db
    .selectFrom("profile.resume_evidence_revisions")
    .select(["evidence", "schema_version"])
    .where("id", "=", evidenceRevisionId)
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .executeTakeFirst();
  if (!row) {
    throw new ServiceError(409, "EVIDENCE_REVISION_UNAVAILABLE", "已确认简历证据不存在或已过期。");
  }
  if (row.schema_version !== "resume-evidence-v2") {
    throw new ServiceError(
      409,
      "EVIDENCE_REVISION_REQUIRES_RECONFIRMATION",
      "这份简历证据缺少可追溯的原文区块，请先重新确认简历证据。",
    );
  }
  return z.array(ResumeEvidenceSchema).parse(row.evidence);
}

export async function createJobInsightRun(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  request: CreateJobInsightRunRequest;
  idempotencyKey: string;
  enableLocalMvp: boolean;
  now?: Date;
}): Promise<JobInsightRun> {
  const scope = JobInsightScopeSchema.parse(input.request.scope);
  const evidenceRevisionId = input.request.evidenceRevisionId ?? null;
  const requestHash = hashCanonicalJson({ scope, evidenceRevisionId });
  const existing = await input.db
    .selectFrom("matching.job_insight_runs")
    .selectAll()
    .where("owner_id", "=", input.owner.ownerId)
    .where("idempotency_key", "=", input.idempotencyKey)
    .executeTakeFirst();
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new ServiceError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "同一个请求编号不能用于不同的洞察条件。",
      );
    }
    return rowToRun(existing);
  }

  const [records, resumeEvidence] = await Promise.all([
    loadInsightRecords(input.db, scope, input.enableLocalMvp),
    loadEvidence(input.db, input.owner, evidenceRevisionId),
  ]);
  const result = buildJobInsightResult(records, resumeEvidence);
  const now = input.now ?? new Date();
  const values: Insertable<Database["matching.job_insight_runs"]> = {
    id: randomUUID(),
    owner_id: input.owner.ownerId,
    owner_epoch: input.owner.ownerEpoch,
    scope: JSON.stringify(scope) as unknown as JsonValue,
    evidence_revision_id: evidenceRevisionId,
    candidate_job_version_ids: JSON.stringify(
      records.map(({ jobVersionId }) => jobVersionId),
    ) as unknown as JsonValue,
    candidate_requirement_set_ids: JSON.stringify(
      records.flatMap(({ requirementSetId }) => (requirementSetId ? [requirementSetId] : [])),
    ) as unknown as JsonValue,
    candidate_source_verifications: JSON.stringify(
      records.map(({ jobVersionId, sourceId, lastVerifiedAt }) => ({
        jobVersionId,
        sourceId,
        lastVerifiedAt,
      })),
    ) as unknown as JsonValue,
    data_version_hash: hashCanonicalJson(
      records.map(({ jobVersionId, requirementSetId, lastVerifiedAt }) => ({
        jobVersionId,
        requirementSetId,
        lastVerifiedAt,
      })),
    ),
    request_hash: requestHash,
    idempotency_key: input.idempotencyKey,
    algorithm_version: JOB_INSIGHT_ALGORITHM_VERSION,
    result: JSON.stringify(result) as unknown as JsonValue,
    created_at: now,
    completed_at: now,
  };
  const inserted = await input.db
    .insertInto("matching.job_insight_runs")
    .values(values)
    .returningAll()
    .executeTakeFirstOrThrow();
  return rowToRun(inserted);
}

export async function getJobInsightRun(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  runId: string;
}): Promise<JobInsightRun | null> {
  const row = await input.db
    .selectFrom("matching.job_insight_runs")
    .selectAll()
    .where("id", "=", input.runId)
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .executeTakeFirst();
  return row ? rowToRun(row) : null;
}
