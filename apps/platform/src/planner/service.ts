import { randomUUID } from "node:crypto";
import {
  type CreatePlannerItemRequest,
  type JobGraphScope,
  JobSearchQuerySchema,
  type PlannerItem,
  PlannerItemSchema,
  type PlannerListQuery,
  PlannerListSchema,
  SavedSearchListSchema,
  SavedSearchSchema,
  type UpdatePlannerItemRequest,
} from "@aijob/contracts";
import type { Database, JsonValue, PlannerItemTable } from "@aijob/database";
import { type Kysely, type Selectable, sql, type Transaction } from "kysely";
import { JOB_SEMANTICS_VERSION } from "../catalog/job-semantics.js";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { setSubscription, subscriptionFromRow, syncDiscoveryDemand } from "../opportunities/subscriptions.js";

type Db = Kysely<Database>;
type Tx = Transaction<Database>;
type Context = { db: Db; owner: OwnerScope };
const missing = () =>
  new ServiceError(404, "PLANNER_ITEM_NOT_FOUND", "事项不存在、已删除或不属于当前账户。");
const iso = (value: Date | string) => new Date(value).toISOString();
const json = (value: unknown) => JSON.stringify(value);
function project(row: Selectable<PlannerItemTable>): PlannerItem {
  return PlannerItemSchema.parse({
    id: row.id,
    kind: row.kind,
    title: row.title,
    note: row.note,
    status: row.status,
    caseId: row.case_id,
    dueAt: row.due_at ? iso(row.due_at) : null,
    timezone: row.timezone,
    artifact: row.artifact,
    evidenceRevisionId: row.evidence_revision_id,
    evidenceIds: row.evidence_ids,
    sourceExperienceIds: row.source_experience_ids,
    source: row.source,
    revision: row.revision,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
  });
}

async function active<T>(input: Context, action: (tx: Tx) => Promise<T>): Promise<T> {
  return input.db.transaction().execute(async (tx) => {
    try {
      await assertActiveOwnerEpoch(tx, input.owner.ownerId, input.owner.ownerEpoch);
    } catch (error) {
      if (error instanceof Error && error.message === "OWNER_EPOCH_STALE")
        throw new ServiceError(409, "OWNER_EPOCH_STALE", "账户状态已改变，请刷新页面。");
      throw error;
    }
    return action(tx);
  });
}
export async function mutatePersonalAsset<T>(
  input: Context & { idempotencyKey: string },
  operation: unknown,
  action: (tx: Tx) => Promise<T>,
): Promise<T> {
  return active(input, async (tx) => {
    const requestHash = hashCanonicalJson(operation);
    const receipt = await tx
      .selectFrom("application.planner_mutation_receipts")
      .selectAll()
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("request_key", "=", input.idempotencyKey)
      .executeTakeFirst();
    if (receipt) {
      if (receipt.request_hash !== requestHash)
        throw new ServiceError(409, "IDEMPOTENCY_CONFLICT", "这个请求编号已经用于另一项操作。");
      const result = receipt.result as Record<string, unknown>;
      if (result.erased)
        throw new ServiceError(
          410,
          "PLANNER_ITEM_DELETED",
          "这条记录已删除，原请求不会重新创建它。",
        );
      return receipt.result as T;
    }
    const result = await action(tx);
    await tx
      .insertInto("application.planner_mutation_receipts")
      .values({
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        request_key: input.idempotencyKey,
        request_hash: requestHash,
        result: json(result),
      })
      .execute();
    return result;
  });
}
const mutate = mutatePersonalAsset;

