import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import { ProblemDetailsSchema } from "@aijob/contracts";
import { checkDatabase, type Database } from "@aijob/database";
import Fastify, { type FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { ZodError, z } from "zod";
import { registerAssistantRoutes } from "./ai/assistant-routes.js";
import { registerUserAiRoutes } from "./ai/user-ai-routes.js";
import { getInternalPreviewJob, listInternalPreviewJobs } from "./api/job-repository.js";
import { registerApplicationCaseRoutes } from "./applications/routes.js";
import { registerBookmarkRoutes } from "./catalog/bookmarks.js";
import { registerRecruitmentPlanRoutes } from "./catalog/recruitment-plan-routes.js";
import { catalogRoutes } from "./catalog/routes.js";
import { registerDecisionRoutes } from "./decisions/routes.js";
import {
  DisabledEmailVerificationDelivery,
  FixtureEmailVerificationDelivery,
} from "./identity/email-delivery.js";
import { installAnonymousIdentity } from "./identity/fastify.js";
import { isApiProblem, sendApiProblem } from "./identity/http.js";
import { SmtpEmailVerificationDelivery } from "./identity/smtp-delivery.js";
import { registerInsightRoutes } from "./insights/routes.js";
import { registerInterviewRoutes } from "./interviews/routes.js";
import { sha256 } from "./lib/canonical-json.js";
import { registerMatchingRoutes } from "./matching/routes.js";
import { registerUserDiscoveryRoutes } from "./opportunities/user-discovery-routes.js";
import { registerPlannerRoutes } from "./planner/routes.js";
import { registerProfileRoutes } from "./profile/routes.js";
import { registerResumeRoutes } from "./resume/routes.js";
import { registerMaterialRoutes } from "./resume-documents/material-routes.js";
import { registerNativeStudioRoutes } from "./resume-documents/native-studio-routes.js";
import { registerResumeDocumentRoutes } from "./resume-documents/routes.js";
import { registerResumeStudioRoutes } from "./resume-documents/studio-routes.js";
import { builtinSourceCatalog } from "./sources/builtin-catalog.js";
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

  const emailDelivery =
    input.config.identity.emailDeliveryMode === "fixture"
      ? new FixtureEmailVerificationDelivery()
      : input.config.identity.emailDeliveryMode === "smtp" && input.config.identity.smtp
        ? new SmtpEmailVerificationDelivery(input.config.identity.smtp)
        : new DisabledEmailVerificationDelivery();
  installAnonymousIdentity(app, {
    db: input.db,
    appEnv: input.config.appEnv,
    host: input.config.host,
    acceptedOrigins: input.config.identity.acceptedOrigins,
    identityMasterKey:
      input.config.identity.masterKey ??
      sha256(`${input.config.resumeEncryptionKey}:identity-master-v1`),
    invitedEmailHashes: input.config.identity.invitedEmailHashes ?? [],
    emailDelivery,
    ...(input.config.identity.fixtureVerificationCode
      ? { fixedVerificationCode: input.config.identity.fixtureVerificationCode }
      : {}),
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const ownerScopedPrefixes = [
      "/v2/private-job-graph",
      "/v2/job-graph/personal-comparison",
      "/v1/profile",
      "/v1/resume-analyses",
      "/v1/resume-documents",
      "/v1/material-snippets",
      "/v1/match-runs",
      "/v1/recommendation-runs",
      "/v1/resume-tailorings",
      "/v1/resume-exports",
      "/v1/job-decisions",
      "/v1/job-insight-runs",
      "/v1/job-graph/personal-comparison",
      "/v1/private-job-graph",
      "/v1/planner-",
      "/v1/saved-searches",
      "/v1/application-cases",
      "/v1/session",
      "/v1/email-verification-challenges",
    ];
    if (ownerScopedPrefixes.some((prefix) => request.url.startsWith(prefix))) {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
    }
    reply.header("X-Content-Type-Options", "nosniff");
    return payload;
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  if (input.config.appEnv === "local")
    app.get("/v1/local-source-catalog", () => builtinSourceCatalog(input.config.workspaceRoot));
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
  registerResumeDocumentRoutes(app, {
    encryptionKey: input.config.resumeEncryptionKey,
    db: input.db,
    reviewV2WriteEnabled: input.config.resumeReviewV2WriteEnabled,
    ...(input.config.pdfRuntime ? { pdfRuntime: input.config.pdfRuntime } : {}),
  });
  registerResumeStudioRoutes(app, { db: input.db, config: input.config });
  if (input.config.appEnv === "local" || input.config.appEnv === "test")
    registerNativeStudioRoutes(
      app,
      input.db,
      input.config.resumeEncryptionKey,
      input.config.nativeStudioTemplatesEnabled,
    );
  registerAssistantRoutes(app, { db: input.db, config: input.config });
  registerUserAiRoutes(app, input);
  registerUserDiscoveryRoutes(app, input);
  registerBookmarkRoutes(app, input);
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
  registerApplicationCaseRoutes(app, {
    encryptionKey: input.config.resumeEncryptionKey,
    db: input.db,
    enableLocalMvp: input.config.enableLocalMvp,
  });
  registerInterviewRoutes(app, { db: input.db });
  registerPlannerRoutes(app, {
    db: input.db,
    local: input.config.enableLocalMvp,
    config: input.config,
    ...(input.config.opportunityDiscovery ? { discovery: input.config.opportunityDiscovery } : {}),
  });
  registerMaterialRoutes(app, {
    db: input.db,
    encryptionKey: input.config.resumeEncryptionKey,
    ...(input.config.pdfRuntime ? { pdfRuntime: input.config.pdfRuntime } : {}),
  });
  registerRecruitmentPlanRoutes(app, { db: input.db, local: input.config.enableLocalMvp });

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
