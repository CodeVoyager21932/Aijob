import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";

/**
 * ADR-0035 第三条：`stableIdentityAndFields` 按**观察次数与跨度**计量，不依赖在线时长。
 *
 * 旧判据要求「连续运行证据」，来源持续性 Gate 要求「3 个来源连续 7 天按 12 小时周期运行」。
 * 本项目跑在个人 Windows 笔记本与 Docker Desktop 上，机器会关，那个门槛在实际运行环境里
 * 不可满足。更根本的是它测错了对象：要确认的是「字段与标识稳定，不会一变就烂」，与机器是否
 * 不间断在线没有因果关系——一台永不关机但只成功刷新过 1 次的机器，对契约稳定性的证据强度低于
 * 一台开开关关但成功刷新过 10 次的机器。
 *
 * 因此判据只看三件事：够不够多次、是否分散在不同时间、这些次数之间结构有没有变。机器关机只
 * 延后达标时间，不产生惩罚。
 */
export const MINIMUM_QUALIFYING_REFRESHES = 3;

/**
 * 相邻两次合格刷新的最小间隔。取 20 小时而不是 24：`crawl_interval` 普遍是 `24h`，若门槛也写
 * 24 小时，实际调度的任何抖动都会让第二次刷新差几分钟而不计数，于是永远攒不满 3 次。
 * 20 小时既排除「同一天连打三次」，又给调度留出余量。
 */
export const MINIMUM_REFRESH_INTERVAL_HOURS = 20;

/** 来源持续性：至少这么多来源各自达标，且各自跨度不少于 `MINIMUM_PERSISTENCE_SPAN_HOURS`。 */
export const MINIMUM_PERSISTENT_SOURCES = 3;
export const MINIMUM_PERSISTENCE_SPAN_HOURS = 72;

const MILLISECONDS_PER_HOUR = 3_600_000;

export interface ContractStabilityObservation {
  /** 运行结束时间。未结束的运行不构成观察。 */
  finishedAt: Date;
  policyVersion: number;
  adapterVersion: string;
  /**
   * 该次运行是否被自动化接受。这正是机器对「冻结契约仍然解析得通」的判断：`automation_acceptance`
   * 为 `accepted` 要求 completion 不是 failed、没有任何硬冲突码、且没有数量异常。因此这里不需要
   * 另造一套「结构一致」判定。
   */
  accepted: boolean;
}

export interface ContractStabilityVerdict {
  /** 只有 `pass` 与 `pending` 两态：证据不足是「还没到」，不是「不合格」。 */
  status: "pass" | "pending";
  /** 当前契约下被接受的运行次数。 */
  acceptedRunCount: number;
  /** 其中满足间隔要求、计入达标的次数。 */
  qualifyingRunCount: number;
  /** 首末两次合格刷新之间的跨度小时数；不足两次时为 null。 */
  observationSpanHours: number | null;
  /** 还差什么。为空即 `pass`。 */
  shortfalls: string[];
}

/**
 * 只保留**当前契约**下的观察。
 *
 * 稳定性是关于当前 `(policy_version, adapter_version)` 的断言：适配器或政策改过之后，改动之前的
 * 成功刷新不能再用来证明「现在这套契约稳定」。代价是任何适配器改动都会把计数清零，重新攒满约
 * 需两天——按 fail-closed 取这一侧。
 */
function observationsUnderCurrentContract(
  observations: readonly ContractStabilityObservation[],
): ContractStabilityObservation[] {
  const finished = observations
    .filter((observation) => observation.accepted)
    .slice()
    .sort((left, right) => left.finishedAt.getTime() - right.finishedAt.getTime());
  const latest = finished.at(-1);
  if (!latest) return [];
  return finished.filter(
    (observation) =>
      observation.policyVersion === latest.policyVersion &&
      observation.adapterVersion === latest.adapterVersion,
  );
}

/**
 * 从最早一次开始贪心取点：第一次总是计入，之后只有距上一次计入 ≥20 小时的才计入。
 *
 * 贪心而不是「相邻两次都必须 ≥20h」：同小时重放与补跑会产生密集运行，若要求每一对相邻运行都
 * 满足间隔，一次重放就能让整段证据作废。贪心取点保留「这些计数彼此分散」的原意，又不惩罚多跑。
 */
function qualifyingObservations(
  observations: readonly ContractStabilityObservation[],
): ContractStabilityObservation[] {
  const qualifying: ContractStabilityObservation[] = [];
  for (const observation of observations) {
    const previous = qualifying.at(-1);
    if (
      previous === undefined ||
      observation.finishedAt.getTime() - previous.finishedAt.getTime() >=
        MINIMUM_REFRESH_INTERVAL_HOURS * MILLISECONDS_PER_HOUR
    ) {
      qualifying.push(observation);
    }
  }
  return qualifying;
}

