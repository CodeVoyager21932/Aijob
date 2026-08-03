import { type JobFamily, JobFamilySchema } from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { shanghaiDateKey } from "../catalog/effective-activity.js";
import {
  type CandidateActivityState,
  type CandidateApplicationSignal,
  hasOfficialApplicationSignal,
  loadSourceCandidateLedgerRows,
  type MergedSourceCandidateEvidence,
  mergeSourceCandidateEvidence,
  normalizeCandidateCompanyName,
  type SourceCandidateLedgerRow,
} from "./source-candidate-ledger.js";
import {
  type AlphaTargetCity,
  loadSourceCandidateRegistry,
  type SourceCandidateOverride,
  type SourceCandidateRegistry,
  sourceCandidateOverrides,
  TARGET_ALPHA_CITIES,
} from "./source-candidates.js";
import { listSourceKeys } from "./source-config.js";
import { isOfficialSourceAdapterKey } from "./official-source-adapters.js";

export type SourceScaleMilestone = 40 | 70 | 100;

export interface CatalogSupplyMetrics {
  totalSupply: number;
  visibleJobs: number;
  companies: number;
  smeVisibleJobs: number;
  smeCompanies: number;
  manualVisibleJobs: number;
  manualCompanies: number;
  publicJobs: number;
  jobFamilies: Record<JobFamily, number>;
  cities: Record<AlphaTargetCity, number>;
  companyNames: string[];
  registeredOrganizationNames: string[];
}

interface CatalogMetricRow {
  company_name: string;
  scale_band: string;
  job_family: JsonValue;
  locations: JsonValue;
  acquisition_mode: string;
}

export interface PlannerCandidate {
  candidateId: string;
  companyName: string;
  activityState: CandidateActivityState;
  applicationSignal: CandidateApplicationSignal;
  evidenceUrl: string;
  closeDate: string;
  adapterFamily: string;
  scaleBand: SourceCandidateOverride["scaleBand"];
  alphaDisplayStatus: SourceCandidateOverride["alphaDisplayStatus"];
  assessmentStatus: SourceCandidateOverride["assessmentStatus"] | "unregistered";
  jobFamilyHints: JobFamily[];
  cityHints: AlphaTargetCity[];
  pauseReasons: string[];
  assessmentEvidenceRefs: string[];
  sourceLedgers: string[];
  lane: SourceCandidateOverride["lane"];
  automationMode: SourceCandidateOverride["automationMode"];
  capacity: SourceCandidateOverride["capacity"];
  quota: 10 | 30;
  projectedVisibleJobs: number;
  capacityFresh: boolean;
  readinessBlockers: string[];
  selectionReasons: string[];
}

const CAPACITY_EVIDENCE_MAX_AGE_DAYS = 7;
const CAPACITY_MINIMUM_COMPLETE_JOBS = 10;
const MAX_COVERAGE_COMPANIES_PER_BATCH = 2;
const NON_SME_COMPANY_QUOTA = 10;
const SME_COMPANY_QUOTA = 30;

function isSmeScaleBand(value: SourceCandidateOverride["scaleBand"]): boolean {
  return value === "small" || value === "medium";
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function dateAgeDays(currentShanghaiDate: string, verifiedAt: string): number {
  const current = Date.parse(`${currentShanghaiDate}T00:00:00+08:00`);
  const verified = Date.parse(`${verifiedAt}T00:00:00+08:00`);
  return Math.floor((current - verified) / 86_400_000);
}

const CITY_ALIASES: Readonly<Record<string, AlphaTargetCity>> = {
  北京: "北京",
  北京市: "北京",
  上海: "上海",
  上海市: "上海",
  深圳: "深圳",
  深圳市: "深圳",
  广州: "广州",
  广州市: "广州",
  杭州: "杭州",
  杭州市: "杭州",
  成都: "成都",
  成都市: "成都",
  武汉: "武汉",
  武汉市: "武汉",
  南京: "南京",
  南京市: "南京",
};

function emptyJobFamilyCounts(): Record<JobFamily, number> {
  return Object.fromEntries(JobFamilySchema.options.map((family) => [family, 0])) as Record<
    JobFamily,
    number
  >;
}

function emptyCityCounts(): Record<AlphaTargetCity, number> {
  return Object.fromEntries(TARGET_ALPHA_CITIES.map((city) => [city, 0])) as Record<
    AlphaTargetCity,
    number
  >;
}

function knownValue(value: JsonValue): JsonValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, JsonValue>;
  return record.state === "known" ? record.value : undefined;
}

function primaryTargetCity(value: JsonValue): AlphaTargetCity | undefined {
  const locations = knownValue(value);
  if (!Array.isArray(locations)) return undefined;
  for (const location of locations) {
    if (typeof location !== "string") continue;
    const city = CITY_ALIASES[location.normalize("NFKC").trim()];
    if (city) return city;
  }
  return undefined;
}

