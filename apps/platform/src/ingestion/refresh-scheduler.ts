import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, sql } from "kysely";

const TRANSPORT_ERROR_CODES = new Set([
  "DNS_EMPTY",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "UPSTREAM_TIMEOUT",
]);

export interface DueSourceRefresh {
  sourceId: string;
  sourceKey: string;
  policyVersion: number;
  adapterVersion: string;
  nextDueAt: Date;
}

export function isTransportErrorCode(code: string): boolean {
  return TRANSPORT_ERROR_CODES.has(code);
}

export function remainingHourlyCapacity(startedSourceIds: string[], maximum = 3): number {
  return Math.max(0, maximum - new Set(startedSourceIds).size);
}

function errorCodes(value: JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const code = (item as Record<string, JsonValue>).code;
    return typeof code === "string" ? [code] : [];
  });
}

export async function refreshFreshnessAndSnapshotReminders(
  db: Kysely<Database>,
  now = new Date(),
): Promise<string[]> {
  await db
    .updateTable("source_control.source_runtime_states as runtime")
    .set({ freshness_state: "due", updated_at: now })
    .where("runtime.next_due_at", "<=", now)
    .where("runtime.freshness_state", "!=", "stale")
    .execute();

  await sql`
    UPDATE source_control.source_runtime_states AS runtime
    SET
      freshness_state = 'stale',
      updated_at = ${now}
    FROM source_control.sources AS source
    JOIN source_control.source_policy_versions AS policy
      ON policy.source_id = source.id
      AND policy.version = source.current_policy_version
    WHERE runtime.source_id = source.id
      AND runtime.next_due_at IS NOT NULL
      AND policy.crawl_interval ~ '^\\d+h$'
      AND ${now} >= runtime.next_due_at
        + ((regexp_replace(policy.crawl_interval, 'h$', ''))::integer * interval '1 hour');
  `.execute(db);

  const reminders = await sql<{ source_key: string }>`
    WITH newly_due AS (
      UPDATE source_control.source_runtime_states AS runtime
      SET
        manual_snapshot_required = TRUE,
        manual_snapshot_due_at = COALESCE(runtime.manual_snapshot_due_at, runtime.next_due_at),
        freshness_state = CASE
          WHEN runtime.freshness_state = 'stale' THEN 'stale'
          ELSE 'due'
        END,
        updated_at = ${now}
      FROM source_control.sources AS source
      JOIN source_control.source_policy_versions AS policy
        ON policy.source_id = source.id
        AND policy.version = source.current_policy_version
      WHERE runtime.source_id = source.id
        AND policy.refresh_coverage = 'manual_snapshot'
        AND runtime.manual_snapshot_required = FALSE
        AND runtime.next_due_at IS NOT NULL
        AND runtime.next_due_at <= ${now}
      RETURNING source.source_key
    )
    SELECT source_key FROM newly_due ORDER BY source_key;
  `.execute(db);
  return reminders.rows.map(({ source_key }) => source_key);
}

export async function clearExpiredCircuitBreaker(
  db: Kysely<Database>,
  now = new Date(),
): Promise<void> {
  await db
    .updateTable("source_control.refresh_circuit_breaker")
    .set({ open_until: null, reason: null, updated_at: now })
    .where("id", "=", "global")
    .where("open_until", "<=", now)
    .execute();
}

export async function isRefreshCircuitOpen(
  db: Kysely<Database>,
  now = new Date(),
): Promise<boolean> {
  await clearExpiredCircuitBreaker(db, now);
  const state = await db
    .selectFrom("source_control.refresh_circuit_breaker")
    .select("open_until")
    .where("id", "=", "global")
    .executeTakeFirstOrThrow();
  return state.open_until !== null && new Date(state.open_until).getTime() > now.getTime();
}

export async function openCircuitForTransportFailures(
  db: Kysely<Database>,
  now = new Date(),
): Promise<boolean> {
  const runs = await db
    .selectFrom("ingestion.crawl_runs")
    .select(["source_id", "error_summary"])
    .where("run_mode", "=", "scheduled")
    .where("started_at", ">=", new Date(now.getTime() - 60 * 60 * 1_000))
    .execute();
  const affectedSources = new Set(
    runs
      .filter((run) => errorCodes(run.error_summary).some(isTransportErrorCode))
      .map((run) => run.source_id),
  );
  if (affectedSources.size < 3) return false;
  await db
    .updateTable("source_control.refresh_circuit_breaker")
    .set({
      open_until: new Date(now.getTime() + 60 * 60 * 1_000),
      reason: "three_distinct_transport_failures_within_one_hour",
      updated_at: now,
    })
    .where("id", "=", "global")
    .execute();
  return true;
}

export async function selectDueSourceRefreshes(
  db: Kysely<Database>,
  now = new Date(),
  maximumPerHour = 3,
): Promise<DueSourceRefresh[]> {
  if (await isRefreshCircuitOpen(db, now)) return [];
  const started = await db
    .selectFrom("ingestion.crawl_runs")
    .select("source_id")
    .distinct()
    .where("run_mode", "=", "scheduled")
    .where("started_at", ">=", new Date(now.getTime() - 60 * 60 * 1_000))
    .execute();
  const capacity = remainingHourlyCapacity(
    started.map(({ source_id }) => source_id),
    maximumPerHour,
  );
  if (capacity === 0) return [];

  const rows = await db
    .selectFrom("source_control.source_runtime_states as runtime")
    .innerJoin("source_control.sources as source", "source.id", "runtime.source_id")
    .innerJoin("source_control.source_policy_versions as policy", (join) =>
      join
        .onRef("policy.source_id", "=", "source.id")
        .onRef("policy.version", "=", "source.current_policy_version"),
    )
    .select([
      "source.id as sourceId",
      "source.source_key as sourceKey",
      "source.current_policy_version as policyVersion",
      "policy.adapter_version as adapterVersion",
      "runtime.next_due_at as nextDueAt",
    ])
    .where("runtime.automation_paused", "=", false)
    .where("runtime.next_due_at", "is not", null)
    .where("runtime.next_due_at", "<=", now)
    .where("policy.crawl_interval", "is not", null)
    .where("policy.refresh_coverage", "!=", "manual_snapshot")
    .where("policy.policy_status", "in", ["pending_review", "approved"])
    .orderBy("runtime.next_due_at", "asc")
    .orderBy("source.source_key", "asc")
    .limit(capacity)
    .execute();

  return rows.flatMap((row) =>
    row.nextDueAt
      ? [
          {
            sourceId: row.sourceId,
            sourceKey: row.sourceKey,
            policyVersion: row.policyVersion,
            adapterVersion: row.adapterVersion,
            nextDueAt: new Date(row.nextDueAt),
          },
        ]
      : [],
  );
}

