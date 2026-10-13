import {
  CreateMaterialSnippetRequestSchema,
  UpdateMaterialSnippetRequestSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { ServiceError } from "../lib/service-error.js";
import {
  createMaterialSnippet,
  updateMaterialSnippet,
  listMaterialSnippets,
  deleteMaterialSnippet,
} from "./material-snippets.js";
import {
  listSubmittedMaterials,
  exportSubmittedMaterial,
  deleteSubmittedMaterial,
} from "../applications/submitted-materials.js";
import type { PdfRuntimeConfig } from "./pdf-service.js";
export function registerMaterialRoutes(
  app: FastifyInstance,
  options: { db: Kysely<Database>; pdfRuntime?: PdfRuntimeConfig; encryptionKey?: string | undefined },
) {
  const context = (request: FastifyRequest) => ({
    db: options.db,
    owner: requireOwnerContext(request),
  });
  const key = (request: FastifyRequest) =>
    z.string().min(1).max(200).parse(request.headers["idempotency-key"]);
  const snippetId = (request: FastifyRequest) =>
    z.object({ id: z.string().uuid() }).parse(request.params).id;
  const boundary =
    (action: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return await action(request, reply);
      } catch (error) {
        if (error instanceof ServiceError)
          return sendApiProblem(
            request,
            reply,
            new ApiProblem(error.statusCode, error.code, "材料操作未完成", error.message),
          );
        throw error;
      }
    };
  app.get(
    "/v1/material-snippets",
    boundary(async (request) =>
      listMaterialSnippets({
        ...context(request),
        ...z
          .object({
            offset: z.coerce.number().int().min(0).max(100000).default(0),
            limit: z.coerce.number().int().min(1).max(100).default(50),
          })
          .parse(request.query),
      }),
    ),
  );
  app.post(
    "/v1/material-snippets",
    boundary(async (request, reply) =>
      reply.code(201).send(
        await createMaterialSnippet({
          ...context(request),
          request: CreateMaterialSnippetRequestSchema.parse(request.body),
          idempotencyKey: key(request),
        }),
      ),
    ),
  );
  app.put(
    "/v1/material-snippets/:id",
    boundary(async (request) =>
      updateMaterialSnippet({
        ...context(request),
        snippetId: snippetId(request),
        request: UpdateMaterialSnippetRequestSchema.parse(request.body),
        idempotencyKey: key(request),
      }),
    ),
  );
  app.delete(
    "/v1/material-snippets/:id",
    boundary(async (request) =>
      deleteMaterialSnippet({
        ...context(request),
        snippetId: snippetId(request),
        ...z.object({ expectedRevision: z.number().int().positive() }).parse(request.body),
        idempotencyKey: key(request),
      }),
    ),
  );
  const caseParams = z.object({ caseId: z.string().uuid() });
  const materialParams = caseParams.extend({ materialId: z.string().uuid() });
  app.get(
    "/v1/application-cases/:caseId/submitted-materials",
    boundary(async (request) =>
      listSubmittedMaterials({ ...context(request), ...caseParams.parse(request.params) }),
    ),
  );
  app.delete(
    "/v1/application-cases/:caseId/submitted-materials/:materialId",
    boundary(async (request) =>
      deleteSubmittedMaterial({
        ...context(request),
        ...materialParams.parse(request.params),
        idempotencyKey: key(request),
      }),
    ),
  );
  for (const format of ["pdf", "docx"] as const)
    app.get(
      `/v1/application-cases/:caseId/submitted-materials/:materialId/${format}`,
      boundary(async (request, reply) => {
        const result = await exportSubmittedMaterial({
          ...context(request),
          ...materialParams.parse(request.params),
          format,
          encryptionKey: options.encryptionKey,
          ...(options.pdfRuntime ? { runtime: options.pdfRuntime } : {}),
        });
        return reply
          .type(result.mediaType)
          .header(
            "Content-Disposition",
            `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
          )
          .send(result.buffer);
      }),
    );
}