export async function loadLocalCatalogSupplyMetrics(
  db: Kysely<Database>,
): Promise<CatalogSupplyMetrics> {
  const configuredSourceKeys = await listSourceKeys();
  if (configuredSourceKeys.length === 0) {
    throw new Error("SOURCE_CONFIG_REGISTRY_EMPTY");
  }

  const [catalogRows, totalSupplyRow, publicJobsRow, registeredOrganizations] = await Promise.all([
    sql<CatalogMetricRow>`
      SELECT
        quota.company_name,
        quota.scale_band,
        version.job_family,
        projection.locations,
        policy.acquisition_mode
      FROM catalog.company_quota_selections AS quota
      JOIN catalog.published_jobs AS job
        ON job.id = quota.published_job_id
      JOIN catalog.published_job_versions AS version
        ON version.id = job.current_version_id
      JOIN catalog.current_job_effective_activity AS activity
        ON activity.published_job_version_id = version.id
      JOIN catalog.job_condition_projections AS projection
        ON projection.published_job_version_id = version.id
        AND projection.requirement_set_id = version.active_requirement_set_id
      JOIN ingestion.source_job_revisions AS revision
        ON revision.id = version.source_job_revision_id
      JOIN ingestion.source_job_records AS record
        ON record.id = revision.source_job_record_id
      JOIN source_control.sources AS source
        ON source.id = record.source_id
      JOIN source_control.source_policy_versions AS policy
        ON policy.source_id = source.id
        AND policy.version = source.current_policy_version
      WHERE quota.selected = TRUE
        AND activity.effective_activity_state <> 'closed'
        AND source.source_key IN (${sql.join(
          configuredSourceKeys.map((sourceKey) => sql`${sourceKey}`),
          sql`, `,
        )})
    `.execute(db),
    db
      .selectFrom("catalog.internal_job_previews as preview")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("preview.ingestion_state", "=", "validated")
      .where("preview.publication_state", "in", ["review", "published"])
      .where("preview.policy_status", "in", ["pending_review", "approved"])
      .where("preview.source_key", "in", configuredSourceKeys)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("catalog.published_jobs as job")
      .innerJoin("catalog.published_job_versions as version", "version.id", "job.public_version_id")
      .innerJoin(
        "ingestion.source_job_revisions as revision",
        "revision.id",
        "version.source_job_revision_id",
      )
      .innerJoin(
        "ingestion.source_job_records as record",
        "record.id",
        "revision.source_job_record_id",
      )
      .innerJoin("source_control.sources as source", "source.id", "record.source_id")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("job.public_version_id", "is not", null)
      .where("source.source_key", "in", configuredSourceKeys)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("source_control.sources as source")
      .innerJoin(
        "source_control.organizations as organization",
        "organization.id",
        "source.organization_id",
      )
      .select("organization.name")
      .distinct()
      .where("source.source_key", "in", configuredSourceKeys)
      .execute(),
  ]);

  const jobFamilies = emptyJobFamilyCounts();
  const cities = emptyCityCounts();
  const companyNames = new Set<string>();
  const smeCompanyNames = new Set<string>();
  const manualCompanyNames = new Set<string>();
  let smeVisibleJobs = 0;
  let manualVisibleJobs = 0;

  for (const row of catalogRows.rows) {
    companyNames.add(row.company_name);
    if (row.scale_band === "small" || row.scale_band === "medium") {
      smeVisibleJobs += 1;
      smeCompanyNames.add(row.company_name);
    }
    if (row.acquisition_mode === "browser_required") {
      manualVisibleJobs += 1;
      manualCompanyNames.add(row.company_name);
    }

    const family = JobFamilySchema.safeParse(knownValue(row.job_family));
    if (family.success) jobFamilies[family.data] += 1;
    const city = primaryTargetCity(row.locations);
    if (city) cities[city] += 1;
  }

  return {
    totalSupply: Number(totalSupplyRow.count),
    visibleJobs: catalogRows.rows.length,
    companies: companyNames.size,
    smeVisibleJobs,
    smeCompanies: smeCompanyNames.size,
    manualVisibleJobs,
    manualCompanies: manualCompanyNames.size,
    publicJobs: Number(publicJobsRow.count),
    jobFamilies,
    cities,
    companyNames: [...companyNames].sort((left, right) => left.localeCompare(right, "zh-CN")),
    registeredOrganizationNames: registeredOrganizations
      .map((organization) => organization.name)
      .sort((left, right) => left.localeCompare(right, "zh-CN")),
  };
}