async function validateReferences(
  tx: Tx,
  owner: OwnerScope,
  request: CreatePlannerItemRequest,
  local: boolean,
) {
  if (request.caseId) {
    const row = await tx
      .selectFrom("application.application_cases")
      .select("id")
      .where("id", "=", request.caseId)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!row) throw new ServiceError(404, "APPLICATION_CASE_NOT_FOUND", "关联申请不存在或已删除。");
  }
  if (request.sourceExperienceIds.length) {
    const ids = [...new Set(request.sourceExperienceIds)];
    const { rows } = await sql<{
      id: string;
    }>`SELECT id FROM profile.experiences WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND id=ANY(${ids}::uuid[])`.execute(
      tx,
    );
    if (rows.length !== ids.length)
      throw new ServiceError(
        404,
        "EXPERIENCE_NOT_FOUND",
        "关联经历不存在、已删除或不属于当前账户。",
      );
  }
  if (request.evidenceIds.length && !request.evidenceRevisionId)
    throw new ServiceError(400, "EVIDENCE_REVISION_REQUIRED", "请选择经历的已确认版本。");
  if (request.evidenceRevisionId) {
    const row = await tx
      .selectFrom("profile.resume_evidence_revisions")
      .select("evidence")
      .where("id", "=", request.evidenceRevisionId)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .executeTakeFirst();
    const evidence =
      row && Array.isArray(row.evidence)
        ? (row.evidence as { id?: string; confirmed?: boolean }[])
        : [];
    if (
      !row ||
      request.evidenceIds.some(
        (id) => !evidence.some((item) => item.id === id && item.confirmed === true),
      )
    ) {
      throw new ServiceError(404, "EVIDENCE_NOT_FOUND", "关联经历不存在、未确认或不属于当前账户。");
    }
  }
  if (request.source) {
    const source = request.source;
    const { rows } = await sql<{
      requirements: string;
      responsibilities: string;
      atoms: JsonValue;
    }>`
      SELECT version.requirements, version.responsibilities, semantics.atoms
      FROM catalog.published_job_versions version
      JOIN catalog.published_jobs job ON job.id = version.published_job_id
      JOIN catalog.job_semantic_indexes semantics ON semantics.job_version_id = version.id AND semantics.extraction_version = ${source.extractionVersion ?? JOB_SEMANTICS_VERSION}
      JOIN catalog.job_version_eligibility eligibility ON eligibility.published_job_version_id = version.id
      JOIN catalog.current_job_effective_activity activity ON activity.published_job_version_id = version.id
      WHERE job.id = ${source.jobId}::uuid AND version.id = ${source.jobVersionId}::uuid
      AND ((version.id = ${sql.ref(local ? "job.current_version_id" : "job.public_version_id")}
        AND ${local ? sql`eligibility.eligible_for_local_mvp` : sql`eligibility.eligible_for_alpha`} AND activity.effective_activity_state <> 'closed')
        OR EXISTS(SELECT 1 FROM application.application_cases c WHERE c.owner_id = ${owner.ownerId}::uuid AND c.owner_epoch = ${owner.ownerEpoch}
          AND c.deleted_at IS NULL AND c.id = ${request.caseId}::uuid AND c.published_job_version_id = version.id))
    `.execute(tx);
    const row = rows[0];
    const atomFound =
      row &&
      Array.isArray(row.atoms) &&
      row.atoms.some((value) => {
        const atom = value as {
          key?: string;
          section?: string;
          sourceText?: string;
          sourceSpan?: { start?: number; end?: number };
        };
        return (
          atom.key === source.key &&
          atom.section === source.section &&
          atom.sourceText === source.sourceText &&
          atom.sourceSpan?.start === source.start &&
          atom.sourceSpan?.end === source.end
        );
      });
    if (
      !row ||
      !atomFound ||
      row[source.section].slice(source.start, source.end) !== source.sourceText
    ) {
      throw new ServiceError(
        409,
        "SOURCE_QUOTE_CHANGED",
        "岗位原句不可用或与所选版本不一致，请重新查看原句。",
      );
    }
  }
}

