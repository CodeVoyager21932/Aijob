import { CreateJobInsightRunRequestSchema } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { ServiceError } from "../lib/service-error.js";
import { createJobInsightRun, getJobInsightRun } from "./service.js";

const ParamsSchema = z.object({ runId: z.string().uuid() });
const IdempotencyKeySchema = z.string().trim().min(1).max(200);

function handleError(
  error: unknown,
  request: Parameters<typeof sendApiProblem>[0],
  reply: Parameters<typeof sendApiProblem>[1],
) {
  if (error instanceof ServiceError) {
    return sendApiProblem(
      request,
      reply,
      new ApiProblem(error.statusCode, error.code, "无法生成岗位洞察", error.message),
    );
  }
  if (error instanceof z.ZodError) {
    return sendApiProblem(
      request,
      reply,
      new ApiProblem(
        400,
        "INVALID_INSIGHT_REQUEST",
        "洞察条件不正确",
        "请选择一个岗位方向后重试。",
      ),
    );
  }
  throw error;
}

export function registerInsightRoutes(
  app: FastifyInstance,
  options: { db: Kysely<Database>; enableLocalMvp: boolean },
): void {
  app.post("/v1/job-insight-runs", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const body = CreateJobInsightRunRequestSchema.parse(request.body);
      const idempotencyKey = IdempotencyKeySchema.parse(request.headers["idempotency-key"]);
      const run = await createJobInsightRun({
        db: options.db,
        owner,
        request: body,
        idempotencyKey,
        enableLocalMvp: options.enableLocalMvp,
      });
      return reply.code(201).send(run);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get("/v1/job-insight-runs/:runId", async (request, reply) => {
    const owner = requireOwnerContext(request);
    const { runId } = ParamsSchema.parse(request.params);
    const run = await getJobInsightRun({ db: options.db, owner, runId });
    if (!run) {
      return sendApiProblem(
        request,
        reply,
        new ApiProblem(
          404,
          "INSIGHT_RUN_NOT_FOUND",
          "没有找到这次岗位洞察",
          "记录不存在、已删除或不属于当前会话。",
        ),
      );
    }
    return reply.send(run);
  });
}