export function evaluateContractStability(
  observations: readonly ContractStabilityObservation[],
): ContractStabilityVerdict {
  const current = observationsUnderCurrentContract(observations);
  const qualifying = qualifyingObservations(current);
  const first = qualifying.at(0);
  const last = qualifying.at(-1);
  const observationSpanHours =
    first && last && qualifying.length > 1
      ? (last.finishedAt.getTime() - first.finishedAt.getTime()) / MILLISECONDS_PER_HOUR
      : null;

  const shortfalls: string[] = [];
  if (qualifying.length < MINIMUM_QUALIFYING_REFRESHES) {
    shortfalls.push(
      `needs_${MINIMUM_QUALIFYING_REFRESHES - qualifying.length}_more_qualifying_refreshes`,
    );
  }

  return {
    status: shortfalls.length === 0 ? "pass" : "pending",
    acceptedRunCount: current.length,
    qualifyingRunCount: qualifying.length,
    observationSpanHours,
    shortfalls,
  };
}

export interface SourcePersistenceVerdict {
  status: "pass" | "pending";
  /** 各自达标（≥3 次合格刷新且跨度 ≥3 天）的来源数。 */
  persistentSourceCount: number;
  persistentSourceKeys: string[];
  shortfalls: string[];
}

/**
 * ADR-0035 第三条的来源持续性：至少 3 个来源各自累计成功刷新 ≥3 次且跨度 ≥3 天。
 *
 * 替代的是「3 个来源连续 7 天按 12 小时周期运行」。跨度用首末合格刷新之间的实际间隔计量，
 * 中途关机只是把达标日期往后推。
 */
export function evaluateSourcePersistence(
  verdicts: ReadonlyMap<string, ContractStabilityVerdict>,
): SourcePersistenceVerdict {
  const persistentSourceKeys = [...verdicts.entries()]
    .filter(
      ([, verdict]) =>
        verdict.qualifyingRunCount >= MINIMUM_QUALIFYING_REFRESHES &&
        (verdict.observationSpanHours ?? 0) >= MINIMUM_PERSISTENCE_SPAN_HOURS,
    )
    .map(([sourceKey]) => sourceKey)
    .sort();
  const shortfalls: string[] = [];
  if (persistentSourceKeys.length < MINIMUM_PERSISTENT_SOURCES) {
    shortfalls.push(
      `needs_${MINIMUM_PERSISTENT_SOURCES - persistentSourceKeys.length}_more_persistent_sources`,
    );
  }
  return {
    status: shortfalls.length === 0 ? "pass" : "pending",
    persistentSourceCount: persistentSourceKeys.length,
    persistentSourceKeys,
    shortfalls,
  };
}

interface StabilityRow {
  source_key: string;
  finished_at: string;
  policy_version: number;
  adapter_version: string;
  accepted: boolean;
}

/**
 * 只读已结束的 `scheduled` 运行。`probe` 是人工首次探测，按定义不是「周期刷新」，不计入稳定性。
 */
export async function loadContractStabilityObservations(
  db: Kysely<Database>,
  sourceKeys?: readonly string[],
): Promise<Map<string, ContractStabilityObservation[]>> {
  const { rows } = await sql<StabilityRow>`
    SELECT
      source.source_key,
      run.finished_at,
      run.policy_version,
      run.adapter_version,
      run.automation_acceptance = 'accepted' AS accepted
    FROM ingestion.crawl_runs AS run
    JOIN source_control.sources AS source
      ON source.id = run.source_id
    WHERE run.run_mode = 'scheduled'
      AND run.finished_at IS NOT NULL
    ORDER BY source.source_key, run.finished_at
  `.execute(db);

  const allowed = sourceKeys ? new Set(sourceKeys) : null;
  const grouped = new Map<string, ContractStabilityObservation[]>();
  for (const row of rows) {
    if (allowed && !allowed.has(row.source_key)) continue;
    const group = grouped.get(row.source_key) ?? [];
    group.push({
      finishedAt: new Date(row.finished_at),
      policyVersion: row.policy_version,
      adapterVersion: row.adapter_version,
      accepted: row.accepted,
    });
    grouped.set(row.source_key, group);
  }
  return grouped;
}

/** 逐来源判定 + 汇总持续性，供 `pnpm source:refresh-status` 直接报出。 */
export async function loadSourceContractStability(
  db: Kysely<Database>,
  sourceKeys?: readonly string[],
): Promise<{
  sources: Array<{ sourceKey: string } & ContractStabilityVerdict>;
  persistence: SourcePersistenceVerdict;
}> {
  const observations = await loadContractStabilityObservations(db, sourceKeys);
  const verdicts = new Map(
    [...observations.entries()].map(([sourceKey, group]) => [
      sourceKey,
      evaluateContractStability(group),
    ]),
  );
  return {
    sources: [...verdicts.entries()]
      .map(([sourceKey, verdict]) => ({ sourceKey, ...verdict }))
      .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey)),
    persistence: evaluateSourcePersistence(verdicts),
  };
}
