import { randomUUID } from "node:crypto";
import {
  CreateResumeStudioSchema,
  SaveResumeStudioDraftSchema,
  ResumeStudioEntrySchema,
  ResumeSectionKindSchema,
  ResumeStudioContentSchema,
  ResumeStudioLayoutSchema,
  blankResumeStudioContent,
  RESUME_TEMPLATES,
  RESUME_TEMPLATE_SOURCES,
  CreateResumeExportSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { AppConfig } from "@aijob/config";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import {
  assertActiveOwnerEpoch,
  retainOwnerAssetsAfterMaterialSave,
  type OwnerScope,
} from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";
import { validateResumeUpload, ResumeInputError } from "../resume/security.js";
import {
  createStudioDocument,
  getStudioDraft,
  saveStudioDraft,
  saveStudioDraftInTransaction,
  checkpointStudioDraft,
  listExperiences,
  updateExperience,
  studioJson,
  studioMissing,
} from "./studio-service.js";
import {
  createStudioImport,
  applyStudioParsedOriginal,
  listStudioOriginals,
  downloadStudioOriginal,
} from "./studio-import.js";
import { experienceCaptureHash, importStudioText, studioFromLegacy } from "./studio-content.js";
import { semanticContent } from "./export-service.js";
import { templatePreferences, setTemplatePreference, uploadResumePhoto, readResumePhoto, deleteResumePhoto } from './template-library.js';
import { createResumeExport, getResumeExport, listResumeExports, deleteResumeExport } from './export-artifacts.js';

const key = (request: FastifyRequest) =>
  z.string().min(1).max(200).parse(request.headers["idempotency-key"]);
const docId = (request: FastifyRequest) =>
  z.object({ documentId: z.string().uuid() }).parse(request.params).documentId;
const objectId = (request: FastifyRequest) =>
  z.object({ id: z.string().uuid() }).parse(request.params).id;
type Handler = (
  request: FastifyRequest,
  reply: FastifyReply,
  owner: OwnerScope,
) => Promise<unknown>;
const wrap = (handler: Handler) => async (request: FastifyRequest, reply: FastifyReply) => {
  reply.header("Cache-Control", "no-store");
  try {
    return await handler(request, reply, requireOwnerContext(request));
  } catch (error) {
    if (error instanceof ServiceError || error instanceof ResumeInputError)
      return sendApiProblem(
        request,
        reply,
        new ApiProblem(
          error instanceof ServiceError ? error.statusCode : 422,
          error.code,
          "操作未完成",
          error.message,
        ),
      );
    if (error instanceof z.ZodError)
      return sendApiProblem(
        request,
        reply,
        new ApiProblem(
          400,
          "INVALID_STUDIO_REQUEST",
          "内容需要调整",
          error.issues[0]?.message ?? "请检查填写的内容。",
        ),
      );
    throw error;
  }
};
export function registerResumeStudioRoutes(
  app: FastifyInstance,
  options: { db: Kysely<Database>; config: AppConfig },
) {
  const { db, config } = options;
  app.post('/v1/resume-documents/:documentId/exports',wrap(async(req,reply,owner)=>{
    const artifact=await createResumeExport({db,owner,documentId:docId(req),request:CreateResumeExportSchema.parse(req.body),idempotencyKey:key(req),encryptionKey:config.resumeEncryptionKey,...(config.pdfRuntime?{runtime:config.pdfRuntime}:{})});
    return reply.code(artifact.state==='generating'?202:200).send(artifact);
  }));
  app.get('/v1/resume-documents/:documentId/exports',wrap(async(req,_reply,owner)=>listResumeExports(db,owner,docId(req))));
  app.get('/v1/resume-exports/:id/status',wrap(async(req,_reply,owner)=>getResumeExport(db,owner,objectId(req))));
  app.delete('/v1/resume-exports/:id',wrap(async(req,_reply,owner)=>deleteResumeExport(db,owner,objectId(req))));
  app.get('/v1/resume-templates', wrap(async () => ({ items: RESUME_TEMPLATES.map((t) => ({ ...t, source:RESUME_TEMPLATE_SOURCES[t.id], capabilities:{photos:true,multiplePages:true,richText:true,allModules:true,columns:t.columns,compact:t.group==='project'||t.id==='jp_ats',longMaterial:t.group==='research'}, thumbnail: `/resume-templates/${t.id}${t.rendererVersion === 'studio-pages-v3' ? `-${t.version}` : ''}.png?v=${t.version}` })) })));
  app.get('/v1/resume-template-preferences', wrap(async (_req,_reply,owner) => templatePreferences(db,owner)));
  app.put('/v1/resume-template-preferences', wrap(async (req,_reply,owner) => setTemplatePreference(db,owner,req.body,key(req))));
  app.post('/v1/resume-photos', wrap(async (req,_reply,owner) => {
    key(req);
    const file=await req.file({limits:{files:1,fileSize:5242880,fields:0,parts:1}});
    if(!file)throw new ServiceError(400,'RESUME_PHOTO_REQUIRED','请选择照片。');
    return uploadResumePhoto(db,owner,await file.toBuffer(),file.mimetype,config.resumeEncryptionKey,key(req));
  }));
  app.get('/v1/resume-photos/:id',wrap(async(req,reply,owner)=>{
    const photo=await readResumePhoto(db,owner,objectId(req),config.resumeEncryptionKey);
    if(!photo)throw new ServiceError(404,'RESUME_PHOTO_NOT_FOUND','照片已删除或不存在。');
    return reply.type(photo.mediaType).header('X-Content-Type-Options','nosniff').send(photo.buffer);
  }));
  app.delete('/v1/resume-photos/:id',wrap(async(req,_reply,owner)=>deleteResumePhoto(db,owner,objectId(req))));
  app.post(
    "/v1/resume-documents/studio",
    wrap(async (req, _reply, owner) =>
      createStudioDocument(db, owner, CreateResumeStudioSchema.parse(req.body), key(req)),
    ),
  );
  app.get(
    "/v1/resume-documents/:documentId/studio",
    wrap(async (req, _reply, owner) => getStudioDraft(db, owner, docId(req))),
  );
  app.put(
    "/v1/resume-documents/:documentId/studio",
    wrap(async (req, _reply, owner) =>
      saveStudioDraft(db, owner, docId(req), SaveResumeStudioDraftSchema.parse(req.body), key(req)),
    ),
  );
  app.post(
    "/v1/resume-documents/:documentId/checkpoint",
    wrap(async (req, _reply, owner) => {
      const b = z
        .object({ expectedRevision: z.number().int().nonnegative() })
        .strict()
        .parse(req.body);
      return checkpointStudioDraft(db, owner, docId(req), b.expectedRevision);
    }),
  );
  app.get(
    "/v1/resume-documents/:documentId/studio-history",
    wrap(async (req, _reply, owner) => {
      const documentId = docId(req);
      await getStudioDraft(db, owner, documentId);
      const { rows } = await sql<{
        id: string;
        layout_id: string;
        document_revision: number;
        created_at: Date;
        studio_content: unknown;
        studio_layout: unknown;
      }>`SELECT c.id,l.id AS layout_id,c.document_revision,c.created_at,c.studio_content,l.studio_layout FROM profile.resume_document_revisions c JOIN profile.resume_layout_revisions l ON l.document_id=c.document_id AND l.owner_id=c.owner_id AND l.result_document_revision=c.result_document_revision WHERE c.owner_id=${owner.ownerId} AND c.owner_epoch=${owner.ownerEpoch} AND c.document_id=${documentId} AND c.studio_content IS NOT NULL ORDER BY c.document_revision DESC LIMIT 50`.execute(
        db,
      );
      return {
        items: rows.map((r) => ({
          contentRevisionId: r.id,
          layoutRevisionId: r.layout_id,
          version: Number(r.document_revision),
          createdAt: new Date(r.created_at).toISOString(),
          content: ResumeStudioContentSchema.parse(r.studio_content),
          layout: ResumeStudioLayoutSchema.parse(r.studio_layout),
        })),
      };
    }),
  );
  app.post(
    "/v1/resume-documents/import",
    wrap(async (req, reply, owner) => {
      if (req.isMultipart()) {
        const file = await req.file({
          limits: { files: 1, fileSize: config.resumeMaxBytes, fields: 0, parts: 1 },
        });
        if (!file) throw new ServiceError(400, "RESUME_FILE_REQUIRED", "请选择 PDF 或 DOCX 文件。");
        const buffer = await file.toBuffer();
        validateResumeUpload({
          filename: file.filename,
          mimetype: file.mimetype,
          buffer,
          maxBytes: config.resumeMaxBytes,
        });
        return reply.code(202).send(
          await createStudioImport(
            db,
            owner,
            {
              filename: file.filename,
              mediaType: file.mimetype,
              buffer,
              encryptionKey: config.resumeEncryptionKey,
            },
            key(req),
          ),
        );
      }
      const body = z
        .object({
          text: z.string().trim().min(1).max(150000),
          title: z.string().trim().min(1).max(200).default("导入的简历"),
        })
        .strict()
        .parse(req.body);
      const draft = await createStudioDocument(db, owner, { title: body.title }, key(req));
      const result = await saveStudioDraft(
        db,
        owner,
        draft.documentId,
        {
          expectedRevision: 1,
          title: body.title,
          content: importStudioText(body.text),
          layout: draft.layout,
        },
        `text-import:${key(req)}`,
      );
      return { draft: result, originals: [] };
    }),
  );
  app.post(
    "/v1/resume-documents/import-legacy/:id",
    wrap(async (req, _reply, owner) => {
      const row = await db
        .selectFrom("profile.resume_document_revisions")
        .selectAll()
        .where("resume_analysis_id", "=", objectId(req))
        .where("owner_id", "=", owner.ownerId)
        .orderBy("revision", "desc")
        .executeTakeFirst();
      if (!row)
        throw new ServiceError(
          404,
          "LEGACY_RESUME_NOT_FOUND",
          "旧导入尚无可恢复的正文；可以重新导入原件直接编辑。",
        );
      const draft = await createStudioDocument(db, owner, { title: "我的简历" }, key(req));
      const content =
        row.schema_version === "resume-document-v1"
          ? {
              ...blankResumeStudioContent(),
              sections: studioFromLegacy({
                schemaVersion: "resume-content-v1",
                sections: row.sections as {
                  id: string;
                  ordinal: number;
                  title: string;
                  blocks: { id: string; ordinal: number; text: string; evidenceIds: string[] }[];
                }[],
              }).sections,
            }
          : studioFromLegacy(semanticContent(row.schema_version, row.sections));
      return saveStudioDraft(
        db,
        owner,
        draft.documentId,
        { expectedRevision: 1, title: draft.title, content, layout: draft.layout },
        `legacy:${key(req)}`,
      );
    }),
  );
  app.get(
    "/v1/resume-documents/:documentId/originals",
    wrap(async (req, _reply, owner) => ({
      items: await listStudioOriginals(db, owner, docId(req)),
    })),
  );
  app.get(
    "/v1/resume-originals/:id",
    wrap(async (req, reply, owner) => {
      const original = await downloadStudioOriginal(
        db,
        owner,
        objectId(req),
        config.resumeEncryptionKey,
      );
      return reply
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(original.filename)}`,
        )
        .type(original.mediaType)
        .send(original.buffer);
    }),
  );
  app.delete(
    "/v1/resume-originals/:id",
    wrap(async (req, _reply, owner) =>
      db.transaction().execute(async (tx) => {
        await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
        await sql`DELETE FROM profile.resume_originals WHERE id=${objectId(req)} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
          tx,
        );
        return { deleted: true };
      }),
    ),
  );
  app.post(
    "/v1/resume-originals/:id/use-parsed",
    wrap(async (req, _reply, owner) => {
      const body = z
        .object({ expectedRevision: z.number().int().nonnegative() })
        .strict()
        .parse(req.body);
      return applyStudioParsedOriginal(db, owner, objectId(req), body.expectedRevision, key(req));
    }),
  );
  app.get(
    "/v1/experiences",
    wrap(async (_req, _reply, owner) => ({ items: await listExperiences(db, owner) })),
  );
  app.post(
    "/v1/experiences",
    wrap(async (req, _reply, owner) =>
      db.transaction().execute(async (tx) => {
        await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
        await retainOwnerAssetsAfterMaterialSave(tx, owner);
        const body = z
            .object({ kind: ResumeSectionKindSchema, entry: ResumeStudioEntrySchema })
            .strict()
            .parse(req.body),
          hash = experienceCaptureHash(body.kind, body.entry),
          id = randomUUID();
        await sql`INSERT INTO profile.experiences(id,owner_id,owner_epoch,kind,title,entry,capture_hash) VALUES(${id},${owner.ownerId},${owner.ownerEpoch},${body.kind},${body.entry.title || body.entry.organization || "我的经历"},${studioJson(body.entry)}::jsonb,${hash}) ON CONFLICT(owner_id,owner_epoch,capture_hash) DO NOTHING`.execute(
          tx,
        );
        const result = (await listExperiences(tx, owner)).find(
          (e) => experienceCaptureHash(e.kind, e.entry) === hash,
        );
        if (result)
          await sql`INSERT INTO profile.experience_revisions(id,owner_id,owner_epoch,experience_id,revision,entry) VALUES(${randomUUID()},${owner.ownerId},${owner.ownerEpoch},${result.id},1,${studioJson(result.entry)}::jsonb) ON CONFLICT(owner_id,experience_id,revision) DO NOTHING`.execute(
            tx,
          );
        return result;
      }),
    ),
  );
  app.put(
    "/v1/experiences/:id",
    wrap(async (req, _reply, owner) => {
      const b = z
        .object({ expectedRevision: z.number().int().positive(), entry: ResumeStudioEntrySchema })
        .strict()
        .parse(req.body);
      return updateExperience(db, owner, objectId(req), b.expectedRevision, b.entry);
    }),
  );
  app.delete(
    "/v1/experiences/:id",
    wrap(async (req, _reply, owner) =>
      db.transaction().execute(async (tx) => {
        await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
        await sql`DELETE FROM profile.experiences WHERE id=${objectId(req)} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
          tx,
        );
        return { deleted: true };
      }),
    ),
  );
}
