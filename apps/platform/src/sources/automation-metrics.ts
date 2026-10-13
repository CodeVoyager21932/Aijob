import type { Database } from "@aijob/database";
import { sql, type Kysely } from "kysely";

/** Operational evidence across ALL retained scheduled tasks, including failures and inactive sources. */
export async function sourceAutomationMetrics(db: Kysely<Database>, days = 30) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("METRICS_WINDOW_INVALID");
  const result = await sql<{
    planned: number;
    completed: number;
    failed: number;
    pending: number;
    sources: number;
    touched_sources: number;
    actions: number;
    onboarding: unknown;
    recovery: unknown;
    freshness: unknown;
  }>`WITH tasks AS MATERIALIZED (
    SELECT t.* FROM task_queue.tasks t WHERE task_type='crawl' AND run_mode='scheduled'
      AND created_at>=now()-${days}*interval '1 day'
  ), actions AS MATERIALIZED (
    SELECT * FROM source_control.operator_actions WHERE created_at>=now()-${days}*interval '1 day'
      AND action IN ('refresh','resume','configuration_install')
  ), runs AS MATERIALIZED (
    SELECT r.*,count(*) FILTER(WHERE completion='complete' AND automation_acceptance='accepted') OVER
      (PARTITION BY source_id ORDER BY started_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS episode
    FROM ingestion.crawl_runs r WHERE run_mode='scheduled' AND started_at>=now()-${days}*interval '1 day'
  ), failures AS (
    SELECT source_id,episode,min(started_at) AS first_failure,max(started_at) AS last_failure
    FROM runs WHERE completion IS DISTINCT FROM 'complete' OR automation_acceptance IS DISTINCT FROM 'accepted'
    GROUP BY source_id,episode
  ), recoveries AS (
    SELECT source.source_key,f.first_failure, recovered.at AS recovered_at,
      EXTRACT(EPOCH FROM (recovered.at-f.first_failure)) AS seconds
    FROM failures f JOIN source_control.sources source ON source.id=f.source_id
    LEFT JOIN LATERAL (SELECT min(finished_at) AS at FROM runs r WHERE r.source_id=f.source_id
      AND r.started_at>f.last_failure AND completion='complete' AND automation_acceptance='accepted') recovered ON true
  ), onboarding AS (
    SELECT source_key,min(created_at) FILTER(WHERE action='configuration_draft') AS first_preview,
      min(completed_at) FILTER(WHERE action='configuration_install' AND status='completed') AS installed_at
    FROM source_control.operator_actions GROUP BY source_key
  ) SELECT
    (SELECT count(*)::int FROM tasks) AS planned,
    (SELECT count(*)::int FROM tasks t WHERE status='succeeded' AND EXISTS
      (SELECT 1 FROM ingestion.crawl_runs r WHERE r.task_id=t.id AND completion='complete' AND automation_acceptance='accepted')) AS completed,
    (SELECT count(*)::int FROM tasks WHERE status IN ('failed','dead')) AS failed,
    (SELECT count(*)::int FROM tasks WHERE status IN ('queued','running')) AS pending,
    (SELECT count(DISTINCT source_id)::int FROM tasks) AS sources,
    (SELECT count(DISTINCT t.source_id)::int FROM tasks t JOIN source_control.sources s ON s.id=t.source_id
      WHERE EXISTS(SELECT 1 FROM actions a WHERE a.source_key=s.source_key)) AS touched_sources,
    (SELECT count(*)::int FROM actions) AS actions,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceKey',source_key,'firstPreviewAt',first_preview,
      'installedAt',installed_at,'elapsedSeconds',CASE WHEN installed_at>=first_preview THEN EXTRACT(EPOCH FROM installed_at-first_preview) END)) FROM onboarding),'[]') AS onboarding,
    COALESCE((SELECT jsonb_agg(to_jsonb(recoveries)) FROM recoveries),'[]') AS recovery,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceKey',s.source_key,'state',r.freshness_state,
      'paused',r.automation_paused,'lastSuccessAt',r.last_successful_run_at,'nextDueAt',r.next_due_at))
      FROM source_control.sources s JOIN source_control.source_runtime_states r ON r.source_id=s.id),'[]') AS freshness`.execute(
    db,
  );
  const row = result.rows[0];
  if (!row) throw new Error("METRICS_READ_FAILED");
  return {
    generatedAt: new Date().toISOString(),
    days,
    denominator:
      "All retained scheduled crawl tasks created in this window; includes failed, dead, queued and running tasks, and paused or inactive sources.",
    planned: row.planned,
    acceptedComplete: row.completed,
    failed: row.failed,
    pending: row.pending,
    otherUnaccepted: row.planned - row.completed - row.failed - row.pending,
    automaticSuccessRate: row.planned ? row.completed / row.planned : null,
    manualIntervention: {
      unit: "sources_with_operator_actions / sources_with_scheduled_tasks",
      sources: row.sources,
      touchedSources: row.touched_sources,
      actionCount: row.actions,
      rate: row.sources ? row.touched_sources / row.sources : null,
    },
    onboarding: row.onboarding,
    recovery: row.recovery,
    freshness: row.freshness,
    limitations: [
      "No planned tasks means unmeasured, not 100% success.",
      "First preview to installation is observed elapsed time, not measured human labor. Older installations without a draft remain unknown.",
      "Failed attempts remain in recovery evidence even if a later retry succeeds. Running attempts can appear as unresolved.",
      "Historical records outside the retained window and machine-off time are not invented as scheduled executions.",
    ],
  };
}
