import type { AppConfig } from "@aijob/config";
import { BookmarkListSchema, BookmarkSchema, PutBookmarkSchema } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type Kysely, sql, type Transaction } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { studioJson } from "../resume-documents/studio-service.js";
import { createCatalogRepository } from "./repository.js";
import { parseJobSearchQuery } from "./routes.js";

type Db = Kysely<Database> | Transaction<Database>;
export async function listBookmarks(db: Db, owner: OwnerScope) {
  const { rows } = await sql<{
    job_id: string;
    saved: boolean;
    revision: number;
    updated_at: Date;
  }>`SELECT job_id,saved,revision,updated_at FROM application.job_bookmarks WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} ORDER BY updated_at DESC`.execute(
    db,
  );
  return BookmarkListSchema.parse({
    items: rows.map((r) => ({
      jobId: r.job_id,
      saved: r.saved,
      revision: Number(r.revision),
      updatedAt: new Date(r.updated_at).toISOString(),
    })),
  });
}
export async function putBookmark(
  db: Kysely<Database>,
  owner: OwnerScope,
  jobId: string,
  raw: unknown,
  key: string,
  local: boolean,
) {
  const input = PutBookmarkSchema.parse(raw),
    hash = hashCanonicalJson({ jobId, ...input });
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const receipt = (
      await sql<{
        request_hash: string;
        result: unknown;
      }>`SELECT request_hash,result FROM application.bookmark_receipts WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND idempotency_key=${key}`.execute(
        tx,
      )
    ).rows[0];
    if (receipt) {
      if (receipt.request_hash !== hash)
        throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "请求编号对应不同的收藏操作。");
      return BookmarkSchema.parse(receipt.result);
    }
    const existing = (await listBookmarks(tx, owner)).items.find((b) => b.jobId === jobId);
    if (!existing && !input.saved) throw new ServiceError(404, "BOOKMARK_NOT_FOUND", "这份岗位尚未收藏。");
    if ((existing?.revision ?? 0) !== input.expectedRevision)
      throw new ServiceError(409, "BOOKMARK_CHANGED", "收藏状态已变化，请刷新后重试。");
    if (
      input.saved &&
      !(await createCatalogRepository({ db: tx, enableLocalMvp: local }).get(jobId))
    )
      throw new ServiceError(404, "JOB_NOT_AVAILABLE", "岗位当前已不在目录中，无法新增收藏。");
    const row = (
      await sql<{
        revision: number;
        updated_at: Date;
      }>`INSERT INTO application.job_bookmarks(owner_id,owner_epoch,job_id,saved) VALUES(${owner.ownerId},${owner.ownerEpoch},${jobId},${input.saved}) ON CONFLICT(owner_id,owner_epoch,job_id) DO UPDATE SET saved=EXCLUDED.saved,revision=application.job_bookmarks.revision+1,updated_at=now() RETURNING revision,updated_at`.execute(
        tx,
      )
    ).rows[0]!;
    const result = BookmarkSchema.parse({
      jobId,
      saved: input.saved,
      revision: Number(row.revision),
      updatedAt: new Date(row.updated_at).toISOString(),
    });
    await sql`INSERT INTO application.bookmark_receipts(owner_id,owner_epoch,idempotency_key,request_hash,result) VALUES(${owner.ownerId},${owner.ownerEpoch},${key},${hash},${studioJson(result)}::jsonb)`.execute(
      tx,
    );
    return result;
  });
}
export function registerBookmarkRoutes(
  app: FastifyInstance,
  { db, config }: { db: Kysely<Database>; config: AppConfig },
) {
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
            new ApiProblem(error.statusCode, error.code, "操作未完成", error.message),
          );
        if (error instanceof z.ZodError)
          return sendApiProblem(
            r,
            p,
            new ApiProblem(400, "INVALID_BOOKMARK", "请求格式有误", "请重新操作。"),
          );
        throw error;
      }
    };
  app.get(
    "/v1/bookmarks",
    wrap(async (_r, _p, o) => listBookmarks(db, o)),
  );
  app.put(
    "/v1/bookmarks/:id",
    wrap(async (r, _p, o) =>
      putBookmark(
        db,
        o,
        z.object({ id: z.string().uuid() }).parse(r.params).id,
        r.body,
        z.string().min(1).max(200).parse(r.headers["idempotency-key"]),
        config.enableLocalMvp,
      ),
    ),
  );
  app.get(
    "/v1/bookmarks/jobs",
    wrap(async (r, _p, o) => {
      const jobIds = (await listBookmarks(db, o)).items.filter((b) => b.saved).map((b) => b.jobId);
      return createCatalogRepository({ db, enableLocalMvp: config.enableLocalMvp }).search({
        ...parseJobSearchQuery(r.query as Record<string, unknown>),
        jobIds,
      });
    }),
  );
}