function milestoneTargets(registry: SourceCandidateRegistry, milestone: SourceScaleMilestone) {
  const visibleJobs = milestone * 10;
  const scale = Math.min(1, visibleJobs / registry.targets.hardGate.visibleJobs);
  return {
    companies: milestone,
    visibleJobs,
    smeCompanies: Math.ceil(milestone * registry.targets.minimumSmeCompanyRatio),
    smeVisibleJobs: Math.ceil(visibleJobs * registry.targets.minimumSmeVisibleJobRatio),
    maximumManualCompanies: Math.floor(
      milestone * registry.targets.manualSourceMaximumCompanyRatio,
    ),
    maximumManualVisibleJobs: Math.floor(
      visibleJobs * registry.targets.manualSourceMaximumVisibleJobRatio,
    ),
    jobFamilies: Object.fromEntries(
      JobFamilySchema.options.map((family) => [
        family,
        Math.ceil(registry.targets.jobFamilyMinimums[family] * scale),
      ]),
    ) as Record<JobFamily, number>,
    cities: Object.fromEntries(
      TARGET_ALPHA_CITIES.map((city) => [
        city,
        Math.ceil(registry.targets.cityMinimums[city] * scale),
      ]),
    ) as Record<AlphaTargetCity, number>,
  };
}

function firstFeasibleSmeCompanyTarget(input: {
  baseline: CatalogSupplyMetrics;
  milestoneCompanies: number;
  minimumRatio: number;
}) {
  let additionalSmeCompanies = Math.max(
    0,
    input.milestoneCompanies - input.baseline.companies,
  );
  while (
    ratio(
      input.baseline.smeCompanies + additionalSmeCompanies,
      input.baseline.companies + additionalSmeCompanies,
    ) < input.minimumRatio
  ) {
    additionalSmeCompanies += 1;
  }
  const firstFeasibleCompanyCount = input.baseline.companies + additionalSmeCompanies;
  return {
    minimumAdditionalSmeCompaniesIfAllNewSme: additionalSmeCompanies,
    firstFeasibleCompanyCount,
    minimumSmeCompaniesAtFirstFeasibleCount: Math.ceil(
      firstFeasibleCompanyCount * input.minimumRatio,
    ),
  };
}

function dynamicRequirements(input: {
  baseline: CatalogSupplyMetrics;
  targets: ReturnType<typeof milestoneTargets>;
  registry: SourceCandidateRegistry;
}) {
  const companyFeasibility = firstFeasibleSmeCompanyTarget({
    baseline: input.baseline,
    milestoneCompanies: input.targets.companies,
    minimumRatio: input.registry.targets.minimumSmeCompanyRatio,
  });
  const visibleDenominator = Math.max(input.targets.visibleJobs, input.baseline.visibleJobs);
  const minimumSmeVisibleJobs = Math.ceil(
    visibleDenominator * input.registry.targets.minimumSmeVisibleJobRatio,
  );
  const deterministicVisibleJobs =
    input.baseline.visibleJobs - input.baseline.manualVisibleJobs;
  const minimumDeterministicVisibleJobsBeforeManualExpansion = Math.ceil(
    input.baseline.manualVisibleJobs /
      input.registry.targets.manualSourceMaximumVisibleJobRatio,
  );
  const companyRatioRecovered =
    ratio(input.baseline.smeCompanies, input.baseline.companies) >=
    input.registry.targets.minimumSmeCompanyRatio;
  const visibleJobRatioRecovered =
    ratio(input.baseline.smeVisibleJobs, input.baseline.visibleJobs) >=
    input.registry.targets.minimumSmeVisibleJobRatio;

  return {
    ...companyFeasibility,
    minimumAdditionalSmeVisibleJobsAtMilestone: Math.max(
      0,
      minimumSmeVisibleJobs - input.baseline.smeVisibleJobs,
    ),
    minimumDeterministicVisibleJobsBeforeManualExpansion,
    deterministicVisibleJobs,
    manualExpansionAllowed:
      ratio(input.baseline.manualVisibleJobs, input.baseline.visibleJobs) <=
        input.registry.targets.manualSourceMaximumVisibleJobRatio &&
      deterministicVisibleJobs >= minimumDeterministicVisibleJobsBeforeManualExpansion,
    smeRecoveryRequired: !companyRatioRecovered || !visibleJobRatioRecovered,
    currentRatios: {
      smeCompanies: ratio(input.baseline.smeCompanies, input.baseline.companies),
      smeVisibleJobs: ratio(input.baseline.smeVisibleJobs, input.baseline.visibleJobs),
      manualCompanies: ratio(input.baseline.manualCompanies, input.baseline.companies),
      manualVisibleJobs: ratio(input.baseline.manualVisibleJobs, input.baseline.visibleJobs),
    },
  };
}

function deficit(target: number, current: number): number {
  return Math.max(0, target - current);
}

