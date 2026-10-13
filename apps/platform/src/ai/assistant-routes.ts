import type { AppConfig } from "@aijob/config";
import {
  AdoptAssistantResultSchema,
  CreateAssistantSessionSchema,
  SubmitAssistantTurnSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";
import { adoptAssistantResult } from "../resume-documents/studio-review-service.js";
import {
  assistantSession,
  createAssistantSession,
  retryAssistantTurn,
  setAssistantSessionStatus,
  submitAssistantTurn,
} from "./assistant-service.js";
import { userAiAvailability } from "./user-ai-service.js";

const id = (r: FastifyRequest) => z.object({ id: z.string().uuid() }).parse(r.params).id;
const key = (r: FastifyRequest) => z.string().min(1).max(200).parse(r.headers["idempotency-key"]);
const wrap =
  (fn: (r: FastifyRequest, p: FastifyReply, o: OwnerScope) => Promise<unknown>) =>
  async (r: FastifyRequest, p: FastifyReply) => {
    p.header("Cache-Control", "no-store");
    try {
      return await fn(r, p, requireOwnerContext(r));
    } catch (error) {
      if (error instanceof ServiceError)
        return sendApiProblem(
          r,
          p,
          new ApiProblem(error.statusCode, error.code, "本次操作未完成", error.message),
        );
      if (error instanceof z.ZodError)
        return sendApiProblem(
          r,
          p,
          new ApiProblem(
            400,
            "INVALID_ASSISTANT_REQUEST",
            "请检查填写内容",
            error.issues[0]?.message ?? "请求格式不正确",
          ),
        );
      throw error;
    }
  };
export function registerAssistantRoutes(
  app: FastifyInstance,
  { db, config }: { db: Kysely<Database>; config: AppConfig },
) {
  app.get(
    "/v1/assistant/status",
    wrap(async (_r, _p, o) => userAiAvailability(db, o)),
  );
  app.post(
    "/v1/assistant/sessions",
    wrap(async (r, _p, o) =>
      createAssistantSession(
        db,
        o,
        CreateAssistantSessionSchema.parse(r.body),
        key(r),
        config.enableLocalMvp,
      ),
    ),
  );
  app.get(
    "/v1/assistant/sessions/:id",
    wrap(async (r, _p, o) => assistantSession(db, o, id(r))),
  );
  app.get(
    "/v1/assistant/sessions",
    wrap(async (r, _p, o) => {
      const { caseId } = z.object({ caseId: z.string().uuid().optional() }).strict().parse(r.query);
      return {
        items: (
          await sql<{
            id: string;
            title: string;
            task: string;
            status: string;
            updated_at: Date;
          }>`SELECT id,title,task,status,updated_at FROM profile.assistant_sessions AS s WHERE owner_id=${o.ownerId} AND owner_epoch=${o.ownerEpoch} AND s.deleted_at IS NULL AND (s.case_id IS NULL OR EXISTS(SELECT 1 FROM application.application_cases AS c WHERE c.id=s.case_id AND c.owner_id=s.owner_id AND c.deleted_at IS NULL)) AND ${caseId ? sql`s.case_id=${caseId}` : sql`true`} AND (document_id IS NULL OR EXISTS(SELECT 1 FROM profile.resume_documents AS d WHERE d.id=s.document_id AND d.owner_id=s.owner_id AND d.deleted_at IS NULL)) ORDER BY updated_at DESC LIMIT 100`.execute(
            db,
          )
        ).rows.map((s) => ({
          id: s.id,
          title: s.title,
          task: s.task,
          status: s.status,
          updatedAt: new Date(s.updated_at).toISOString(),
        })),
      };
    }),
  );
  app.post(
    "/v1/assistant/sessions/:id/turns",
    wrap(async (r, _p, o) =>
      submitAssistantTurn(db, o, id(r), SubmitAssistantTurnSchema.parse(r.body), key(r), config),
    ),
  );
  app.post(
    "/v1/assistant/turns/:id/retry",
    wrap(async (r, _p, o) =>
      retryAssistantTurn(
        db,
        o,
        id(r),
        z.object({ expectedRevision: z.number().int().positive() }).strict().parse(r.body)
          .expectedRevision,
        key(r),
      ),
    ),
  );
  app.patch(
    "/v1/assistant/sessions/:id",
    wrap(async (r, _p, o) => {
      const b = z
        .object({
          expectedRevision: z.number().int().positive(),
          status: z.enum(["active", "paused", "completed"]),
        })
        .strict()
        .parse(r.body);
      return setAssistantSessionStatus(db, o, id(r), b.expectedRevision, b.status);
    }),
  );
  app.delete(
    "/v1/assistant/sessions/:id",
    wrap(async (r, _p, o) =>
      db.transaction().execute(async (tx) => {
        await assertActiveOwnerEpoch(tx, o.ownerId, o.ownerEpoch);
        await sql`DELETE FROM profile.assistant_sessions WHERE id=${id(r)} AND owner_id=${o.ownerId} AND owner_epoch=${o.ownerEpoch}`.execute(
          tx,
        );
        return { deleted: true };
      }),
    ),
  );
  app.post(
    "/v1/assistant/turns/:id/adopt",
    wrap(async (r, _p, o) =>
      adoptAssistantResult(
        db,
        o,
        id(r),
        AdoptAssistantResultSchema.parse(r.body),
        key(r),
        config.enableLocalMvp,
      ),
    ),
  );
}
