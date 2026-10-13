import { randomUUID } from "node:crypto";
import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import {
  probeTenant,
  TENANT_ONBOARDING_VERSION,
  type TenantOnboardingRequest,
  TenantOnboardingRequestSchema,
} from "./tenant-onboarding.js";

/** Restricted operator API. The task reuses the ownerless collector queue. */
export async function queueTenantOnboarding(db: Kysely<Database>, raw: unknown) {
  const request = TenantOnboardingRequestSchema.parse(raw),
    id = randomUUID(),
    taskId = randomUUID();
  return db.transaction().execute(async (tx) => {
    await sql`INSERT INTO task_queue.tasks(id,task_type,payload,idempotency_key,status,max_attempts,backoff_policy)
      VALUES(${taskId}::uuid,'source_discovery',${JSON.stringify({ operation: "source_probe", runId: id })}::jsonb,${`source-probe:${id}`},'queued',2,'{}')`.execute(
      tx,
    );
    await sql`INSERT INTO source_control.onboarding_runs(id,task_id,version,request) VALUES(${id}::uuid,${taskId}::uuid,${TENANT_ONBOARDING_VERSION},${JSON.stringify(request)}::jsonb)`.execute(
      tx,
    );
    return { id, status: "queued", requestHash: hashCanonicalJson(request) };
  });
}
export async function getTenantOnboarding(db: Kysely<Database>, id: string) {
  return (
    (
      await sql`SELECT id,status,result,created_at,completed_at FROM source_control.onboarding_runs WHERE id=${id}::uuid`.execute(
        db,
      )
    ).rows[0] ?? null
  );
}
export async function runTenantOnboardingCycle(input: {
  db: Kysely<Database>;
  signal: AbortSignal;
  enabled: boolean;
  probe?: typeof probeTenant;
}) {
  if (!input.enabled || input.signal.aborted) return false;
  const worker = `tenant-probe-${randomUUID()}`;
  const task = await input.db.transaction().execute(async (tx) => {
    await sql`UPDATE source_control.onboarding_runs r SET status='failed',result='{"state":"failed","reason":"SOURCE_PROBE_ATTEMPTS_EXHAUSTED"}'::jsonb,completed_at=now()
      FROM task_queue.tasks t WHERE r.task_id=t.id AND t.status='dead' AND r.status IN ('queued','running')`.execute(
      tx,
    );
    const row = (
      await sql<{
        id: string;
        run_id: string;
        fencing_token: string;
        request: TenantOnboardingRequest;
      }>`
      SELECT t.id,t.fencing_token,r.id AS run_id,r.request FROM task_queue.tasks t JOIN source_control.onboarding_runs r ON r.task_id=t.id
      WHERE t.task_type='source_discovery' AND t.payload->>'operation'='source_probe' AND t.attempt<t.max_attempts
      AND ((t.status='queued' AND t.available_at<=now()) OR (t.status='running' AND t.lease_until<now())) ORDER BY t.available_at FOR UPDATE OF t SKIP LOCKED LIMIT 1`.execute(
        tx,
      )
    ).rows[0];
    if (!row) return null;
    await sql`UPDATE task_queue.tasks SET status='running',attempt=attempt+1,lease_owner=${worker},lease_until=now()+interval '60 seconds',heartbeat_at=now(),fencing_token=fencing_token+1 WHERE id=${row.id}::uuid`.execute(
      tx,
    );
    await sql`UPDATE source_control.onboarding_runs SET status='running' WHERE id=${row.run_id}::uuid`.execute(
      tx,
    );
    return { ...row, fence: Number(row.fencing_token) + 1 };
  });
  if (!task) return false;
  const abort = new AbortController(),
    signal = AbortSignal.any([input.signal, abort.signal]);
  const timer = setInterval(() => {
    void sql`UPDATE task_queue.tasks SET heartbeat_at=now(),lease_until=now()+interval '60 seconds' WHERE id=${task.id}::uuid AND lease_owner=${worker} AND fencing_token=${task.fence} AND status='running' AND lease_until>now() RETURNING id`
      .execute(input.db)
      .then((r) => {
        if (!r.rows.length) abort.abort();
      })
      .catch(() => abort.abort());
  }, 10000);
  timer.unref();
  try {
    const result = await (input.probe ?? probeTenant)({
      request: task.request,
      runId: task.run_id,
      signal,
    });
    if (signal.aborted) return true;
    await input.db.transaction().execute(async (tx) => {
      const held = (
        await sql`SELECT id FROM task_queue.tasks WHERE id=${task.id}::uuid AND lease_owner=${worker} AND fencing_token=${task.fence} AND status='running' AND lease_until>now() FOR UPDATE`.execute(
          tx,
        )
      ).rows.length;
      if (!held) return;
      await sql`UPDATE source_control.onboarding_runs SET status=${result.state},result=${JSON.stringify(result)}::jsonb,completed_at=now() WHERE id=${task.run_id}::uuid`.execute(
        tx,
      );
      await sql`UPDATE task_queue.tasks SET status='succeeded',lease_owner=NULL,lease_until=NULL,completed_at=now(),last_error_code=${result.reason} WHERE id=${task.id}::uuid`.execute(
        tx,
      );
    });
  } finally {
    clearInterval(timer);
  }
  return true;
}
