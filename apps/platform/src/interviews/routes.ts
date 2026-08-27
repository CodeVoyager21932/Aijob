import {
  ConfirmCaseDebriefRequestSchema,
  CreateInterviewSessionRequestSchema,
  DeleteDebriefRequestSchema,
  DeleteInterviewSessionRequestSchema,
  ListInterviewSessionsQuerySchema,
  PrepareCaseDebriefRequestSchema,
  SubmitInterviewAnswerRequestSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { ServiceError } from "../lib/service-error.js";
import { deleteDebrief, deleteInterviewSession } from "../career-assets/deletion-service.js";
import { confirmCaseDebrief, getCaseDebrief, prepareCaseDebrief } from "./debrief-service.js";
import {
  createInterviewSession,
  getInterviewSession,
  listInterviewSessions,
  submitInterviewAnswer,
} from "./service.js";

const CaseParamsSchema = z.object({ caseId: z.string().uuid() }).strict();
const SessionParamsSchema = z
  .object({ caseId: z.string().uuid(), sessionId: z.string().uuid() })
  .strict();
const RootSessionParamsSchema = z.object({ sessionId: z.string().uuid() }).strict();
const DebriefParamsSchema = z.object({ debriefId: z.string().uuid() }).strict();
const IdempotencyKeySchema = z.string().trim().min(1).max(200);

function requireRouteParams<T>(
  schema: z.ZodType<T>,
  params: unknown,
  code: "APPLICATION_CASE_NOT_FOUND" | "INTERVIEW_SESSION_NOT_FOUND" | "DEBRIEF_NOT_FOUND",
  message: string,
): T {
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw new ServiceError(404, code, message);
  return parsed.data;
}

function requireCaseParams(params: unknown): z.infer<typeof CaseParamsSchema> {
  return requireRouteParams(
    CaseParamsSchema,
    params,
    "APPLICATION_CASE_NOT_FOUND",
    "记录不存在、已删除或不属于当前账户。",
  );
}

function requireSessionParams(params: unknown): z.infer<typeof SessionParamsSchema> {
  return requireRouteParams(
    SessionParamsSchema,
    params,
    "INTERVIEW_SESSION_NOT_FOUND",
    "面试记录不存在、已删除或不属于当前账户。",
  );
}

function requireIdempotencyKey(headers: Record<string, unknown>): string {
  const value = headers["idempotency-key"];
  if (typeof value !== "string") {
    throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "面试写操作必须提供请求编号。");
  }
  return IdempotencyKeySchema.parse(value);
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
      new ApiProblem(error.statusCode, error.code, "无法处理面试练习", error.message),
    );
  }
  if (error instanceof z.ZodError) {
    return sendApiProblem(
      request,
      reply,
      new ApiProblem(
        400,
        "INVALID_INTERVIEW_REQUEST",
        "面试练习请求格式不正确",
        "请刷新页面并检查游标、回答或请求编号后重试。",
      ),
    );
  }
  throw error;
}

export function registerInterviewRoutes(
  app: FastifyInstance,
  options: { db: Kysely<Database> },
): void {
  app.get("/v1/application-cases/:caseId/debrief", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = requireCaseParams(request.params);
      return reply.send(await getCaseDebrief({ db: options.db, owner, caseId }));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.put("/v1/application-cases/:caseId/debrief", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = requireCaseParams(request.params);
      const body = PrepareCaseDebriefRequestSchema.parse(request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers);
      const result = await prepareCaseDebrief({
        db: options.db,
        owner,
        caseId,
        request: body,
        idempotencyKey,
      });
      return reply.code(result.created ? 201 : 200).send(result);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/application-cases/:caseId/debrief/confirmations", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = requireCaseParams(request.params);
      const body = ConfirmCaseDebriefRequestSchema.parse(request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers);
      const result = await confirmCaseDebrief({
        db: options.db,
        owner,
        caseId,
        request: body,
        idempotencyKey,
      });
      return reply.code(result.created ? 201 : 200).send(result);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get("/v1/application-cases/:caseId/interview-sessions", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = requireCaseParams(request.params);
      const query = ListInterviewSessionsQuerySchema.parse(request.query);
      return reply.send(await listInterviewSessions({ db: options.db, owner, caseId, query }));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/application-cases/:caseId/interview-sessions", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId } = requireCaseParams(request.params);
      const body = CreateInterviewSessionRequestSchema.parse(request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers);
      return reply.code(201).send(
        await createInterviewSession({
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

  app.get("/v1/application-cases/:caseId/interview-sessions/:sessionId", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { caseId, sessionId } = requireSessionParams(request.params);
      const detail = await getInterviewSession({ db: options.db, owner, caseId, sessionId });
      if (!detail) {
        return sendApiProblem(
          request,
          reply,
          new ApiProblem(
            404,
            "INTERVIEW_SESSION_NOT_FOUND",
            "没有找到这次面试练习",
            "记录不存在、已删除或不属于当前用户。",
          ),
        );
      }
      return reply.send(detail);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post(
    "/v1/application-cases/:caseId/interview-sessions/:sessionId/answers",
    async (request, reply) => {
      try {
        const owner = requireOwnerContext(request);
        const { caseId, sessionId } = requireSessionParams(request.params);
        const body = SubmitInterviewAnswerRequestSchema.parse(request.body);
        const idempotencyKey = requireIdempotencyKey(request.headers);
        return reply.send(
          await submitInterviewAnswer({
            db: options.db,
            owner,
            caseId,
            sessionId,
            request: body,
            idempotencyKey,
          }),
        );
      } catch (error) {
        return handleError(error, request, reply);
      }
    },
  );

  app.delete("/v1/interview-sessions/:sessionId", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { sessionId } = requireRouteParams(
        RootSessionParamsSchema,
        request.params,
        "INTERVIEW_SESSION_NOT_FOUND",
        "面试记录不存在、已删除或不属于当前账户。",
      );
      const body = DeleteInterviewSessionRequestSchema.parse(request.body);
      return reply.send(
        await deleteInterviewSession({
          db: options.db,
          owner,
          sessionId,
          request: body,
        }),
      );
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.delete("/v1/debriefs/:debriefId", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { debriefId } = requireRouteParams(
        DebriefParamsSchema,
        request.params,
        "DEBRIEF_NOT_FOUND",
        "复盘记录不存在、已删除或不属于当前账户。",
      );
      const body = DeleteDebriefRequestSchema.parse(request.body);
      return reply.send(
        await deleteDebrief({
          db: options.db,
          owner,
          debriefId,
          request: body,
        }),
      );
    } catch (error) {
      return handleError(error, request, reply);
    }
  });
}
