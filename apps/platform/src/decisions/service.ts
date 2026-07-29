import { type JobDecision, JobDecisionSchema } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { Kysely, Selectable, Transaction } from "kysely";
import type { OwnerScope as OwnerContext } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";

function toIso(value: unknown): string {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

function mapDecision(row: Selectable<Database["decision.job_decisions"]>): JobDecision {
  return JobDecisionSchema.parse({
    ownerId: row.owner_id,
    publishedJobId: row.published_job_id,
    status: row.status,
    reason: row.reason,
    revision: row.revision,
    officialLinkOpenedAt: row.official_link_opened_at ? toIso(row.official_link_opened_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

async function lockActiveOwnerEpoch(
  transaction: Transaction<Database>,
  owner: OwnerContext,
): Promise<void> {
  const currentOwner = await transaction
    .selectFrom("identity.owners")
    .select(["status", "epoch", "retention_expires_at"])
    .where("id", "=", owner.ownerId)
    .forUpdate()
    .executeTakeFirst();
  if (
    !currentOwner ||
    currentOwner.status !== "active" ||
    Number(currentOwner.epoch) !== owner.ownerEpoch ||
    new Date(currentOwner.retention_expires_at).getTime() <= Date.now()
  ) {
    throw new ServiceError(409, "OWNER_EPOCH_STALE", "个人数据访问已撤销，不能再保存岗位状态。");
  }
}

export async function putJobDecision(
  db: Kysely<Database>,
  owner: OwnerContext,
  publishedJobId: string,
  input: {
    expectedRevision: number;
    status: "undecided" | "saved" | "preparing_to_apply" | "applied" | "abandoned";
    reason: string | null;
  },
): Promise<JobDecision> {
  const job = await db
    .selectFrom("catalog.published_jobs")
    .select("id")
    .where("id", "=", publishedJobId)
    .executeTakeFirst();
  if (!job) throw new ServiceError(404, "JOB_NOT_FOUND", "没有找到该岗位。");

  const row = await db.transaction().execute(async (transaction) => {
    await lockActiveOwnerEpoch(transaction, owner);

    if (input.expectedRevision === 0) {
      const inserted = await transaction
        .insertInto("decision.job_decisions")
        .values({
          owner_id: owner.ownerId,
          owner_epoch: owner.ownerEpoch,
          published_job_id: publishedJobId,
          status: input.status,
          reason: input.reason,
          revision: 1,
          official_link_opened_at: null,
          updated_at: new Date(),
        })
        .onConflict((conflict) => conflict.doNothing())
        .returningAll()
        .executeTakeFirst();
      if (inserted) return inserted;
    } else {
      const updated = await transaction
        .updateTable("decision.job_decisions")
        .set({
          status: input.status,
          reason: input.reason,
          revision: input.expectedRevision + 1,
          updated_at: new Date(),
        })
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .where("published_job_id", "=", publishedJobId)
        .where("revision", "=", input.expectedRevision)
        .returningAll()
        .executeTakeFirst();
      if (updated) return updated;
    }
    throw new ServiceError(
      409,
      "DECISION_REVISION_CONFLICT",
      "岗位状态已在其他页面更新，请刷新后重试。",
    );
  });
  return mapDecision(row);
}

export async function listJobDecisions(
  db: Kysely<Database>,
  owner: OwnerContext,
): Promise<JobDecision[]> {
  const rows = await db
    .selectFrom("decision.job_decisions as decision")
    .innerJoin("identity.owners as owner", "owner.id", "decision.owner_id")
    .selectAll("decision")
    .where("decision.owner_id", "=", owner.ownerId)
    .where("decision.owner_epoch", "=", owner.ownerEpoch)
    .where("owner.status", "=", "active")
    .where("owner.epoch", "=", owner.ownerEpoch)
    .where("owner.retention_expires_at", ">", new Date())
    .orderBy("decision.updated_at", "desc")
    .execute();
  return rows.map(mapDecision);
}

export async function markOfficialLinkOpened(
  db: Kysely<Database>,
  owner: OwnerContext,
  publishedJobId: string,
): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    await lockActiveOwnerEpoch(transaction, owner);
    await transaction
      .updateTable("decision.job_decisions")
      .set({ official_link_opened_at: new Date(), updated_at: new Date() })
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("published_job_id", "=", publishedJobId)
      .execute();
  });
}
