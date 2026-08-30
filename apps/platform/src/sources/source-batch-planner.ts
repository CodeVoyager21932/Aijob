import {
  classifyJobReachability,
  isReachableVerdict,
  type JobFamily,
  JobFamilySchema,
  MINIMUM_REACHABLE_VISIBLE_JOB_RATIO,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { shanghaiDateKey } from "../catalog/effective-activity.js";
import {
  type CandidateActivityState,
  type CandidateApplicationSignal,
  hasOfficialApplicationSignal,
  isUnobservedApplicationSignal,
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
  /** ADR-0032 结构门槛轴。 */
  reachableVisibleJobs: number;
  reachableCompanies: number;
  /** SME 两项保留为观察指标，不再参与门槛与排序（ADR-0032）。 */
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
  requirements: string;
  responsibilities: string;
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
  /** 其中判定为可达的部分，来自容量证据；缺失即 0。 */
  projectedReachableVisibleJobs: number;
  /** 容量证据是否显示该候选存在可达岗位（ADR-0032 配额与排序轴）。 */
  reachableCapacity: boolean;
  capacityFresh: boolean;
  readinessBlockers: string[];
  selectionReasons: string[];
}

const CAPACITY_EVIDENCE_MAX_AGE_DAYS = 7;
const CAPACITY_MINIMUM_COMPLETE_JOBS = 10;
const MAX_COVERAGE_COMPANIES_PER_BATCH = 2;

/**
 * ADR-0032 反霸榜配额：可达企业单家最多贡献 30 条可见岗位，非可达企业最多 10 条。
 * 语义与原 SME 配额一致，只是判定轴从企业规模换成岗位可达性。
 */
const NON_REACHABLE_COMPANY_QUOTA = 10;
const REACHABLE_COMPANY_QUOTA = 30;

/**
 * 候选企业尚未入库，没有岗位正文，因此可达性只能来自容量探测记录的证据。
 * 缺失或为 0 时一律视为不可达（fail-closed），不猜测。
 */
function candidateReachableInternships(
  capacity: SourceCandidateOverride["capacity"],
): number {
  return capacity?.reachableInternships ?? 0;
}

function isReachableCandidateCapacity(
  capacity: SourceCandidateOverride["capacity"],
): boolean {
  return candidateReachableInternships(capacity) > 0;
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
        version.requirements,
        version.responsibilities,
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
      JOIN catalog.current_job_eligibility AS eligibility
        ON eligibility.revision_id = revision.id
      JOIN ingestion.source_job_records AS record
        ON record.id = revision.source_job_record_id
      JOIN source_control.sources AS source
        ON source.id = record.source_id
      JOIN source_control.source_policy_versions AS policy
        ON policy.source_id = source.id
        AND policy.version = source.current_policy_version
      WHERE quota.selected = TRUE
        AND eligibility.eligible_for_local_mvp
        AND activity.effective_activity_state <> 'closed'
        AND source.source_key IN (${sql.join(
          configuredSourceKeys.map((sourceKey) => sql`${sourceKey}`),
          sql`, `,
        )})
    `.execute(db),
    db
      .selectFrom("catalog.current_job_eligibility as preview")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("preview.eligible_for_local_mvp", "=", true)
      .where("preview.source_key", "in", configuredSourceKeys)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("catalog.published_jobs as job")
      .innerJoin("catalog.published_job_versions as version", "version.id", "job.public_version_id")
      .innerJoin(
        "catalog.job_version_eligibility as eligibility",
        "eligibility.published_job_version_id",
        "version.id",
      )
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
      .where("eligibility.eligible_for_alpha", "=", true)
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
  const reachableCompanyNames = new Set<string>();
  const smeCompanyNames = new Set<string>();
  const manualCompanyNames = new Set<string>();
  let reachableVisibleJobs = 0;
  let smeVisibleJobs = 0;
  let manualVisibleJobs = 0;

  for (const row of catalogRows.rows) {
    companyNames.add(row.company_name);
    if (
      isReachableVerdict(
        classifyJobReachability({
          requirements: row.requirements,
          responsibilities: row.responsibilities,
        }),
      )
    ) {
      reachableVisibleJobs += 1;
      reachableCompanyNames.add(row.company_name);
    }
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
    reachableVisibleJobs,
    reachableCompanies: reachableCompanyNames.size,
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
    reachableVisibleJobs: Math.ceil(
      visibleJobs * registry.targets.minimumReachableVisibleJobRatio,
    ),
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

function dynamicRequirements(input: {
  baseline: CatalogSupplyMetrics;
  targets: ReturnType<typeof milestoneTargets>;
  registry: SourceCandidateRegistry;
}) {
  const visibleDenominator = Math.max(input.targets.visibleJobs, input.baseline.visibleJobs);
  const minimumReachableVisibleJobs = Math.ceil(
    visibleDenominator * input.registry.targets.minimumReachableVisibleJobRatio,
  );
  const deterministicVisibleJobs =
    input.baseline.visibleJobs - input.baseline.manualVisibleJobs;
  const minimumDeterministicVisibleJobsBeforeManualExpansion = Math.ceil(
    input.baseline.manualVisibleJobs /
      input.registry.targets.manualSourceMaximumVisibleJobRatio,
  );
  const reachableRatioRecovered =
    ratio(input.baseline.reachableVisibleJobs, input.baseline.visibleJobs) >=
    input.registry.targets.minimumReachableVisibleJobRatio;

  return {
    minimumReachableVisibleJobsAtMilestone: minimumReachableVisibleJobs,
    minimumAdditionalReachableVisibleJobsAtMilestone: Math.max(
      0,
      minimumReachableVisibleJobs - input.baseline.reachableVisibleJobs,
    ),
    minimumDeterministicVisibleJobsBeforeManualExpansion,
    deterministicVisibleJobs,
    manualExpansionAllowed:
      ratio(input.baseline.manualVisibleJobs, input.baseline.visibleJobs) <=
        input.registry.targets.manualSourceMaximumVisibleJobRatio &&
      deterministicVisibleJobs >= minimumDeterministicVisibleJobsBeforeManualExpansion,
    reachabilityRecoveryRequired: !reachableRatioRecovered,
    currentRatios: {
      reachableVisibleJobs: ratio(
        input.baseline.reachableVisibleJobs,
        input.baseline.visibleJobs,
      ),
      // 以下两项仅为观察，不参与门槛（ADR-0032）。
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
  const reachableCapacity = isReachableCandidateCapacity(capacity);
  const quota = reachableCapacity ? REACHABLE_COMPANY_QUOTA : NON_REACHABLE_COMPANY_QUOTA;
  const projectedVisibleJobs = Math.min(capacity?.completeJdInternships ?? 0, quota);
  const projectedReachableVisibleJobs = Math.min(
    candidateReachableInternships(capacity),
    quota,
  );
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
  // 未在企业自有页面确认活跃的候选可以进池取证，但不计入达标。
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
    `reachable:${reachableCapacity}`,
    // scaleBand 仅为观察，不参与门槛与排序（ADR-0032）。
    `scale_observed:${scaleBand}`,
    `projected_visible:${projectedVisibleJobs}`,
    `projected_reachable:${projectedReachableVisibleJobs}`,
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
    projectedReachableVisibleJobs,
    reachableCapacity,
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
  const reachableRank = candidate.reachableCapacity ? 0 : 1;
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
    reachableRank,
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
  // `non_job_program` 是确认过的否决（不是岗位），继续排除。
  // `discovery_only` 是「只在第三方或高校页面见过引用，还没到企业自己的页面确认」——
  // 那恰恰是下一步要做的事，不是否决理由。保留在池里，由 `activity_recheck_required` 标注。
  if (candidate.activityState === "non_job_program") return "activity_not_current";
  // 只有**确认过**没有企业直达投递才排除出候选池。`unknown` 是「还没看过」，保留在池里并由
  // `readinessBlockers` 的 `official_application_missing` 标注——可以去取证，但不计入达标。
  // 岗位层的 `EXACT_APPLICATION_NOT_AVAILABLE` 仍然硬拦，把关没有放松。
  if (
    !hasOfficialApplicationSignal(candidate.applicationSignal) &&
    !isUnobservedApplicationSignal(candidate.applicationSignal)
  ) {
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
    candidate.reachableCapacity ||
    candidate.jobFamilyHints.some((family) => familyDeficits[family] > 0) ||
    candidate.cityHints.some((city) => cityDeficits[city] > 0)
  );
}

function projectedBatchRatios(candidates: readonly PlannerCandidate[]) {
  const projectedVisibleJobs = candidates.reduce(
    (total, candidate) => total + candidate.projectedVisibleJobs,
    0,
  );
  const projectedReachableVisibleJobs = candidates.reduce(
    (total, candidate) => total + candidate.projectedReachableVisibleJobs,
    0,
  );
  return {
    reachableVisibleJobRatio: ratio(projectedReachableVisibleJobs, projectedVisibleJobs),
  };
}

function selectSourceBatch(input: {
  eligiblePool: PlannerCandidate[];
  limit: number;
  reachabilityRecoveryRequired: boolean;
  familyDeficits: Record<JobFamily, number>;
  cityDeficits: Record<AlphaTargetCity, number>;
}): PlannerCandidate[] {
  // ADR-0032 §4 的实测结论是可达比例上限 58.8%、70% 不可达。此前这里在
  // `reachabilityRecoveryRequired` 时把本批下限抬到 0.7，等于落后时把门槛提到语料供不出的水平，
  // 于是永远选不出批次。抬高不可达的门槛不产生任何保护，因此统一用 50%。
  // `reachabilityRecoveryRequired` 保留为**排序信号**（可达候选优先），不再改判定阈值。
  const minimumReachableVisibleJobRatio = MINIMUM_REACHABLE_VISIBLE_JOB_RATIO;
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
    if (!candidate.reachableCapacity) {
      const projectedRatios = projectedBatchRatios(proposed);
      if (projectedRatios.reachableVisibleJobRatio < minimumReachableVisibleJobRatio) {
        continue;
      }
    }

    selected.push({
      ...candidate,
      selectionReasons: [
        ...candidate.selectionReasons,
        `batch_reachable_job_floor:${minimumReachableVisibleJobRatio}`,
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
  const projectedReachableVisibleJobs = selected.reduce(
    (total, candidate) => total + candidate.projectedReachableVisibleJobs,
    0,
  );
  const projectedManualVisibleJobs = selected
    .filter((candidate) => candidate.automationMode === "browser_required")
    .reduce((total, candidate) => total + candidate.projectedVisibleJobs, 0);
  const projectedReachableCompanies = selected.filter(
    (candidate) => candidate.reachableCapacity,
  ).length;
  const projectedManualCompanies = selected.filter(
    (candidate) => candidate.automationMode === "browser_required",
  ).length;
  const companies = baseline.companies + selected.length;
  const visibleJobs = baseline.visibleJobs + projectedVisibleJobs;
  const reachableCompanies = baseline.reachableCompanies + projectedReachableCompanies;
  const reachableVisibleJobs = baseline.reachableVisibleJobs + projectedReachableVisibleJobs;
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
    reachableCompanies,
    reachableVisibleJobs,
    manualCompanies,
    manualVisibleJobs,
    ratios: {
      reachableVisibleJobs: ratio(reachableVisibleJobs, visibleJobs),
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
    reachabilityRecoveryRequired: requirements.reachabilityRecoveryRequired,
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
      reachableVisibleJobs: requirements.minimumAdditionalReachableVisibleJobsAtMilestone,
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
      reachableReadyCount: values.filter((candidate) => candidate.reachableCapacity).length,
      projectedVisibleJobs: values.reduce(
        (total, candidate) => total + candidate.projectedVisibleJobs,
        0,
      ),
      candidates: values.slice(0, candidateSampleLimit),
    }))
    .sort(
      (left, right) =>
        right.reachableReadyCount - left.reachableReadyCount ||
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
