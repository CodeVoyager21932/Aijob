import {
  CreatePlannerItemRequestSchema,
  UpdatePlannerItemRequestSchema,
  DeletePlannerItemRequestSchema,
  PlannerListQuerySchema,
  SaveSearchRequestSchema,
  UpdateOpportunitySubscriptionSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { ServiceError } from "../lib/service-error.js";
import { updateSubscription } from "../opportunities/subscriptions.js";
import { listOpportunityDigests, markDigestRead } from "../opportunities/digests.js";
import { getDiscoveryStatus } from "../opportunities/discovery.js";
import { readOpportunitySettings } from "../opportunities/local-settings.js";
import { readLocalRefreshControl } from "../sources/local-refresh-control.js";
import type { AppConfig } from "@aijob/config";
import { sql } from "kysely";
import {
  createPlannerItem,
  updatePlannerItem,
  listPlannerItems,
  deletePlannerItem,
  saveSearch,
  listSavedSearches,
  deleteSavedSearch,
  exportPlannerCalendar,
} from "./service.js";

const key = (request: FastifyRequest) =>
  z.string().trim().min(1).max(200).parse(request.headers["idempotency-key"]);
const id = (request: FastifyRequest) =>
  z.object({ id: z.string().uuid() }).parse(request.params).id;
function boundary(action: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    try {
      return await action(request, reply);
    } catch (error) {
      if (error instanceof ServiceError)
        return sendApiProblem(
          request,
          reply,
          new ApiProblem(error.statusCode, error.code, "无法处理个人事项", error.message),
        );
      throw error;
    }
  };
}
export function registerPlannerRoutes(
  app: FastifyInstance,
  options: {
    db: Kysely<Database>;
    local: boolean;
    discovery?: { enabled: boolean; apiKey?: string | undefined };
    config?: AppConfig;
  },
) {
  const context = (request: FastifyRequest) => ({
    db: options.db,
    owner: requireOwnerContext(request),
  });
  app.get(
    "/v1/planner-items",
    boundary(async (request) =>
      listPlannerItems({ ...context(request), query: PlannerListQuerySchema.parse(request.query) }),
    ),
  );
  app.post(
    "/v1/planner-items",
    boundary(async (request, reply) =>
      reply.code(201).send(
        await createPlannerItem({
          ...context(request),
          local: options.local,
          request: CreatePlannerItemRequestSchema.parse(request.body),
          idempotencyKey: key(request),
        }),
      ),
    ),
  );
  app.put(
    "/v1/planner-items/:id",
    boundary(async (request) =>
      updatePlannerItem({
        ...context(request),
        local: options.local,
        itemId: id(request),
        request: UpdatePlannerItemRequestSchema.parse(request.body),
        idempotencyKey: key(request),
      }),
    ),
  );
  app.delete(
    "/v1/planner-items/:id",
    boundary(async (request) =>
      deletePlannerItem({
        ...context(request),
        itemId: id(request),
        ...DeletePlannerItemRequestSchema.parse(request.body),
        idempotencyKey: key(request),
      }),
    ),
  );
  app.get(
    "/v1/planner-calendar.ics",
    boundary(async (request, reply) =>
      reply
        .type("text/calendar; charset=utf-8")
        .header("Content-Disposition", 'attachment; filename="aijob-calendar.ics"')
        .send(await exportPlannerCalendar(context(request))),
    ),
  );
  app.get(
    "/v1/saved-searches",
    boundary(async (request) => listSavedSearches(context(request))),
  );
  app.patch(
    "/v1/saved-searches/:id",
    boundary(async (request) =>
      updateSubscription({
        ...context(request),
        searchId: id(request),
        request: UpdateOpportunitySubscriptionSchema.parse(request.body),
        idempotencyKey: key(request),
      }),
    ),
  );
  app.get(
    "/v1/opportunity-digests",
    boundary(async (request) =>
      listOpportunityDigests({
        ...context(request),
        local: options.local,
        ...z
          .object({ offset: z.coerce.number().int().min(0).max(1000000).default(0) })
          .parse(request.query),
      }),
    ),
  );
  app.patch(
    "/v1/opportunity-digests/:id",
    boundary(async (request) => markDigestRead({ ...context(request), id: id(request) })),
  );
  app.get(
    "/v1/opportunity-discovery/status",
    boundary(async (request) => {
      const owner = requireOwnerContext(request);
      const runtime = options.config
        ? readOpportunitySettings(options.config)
        : {
            enabled: options.discovery?.enabled ?? false,
            apiKey: options.discovery?.apiKey ?? "",
            sourceNetworkEnabled: false,
          };
      const status = await getDiscoveryStatus(options.db, new Date(), runtime);
      const recent = await sql<{
        last_search_at: Date | null;
        next_search_at: Date | null;
        last_search_status: string | null;
        last_digest_at: Date | null;
        next_digest_at: Date | null;
      }>`
      SELECT max(q.last_success_at) last_search_at,
        min(q.next_due_at) FILTER(WHERE s.discovery_enabled) next_search_at,
        (array_agg(q.last_status ORDER BY q.updated_at DESC) FILTER(WHERE q.query_hash IS NOT NULL))[1] last_search_status,
        (SELECT max(d.created_at) FROM application.opportunity_digests d WHERE d.owner_id=${owner.ownerId}::uuid AND d.owner_epoch=${owner.ownerEpoch}) last_digest_at,
        min(s.next_digest_at) FILTER(WHERE s.digest_enabled) next_digest_at
      FROM application.saved_searches s LEFT JOIN source_control.discovery_queries q ON q.query_hash=s.discovery_query_hash
      WHERE s.owner_id=${owner.ownerId}::uuid AND s.owner_epoch=${owner.ownerEpoch}
    `.execute(options.db);
      const local = options.config?.appEnv === "local";
      const row = recent.rows[0];
      const personal = options.config ? await userDiscoverySettings(options.db,owner,options.config) : null;
      const personalSettings = personal?.settings;
      return {
        ...status,
        setupUrl: local ? "http://127.0.0.1:8091/discovery-setup" : null,
        sourceRefresh:
          local && options.config
            ? {
                enabled: readLocalRefreshControl(options.config.workspaceRoot).enabled,
                networkEnabled: runtime.sourceNetworkEnabled,
              }
            : null,
        lastSearchAt: row?.last_search_at?.toISOString() ?? null,
        nextSearchAt:
          runtime.enabled && runtime.apiKey ? (row?.next_search_at?.toISOString() ?? null) : null,
        lastSearchStatus: row?.last_search_status ?? null,
        lastDigestAt: row?.last_digest_at?.toISOString() ?? null,
        nextDigestAt: row?.next_digest_at?.toISOString() ?? null,
        ...(personalSettings && personal ? {
          provider:personalSettings.mode,configured:personalSettings.mode==="existing_sources" || personalSettings.keyConfigured,
          enabled:personalSettings.mode!=="existing_sources" && personalSettings.capability==="ready",
          ...personal.usage,capability:personalSettings.capability,capabilityCode:personalSettings.capabilityCode,
          lastSearchAt:personalSettings.lastSearchAt,nextSearchAt:personalSettings.nextSearchAt,lastSearchStatus:personalSettings.lastSearchStatus,
          setupUrl:null,notice:personalSettings.mode==="existing_sources"?"只刷新已接入来源，不使用外部搜索。":personalSettings.capability==="ready"?"已连接搜索。新网站先核验，已启用来源继续刷新。":"搜索连接需要检查；已接来源刷新与摘要仍可使用。",
        } : {}),
      };
    }),
  );
  app.post(
    "/v1/saved-searches",
    boundary(async (request, reply) =>
      reply.code(201).send(
        await saveSearch({
          ...context(request),
          request: SaveSearchRequestSchema.parse(request.body),
          idempotencyKey: key(request),
        }),
      ),
    ),
  );
  app.delete(
    "/v1/saved-searches/:id",
    boundary(async (request) =>
      deleteSavedSearch({
        ...context(request),
        searchId: id(request),
        idempotencyKey: key(request),
      }),
    ),
  );
}
import { userDiscoverySettings } from "../opportunities/user-discovery-settings.js";