export async function requestImmediateSourceRefresh(input: {
  db: Kysely<Database>;
  sourceKey: string;
  now?: Date;
}): Promise<{ sourceKey: string; scheduled: boolean; manualSnapshotRequired: boolean }> {
  const now = input.now ?? new Date();
  const row = await input.db
    .selectFrom("source_control.sources as source")
    .innerJoin("source_control.source_policy_versions as policy", (join) =>
      join
        .onRef("policy.source_id", "=", "source.id")
        .onRef("policy.version", "=", "source.current_policy_version"),
    )
    .innerJoin("source_control.source_runtime_states as runtime", "runtime.source_id", "source.id")
    .select([
      "source.id as sourceId",
      "policy.crawl_interval as crawlInterval",
      "policy.refresh_coverage as refreshCoverage",
      "policy.policy_status as policyStatus",
      "runtime.automation_paused as automationPaused",
    ])
    .where("source.source_key", "=", input.sourceKey)
    .executeTakeFirstOrThrow();
  if (row.automationPaused) throw new Error("SOURCE_AUTOMATION_PAUSED");
  if (!row.crawlInterval || !["pending_review", "approved"].includes(row.policyStatus)) {
    throw new Error("SOURCE_SCHEDULED_REFRESH_NOT_AUTHORIZED");
  }
  const manualSnapshotRequired = row.refreshCoverage === "manual_snapshot";
  await input.db
    .updateTable("source_control.source_runtime_states")
    .set({
      freshness_state: "due",
      next_due_at: now,
      manual_snapshot_required: manualSnapshotRequired,
      manual_snapshot_due_at: manualSnapshotRequired ? now : null,
      updated_at: now,
    })
    .where("source_id", "=", row.sourceId)
    .execute();
  return { sourceKey: input.sourceKey, scheduled: !manualSnapshotRequired, manualSnapshotRequired };
}

interface RefreshStatusRow {
  source_key: string;
  policy_status: string;
  refresh_coverage: string;
  crawl_interval: string | null;
  freshness_state: string;
  automation_paused: boolean;
  automation_pause_reason: string | null;
  manual_snapshot_required: boolean;
  last_successful_run_at: Date | string | null;
  next_due_at: Date | string | null;
  job_count: number;
  last_completion: string | null;
  last_error_code: string | null;
}

export async function loadSourceRefreshStatus(db: Kysely<Database>) {
  const rows = await sql<RefreshStatusRow>`
    SELECT
      source.source_key,
      policy.policy_status,
      policy.refresh_coverage,
      policy.crawl_interval,
      runtime.freshness_state,
      runtime.automation_paused,
      runtime.automation_pause_reason,
      runtime.manual_snapshot_required,
      runtime.last_successful_run_at,
      runtime.next_due_at,
      (
        SELECT count(*)::integer
        FROM ingestion.source_job_records AS record
        WHERE record.source_id = source.id
      ) AS job_count,
      latest.completion AS last_completion,
      runtime.last_error_code
    FROM source_control.sources AS source
    JOIN source_control.source_policy_versions AS policy
      ON policy.source_id = source.id
      AND policy.version = source.current_policy_version
    JOIN source_control.source_runtime_states AS runtime
      ON runtime.source_id = source.id
    LEFT JOIN LATERAL (
      SELECT run.completion
      FROM ingestion.crawl_runs AS run
      WHERE run.source_id = source.id
      ORDER BY run.started_at DESC, run.id DESC
      LIMIT 1
    ) AS latest ON TRUE
    ORDER BY source.source_key;
  `.execute(db);
  const circuit = await db
    .selectFrom("source_control.refresh_circuit_breaker")
    .select(["open_until", "reason"])
    .where("id", "=", "global")
    .executeTakeFirstOrThrow();
  return {
    circuit: {
      openUntil: circuit.open_until ? new Date(circuit.open_until).toISOString() : null,
      reason: circuit.reason,
    },
    sources: rows.rows.map((row) => ({
      sourceKey: row.source_key,
      policyStatus: row.policy_status,
      refreshCoverage: row.refresh_coverage,
      crawlInterval: row.crawl_interval,
      freshnessState: row.freshness_state,
      automationPaused: row.automation_paused,
      automationPauseReason: row.automation_pause_reason,
      manualSnapshotRequired: row.manual_snapshot_required,
      lastSuccessfulRunAt: row.last_successful_run_at
        ? new Date(row.last_successful_run_at).toISOString()
        : null,
      nextDueAt: row.next_due_at ? new Date(row.next_due_at).toISOString() : null,
      jobCount: Number(row.job_count),
      lastCompletion: row.last_completion,
      lastErrorCode: row.last_error_code,
    })),
  };
}
