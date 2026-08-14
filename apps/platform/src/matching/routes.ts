import {
  CreateCaseMatchRunRequestSchema,
  CreateMatchRunRequestSchema,
  CreateRecommendationRunFromSearchRequestSchema,
  CreateRecommendationRunRequestSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { ServiceError } from "../lib/service-error.js";
import {
  enqueueCaseMatchRun,
  enqueueMatchRun,
  enqueueRecommendationRun,
  enqueueRecommendationRunFromSearch,
  getCaseMatchState,
  getMatchRun,
  getRecommendationRun,
  getRecommendationRunView,
} from "./service.js";

const ParamsSchema = z.object({ runId: z.string().trim().min(1) });
const CaseParamsSchema = z.object({ caseId: z.string().uuid() }).strict();
const IdempotencyKeySchema = z.string().trim().min(1).max(200);

function idempotencyKey(headers: Record<string, unknown>): string {
  return IdempotencyKeySchema.parse(headers["idempotency-key"]);
}

function handleError(
  error: unknown,
  request: Parameters<typeof sendApiProblem>[0],
  reply: Parameters<typeof sendApiProblem>[1],
) {
  if (error instanceof ServiceError) {
    return sendApiProblem(
      request,
      reply,
      new ApiProblem(error.statusCode, error.code, "无法完成匹配请求", error.message),
    );
  }
  if (error instanceof z.ZodError) {
    return sendApiProblem(
      request,
      reply,
      new ApiProblem(
        400,
        "INVALID_MATCH_REQUEST",
        "匹配请求格式不正确",
        "请检查岗位、画像修订和 Idempotency-Key 后重试。",
      ),
    );
  }
  throw error;
}

function handleRecommendationScopeError(
  error: unknown,
  request: Parameters<typeof sendApiProblem>[0],
  reply: Parameters<typeof sendApiProblem>[1],
) {
  if (error instanceof z.ZodError) {
    return sendApiProblem(
      request,
      reply,
      new ApiProblem(
        400,
        "INVALID_RECOMMENDATION_SCOPE",
        "推荐筛选条件格式不正确",
        "请检查岗位筛选条件后重试。",
      ),
    );
  }
  return handleError(error, request, reply);
}

export function registerMatchingRoutes(
  app: FastifyInstance,
  options: { db: Kysely<Database>; enableLocalMvp: boolean },
): void {
  app.get("/v1/application-cases/:caseId/match-state", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = CaseParamsSchema.parse(request.params);
      const result = await getCaseMatchState(options.db, owner, caseId, {
        enableLocalMvp: options.enableLocalMvp,
      });
      return reply.send(result);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/application-cases/:caseId/match-runs", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = CaseParamsSchema.parse(request.params);
      const body = CreateCaseMatchRunRequestSchema.parse(request.body);
      const result = await enqueueCaseMatchRun(
        options.db,
        owner,
        caseId,
        body.expectedCaseRevision,
        idempotencyKey(request.headers),
        { enableLocalMvp: options.enableLocalMvp },
      );
      return reply.code(202).send(result);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/match-runs", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const body = CreateMatchRunRequestSchema.parse(request.body);
      const result = await enqueueMatchRun(
        options.db,
        owner,
        body,
        idempotencyKey(request.headers),
        { enableLocalMvp: options.enableLocalMvp },
      );
      return reply.code(202).send(result);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get("/v1/match-runs/:runId", async (request, reply) => {
    const owner = requireOwnerContext(request);
    const { runId } = ParamsSchema.parse(request.params);
    const result = await getMatchRun(options.db, owner, runId, {
      enableLocalMvp: options.enableLocalMvp,
    });
    if (!result) {
      return sendApiProblem(
        request,
        reply,
        new ApiProblem(
          404,
          "MATCH_RUN_NOT_FOUND",
          "没有找到这次匹配",
          "任务不存在、已被删除，或不属于当前匿名会话。",
        ),
      );
    }
    return reply.send(result);
  });

  app.post("/v1/recommendation-runs", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const body = CreateRecommendationRunRequestSchema.parse(request.body);
      const result = await enqueueRecommendationRun(
        options.db,
        owner,
        body,
        idempotencyKey(request.headers),
        { enableLocalMvp: options.enableLocalMvp },
      );
      return reply.code(202).send(result);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/recommendation-runs/from-search", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const body = CreateRecommendationRunFromSearchRequestSchema.parse(request.body);
      const result = await enqueueRecommendationRunFromSearch(
        options.db,
        owner,
        body,
        idempotencyKey(request.headers),
        { enableLocalMvp: options.enableLocalMvp },
      );
      return reply.code(202).send(result);
    } catch (error) {
      return handleRecommendationScopeError(error, request, reply);
    }
  });

  app.get("/v1/recommendation-runs/:runId", async (request, reply) => {
    const owner = requireOwnerContext(request);
    const { runId } = ParamsSchema.parse(request.params);
    const result = await getRecommendationRun(options.db, owner, runId, {
      enableLocalMvp: options.enableLocalMvp,
    });
    if (!result) {
      return sendApiProblem(
        request,
        reply,
        new ApiProblem(
          404,
          "RECOMMENDATION_RUN_NOT_FOUND",
          "没有找到这次岗位推荐",
          "任务不存在、已被删除，或不属于当前匿名会话。",
        ),
      );
    }
    return reply.send(result);
  });

  app.get("/v1/recommendation-runs/:runId/view", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { runId } = ParamsSchema.parse(request.params);
      const result = await getRecommendationRunView(options.db, owner, runId, {
        enableLocalMvp: options.enableLocalMvp,
      });
      if (!result) {
        return sendApiProblem(
          request,
          reply,
          new ApiProblem(
            404,
            "RECOMMENDATION_RUN_NOT_FOUND",
            "没有找到这次岗位推荐",
            "任务不存在、已被删除，或不属于当前匿名会话。",
          ),
        );
      }
      return reply.send(result);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });
}
