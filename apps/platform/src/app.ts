import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import { ProblemDetailsSchema } from "@aijob/contracts";
import { checkDatabase, type Database } from "@aijob/database";
import Fastify, { type FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { ZodError, z } from "zod";
import {
  getInternalPreviewJob,
  getPublishedJob,
  listInternalPreviewJobs,
  listPublishedJobs,
} from "./api/job-repository.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const jobParamsSchema = z.object({
  jobId: z.string().uuid(),
});

function problem(input: {
  status: number;
  code: string;
  title: string;
  correlationId: string;
  detail?: string;
  instance?: string;
}) {
  return ProblemDetailsSchema.parse({
    type: `https://aijob.local/problems/${input.code.toLowerCase()}`,
    ...input,
  });
}

export function buildApp(input: { config: AppConfig; db: Kysely<Database> }): FastifyInstance {
  const app = Fastify({
    logger: { level: input.config.logLevel },
    genReqId: () => randomUUID(),
    disableRequestLogging: true,
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await checkDatabase(input.db);
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  app.get("/v1/jobs", async (_request, reply) => {
    return reply.send(await listPublishedJobs());
  });
  app.get("/v1/jobs/:jobId", async (request, reply) => {
    const { jobId } = jobParamsSchema.parse(request.params);
    const result = await getPublishedJob();
    if (!result) {
      return reply.code(404).send(
        problem({
          status: 404,
          code: "JOB_NOT_FOUND",
          title: "没有找到该岗位",
          detail: "该岗位不存在，或尚未通过正式发布复核。",
          correlationId: request.id,
          instance: `/v1/jobs/${jobId}`,
        }),
      );
    }
    return reply.send(result);
  });

  if (
    input.config.enableInternalPreview &&
    (input.config.appEnv === "local" || input.config.appEnv === "test")
  ) {
    app.get("/v1/internal-preview/jobs", async (request, reply) => {
      const { limit } = listQuerySchema.parse(request.query);
      return reply.send(await listInternalPreviewJobs(input.db, limit));
    });
    app.get("/v1/internal-preview/jobs/:jobId", async (request, reply) => {
      const { jobId } = jobParamsSchema.parse(request.params);
      const result = await getInternalPreviewJob(input.db, jobId);
      if (!result) {
        return reply.code(404).send(
          problem({
            status: 404,
            code: "PREVIEW_JOB_NOT_FOUND",
            title: "没有找到这条内部预览岗位",
            detail: "岗位不存在，或它不在当前本地预览范围内。",
            correlationId: request.id,
            instance: `/v1/internal-preview/jobs/${jobId}`,
          }),
        );
      }
      return reply.send(result);
    });
  }

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send(
      problem({
        status: 404,
        code: "ROUTE_NOT_FOUND",
        title: "接口不存在",
        detail: "请检查请求路径；内部预览接口只会在本地环境注册。",
        correlationId: request.id,
        instance: request.url,
      }),
    );
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, correlationId: request.id }, "request failed");
    const validationError = error instanceof ZodError;
    const status = validationError ? 400 : 500;
    return reply.code(status).send(
      problem({
        status,
        code: validationError ? "INVALID_REQUEST" : "INTERNAL_ERROR",
        title: validationError ? "请求参数不正确" : "服务暂时不可用",
        detail: validationError
          ? "请检查参数格式后重试。"
          : "岗位数据没有被修改，请稍后重试并提供关联编号。",
        correlationId: request.id,
        instance: request.url,
      }),
    );
  });

  return app;
}
