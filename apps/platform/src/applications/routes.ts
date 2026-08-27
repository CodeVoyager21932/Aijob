import {
  ApplicationBoardQuerySchema,
  CreateApplicationCaseWithJobContextRequestSchema,
  CreateCaseQuestionRequestSchema,
  DeleteApplicationCaseRequestSchema,
  ListApplicationCaseEventsQuerySchema,
  ListApplicationCasesQuerySchema,
  PutCaseRequirementEvidenceLinksRequestSchema,
  PutCaseRequirementStateRequestSchema,
  RecordManualApplicationRequestSchema,
  TransitionApplicationCaseRequestSchema,
  UpdateCaseQuestionRequestSchema,
  UpgradeApplicationCaseJobVersionRequestSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { ServiceError } from "../lib/service-error.js";
import { deleteApplicationCase } from "../career-assets/deletion-service.js";
import {
  createApplicationCase,
  createApplicationCaseQuestion,
  getApplicationBoard,
  getApplicationCase,
  getApplicationCaseJobVersionDiff,
  getApplicationCaseRequirements,
  listApplicationCaseEvents,
  listApplicationCases,
  putApplicationCaseRequirementEvidenceLinks,
  putApplicationCaseRequirementState,
  recordManualApplication,
  transitionApplicationCase,
  updateApplicationCaseQuestion,
  upgradeApplicationCaseJobVersion,
} from "./service.js";

const ParamsSchema = z.object({ caseId: z.string().uuid() }).strict();
const RequirementParamsSchema = z
  .object({ caseId: z.string().uuid(), requirementId: z.string().min(1).max(200) })
  .strict();
const QuestionParamsSchema = z
  .object({ caseId: z.string().uuid(), questionId: z.string().uuid() })
  .strict();
const IdempotencyKeySchema = z.string().trim().min(1).max(200);

function requireCaseParams(params: unknown): z.infer<typeof ParamsSchema> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new ServiceError(
      404,
      "APPLICATION_CASE_NOT_FOUND",
      "记录不存在、已删除或不属于当前账户。",
    );
  }
  return parsed.data;
}

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

function handleBoardError(
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
        "INVALID_APPLICATION_BOARD_QUERY",
        "申请看板参数格式不正确",
        "请检查城市、排序或每列数量后重新加载。",
      ),
    );
  }
  return handleError(error, request, reply);
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

  app.get("/v1/application-cases/board", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const query = ApplicationBoardQuerySchema.parse(request.query);
      return reply.send(await getApplicationBoard({ db: options.db, owner, query }));
    } catch (error) {
      return handleBoardError(error, request, reply);
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
      const params = ParamsSchema.safeParse(request.params);
      if (!params.success) {
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
      const { caseId } = params.data;
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

  app.delete("/v1/application-cases/:caseId", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = requireCaseParams(request.params);
      const body = DeleteApplicationCaseRequestSchema.parse(request.body);
      return reply.send(
        await deleteApplicationCase({
          db: options.db,
          owner,
          caseId,
          request: body,
        }),
      );
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get("/v1/application-cases/:caseId/events", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = requireCaseParams(request.params);
      const query = ListApplicationCaseEventsQuerySchema.parse(request.query);
      return reply.send(await listApplicationCaseEvents({ db: options.db, owner, caseId, query }));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/application-cases/:caseId/manual-applications", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = requireCaseParams(request.params);
      const body = RecordManualApplicationRequestSchema.parse(request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers);
      return reply.send(
        await recordManualApplication({
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

  app.get("/v1/application-cases/:caseId/requirements", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = ParamsSchema.parse(request.params);
      return reply.send(await getApplicationCaseRequirements({ db: options.db, owner, caseId }));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.put("/v1/application-cases/:caseId/requirements/:requirementId", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId, requirementId } = RequirementParamsSchema.parse(request.params);
      const body = PutCaseRequirementStateRequestSchema.parse(request.body);
      return reply.send(
        await putApplicationCaseRequirementState({
          db: options.db,
          owner,
          caseId,
          requirementId,
          request: body,
        }),
      );
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.put(
    "/v1/application-cases/:caseId/requirements/:requirementId/evidence-links",
    async (request, reply) => {
      try {
        const owner = requireOwnerContext(request);
        const { caseId, requirementId } = RequirementParamsSchema.parse(request.params);
        const body = PutCaseRequirementEvidenceLinksRequestSchema.parse(request.body);
        return reply.send(
          await putApplicationCaseRequirementEvidenceLinks({
            db: options.db,
            owner,
            caseId,
            requirementId,
            request: body,
          }),
        );
      } catch (error) {
        return handleError(error, request, reply);
      }
    },
  );

  app.post("/v1/application-cases/:caseId/questions", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = ParamsSchema.parse(request.params);
      const body = CreateCaseQuestionRequestSchema.parse(request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers);
      return reply.send(
        await createApplicationCaseQuestion({
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

  app.put("/v1/application-cases/:caseId/questions/:questionId", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId, questionId } = QuestionParamsSchema.parse(request.params);
      const body = UpdateCaseQuestionRequestSchema.parse(request.body);
      return reply.send(
        await updateApplicationCaseQuestion({
          db: options.db,
          owner,
          caseId,
          questionId,
          request: body,
        }),
      );
    } catch (error) {
      return handleError(error, request, reply);
    }
  });
}
