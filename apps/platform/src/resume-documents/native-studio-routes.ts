import type { Database } from "@aijob/database";
import { parseNativeResumeDocument } from "@aijob/resume-core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { ServiceError } from "../lib/service-error.js";
import { ResumeInputError } from "../resume/security.js";
import { downloadResumeExport } from "./export-artifacts.js";
import {
  checkpointNativeDraft,
  listNativeSnapshots,
  loadNativeSnapshot,
} from "./native-checkpoint.js";
import {
  listNativeExperiences,
  listReusableNativeExperiences,
  updateNativeExperience,
} from "./native-experiences.js";
import { createNativeExport } from "./native-export.js";
import { createNativePreview } from "./native-preview.js";
import { getNativeImport, listNativeImports, queueNativeImport } from "./native-import.js";
import {
  createNativeStudioDraft,
  getNativeStudioDraft,
  saveNativeStudioDraft,
} from "./native-studio-service.js";
import { createResumeDocument } from "./service.js";
import { nativeTemplatePreferences, setNativeTemplatePreference } from "./template-library.js";

/** Native editor, immutable previews, originals and retained downloads. */
export function registerNativeStudioRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  encryptionKey: string,
  useStudioTemplates = true,
) {
  const route =
    (handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return await handler(req, reply);
      } catch (error) {
        if (error instanceof ResumeInputError)
          return sendApiProblem(
            req,
            reply,
            new ApiProblem(422, error.code, "导入未完成", error.message),
          );
        if (error instanceof ServiceError)
          return sendApiProblem(
            req,
            reply,
            new ApiProblem(error.statusCode, error.code, "保存未完成", error.message),
          );
        if (
          error instanceof z.ZodError ||
          (error instanceof Error &&
            (error.name === "ZodError" || error.message.startsWith("NATIVE_")))
        )
          return sendApiProblem(
            req,
            reply,
            new ApiProblem(
              422,
              "INVALID_NATIVE_RESUME",
              "内容需要调整",
              "内容未通过新版结构校验，当前输入仍保留。",
            ),
          );
        throw error;
      }
    };
  const key = (req: FastifyRequest) =>
    z.string().min(1).max(160).parse(req.headers["idempotency-key"]);
  const id = (req: FastifyRequest) =>
    z.object({ documentId: z.string().uuid() }).parse(req.params).documentId;
  app.get(
    "/v2/native-template-preferences",
    route(async (req) => nativeTemplatePreferences(db, requireOwnerContext(req))),
  );
  app.put(
    "/v2/native-template-preferences",
    route(async (req) =>
      setNativeTemplatePreference(db, requireOwnerContext(req), req.body, key(req)),
    ),
  );
  app.post(
    "/v2/resume-documents/:documentId/native/imports/text",
    route(async (req, reply) => {
      const body = z
        .object({
          text: z.string().min(1).max(100000),
          expectedRevision: z.number().int().positive(),
        })
        .strict()
        .parse(req.body);
      return reply.code(202).send(
        await queueNativeImport(
          db,
          requireOwnerContext(req),
          id(req),
          {
            filename: "粘贴的简历.txt",
            mediaType: "text/plain",
            buffer: Buffer.from(body.text, "utf8"),
            encryptionKey,
            expectedRevision: body.expectedRevision,
            kind: "text",
          },
          key(req),
        ),
      );
    }),
  );
  app.get(
    "/v2/native-experiences",
    route(async (req) => {
      const query = z
        .object({ includeLegacy: z.enum(["true", "false"]).optional() })
        .parse(req.query);
      return query.includeLegacy === "true"
        ? listReusableNativeExperiences(db, requireOwnerContext(req))
        : listNativeExperiences(db, requireOwnerContext(req));
    }),
  );
  app.put(
    "/v2/native-experiences/:experienceId",
    route(async (req) => {
      const params = z.object({ experienceId: z.string().uuid() }).parse(req.params);
      const body = z
        .object({ expectedRevision: z.number().int().positive(), experience: z.unknown() })
        .strict()
        .parse(req.body);
      return updateNativeExperience(
        db,
        requireOwnerContext(req),
        params.experienceId,
        body.expectedRevision,
        body.experience,
      );
    }),
  );
  app.post(
    "/v2/resume-documents/:documentId/native/imports",
    route(async (req, reply) => {
      const { expectedRevision } = z
        .object({ expectedRevision: z.coerce.number().int().positive() })
        .strict()
        .parse(req.query);
      const file = await req.file({
        limits: { files: 1, fileSize: 5 * 1024 * 1024, fields: 0, parts: 1 },
      });
      if (!file) throw new ServiceError(400, "RESUME_FILE_REQUIRED", "请选择 PDF 或 DOCX 文件。");
      const buffer = await file.toBuffer();
      return reply.code(202).send(
        await queueNativeImport(
          db,
          requireOwnerContext(req),
          id(req),
          {
            filename: file.filename,
            mediaType: file.mimetype,
            buffer,
            encryptionKey,
            expectedRevision,
          },
          key(req),
        ),
      );
    }),
  );
  app.get(
    "/v2/resume-documents/:documentId/native/imports",
    route(async (req) => listNativeImports(db, requireOwnerContext(req), id(req))),
  );
  app.get(
    "/v2/resume-documents/:documentId/native/imports/:originalId",
    route(async (req) => {
      const params = z
        .object({ documentId: z.string().uuid(), originalId: z.string().uuid() })
        .parse(req.params);
      return getNativeImport(db, requireOwnerContext(req), params.documentId, params.originalId);
    }),
  );
  app.post(
    "/v2/resume-documents/:documentId/native/copies",
    route(async (req) => {
      const body = z
        .object({
          title: z.string().trim().min(1).max(200),
          contentRevisionId: z.string().uuid(),
          layoutRevisionId: z.string().uuid(),
        })
        .strict()
        .parse(req.body);
      const owner = requireOwnerContext(req),
        sourceId = id(req);
      await loadNativeSnapshot(db, owner, sourceId, body);
      const created = await createResumeDocument({
        db,
        owner,
        idempotencyKey: `native-copy:${key(req)}`,
        request: {
          kind: "base",
          title: body.title,
          copyFrom: {
            documentId: sourceId,
            contentRevisionId: body.contentRevisionId,
            layoutRevisionId: body.layoutRevisionId,
          },
        },
      });
      return getNativeStudioDraft(db, owner, created.resumeDocument.id);
    }),
  );
  app.get(
    "/v2/resume-documents/:documentId/native/versions",
    route(async (req) => listNativeSnapshots(db, requireOwnerContext(req), id(req))),
  );
  app.get(
    "/v2/resume-documents/:documentId/native/version",
    route(async (req) => {
      const pair = z
        .object({ contentRevisionId: z.string().uuid(), layoutRevisionId: z.string().uuid() })
        .strict()
        .parse(req.query);
      return loadNativeSnapshot(db, requireOwnerContext(req), id(req), pair);
    }),
  );
  app.post(
    "/v2/resume-documents/:documentId/native/checkpoint",
    route(async (req) => {
      const { expectedRevision } = z
        .object({ expectedRevision: z.number().int().min(1) })
        .strict()
        .parse(req.body);
      return checkpointNativeDraft(db, requireOwnerContext(req), id(req), expectedRevision);
    }),
  );
  app.post(
    "/v2/resume-documents/:documentId/native/preview",
    route(async (req) => {
      const body = z.object({
        expectedDraftRevision: z.number().int().positive(),
        requestGeneration: z.number().int().nonnegative(),
      }).strict().parse(req.body);
      return createNativePreview({ db, owner: requireOwnerContext(req), documentId: id(req),
        ...body, idempotencyKey: `preview:${key(req)}`, encryptionKey });
    }),
  );
  app.post(
    "/v2/resume-documents/:documentId/native/exports",
    route(async (req) => {
      const request = z
        .object({
          format: z.enum(["pdf", "docx"]),
          contentRevisionId: z.string().uuid(),
          layoutRevisionId: z.string().uuid(),
        })
        .strict()
        .parse(req.body);
      return createNativeExport({
        db,
        owner: requireOwnerContext(req),
        documentId: id(req),
        request,
        idempotencyKey: `native:${key(req)}`,
        encryptionKey,
      });
    }),
  );
  app.get(
    "/v2/resume-exports/:artifactId/file",
    route(async (req, reply) => {
      const { artifactId } = z.object({ artifactId: z.string().uuid() }).parse(req.params);
      const { preview } = z.object({ preview: z.enum(["true", "false"]).optional() }).parse(req.query);
      const file = await downloadResumeExport(
        db,
        requireOwnerContext(req),
        artifactId,
        encryptionKey,
        { preview: preview === "true" },
      );
      return reply
        .type(file.mediaType)
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        )
        .send(file.buffer);
    }),
  );
  app.post(
    "/v2/resume-documents/native",
    route(async (req) => {
      const body = z
        .object({
          title: z.string().trim().min(1).max(200),
          experienceIds: z.array(z.string().uuid()).max(50).optional(),
        })
        .strict()
        .parse(req.body);
      return createNativeStudioDraft(
        db,
        requireOwnerContext(req),
        body.title,
        key(req),
        body.experienceIds,
        useStudioTemplates,
      );
    }),
  );
  app.get(
    "/v2/resume-documents/:documentId/native",
    route(async (req) => getNativeStudioDraft(db, requireOwnerContext(req), id(req))),
  );
  app.put(
    "/v2/resume-documents/:documentId/native",
    route(async (req) => {
      const request = z
        .object({
          expectedRevision: z.number().int().min(0),
          title: z.string().min(1).max(200),
          document: z.unknown(),
        })
        .strict()
        .parse(req.body);
      return saveNativeStudioDraft(
        db,
        requireOwnerContext(req),
        id(req),
        { ...request, document: parseNativeResumeDocument(request.document) },
        key(req),
      );
    }),
  );
}