function values(request: CreatePlannerItemRequest) {
  return {
    kind: request.kind,
    title: request.title,
    note: request.note,
    status: request.status,
    case_id: request.caseId,
    due_at: request.dueAt ? new Date(request.dueAt) : null,
    timezone: request.timezone,
    artifact: request.artifact,
    evidence_revision_id: request.evidenceRevisionId,
    evidence_ids: json([...new Set(request.evidenceIds)]),
    source_experience_ids: json([...new Set(request.sourceExperienceIds)]),
    source: request.source ? json(request.source) : null,
  };
}
export async function insertPlannerItemInTransaction(
  tx: Tx,
  owner: OwnerScope,
  request: CreatePlannerItemRequest,
  local: boolean,
) {
  await validateReferences(tx, owner, request, local);
  return project(
    await tx
      .insertInto("application.planner_items")
      .values({
        id: randomUUID(),
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        ...values(request),
        completed_at: request.status === "done" ? new Date() : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
}
export async function createPlannerItem(
  input: Context & { request: CreatePlannerItemRequest; idempotencyKey: string; local: boolean },
) {
  return mutate(input, { action: "create", request: input.request }, async (tx) => {
    await validateReferences(tx, input.owner, input.request, input.local);
    const row = await tx
      .insertInto("application.planner_items")
      .values({
        id: randomUUID(),
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        ...values(input.request),
        completed_at: input.request.status === "done" ? new Date() : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return project(row);
  });
}
export async function updatePlannerItem(
  input: Context & {
    itemId: string;
    request: UpdatePlannerItemRequest;
    idempotencyKey: string;
    local: boolean;
  },
) {
  return mutate(
    input,
    { action: "update", id: input.itemId, request: input.request },
    async (tx) => {
      const row = await tx
        .selectFrom("application.planner_items")
        .selectAll()
        .where("id", "=", input.itemId)
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .forUpdate()
        .executeTakeFirst();
      if (!row) throw missing();
      if (row.revision !== input.request.expectedRevision)
        throw new ServiceError(
          409,
          "PLANNER_REVISION_CONFLICT",
          "事项已在其他页面更新，请刷新后再保存。",
        );
      // A previously saved quote remains a historical reference after withdrawal; new references must still be visible.
      const unchangedSource =
        hashCanonicalJson(row.source) === hashCanonicalJson(input.request.source);
      await validateReferences(
        tx,
        input.owner,
        { ...input.request, source: unchangedSource ? null : input.request.source },
        input.local,
      );
      const updated = await tx
        .updateTable("application.planner_items")
        .set({
          ...values(input.request),
          revision: row.revision + 1,
          updated_at: new Date(),
          completed_at: input.request.status === "done" ? (row.completed_at ?? new Date()) : null,
        })
        .where("id", "=", row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return project(updated);
    },
  );
}
export async function listPlannerItems(input: Context & { query: PlannerListQuery }) {
  return active(input, async (tx) => {
    let query = tx
      .selectFrom("application.planner_items")
      .selectAll()
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch);
    if (input.query.caseId) query = query.where("case_id", "=", input.query.caseId);
    if (input.query.kind) query = query.where("kind", "=", input.query.kind);
    if (input.query.status === "open") query = query.where("status", "!=", "done");
    else if (input.query.status !== "all") query = query.where("status", "=", input.query.status);
    const rows = await query
      .orderBy(sql`due_at ASC NULLS LAST`)
      .orderBy("created_at", "desc")
      .orderBy("id")
      .offset(input.query.offset)
      .limit(input.query.limit + 1)
      .execute();
    return PlannerListSchema.parse({
      items: rows.slice(0, input.query.limit).map(project),
      nextOffset: rows.length > input.query.limit ? input.query.offset + input.query.limit : null,
    });
  });
}
export async function erasePlannerReceipts(
  tx: Tx,
  ownerId: string,
  field: "id" | "caseId",
  value: string,
) {
  await sql`UPDATE application.planner_mutation_receipts SET result = jsonb_build_object('id', result->>'id', 'erased', true)
    WHERE owner_id = ${ownerId}::uuid AND result->>${field} = ${value}`.execute(tx);
}
export async function deletePlannerItem(
  input: Context & { itemId: string; expectedRevision: number; idempotencyKey: string },
) {
  return mutate(
    input,
    { action: "delete", id: input.itemId, expectedRevision: input.expectedRevision },
    async (tx) => {
      const row = await tx
        .selectFrom("application.planner_items")
        .select("revision")
        .where("id", "=", input.itemId)
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .executeTakeFirst();
      if (!row) throw missing();
      if (row.revision !== input.expectedRevision)
        throw new ServiceError(409, "PLANNER_REVISION_CONFLICT", "事项已更新，请刷新后删除。");
      await tx.deleteFrom("application.planner_items").where("id", "=", input.itemId).execute();
      await erasePlannerReceipts(tx, input.owner.ownerId, "id", input.itemId);
      return { id: input.itemId, deleted: true };
    },
  );
}

export function normalizeGraphScope(scope: JobGraphScope): JobGraphScope {
  return {
    ...scope,
    cities: [...new Set(scope.cities)].sort(),
    recruitmentTypes: [...new Set(scope.recruitmentTypes)].sort(),
    educationLevels: [...new Set(scope.educationLevels)].sort(),
  };
}
export async function saveSearch(
  input: Context & {
    request: {
      label: string;
      scope: JobGraphScope;
      dataset?: "public" | "private";
      catalogQuery?: unknown;
      subscription?: unknown;
    };
    idempotencyKey: string;
  },
) {
  const scope = normalizeGraphScope(input.request.scope);
  const dataset = input.request.dataset ?? "public";
  const catalogQuery = input.request.catalogQuery
    ? JobSearchQuerySchema.omit({ jobIds: true, cursor: true, limit: true }).parse(
        input.request.catalogQuery,
      )
    : undefined;
  if (catalogQuery && dataset !== "public")
    throw new ServiceError(422, "SAVED_SEARCH_DATASET_INVALID", "岗位目录筛选不能用于私有图谱。");
  const storedScope = {
    ...scope,
    __dataset: dataset,
    ...(catalogQuery ? { __catalogQuery: catalogQuery } : {}),
  };
  return mutate(
    input,
    { action: "save_search", request: { ...input.request, scope, dataset } },
    async (tx) => {
      const row = await tx
        .insertInto("application.saved_searches")
        .values({
          id: randomUUID(),
          owner_id: input.owner.ownerId,
          owner_epoch: input.owner.ownerEpoch,
          label: input.request.label,
          scope: json(storedScope),
          scope_hash: hashCanonicalJson(storedScope),
        })
        .onConflict((conflict) =>
          conflict
            .columns(["owner_id", "owner_epoch", "scope_hash"])
            .doUpdateSet({ label: input.request.label }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
      if(input.request.subscription) await setSubscription(tx,row.id,storedScope,input.request.subscription,true);
      const updated=await tx.selectFrom("application.saved_searches").selectAll().where("id","=",row.id).executeTakeFirstOrThrow();
      return SavedSearchSchema.parse({
        id: row.id,
        label: row.label,
        scope: row.scope,
        catalogQuery,
        dataset,
        createdAt: iso(row.created_at),
        revision: updated.revision,
        subscription: subscriptionFromRow(updated),
      });
    },
  );
}
export async function listSavedSearches(input: Context) {
  return active(input, async (tx) => {
    const rows = await tx
      .selectFrom("application.saved_searches")
      .selectAll()
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .orderBy("created_at", "desc")
      .execute();
    return SavedSearchListSchema.parse({
      items: rows.map((row) => ({
        id: row.id,
        label: row.label,
        scope: row.scope,
        catalogQuery: (row.scope as Record<string, unknown>).__catalogQuery,
        dataset: (row.scope as Record<string, unknown>).__dataset ?? "public",
        createdAt: iso(row.created_at),
        revision: row.revision,
        subscription: subscriptionFromRow(row),
      })),
    });
  });
}
export async function deleteSavedSearch(
  input: Context & { searchId: string; idempotencyKey: string },
) {
  return mutate(input, { action: "delete_search", id: input.searchId }, async (tx) => {
    await tx
      .deleteFrom("application.saved_searches")
      .where("id", "=", input.searchId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .execute();
    await erasePlannerReceipts(tx, input.owner.ownerId, "id", input.searchId);
    await syncDiscoveryDemand(tx);
    return { id: input.searchId, deleted: true };
  });
}

const icsEscape = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const icsTime = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
function foldIcs(line: string) {
  const lines: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > 75) {
      lines.push(current);
      current = " ";
    }
    current += char;
  }
  lines.push(current);
  return lines.join("\r\n");
}
export function plannerCalendar(items: PlannerItem[]) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Aijob//Application Planner//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const item of items.filter((value) => value.dueAt)) {
    if (item.kind === "interview" || item.kind === "exam") {
      lines.push(
        "BEGIN:VEVENT",
        `UID:planner-${item.id}@aijob.local`,
        `DTSTAMP:${icsTime(item.updatedAt)}`,
        `SEQUENCE:${item.revision}`,
        `DTSTART:${icsTime(item.dueAt as string)}`,
        `SUMMARY:${icsEscape(item.title)}`,
        `DESCRIPTION:${icsEscape(item.note)}`,
        "STATUS:CONFIRMED",
        `X-AIJOB-TASK-STATUS:${item.status.toUpperCase()}`,
        "END:VEVENT",
      );
      continue;
    }
    lines.push(
      "BEGIN:VTODO",
      `UID:planner-${item.id}@aijob.local`,
      `DTSTAMP:${icsTime(item.updatedAt)}`,
      `SEQUENCE:${item.revision}`,
      `DUE:${icsTime(item.dueAt as string)}`,
      `SUMMARY:${icsEscape(item.title)}`,
      `DESCRIPTION:${icsEscape(item.note)}`,
      `STATUS:${item.status === "done" ? "COMPLETED" : item.status === "doing" ? "IN-PROCESS" : "NEEDS-ACTION"}`,
      ...(item.completedAt ? [`COMPLETED:${icsTime(item.completedAt)}`] : []),
      "END:VTODO",
    );
  }
  return [...lines, "END:VCALENDAR"].map(foldIcs).join("\r\n") + "\r\n";
}
export async function exportPlannerCalendar(input: Context) {
  return active(input, async (tx) => {
    const rows = await tx
      .selectFrom("application.planner_items")
      .selectAll()
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("due_at", "is not", null)
      .orderBy("due_at")
      .orderBy("id")
      .execute();
    return plannerCalendar(rows.map(project));
  });
}
