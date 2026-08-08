import {
  CreateApplicationCaseWithJobContextRequestSchema,
  ListApplicationCasesQuerySchema,
  TransitionApplicationCaseRequestSchema,
  UpgradeApplicationCaseJobVersionRequestSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { ServiceError } from "../lib/service-error.js";
import {
  createApplicationCase,
  getApplicationCase,
  getApplicationCaseJobVersionDiff,
  listApplicationCases,
  transitionApplicationCase,
  upgradeApplicationCaseJobVersion,
} from "./service.js";

const ParamsSchema = z.object({ caseId: z.string().uuid() }).strict();
const IdempotencyKeySchema = z.string().trim().min(1).max(200);

function requireIdempotencyKey(headers: Record<string, unknown>): string {
  const rawIdempotencyKey = headers["idempotency-key"];
  if (typeof rawIdempotencyKey !== "string") {
    throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "该求职项目操作必须提供请求编号。");
  }
  return IdempotencyKeySchema.parse(rawIdempotencyKey);
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
      new ApiProblem(error.statusCode, error.code, "无法处理求职项目", error.message),
    );
  }
  if (error instanceof z.ZodError) {
    return sendApiProblem(
      request,
      reply,
      new ApiProblem(
        400,
        "INVALID_APPLICATION_CASE_REQUEST",
        "求职项目请求格式不正确",
        "请刷新页面并检查岗位、游标或请求编号后重试。",
      ),
    );
  }
  throw error;
}

export function registerApplicationCaseRoutes(
  app: FastifyInstance,
  options: { db: Kysely<Database>; enableLocalMvp: boolean },
): void {
  app.get("/v1/application-cases", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const query = ListApplicationCasesQuerySchema.parse(request.query);
      return reply.send(await listApplicationCases({ db: options.db, owner, query }));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/application-cases", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const body = CreateApplicationCaseWithJobContextRequestSchema.parse(request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers);
      const result = await createApplicationCase({
        db: options.db,
        owner,
        request: body,
        idempotencyKey,
        enableLocalMvp: options.enableLocalMvp,
      });
      return reply.code(result.created ? 201 : 200).send(result);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get("/v1/application-cases/:caseId", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = ParamsSchema.parse(request.params);
      const applicationCase = await getApplicationCase({ db: options.db, owner, caseId });
      if (!applicationCase) {
        return sendApiProblem(
          request,
          reply,
          new ApiProblem(
            404,
            "APPLICATION_CASE_NOT_FOUND",
            "没有找到该求职项目",
            "记录不存在、已删除或不属于当前账户。",
          ),
        );
      }
      return reply.send(applicationCase);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/application-cases/:caseId/transitions", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = ParamsSchema.parse(request.params);
      const body = TransitionApplicationCaseRequestSchema.parse(request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers);
      return reply.send(
        await transitionApplicationCase({
          db: options.db,
          owner,
          caseId,
          request: body,
          idempotencyKey,
        }),
      );
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get("/v1/application-cases/:caseId/job-version-diff", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = ParamsSchema.parse(request.params);
      return reply.send(
        await getApplicationCaseJobVersionDiff({
          db: options.db,
          owner,
          caseId,
          enableLocalMvp: options.enableLocalMvp,
        }),
      );
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/application-cases/:caseId/job-version-upgrades", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = ParamsSchema.parse(request.params);
      const body = UpgradeApplicationCaseJobVersionRequestSchema.parse(request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers);
      return reply.send(
        await upgradeApplicationCaseJobVersion({
          db: options.db,
          owner,
          caseId,
          request: body,
          idempotencyKey,
          enableLocalMvp: options.enableLocalMvp,
        }),
      );
    } catch (error) {
      return handleError(error, request, reply);
    }
  });
}
