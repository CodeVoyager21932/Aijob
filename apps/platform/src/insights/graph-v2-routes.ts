import { JOB_SEMANTICS_V2, JobGraphScopeSchema } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { ServiceError } from "../lib/service-error.js";
import { getDirectionsV2, getEvidenceV2, getGraphV2 } from "./graph-v2.js";
import { compareExperiencesV2, getPrivateDirectionsV2, getPrivateEvidenceV2, getPrivateGraphV2 } from "./private-graph-v2.js";

export function registerGraphV2Routes(app: FastifyInstance, options: { db: Kysely<Database>; enableLocalMvp: boolean }) {
  const query = z.object({ scope: z.string().max(4000).default("{}").transform((s) => JobGraphScopeSchema.parse(JSON.parse(s))) });
  const evidenceQuery = query.extend({ key: z.string().min(1).max(250), offset: z.coerce.number().int().min(0).max(1000000).default(0), limit: z.coerce.number().int().min(1).max(50).default(20) });
  const error = (e: unknown, request: Parameters<typeof sendApiProblem>[0], reply: Parameters<typeof sendApiProblem>[1]) => {
    if (e instanceof ServiceError) return sendApiProblem(request, reply, new ApiProblem(e.statusCode, e.code, "无法读取方向", e.message));
    if (e instanceof z.ZodError || e instanceof SyntaxError) return sendApiProblem(request, reply, new ApiProblem(400, "INVALID_GRAPH_SCOPE", "条件不正确", "请检查方向与筛选条件。"));
    throw e;
  };
  for (const dataset of ["public", "private"] as const) {
    const base = dataset === "private" ? "/v2/private-job-graph" : "/v2/job-graph";
    for (const view of ["", "/directions", "/evidence"] as const) app.get(`${base}${view}`, async (request, reply) => {
      try {
        reply.header("Cache-Control", "no-store");
        if (view === "/evidence") {
          const input = { db: options.db, ...evidenceQuery.parse(request.query) };
          return dataset === "private" ? await getPrivateEvidenceV2({ ...input, owner: requireOwnerContext(request) }) : await getEvidenceV2({ ...input, local: options.enableLocalMvp });
        }
        const input = { db: options.db, ...query.parse(request.query) };
        if (dataset === "private") {
          const privateInput = { ...input, owner: requireOwnerContext(request) };
          return view === "/directions" ? await getPrivateDirectionsV2(privateInput) : await getPrivateGraphV2(privateInput);
        }
        const shared = { ...input, local: options.enableLocalMvp };
        return view === "/directions" ? await getDirectionsV2(shared) : await getGraphV2(shared);
      } catch (e) { return error(e, request, reply); }
    });
  }
  app.post("/v2/job-graph/personal-comparison", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const body = z.object({ scope: JobGraphScopeSchema, dataset: z.enum(["public", "private"]).default("public"), key: z.string().min(1).max(250), extractionVersion: z.literal(JOB_SEMANTICS_V2) }).parse(request.body);
      const graph = body.dataset === "private" ? await getPrivateGraphV2({ db: options.db, owner, scope: body.scope }) : await getGraphV2({ db: options.db, scope: body.scope, local: options.enableLocalMvp });
      const item = graph.groups.flatMap((g) => g.items).find((i) => i.key === body.key);
      if (!item) throw new ServiceError(404, "GRAPH_REQUIREMENT_NOT_FOUND", "当前范围已无此要求，请刷新方向。");
      reply.header("Cache-Control", "no-store");
      return await compareExperiencesV2({ db: options.db, owner, item });
    } catch (e) { return error(e, request, reply); }
  });
}