function buildAliasMap(registry: SourceCandidateRegistry): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const group of registry.companyAliases) {
    for (const name of [group.canonicalName, ...group.aliases]) {
      aliases.set(normalizeCandidateCompanyName(name), group.canonicalName);
    }
  }
  for (const candidate of sourceCandidateOverrides(registry)) {
    for (const name of [candidate.displayName, ...candidate.aliases]) {
      aliases.set(normalizeCandidateCompanyName(name), candidate.displayName);
    }
  }
  return aliases;
}

function buildOverrideMap(registry: SourceCandidateRegistry): Map<string, SourceCandidateOverride> {
  const overrides = new Map<string, SourceCandidateOverride>();
  for (const candidate of sourceCandidateOverrides(registry)) {
    for (const name of [candidate.displayName, ...candidate.aliases]) {
      overrides.set(normalizeCandidateCompanyName(name), candidate);
    }
  }
  return overrides;
}

function activityRank(row: Pick<SourceCandidateLedgerRow, "activityState">): number {
  return row.activityState === "active_explicit"
    ? 0
    : row.activityState === "active_needs_recheck"
      ? 1
      : 2;
}

function representativeEvidence(
  candidate: MergedSourceCandidateEvidence,
): SourceCandidateLedgerRow {
  return [...candidate.evidence].sort((left, right) => {
    const activity = activityRank(left) - activityRank(right);
    if (activity !== 0) return activity;
    const application =
      Number(hasOfficialApplicationSignal(right.applicationSignal)) -
      Number(hasOfficialApplicationSignal(left.applicationSignal));
    if (application !== 0) return application;
    return left.candidateId.localeCompare(right.candidateId);
  })[0] as SourceCandidateLedgerRow;
}

export function inferAdapterFamily(evidenceUrl: string): string {
  const url = new URL(evidenceUrl);
  const host = url.hostname.toLowerCase();
  if (host.endsWith("mokahr.com")) return "moka-public-contract-candidate";
  if (host.includes("zhiye.com") || host.includes("beisen.com")) {
    return "beisen-zhiye-public-api";
  }
  if (host.endsWith(".edu.cn")) return "university-employment-detail-html";
  return "unclassified";
}

function plannerCandidate(
  merged: MergedSourceCandidateEvidence,
  overrideMap: ReadonlyMap<string, SourceCandidateOverride>,
  currentShanghaiDate: string,
): PlannerCandidate {
  const evidence = representativeEvidence(merged);
  const override = overrideMap.get(normalizeCandidateCompanyName(merged.canonicalCompanyName));
  const lane = override?.lane ?? "deferred";
  const automationMode = override?.automationMode ?? "unknown";
  const capacity = override?.capacity ?? null;
  const scaleBand = override?.scaleBand ?? "unknown";
  const quota = isSmeScaleBand(scaleBand) ? SME_COMPANY_QUOTA : NON_SME_COMPANY_QUOTA;
  const projectedVisibleJobs = Math.min(capacity?.completeJdInternships ?? 0, quota);
  const capacityAge = capacity ? dateAgeDays(currentShanghaiDate, capacity.verifiedAt) : null;
  const capacityFresh =
    capacityAge !== null &&
    capacityAge >= 0 &&
    capacityAge <= CAPACITY_EVIDENCE_MAX_AGE_DAYS;
  const readinessBlockers: string[] = [];
  if (lane === "deferred") readinessBlockers.push("deferred");
  if (lane === "capacity" && automationMode !== "deterministic") {
    readinessBlockers.push("automation_not_deterministic");
  } else if (automationMode === "blocked" || automationMode === "unknown") {
    readinessBlockers.push("automation_not_deterministic");
  }
  if (capacity === null) readinessBlockers.push("capacity_unverified");
  else if (!capacityFresh) readinessBlockers.push("capacity_stale");
  if (lane === "capacity" && projectedVisibleJobs < CAPACITY_MINIMUM_COMPLETE_JOBS) {
    readinessBlockers.push("below_capacity_threshold");
  }
  if (evidence.activityState !== "active_explicit") {
    readinessBlockers.push("activity_recheck_required");
  }
  if (!hasOfficialApplicationSignal(evidence.applicationSignal)) {
    readinessBlockers.push("official_application_missing");
  }
  if (override?.assessmentStatus !== "preflight_ready") {
    readinessBlockers.push("preflight_not_ready");
  }
  if (override?.alphaDisplayStatus !== "approved") {
    readinessBlockers.push("alpha_display_not_approved");
  }

  const adapterFamily = override?.adapterFamily ?? inferAdapterFamily(evidence.evidenceUrl);
  const selectionReasons = [
    `lane:${lane}`,
    `scale:${scaleBand}`,
    `projected_visible:${projectedVisibleJobs}`,
    `adapter:${adapterFamily}`,
  ];
  if ((override?.jobFamilyHints.length ?? 0) > 0) selectionReasons.push("job_family_gap_hint");
  if ((override?.cityHints.length ?? 0) > 0) selectionReasons.push("city_gap_hint");

  return {
    candidateId: evidence.candidateId,
    companyName: override?.displayName ?? merged.canonicalCompanyName,
    activityState: evidence.activityState,
    applicationSignal: evidence.applicationSignal,
    evidenceUrl: evidence.evidenceUrl,
    closeDate: evidence.closeDate,
    adapterFamily,
    scaleBand,
    alphaDisplayStatus: override?.alphaDisplayStatus ?? "not_reviewed",
    assessmentStatus: override?.assessmentStatus ?? "unregistered",
    jobFamilyHints: override?.jobFamilyHints ?? [],
    cityHints: override?.cityHints ?? [],
    pauseReasons: override?.pauseReasons ?? [],
    assessmentEvidenceRefs: override?.assessmentEvidenceRefs ?? [],
    sourceLedgers: [...new Set(merged.evidence.map((row) => row.sourceLedger))].sort(),
    lane,
    automationMode,
    capacity,
    quota,
    projectedVisibleJobs,
    capacityFresh,
    readinessBlockers,
    selectionReasons,
  };
}

