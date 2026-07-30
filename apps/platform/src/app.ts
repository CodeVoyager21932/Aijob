import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import { ProblemDetailsSchema } from "@aijob/contracts";
import { checkDatabase, type Database } from "@aijob/database";
import Fastify, { type FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { ZodError, z } from "zod";
import { getInternalPreviewJob, listInternalPreviewJobs } from "./api/job-repository.js";
import { catalogRoutes } from "./catalog/routes.js";
import { registerDecisionRoutes } from "./decisions/routes.js";
import { installAnonymousIdentity } from "./identity/fastify.js";
import { isApiProblem, sendApiProblem } from "./identity/http.js";
import { registerInsightRoutes } from "./insights/routes.js";
import { sha256 } from "./lib/canonical-json.js";
import { registerMatchingRoutes } from "./matching/routes.js";
import { registerProfileRoutes } from "./profile/routes.js";
import { registerResumeRoutes } from "./resume/routes.js";
import { registerTailoringRoutes } from "./tailoring/routes.js";

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

  installAnonymousIdentity(app, {
    db: input.db,
    appEnv: input.config.appEnv,
    host: input.config.host,
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const ownerScopedPrefixes = [
      "/v1/profile",
      "/v1/resume-analyses",
      "/v1/match-runs",
      "/v1/recommendation-runs",
      "/v1/resume-tailorings",
      "/v1/resume-exports",
      "/v1/job-decisions",
      "/v1/job-insight-runs",
    ];
    if (ownerScopedPrefixes.some((prefix) => request.url.startsWith(prefix))) {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
    }
    reply.header("X-Content-Type-Options", "nosniff");
    return payload;
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

  app.register(catalogRoutes, {
    db: input.db,
    enableLocalMvp: input.config.enableLocalMvp,
  });
  registerResumeRoutes(app, {
    db: input.db,
    encryptionKey: input.config.resumeEncryptionKey,
    maxBytes: input.config.resumeMaxBytes,
    encryptionKeyVersion: "local-mvp-v1",
  });
  registerProfileRoutes(app, {
    db: input.db,
    appEnv: input.config.appEnv,
    deletionReceiptSecret: sha256(`${input.config.resumeEncryptionKey}:deletion-receipt-v1`),
  });
  registerMatchingRoutes(app, {
    db: input.db,
    enableLocalMvp: input.config.enableLocalMvp,
  });
  registerInsightRoutes(app, {
    db: input.db,
    enableLocalMvp: input.config.enableLocalMvp,
  });
  registerTailoringRoutes(app, { db: input.db, config: input.config });
  registerDecisionRoutes(app, { db: input.db });

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
        reply.type("application/problem+json");
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
    reply.type("application/problem+json");
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
    if (isApiProblem(error)) {
      return sendApiProblem(request, reply, error);
    }
    const validationError = error instanceof ZodError;
    const status = validationError ? 400 : 500;
    reply.type("application/problem+json");
    return reply.code(status).send(
      problem({
        status,
        code: validationError ? "INVALID_REQUEST" : "INTERNAL_ERROR",
        title: validationError ? "请求参数不正确" : "服务暂时不可用",
        detail: validationError
          ? "请检查参数格式后重试。"
          : "数据没有被修改，请稍后重试并提供关联编号。",
        correlationId: request.id,
        instance: request.url,
      }),
    );
  });

  return app;
}
