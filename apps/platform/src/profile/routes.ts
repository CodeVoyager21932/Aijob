import type { AppEnvironment } from "@aijob/config";
import {
  normalizeCityPreferences,
  PutJobPreferencesRequestSchema,
  PutProfileFactsRequestSchema,
  PutResumeEvidenceRequestSchema,
  PutSavedResumeEvidenceSelectionRequestSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { clearIdentityCookies, requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, isApiProblem, sendApiProblem } from "../identity/http.js";
import {
  createDeletionReceipt,
  getOwnerDeletionByReceipt,
  requestOwnerDeletion,
} from "./deletion-service.js";
import {
  getCurrentJobPreferences,
  getCurrentProfileFacts,
  getCurrentResumeDocument,
  getCurrentResumeEvidence,
  putJobPreferences,
  putProfileFacts,
  putResumeEvidence,
  putSavedResumeEvidenceSelection,
} from "./revision-repository.js";

export const DELETION_RECEIPT_COOKIE_NAME = "aijob_deletion_receipt";

export interface ProfileRouteOptions {
  db: Kysely<Database>;
  appEnv: AppEnvironment;
  deletionReceiptSecret: string;
}

function cookieSecure(appEnv: AppEnvironment): boolean {
  return appEnv === "alpha" || appEnv === "production";
}

async function handleMutationError(
  error: unknown,
  request: Parameters<typeof sendApiProblem>[0],
  reply: Parameters<typeof sendApiProblem>[1],
) {
  if (isApiProblem(error)) return sendApiProblem(request, reply, error);
  if (error instanceof z.ZodError) {
    return sendApiProblem(
      request,
      reply,
      new ApiProblem(
        400,
        "INVALID_PROFILE_REVISION",
        "资料格式不正确",
        "请检查确认项后重新提交，未确认内容不会参与匹配。",
      ),
    );
  }
  throw error;
}

export function registerProfileRoutes(app: FastifyInstance, options: ProfileRouteOptions): void {
  app.get("/v1/profile/facts", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      return reply.send(
        (await getCurrentProfileFacts({ db: options.db, ownerId: owner.ownerId })) ?? {
          revision: 0,
          facts: [],
        },
      );
    } catch (error) {
      return handleMutationError(error, request, reply);
    }
  });
  app.put("/v1/profile/facts", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const body = PutProfileFactsRequestSchema.parse(request.body);
      return reply.send(await putProfileFacts({ db: options.db, owner, ...body }));
    } catch (error) {
      return handleMutationError(error, request, reply);
    }
  });

  app.get("/v1/profile/preferences", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      return reply.send(
        (await getCurrentJobPreferences({ db: options.db, ownerId: owner.ownerId })) ?? {
          revision: 0,
          preferences: null,
        },
      );
    } catch (error) {
      return handleMutationError(error, request, reply);
    }
  });
  app.put("/v1/profile/preferences", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const body = PutJobPreferencesRequestSchema.parse(request.body);
      const normalizedCities = normalizeCityPreferences(body.preferences.cities);
      if (normalizedCities.mixedUnlimitedValue) {
        throw new ApiProblem(
          422,
          "CITY_PREFERENCE_AMBIGUOUS",
          "不限城市不能和具体城市同时选择",
          "请选择“不限城市”，或只保留希望优先考虑的具体城市。",
        );
      }
      return reply.send(
        await putJobPreferences({
          db: options.db,
          owner,
          ...body,
          preferences: { ...body.preferences, cities: normalizedCities.cities },
        }),
      );
    } catch (error) {
      return handleMutationError(error, request, reply);
    }
  });

  app.get("/v1/profile/evidence", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      return reply.send(
        (await getCurrentResumeEvidence({ db: options.db, ownerId: owner.ownerId })) ?? {
          revision: 0,
          resumeAnalysisId: null,
          schemaVersion: "resume-evidence-v2",
          documentRevisionId: null,
          evidence: [],
        },
      );
    } catch (error) {
      return handleMutationError(error, request, reply);
    }
  });

  app.get("/v1/profile/document", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      return reply.send({
        document: await getCurrentResumeDocument({ db: options.db, ownerId: owner.ownerId }),
      });
    } catch (error) {
      return handleMutationError(error, request, reply);
    }
  });

  app.put("/v1/profile/evidence-selection", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const body = PutSavedResumeEvidenceSelectionRequestSchema.parse(request.body);
      return reply.send(await putSavedResumeEvidenceSelection({ db: options.db, owner, ...body }));
    } catch (error) {
      return handleMutationError(error, request, reply);
    }
  });

  app.put("/v1/profile/evidence", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const body = PutResumeEvidenceRequestSchema.parse(request.body);
      return reply.send(await putResumeEvidence({ db: options.db, owner, ...body }));
    } catch (error) {
      return handleMutationError(error, request, reply);
    }
  });

  app.delete("/v1/profile", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const result = await requestOwnerDeletion({ db: options.db, owner });
      const receipt = createDeletionReceipt(
        {
          deletionId: result.deletion.id,
          ownerId: owner.ownerId,
          requestedOwnerEpoch: result.requestedOwnerEpoch,
        },
        options.deletionReceiptSecret,
      );
      clearIdentityCookies(reply, options.appEnv);
      reply.setCookie(DELETION_RECEIPT_COOKIE_NAME, receipt, {
        path: "/v1/profile/deletion",
        httpOnly: true,
        sameSite: "strict",
        secure: cookieSecure(options.appEnv),
        maxAge: 7 * 24 * 60 * 60,
      });
      request.ownerContext = null;
      return reply.code(202).send(result.deletion);
    } catch (error) {
      return handleMutationError(error, request, reply);
    }
  });

  app.get("/v1/profile/deletion", async (request, reply) => {
    const receipt = request.cookies[DELETION_RECEIPT_COOKIE_NAME];
    if (!receipt) {
      return sendApiProblem(
        request,
        reply,
        new ApiProblem(
          404,
          "DELETION_STATUS_NOT_FOUND",
          "没有可查询的删除任务",
          "删除回执不存在或已过期。",
        ),
      );
    }
    const deletion = await getOwnerDeletionByReceipt({
      db: options.db,
      receipt,
      receiptSecret: options.deletionReceiptSecret,
    });
    if (!deletion) {
      return sendApiProblem(
        request,
        reply,
        new ApiProblem(
          404,
          "DELETION_STATUS_NOT_FOUND",
          "没有可查询的删除任务",
          "删除回执无效、已过期，或任务不存在。",
        ),
      );
    }
    return reply.send(deletion);
  });
}