function closeDateValue(value: string): number {
  if (value === "rolling" || value === "unknown") return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(`${value}T23:59:59+08:00`);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function candidatePriority(
  candidate: PlannerCandidate,
  familyDeficits: Record<JobFamily, number>,
  cityDeficits: Record<AlphaTargetCity, number>,
): [number, number, number, number, number, number, number, string] {
  const laneRank = candidate.lane === "capacity" ? 0 : candidate.lane === "coverage" ? 1 : 2;
  const smeRank = candidate.scaleBand === "small" || candidate.scaleBand === "medium" ? 0 : 1;
  const adapterRank = isOfficialSourceAdapterKey(candidate.adapterFamily)
    ? 0
    : candidate.adapterFamily === "unclassified"
      ? 2
      : 1;
  const coverage =
    candidate.jobFamilyHints.filter((family) => familyDeficits[family] > 0).length +
    candidate.cityHints.filter((city) => cityDeficits[city] > 0).length;
  return [
    laneRank,
    smeRank,
    -candidate.projectedVisibleJobs,
    activityRank(candidate),
    adapterRank,
    -coverage,
    closeDateValue(candidate.closeDate),
    candidate.candidateId,
  ];
}

function comparePriority(
  left: PlannerCandidate,
  right: PlannerCandidate,
  familyDeficits: Record<JobFamily, number>,
  cityDeficits: Record<AlphaTargetCity, number>,
): number {
  const leftPriority = candidatePriority(left, familyDeficits, cityDeficits);
  const rightPriority = candidatePriority(right, familyDeficits, cityDeficits);
  for (let index = 0; index < leftPriority.length; index += 1) {
    const leftValue = leftPriority[index];
    const rightValue = rightPriority[index];
    if (leftValue === rightValue) continue;
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return leftValue - rightValue;
    }
    return String(leftValue).localeCompare(String(rightValue));
  }
  return 0;
}

function holdReason(
  candidate: PlannerCandidate,
  currentCompanies: ReadonlySet<string>,
  currentShanghaiDate: string,
): string | null {
  if (currentCompanies.has(normalizeCandidateCompanyName(candidate.companyName))) {
    return "already_in_catalog";
  }
  if (candidate.assessmentStatus === "paused" || candidate.alphaDisplayStatus === "paused") {
    return "paused";
  }
  if (candidate.assessmentStatus === "rejected" || candidate.alphaDisplayStatus === "blocked") {
    return "rejected_or_blocked";
  }
  if (
    candidate.closeDate !== "rolling" &&
    candidate.closeDate !== "unknown" &&
    candidate.closeDate < currentShanghaiDate
  ) {
    return "deadline_expired";
  }
  if (candidate.activityState === "expired") return "activity_expired";
  if (
    candidate.activityState !== "active_explicit" &&
    candidate.activityState !== "active_needs_recheck"
  ) {
    return "activity_not_current";
  }
  if (!hasOfficialApplicationSignal(candidate.applicationSignal)) {
    return "official_application_missing";
  }
  return null;
}

function coverageCandidateUseful(
  candidate: PlannerCandidate,
  familyDeficits: Record<JobFamily, number>,
  cityDeficits: Record<AlphaTargetCity, number>,
): boolean {
  return (
    isSmeScaleBand(candidate.scaleBand) ||
    candidate.jobFamilyHints.some((family) => familyDeficits[family] > 0) ||
    candidate.cityHints.some((city) => cityDeficits[city] > 0)
  );
}

