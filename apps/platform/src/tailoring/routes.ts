import type { AppConfig } from "@aijob/config";
import {
  CreateResumeTailoringRequestSchema,
  PutTailoringSegmentRequestSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { ServiceError } from "../lib/service-error.js";
import {
  downloadResumeExport,
  enqueueResumeExport,
  enqueueTailoringRun,
  getResumeExport,
  getTailoringRun,
  updateTailoringSegment,
} from "./service.js";

const RunParamsSchema = z.object({ runId: z.string().trim().min(1) });
const SegmentParamsSchema = RunParamsSchema.extend({
  segmentId: z.string().trim().min(1),
});
const ExportParamsSchema = z.object({ exportId: z.string().trim().min(1) });
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
      new ApiProblem(error.statusCode, error.code, "无法完成简历优化请求", error.message),
    );
  }
  if (error instanceof z.ZodError) {
    return sendApiProblem(
      request,
      reply,
      new ApiProblem(
        400,
        "INVALID_TAILORING_REQUEST",
        "简历优化请求格式不正确",
        "请检查岗位、证据修订、隐私同意和 Idempotency-Key 后重试。",
      ),
    );
  }
  throw error;
}

export function registerTailoringRoutes(
  app: FastifyInstance,
  options: { db: Kysely<Database>; config: AppConfig },
): void {
  app.post("/v1/resume-tailorings", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const body = CreateResumeTailoringRequestSchema.parse(request.body);
      const result = await enqueueTailoringRun(
        options.db,
        options.config,
        owner,
        body,
        idempotencyKey(request.headers),
      );
      return reply.code(202).send(result);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get("/v1/resume-tailorings/:runId", async (request, reply) => {
    const owner = requireOwnerContext(request);
    const { runId } = RunParamsSchema.parse(request.params);
    const result = await getTailoringRun(options.db, owner, runId);
    if (!result) {
      return sendApiProblem(
        request,
        reply,
        new ApiProblem(
          404,
          "TAILORING_RUN_NOT_FOUND",
          "没有找到这次简历优化",
          "任务不存在、已被删除，或不属于当前匿名会话。",
        ),
      );
    }
    return reply.send(result);
  });

  app.put("/v1/resume-tailorings/:runId/segments/:segmentId", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { runId, segmentId } = SegmentParamsSchema.parse(request.params);
      const body = PutTailoringSegmentRequestSchema.parse(request.body);
      return reply.send(await updateTailoringSegment(options.db, owner, runId, segmentId, body));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v1/resume-tailorings/:runId/exports", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { runId } = RunParamsSchema.parse(request.params);
      const result = await enqueueResumeExport(
        options.db,
        options.config,
        owner,
        runId,
        idempotencyKey(request.headers),
      );
      return reply.code(202).send(result);
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get("/v1/resume-exports/:exportId", async (request, reply) => {
    const owner = requireOwnerContext(request);
    const { exportId } = ExportParamsSchema.parse(request.params);
    const result = await getResumeExport(options.db, owner, exportId);
    if (!result) {
      return sendApiProblem(
        request,
        reply,
        new ApiProblem(
          404,
          "RESUME_EXPORT_NOT_FOUND",
          "没有找到这次简历导出",
          "导出不存在、已过期，或不属于当前匿名会话。",
        ),
      );
    }
    return reply.send(result);
  });

  app.get("/v1/resume-exports/:exportId/file", async (request, reply) => {
    const owner = requireOwnerContext(request);
    const { exportId } = ExportParamsSchema.parse(request.params);
    const result = await downloadResumeExport(options.db, options.config, owner, exportId);
    if (!result) {
      return sendApiProblem(
        request,
        reply,
        new ApiProblem(
          404,
          "RESUME_EXPORT_FILE_NOT_AVAILABLE",
          "导出文件暂不可用",
          "文件尚未生成、已过期，或不属于当前匿名会话。",
        ),
      );
    }
    return reply
      .header("Content-Type", result.mediaType)
      .header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      )
      .header("Cache-Control", "no-store")
      .send(result.buffer);
  });
}
