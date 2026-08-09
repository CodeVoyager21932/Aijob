import {
  CreateResumeDocumentRequestSchema,
  CreateResumeReviewRequestSchema,
  DecideResumeReviewSuggestionRequestSchema,
  LegacyResumeDocumentSourceIdSchema,
  ListResumeDocumentsQuerySchema,
  PutResumeDocumentContentRevisionRequestSchema,
  PutResumeDocumentLayoutRevisionRequestSchema,
  ResumeDocumentIdSchema,
  ResumeDocumentRevisionPageQuerySchema,
  ResumeReviewSuggestionDecisionIdSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { ServiceError } from "../lib/service-error.js";
import {
  getLegacyResumeContentConversion,
  listResumeDocumentContentRevisions,
  listResumeDocumentLayoutRevisions,
  putResumeDocumentContentRevision,
  putResumeDocumentLayoutRevision,
} from "./revision-service.js";
import {
  createResumeReview,
  decideResumeReviewSuggestion,
  getCurrentResumeReview,
} from "./review-service.js";
import { createResumeDocument, getResumeDocument, listResumeDocuments } from "./service.js";

const IdempotencyKeySchema = z.string().trim().min(1).max(200);

function requireIdempotencyKey(headers: Record<string, unknown>): string {
  const rawIdempotencyKey = headers["idempotency-key"];
  if (typeof rawIdempotencyKey !== "string") {
    throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "创建简历文档必须提供请求编号。");
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
      new ApiProblem(error.statusCode, error.code, "无法处理简历文档", error.message),
    );
  }
  if (error instanceof z.ZodError) {
    return sendApiProblem(
      request,
      reply,
      new ApiProblem(
        400,
        "INVALID_RESUME_DOCUMENT_REQUEST",
        "简历文档请求格式不正确",
        "请刷新页面并检查文档、游标或请求编号后重试。",
      ),
    );
  }
  throw error;
}

export function registerResumeDocumentRoutes(
  app: FastifyInstance,
  options: { db: Kysely<Database> },
): void {
  app.get("/v1/resume-documents", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const query = ListResumeDocumentsQuerySchema.parse(request.query);
      return reply.send(await listResumeDocuments({ db: options.db, owner, query }));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/resume-documents", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const body = CreateResumeDocumentRequestSchema.parse(request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers);
      const result = await createResumeDocument({
        db: options.db,
        owner,
        request: body,
        idempotencyKey,
      });
      return reply.code(result.created ? 201 : 200).send(result);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get("/v1/resume-documents/legacy-source/:legacySourceRevisionId", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { legacySourceRevisionId } = LegacyResumeDocumentSourceIdSchema.parse(request.params);
      const conversion = await getLegacyResumeContentConversion({
        db: options.db,
        owner,
        legacySourceRevisionId,
      });
      if (!conversion) {
        return sendApiProblem(
          request,
          reply,
          new ApiProblem(
            404,
            "LEGACY_RESUME_SOURCE_NOT_FOUND",
            "没有找到该旧版简历来源",
            "记录不存在、不是当前最新版本或不属于当前账户。",
          ),
        );
      }
      return reply.send(conversion);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get("/v1/resume-documents/:documentId/revisions", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { documentId } = ResumeDocumentIdSchema.parse(request.params);
      const query = ResumeDocumentRevisionPageQuerySchema.parse(request.query);
      return reply.send(
        await listResumeDocumentContentRevisions({
          db: options.db,
          owner,
          documentId,
          query,
        }),
      );
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/resume-documents/:documentId/revisions", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { documentId } = ResumeDocumentIdSchema.parse(request.params);
      const body = PutResumeDocumentContentRevisionRequestSchema.parse(request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers);
      const result = await putResumeDocumentContentRevision({
        db: options.db,
        owner,
        documentId,
        request: body,
        idempotencyKey,
      });
      return reply.code(result.created ? 201 : 200).send(result);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get("/v1/resume-documents/:documentId/layout-revisions", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { documentId } = ResumeDocumentIdSchema.parse(request.params);
      const query = ResumeDocumentRevisionPageQuerySchema.parse(request.query);
      return reply.send(
        await listResumeDocumentLayoutRevisions({
          db: options.db,
          owner,
          documentId,
          query,
        }),
      );
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/resume-documents/:documentId/layout-revisions", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { documentId } = ResumeDocumentIdSchema.parse(request.params);
      const body = PutResumeDocumentLayoutRevisionRequestSchema.parse(request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers);
      const result = await putResumeDocumentLayoutRevision({
        db: options.db,
        owner,
        documentId,
        request: body,
        idempotencyKey,
      });
      return reply.code(result.created ? 201 : 200).send(result);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get("/v1/resume-documents/:documentId/review", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { documentId } = ResumeDocumentIdSchema.parse(request.params);
      return reply.send(await getCurrentResumeReview({ db: options.db, owner, documentId }));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/resume-documents/:documentId/reviews", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { documentId } = ResumeDocumentIdSchema.parse(request.params);
      const body = CreateResumeReviewRequestSchema.parse(request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers);
      const result = await createResumeReview({
        db: options.db,
        owner,
        documentId,
        request: body,
        idempotencyKey,
      });
      return reply.code(result.created ? 202 : 200).send(result);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post(
    "/v1/resume-documents/:documentId/reviews/:reviewRunId/suggestions/:suggestionId/decisions",
    async (request, reply) => {
      try {
        const owner = requireOwnerContext(request);
        const { documentId, reviewRunId, suggestionId } =
          ResumeReviewSuggestionDecisionIdSchema.parse(request.params);
        const body = DecideResumeReviewSuggestionRequestSchema.parse(request.body);
        return reply.send(
          await decideResumeReviewSuggestion({
            db: options.db,
            owner,
            documentId,
            reviewRunId,
            suggestionId,
            request: body,
          }),
        );
      } catch (error) {
        return handleError(error, request, reply);
      }
    },
  );

  app.get("/v1/resume-documents/:documentId", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { documentId } = ResumeDocumentIdSchema.parse(request.params);
      const resumeDocument = await getResumeDocument({ db: options.db, owner, documentId });
      if (!resumeDocument) {
        return sendApiProblem(
          request,
          reply,
          new ApiProblem(
            404,
            "RESUME_DOCUMENT_NOT_FOUND",
            "没有找到该简历文档",
            "记录不存在、已删除或不属于当前账户。",
          ),
        );
      }
      return reply.send(resumeDocument);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });
}