function projectedBatchRatios(candidates: readonly PlannerCandidate[]) {
  const smeCandidates = candidates.filter((candidate) => isSmeScaleBand(candidate.scaleBand));
  const projectedVisibleJobs = candidates.reduce(
    (total, candidate) => total + candidate.projectedVisibleJobs,
    0,
  );
  const projectedSmeVisibleJobs = smeCandidates.reduce(
    (total, candidate) => total + candidate.projectedVisibleJobs,
    0,
  );
  return {
    smeCompanyRatio: ratio(smeCandidates.length, candidates.length),
    smeVisibleJobRatio: ratio(projectedSmeVisibleJobs, projectedVisibleJobs),
  };
}

function selectSourceBatch(input: {
  eligiblePool: PlannerCandidate[];
  limit: number;
  smeRecoveryRequired: boolean;
  familyDeficits: Record<JobFamily, number>;
  cityDeficits: Record<AlphaTargetCity, number>;
}): PlannerCandidate[] {
  const minimumSmeCompanyRatio = input.smeRecoveryRequired ? 0.7 : 0.5;
  const minimumSmeVisibleJobRatio = input.smeRecoveryRequired ? 0.5 : 0.4;
  const selected: PlannerCandidate[] = [];
  let coverageCompanies = 0;

  for (const candidate of input.eligiblePool) {
    if (selected.length >= input.limit) break;
    if (candidate.readinessBlockers.length > 0) continue;
    if (candidate.lane !== "capacity" && candidate.lane !== "coverage") continue;
    if (
      candidate.lane === "coverage" &&
      (!coverageCandidateUseful(candidate, input.familyDeficits, input.cityDeficits) ||
        coverageCompanies >= MAX_COVERAGE_COMPANIES_PER_BATCH)
    ) {
      continue;
    }

    const proposed = [...selected, candidate];
    if (!isSmeScaleBand(candidate.scaleBand)) {
      const projectedRatios = projectedBatchRatios(proposed);
      if (
        projectedRatios.smeCompanyRatio < minimumSmeCompanyRatio ||
        projectedRatios.smeVisibleJobRatio < minimumSmeVisibleJobRatio
      ) {
        continue;
      }
    }

    selected.push({
      ...candidate,
      selectionReasons: [
        ...candidate.selectionReasons,
        `batch_sme_company_floor:${minimumSmeCompanyRatio}`,
        `batch_sme_job_floor:${minimumSmeVisibleJobRatio}`,
      ],
    });
    if (candidate.lane === "coverage") coverageCompanies += 1;
  }

  return selected;
}

function projectedSupplyMetrics(
  baseline: CatalogSupplyMetrics,
  selected: readonly PlannerCandidate[],
) {
  const projectedVisibleJobs = selected.reduce(
    (total, candidate) => total + candidate.projectedVisibleJobs,
    0,
  );
  const projectedSmeVisibleJobs = selected
    .filter((candidate) => isSmeScaleBand(candidate.scaleBand))
    .reduce((total, candidate) => total + candidate.projectedVisibleJobs, 0);
  const projectedManualVisibleJobs = selected
    .filter((candidate) => candidate.automationMode === "browser_required")
    .reduce((total, candidate) => total + candidate.projectedVisibleJobs, 0);
  const projectedSmeCompanies = selected.filter((candidate) =>
    isSmeScaleBand(candidate.scaleBand),
  ).length;
  const projectedManualCompanies = selected.filter(
    (candidate) => candidate.automationMode === "browser_required",
  ).length;
  const companies = baseline.companies + selected.length;
  const visibleJobs = baseline.visibleJobs + projectedVisibleJobs;
  const smeCompanies = baseline.smeCompanies + projectedSmeCompanies;
  const smeVisibleJobs = baseline.smeVisibleJobs + projectedSmeVisibleJobs;
  const manualCompanies = baseline.manualCompanies + projectedManualCompanies;
  const manualVisibleJobs = baseline.manualVisibleJobs + projectedManualVisibleJobs;
  const jobFamilies = { ...baseline.jobFamilies };
  const cities = { ...baseline.cities };
  let unallocatedJobFamilyJobs = 0;
  let unallocatedCityJobs = 0;

  for (const candidate of selected) {
    if (candidate.jobFamilyHints.length === 1) {
      const family = candidate.jobFamilyHints[0];
      if (family) jobFamilies[family] += candidate.projectedVisibleJobs;
    } else {
      unallocatedJobFamilyJobs += candidate.projectedVisibleJobs;
    }
    if (candidate.cityHints.length === 1) {
      const city = candidate.cityHints[0];
      if (city) cities[city] += candidate.projectedVisibleJobs;
    } else {
      unallocatedCityJobs += candidate.projectedVisibleJobs;
    }
  }

  return {
    companies,
    visibleJobs,
    smeCompanies,
    smeVisibleJobs,
    manualCompanies,
    manualVisibleJobs,
    ratios: {
      smeCompanies: ratio(smeCompanies, companies),
      smeVisibleJobs: ratio(smeVisibleJobs, visibleJobs),
      manualCompanies: ratio(manualCompanies, companies),
      manualVisibleJobs: ratio(manualVisibleJobs, visibleJobs),
    },
    jobFamilies,
    cities,
    unallocatedJobFamilyJobs,
    unallocatedCityJobs,
  };
}

