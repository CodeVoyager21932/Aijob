import { randomUUID } from "node:crypto";
import {
  JobSearchQuerySchema,
  OpportunityDigestListSchema,
  type JobSearchItem,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { createCatalogRepository } from "../catalog/repository.js";
import { shanghaiDateKey } from "../catalog/effective-activity.js";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { withOwnerTaskLease, type OwnerTaskLease } from "../workers/owner-task-lease.js";
import { nextDigestTime } from "./subscriptions.js";

export type DigestSnapshot = {
  job_id: string;
  version_id: string | null;
  activity_state: string;
  title: string;
  company_name: string;
};
export function classifyDigestChange(
  current: DigestSnapshot,
  previous?: DigestSnapshot,
  initial = false,
) {
  if (!previous) return initial ? "initial" : "new";
  if (current.activity_state === "closed" && previous.activity_state !== "closed") return "closed";
  if (current.activity_state !== "closed" && previous.activity_state === "closed")
    return "reopened";
  if (current.version_id !== previous.version_id) return "updated";
  return "unchanged";
}
/** Persist every current/previous job as a snapshot; no event-id watermark or disappearance-as-closure. */
export async function processOpportunityDigest(input: {
  db: Kysely<Database>;
  lease: OwnerTaskLease;
  searchId: string;
  revision: number;
  localDate: string;
  local: boolean;
}) {
  await withOwnerTaskLease(input.db, input.lease, async (tx) => {
    const search = await tx
      .selectFrom("application.saved_searches")
      .selectAll()
      .where("id", "=", input.searchId)
      .where("owner_id", "=", input.lease.ownerId)
      .where("owner_epoch", "=", input.lease.ownerEpoch)
      .forUpdate()
      .executeTakeFirst();
    if (!search || !search.digest_enabled || search.revision !== input.revision) return;
    if (
      (
        await sql`SELECT id FROM application.opportunity_digests WHERE search_id=${search.id}::uuid AND search_revision=${input.revision} AND local_date=${input.localDate}::date`.execute(
          tx,
        )
      ).rows.length
    )
      return;
    const previous = (
      await sql<{
        id: string;
      }>`SELECT id FROM application.opportunity_digests WHERE search_id=${search.id}::uuid AND search_revision=${input.revision} ORDER BY local_date DESC LIMIT 1`.execute(
        tx,
      )
    ).rows[0];
    const old = previous
      ? (
          await sql<DigestSnapshot>`SELECT job_id,version_id,activity_state,title,company_name FROM application.opportunity_digest_items WHERE digest_id=${previous.id}::uuid`.execute(
            tx,
          )
        ).rows
      : [];
    const prior = new Map(old.map((j) => [j.job_id, j])),
      current = new Map<string, DigestSnapshot>();
    const scope = search.scope as Record<string, unknown>;
    const query = JobSearchQuerySchema.parse(
      scope.__catalogQuery ?? { cities: scope.cities, educationLevels: scope.educationLevels },
    );
    const repository = createCatalogRepository({ db: tx, enableLocalMvp: input.local });
    let cursor: string | undefined;
    const reasons = new Map<string, string>();
    do {
      const page = await repository.search({ ...query, limit: 100, ...(cursor ? { cursor } : {}) });
      for (const j of page.items) {
        current.set(j.id, {
          job_id: j.id,
          version_id: j.publishedJobVersionId,
          activity_state: j.activityState,
          title: j.title,
          company_name: j.companyName,
        });
        reasons.set(j.id, reasonFor(j));
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    // A missing row may be unpublished, stale, or temporarily unavailable. Only authoritative closure changes its state.
    for (const j of old)
      if (!current.has(j.job_id)) {
        const state = (
          await sql<{
            effective_activity_state: string;
          }>`SELECT e.effective_activity_state FROM catalog.published_jobs p JOIN catalog.job_version_eligibility e ON e.published_job_version_id=p.current_version_id WHERE p.id=${j.job_id}::uuid`.execute(
            tx,
          )
        ).rows[0];
        current.set(j.job_id, {
          ...j,
          activity_state:
            state?.effective_activity_state === "closed" ? "closed" : j.activity_state,
        });
        reasons.set(
          j.job_id,
          state?.effective_activity_state === "closed"
            ? "官方截止或完整刷新已确认关闭。"
            : "暂未取得新的可见信息，保留上次记录。",
        );
      }
    const partial =
      (
        await sql<{
          partial: boolean;
        }>`SELECT EXISTS(SELECT 1 FROM source_control.source_runtime_states r JOIN source_control.source_policy_versions p ON p.source_id=r.source_id AND p.version=r.policy_version WHERE p.config_registered AND (r.automation_paused OR r.freshness_state='stale')) AS partial`.execute(
          tx,
        )
      ).rows[0]?.partial ?? false;
    const id = randomUUID();
    await sql`INSERT INTO application.opportunity_digests(id,owner_id,owner_epoch,search_id,search_revision,local_date,label,initial,partial,local_preview,status_note)
      VALUES(${id}::uuid,${search.owner_id}::uuid,${search.owner_epoch},${search.id}::uuid,${input.revision},${input.localDate}::date,${search.label},${!previous},${partial},${input.local},${partial ? "部分来源本次未更新；未把来源故障视为岗位关闭。" : !previous ? "首次汇总当前符合方向的岗位，存量不计作今日新增。" : "与上一份摘要比较；条件未说明的岗位保留供你核对。"})`.execute(
      tx,
    );
    for (const job of current.values()) {
      const kind = classifyDigestChange(job, prior.get(job.job_id), !previous);
      await sql`INSERT INTO application.opportunity_digest_items(digest_id,job_id,version_id,event_id,kind,activity_state,title,company_name,reason)
        VALUES(${id}::uuid,${job.job_id}::uuid,${job.version_id}::uuid,(SELECT id FROM catalog.job_change_events WHERE job_id=${job.job_id}::uuid ORDER BY occurred_at DESC,id DESC LIMIT 1),${kind},${job.activity_state},${job.title},${job.company_name},${reasons.get(job.job_id) ?? "符合保存的求职方向。"})`.execute(
        tx,
      );
    }
  });
}
function reasonFor(job: JobSearchItem) {
  return job.conditionState === "information_unknown"
    ? "方向与筛选相关；部分条件未说明，请打开岗位核对。"
    : "符合保存的求职方向与筛选条件。";
}

export async function scheduleOpportunityDigests(db: Kysely<Database>, now = new Date()) {
  await db.transaction().execute(async (tx) => {
    const due = await tx
      .selectFrom("application.saved_searches as s")
      .innerJoin("identity.owners as o", "o.id", "s.owner_id")
      .selectAll("s")
      .where("s.digest_enabled", "=", true)
      .where("s.next_digest_at", "<=", now)
      .where("o.status", "=", "active")
      .whereRef("s.owner_epoch", "=", "o.epoch")
      .where((eb) =>
        eb.or([eb("o.retention_expires_at", "is", null), eb("o.retention_expires_at", ">", now)]),
      )
      .orderBy("s.next_digest_at")
      .limit(50)
      .forUpdate("o")
      .skipLocked()
      .execute();
    for (const row of due) {
      const day = shanghaiDateKey(now);
      await sql`INSERT INTO task_queue.tasks(task_type,owner_id,owner_epoch,idempotency_key,status,backoff_policy,payload)
        VALUES('opportunity_digest',${row.owner_id}::uuid,${row.owner_epoch},${`digest:${row.id}:${row.revision}:${day}`},'queued','{}',${JSON.stringify({ searchId: row.id, revision: row.revision, localDate: day })}::jsonb) ON CONFLICT(idempotency_key) DO NOTHING`.execute(
        tx,
      );
      await tx
        .updateTable("application.saved_searches")
        .set({ next_digest_at: nextDigestTime(now, row.digest_time) })
        .where("id", "=", row.id)
        .execute();
    }
  });
}
export async function listOpportunityDigests(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  local: boolean;
  offset?: number;
}) {
  return input.db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, input.owner.ownerId, input.owner.ownerEpoch);
    const result = await sql<{
      id: string;
      search_id: string;
      label: string;
      local_date_key: string;
      initial: boolean;
      partial: boolean;
      status_note: string;
      read_at: Date | null;
      created_at: Date;
      items: unknown[];
    }>`
      SELECT d.*,to_char(d.local_date,'YYYY-MM-DD') AS local_date_key,COALESCE((SELECT jsonb_agg(jsonb_build_object('jobId',i.job_id,'versionId',i.version_id,'kind',i.kind,'title',i.title,'companyName',i.company_name,'reason',i.reason) ORDER BY i.kind,i.company_name,i.title) FROM application.opportunity_digest_items i WHERE i.digest_id=d.id AND i.kind<>'unchanged'),'[]'::jsonb) items
      FROM application.opportunity_digests d WHERE d.owner_id=${input.owner.ownerId}::uuid AND d.owner_epoch=${input.owner.ownerEpoch} AND d.local_preview=${input.local} ORDER BY d.created_at DESC,d.id DESC LIMIT 11 OFFSET ${input.offset ?? 0}`.execute(
      tx,
    );
    return OpportunityDigestListSchema.parse({
      nextOffset: result.rows.length > 10 ? (input.offset ?? 0) + 10 : null,
      items: result.rows.slice(0, 10).map((r) => ({
        id: r.id,
        searchId: r.search_id,
        label: r.label,
        localDate: r.local_date_key,
        initial: r.initial,
        partial: r.partial,
        statusNote: r.status_note,
        readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
        items: r.items,
      })),
    });
  });
}
export async function markDigestRead(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  id: string;
}) {
  return input.db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, input.owner.ownerId, input.owner.ownerEpoch);
    const result =
      await sql`UPDATE application.opportunity_digests SET read_at=COALESCE(read_at,now()) WHERE id=${input.id}::uuid AND owner_id=${input.owner.ownerId}::uuid AND owner_epoch=${input.owner.ownerEpoch} RETURNING id`.execute(
        tx,
      );
    return { updated: result.rows.length > 0 };
  });
}
