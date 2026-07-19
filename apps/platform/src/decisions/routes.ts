import { PutJobDecisionRequestSchema } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { ServiceError } from "../lib/service-error.js";
import { listJobDecisions, markOfficialLinkOpened, putJobDecision } from "./service.js";

const ParamsSchema = z.object({ jobId: z.string().trim().min(1) });

function handleError(
  error: unknown,
  request: Parameters<typeof sendApiProblem>[0],
  reply: Parameters<typeof sendApiProblem>[1],
) {
  if (error instanceof ServiceError) {
    return sendApiProblem(
      request,
      reply,
      new ApiProblem(error.statusCode, error.code, "无法更新岗位状态", error.message),
    );
  }
  if (error instanceof z.ZodError) {
    return sendApiProblem(
      request,
      reply,
      new ApiProblem(
        400,
        "INVALID_JOB_DECISION",
        "岗位状态格式不正确",
        "请刷新页面并重新选择保存、准备投递、已投递或已放弃。",
      ),
    );
  }
  throw error;
}

export function registerDecisionRoutes(
  app: FastifyInstance,
  options: { db: Kysely<Database> },
): void {
  app.get("/v1/job-decisions", async (request, reply) => {
    const owner = requireOwnerContext(request);
    return reply.send(await listJobDecisions(options.db, owner));
  });

  app.put("/v1/job-decisions/:jobId", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { jobId } = ParamsSchema.parse(request.params);
      const body = PutJobDecisionRequestSchema.parse(request.body);
      return reply.send(await putJobDecision(options.db, owner, jobId, body));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/job-decisions/:jobId/official-link-opened", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { jobId } = ParamsSchema.parse(request.params);
      await markOfficialLinkOpened(options.db, owner, jobId);
      return reply.code(204).send();
    } catch (error) {
      return handleError(error, request, reply);
    }
  });
}