export function planSourceBatch(input: {
  baseline: CatalogSupplyMetrics;
  milestone: SourceScaleMilestone;
  limit?: number;
  preflightLimit?: number;
  registry: SourceCandidateRegistry;
  ledgerRows: SourceCandidateLedgerRow[];
  now?: Date;
}) {
  const registry = input.registry;
  const limit = input.limit ?? registry.batchPolicy.maxCompanies;
  if (!Number.isInteger(limit) || limit < 1 || limit > registry.batchPolicy.maxCompanies) {
    throw new Error("SOURCE_BATCH_PLAN_LIMIT_OUT_OF_RANGE");
  }
  const preflightLimit = input.preflightLimit ?? Math.max(limit * 2, 20);
  if (!Number.isInteger(preflightLimit) || preflightLimit < 1 || preflightLimit > 1_000) {
    throw new Error("SOURCE_PREFLIGHT_LIMIT_OUT_OF_RANGE");
  }

  const baseline = input.baseline;
  const ledgerRows = input.ledgerRows;
  const targets = milestoneTargets(registry, input.milestone);
  const requirements = dynamicRequirements({ baseline, targets, registry });
  const familyDeficits = Object.fromEntries(
    JobFamilySchema.options.map((family) => [
      family,
      deficit(targets.jobFamilies[family], baseline.jobFamilies[family]),
    ]),
  ) as Record<JobFamily, number>;
  const cityDeficits = Object.fromEntries(
    TARGET_ALPHA_CITIES.map((city) => [city, deficit(targets.cities[city], baseline.cities[city])]),
  ) as Record<AlphaTargetCity, number>;

  const aliasMap = buildAliasMap(registry);
  const overrideMap = buildOverrideMap(registry);
  const currentCompanies = new Set(
    [...baseline.companyNames, ...baseline.registeredOrganizationNames].map(
      normalizeCandidateCompanyName,
    ),
  );
  const currentShanghaiDate = shanghaiDateKey(input.now ?? new Date());
  const candidates = mergeSourceCandidateEvidence(ledgerRows, aliasMap).map((candidate) => {
    const planned = plannerCandidate(candidate, overrideMap, currentShanghaiDate);
    const readinessBlockers = [...planned.readinessBlockers];
    if (
      planned.automationMode === "browser_required" &&
      !requirements.manualExpansionAllowed &&
      !readinessBlockers.includes("manual_ratio_blocked")
    ) {
      readinessBlockers.push("manual_ratio_blocked");
    }
    if (
      planned.lane === "coverage" &&
      !coverageCandidateUseful(planned, familyDeficits, cityDeficits)
    ) {
      readinessBlockers.push("coverage_not_needed");
    }
    return { ...planned, readinessBlockers };
  });
  const holds = new Map<string, PlannerCandidate[]>();
  const eligiblePool: PlannerCandidate[] = [];

  for (const candidate of candidates) {
    const reason = holdReason(candidate, currentCompanies, currentShanghaiDate);
    if (!reason) {
      eligiblePool.push(candidate);
      continue;
    }
    const group = holds.get(reason) ?? [];
    group.push(candidate);
    holds.set(reason, group);
  }

  eligiblePool.sort((left, right) => comparePriority(left, right, familyDeficits, cityDeficits));
  const selected = selectSourceBatch({
    eligiblePool,
    limit,
    smeRecoveryRequired: requirements.smeRecoveryRequired,
    familyDeficits,
    cityDeficits,
  });
  const selectedIds = new Set(selected.map((candidate) => candidate.candidateId));
  const preflightQueue = eligiblePool
    .filter((candidate) => !selectedIds.has(candidate.candidateId))
    .slice(0, preflightLimit);
  const projected = projectedSupplyMetrics(baseline, selected);

  return {
    milestone: input.milestone,
    baseline,
    targets,
    dynamicRequirements: requirements,
    projected,
    deficits: {
      companies: deficit(targets.companies, baseline.companies),
      visibleJobs: deficit(targets.visibleJobs, baseline.visibleJobs),
      smeCompanies: requirements.minimumAdditionalSmeCompaniesIfAllNewSme,
      smeVisibleJobs: requirements.minimumAdditionalSmeVisibleJobsAtMilestone,
      jobFamilies: familyDeficits,
      cities: cityDeficits,
      manualCompaniesOverLimit: Math.max(
        0,
        baseline.manualCompanies -
          Math.floor(baseline.companies * registry.targets.manualSourceMaximumCompanyRatio),
      ),
      manualVisibleJobsOverLimit: Math.max(
        0,
        baseline.manualVisibleJobs -
          Math.floor(
            baseline.visibleJobs * registry.targets.manualSourceMaximumVisibleJobRatio,
          ),
      ),
    },
    candidatePool: {
      ledgerRows: ledgerRows.length,
      canonicalCompanies: candidates.length,
      eligible: eligiblePool.length,
      selected,
      preflightQueue,
      holds: Object.fromEntries(
        [...holds.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([reason, values]) => [
            reason,
            {
              count: values.length,
              sample: values.slice(0, 5),
            },
          ]),
      ),
    },
    constraints: {
      maxCompaniesPerBatch: registry.batchPolicy.maxCompanies,
      familyPilotMaxCompanies: registry.batchPolicy.familyPilotMaxCompanies,
      initialJobsPerCompany: registry.batchPolicy.initialJobsPerCompany,
      requiresExplicitLiveProbeApproval: registry.liveProbeRequiresExplicitApproval,
      automaticFirst: true,
      browserFallbackOnly: true,
    },
  };
}

