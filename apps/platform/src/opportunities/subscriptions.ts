import {
  JOB_FAMILY_NAMES,
  JobSearchQuerySchema,
  OpportunitySubscriptionSchema,
  SavedSearchSchema,
  type UpdateOpportunitySubscription,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";
import type { OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { mutatePersonalAsset } from "../planner/service.js";

type Db = Kysely<Database> | Transaction<Database>;
export function subscriptionFromRow(row: {
  discovery_enabled?: boolean;
  digest_enabled?: boolean;
  digest_time?: string;
}) {
  return OpportunitySubscriptionSchema.parse({
    discoveryEnabled: row.discovery_enabled ?? false,
    digestEnabled: row.digest_enabled ?? false,
    digestTime: row.digest_time ?? "09:00",
  });
}
export function discoveryQueries(scope: Record<string, unknown>) {
  const q = JobSearchQuerySchema.parse(
    scope.__catalogQuery ?? { cities: scope.cities, educationLevels: scope.educationLevels },
  );
  const keyword = q.keyword?.normalize("NFKC").trim().slice(0, 120) ?? "";
  const family = [...new Set(q.jobFamilies ?? [])]
    .sort()
    .map((f) => JOB_FAMILY_NAMES[f])
    .filter((f) => !keyword.includes(f));
  const cities = [...new Set(q.cities ?? [])].sort();
  return (cities.length ? cities : [""]).map((city) => {
    const batches = (q.recruitmentBatches ?? []).filter((value) => !keyword.includes(value));
    const text = [keyword, ...family, ...batches, city, "招聘 官网"]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .slice(0, 500);
    return { text, hash: hashCanonicalJson({ version: "opportunity-discovery-v2", text }) };
  });
}
export function discoveryQuery(scope: Record<string, unknown>) {
  return discoveryQueries(scope)[0]!;
}
export function nextDigestTime(now: Date, time: string): Date {
  const date = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const candidate = new Date(`${date}T${time}:00+08:00`);
  if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate;
}
export async function setSubscription(
  db: Db,
  id: string,
  scope: Record<string, unknown>,
  value: unknown,
  bumpRevision: boolean,
) {
  const subscription = OpportunitySubscriptionSchema.parse(value);
  if (
    scope.__dataset === "private" &&
    (subscription.digestEnabled || subscription.discoveryEnabled)
  )
    throw new ServiceError(
      422,
      "SUBSCRIPTION_DATASET_INVALID",
      "私有图谱不能订阅官网岗位，请在发现机会中保存筛选。",
    );
  const query = discoveryQuery(scope);
  if (subscription.discoveryEnabled)
    await sql`INSERT INTO source_control.discovery_queries(query_hash,query_text) VALUES(${query.hash},${query.text}) ON CONFLICT(query_hash) DO UPDATE SET enabled=true`.execute(
      db,
    );
  await sql`UPDATE application.saved_searches SET discovery_enabled=${subscription.discoveryEnabled}, digest_enabled=${subscription.digestEnabled}, digest_time=${subscription.digestTime},
    discovery_query_hash=${subscription.discoveryEnabled ? query.hash : null},
    next_digest_at=CASE WHEN ${subscription.digestEnabled} THEN now() ELSE NULL END,
    revision=revision+${bumpRevision ? 1 : 0} WHERE id=${id}::uuid`.execute(db);
  await syncDiscoveryDemand(db);
}
export async function syncDiscoveryDemand(db: Db) {
  await sql`UPDATE source_control.discovery_queries q SET enabled=EXISTS(SELECT 1 FROM source_control.legacy_discovery_demand s WHERE s.discovery_query_hash=q.query_hash)`.execute(
    db,
  );
}
export async function updateSubscription(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  searchId: string;
  request: UpdateOpportunitySubscription;
  idempotencyKey: string;
}) {
  return mutatePersonalAsset(
    input,
    { action: "update_subscription", id: input.searchId, request: input.request },
    async (tx) => {
      const row = await tx
        .selectFrom("application.saved_searches")
        .selectAll()
        .where("id", "=", input.searchId)
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .forUpdate()
        .executeTakeFirst();
      if (!row) throw new ServiceError(404, "SAVED_SEARCH_NOT_FOUND", "筛选不存在或已删除。");
      if (row.revision !== input.request.expectedRevision)
        throw new ServiceError(409, "SUBSCRIPTION_REVISION_CONFLICT", "订阅已改变，请刷新后重试。");
      const { expectedRevision: _, label, catalogQuery, ...changes } = input.request;
      const scope = { ...(row.scope as Record<string, unknown>) };
      if (catalogQuery) {
        if (scope.__dataset === "private")
          throw new ServiceError(
            422,
            "SUBSCRIPTION_DATASET_INVALID",
            "私有图谱不能改为官网岗位查询。",
          );
        scope.__catalogQuery = catalogQuery;
        const hash = hashCanonicalJson(scope);
        const duplicate = await tx
          .selectFrom("application.saved_searches")
          .select("id")
          .where("owner_id", "=", input.owner.ownerId)
          .where("owner_epoch", "=", input.owner.ownerEpoch)
          .where("scope_hash", "=", hash)
          .where("id", "!=", row.id)
          .executeTakeFirst();
        if (duplicate)
          throw new ServiceError(
            409,
            "SUBSCRIPTION_ALREADY_EXISTS",
            "这组方向已有订阅，请编辑对应订阅。",
          );
        await tx
          .updateTable("application.saved_searches")
          .set({ scope: JSON.stringify(scope), scope_hash: hash })
          .where("id", "=", row.id)
          .execute();
      }
      if (label)
        await tx
          .updateTable("application.saved_searches")
          .set({ label })
          .where("id", "=", row.id)
          .execute();
      await setSubscription(tx, row.id, scope, { ...subscriptionFromRow(row), ...changes }, true);
      const updated = await tx
        .selectFrom("application.saved_searches")
        .selectAll()
        .where("id", "=", row.id)
        .executeTakeFirstOrThrow();
      return SavedSearchSchema.parse({
        id: updated.id,
        label: updated.label,
        scope: updated.scope,
        catalogQuery: (updated.scope as Record<string, unknown>).__catalogQuery,
        dataset: (updated.scope as Record<string, unknown>).__dataset ?? "public",
        createdAt: new Date(updated.created_at).toISOString(),
        revision: updated.revision,
        subscription: subscriptionFromRow(updated),
      });
    },
  );
}
