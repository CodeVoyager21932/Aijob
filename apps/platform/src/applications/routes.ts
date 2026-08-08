import {
  CreateApplicationCaseWithJobContextRequestSchema,
  ListApplicationCasesQuerySchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { ServiceError } from "../lib/service-error.js";
import { createApplicationCase, getApplicationCase, listApplicationCases } from "./service.js";

const ParamsSchema = z.object({ caseId: z.string().uuid() }).strict();
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
      const rawIdempotencyKey = request.headers["idempotency-key"];
      if (typeof rawIdempotencyKey !== "string") {
        throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "创建求职项目时必须提供请求编号。");
      }
      const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
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
}