export async function buildSourceBatchPlan(input: {
  db: Kysely<Database>;
  milestone: SourceScaleMilestone;
  limit?: number;
  preflightLimit?: number;
  registry?: SourceCandidateRegistry;
  ledgerRows?: SourceCandidateLedgerRow[];
  now?: Date;
}) {
  const registry = input.registry ?? (await loadSourceCandidateRegistry());
  const [baseline, ledgerRows, configuredSourceKeys] = await Promise.all([
    loadLocalCatalogSupplyMetrics(input.db),
    input.ledgerRows ? Promise.resolve(input.ledgerRows) : loadSourceCandidateLedgerRows(),
    listSourceKeys(),
  ]);
  const configuredSourceKeySet = new Set(configuredSourceKeys);
  const missingSourceKeys = sourceCandidateOverrides(registry)
    .flatMap((candidate) => candidate.sourceKeys)
    .filter((sourceKey) => !configuredSourceKeySet.has(sourceKey));
  if (missingSourceKeys.length > 0) {
    throw new Error(
      `SOURCE_CANDIDATE_CONFIG_MISSING:${[...new Set(missingSourceKeys)].sort().join(",")}`,
    );
  }
  return planSourceBatch({
    baseline,
    milestone: input.milestone,
    registry,
    ledgerRows,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.preflightLimit === undefined ? {} : { preflightLimit: input.preflightLimit }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

export function auditSourceBatchPlan(
  plan: ReturnType<typeof planSourceBatch>,
  candidateSampleLimit = 20,
) {
  if (
    !Number.isInteger(candidateSampleLimit) ||
    candidateSampleLimit < 1 ||
    candidateSampleLimit > 100
  ) {
    throw new Error("SOURCE_CANDIDATE_AUDIT_LIMIT_OUT_OF_RANGE");
  }
  const candidates = [...plan.candidatePool.selected, ...plan.candidatePool.preflightQueue];
  const groups = new Map<string, PlannerCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.adapterFamily) ?? [];
    group.push(candidate);
    groups.set(candidate.adapterFamily, group);
  }
  const familyGroups = [...groups.entries()]
    .map(([adapterFamily, values]) => ({
      adapterFamily,
      candidateCount: values.length,
      capacityReadyCount: values.filter((candidate) => candidate.readinessBlockers.length === 0)
        .length,
      verifiedSmeCount: values.filter((candidate) => isSmeScaleBand(candidate.scaleBand)).length,
      projectedVisibleJobs: values.reduce(
        (total, candidate) => total + candidate.projectedVisibleJobs,
        0,
      ),
      candidates: values.slice(0, candidateSampleLimit),
    }))
    .sort(
      (left, right) =>
        right.verifiedSmeCount - left.verifiedSmeCount ||
        right.projectedVisibleJobs - left.projectedVisibleJobs ||
        right.candidateCount - left.candidateCount ||
        left.adapterFamily.localeCompare(right.adapterFamily),
    );

  return {
    milestone: plan.milestone,
    baseline: plan.baseline,
    targets: plan.targets,
    dynamicRequirements: plan.dynamicRequirements,
    projected: plan.projected,
    familyGroups,
    holds: plan.candidatePool.holds,
    constraints: plan.constraints,
  };
}

export async function buildSourceCandidateAudit(input: {
  db: Kysely<Database>;
  milestone: SourceScaleMilestone;
  candidateSampleLimit?: number;
  registry?: SourceCandidateRegistry;
  ledgerRows?: SourceCandidateLedgerRow[];
  now?: Date;
}) {
  const plan = await buildSourceBatchPlan({
    db: input.db,
    milestone: input.milestone,
    preflightLimit: 1_000,
    ...(input.registry === undefined ? {} : { registry: input.registry }),
    ...(input.ledgerRows === undefined ? {} : { ledgerRows: input.ledgerRows }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  return auditSourceBatchPlan(plan, input.candidateSampleLimit ?? 20);
}
