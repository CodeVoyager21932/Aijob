import type { AppConfig } from "@aijob/config";
import type { Database } from "@aijob/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";
import { loadUserAiConnection, saveUserAiSettings, userAiSettings } from "./user-ai-service.js";
import { queueUserAiTest } from "./user-ai-test.js";
import { userProviderFetch } from "./user-provider-fetch.js";

export function registerUserAiRoutes(
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
            new ApiProblem(error.statusCode, error.code, "配置尚未完成", error.message),
          );
        if (error instanceof z.ZodError)
          return sendApiProblem(
            r,
            p,
            new ApiProblem(
              400,
              "INVALID_AI_SETTINGS",
              "请检查填写内容",
              error.issues[0]?.message ?? "格式不正确",
            ),
          );
        // Credential-bearing requests never enter the general error serializer.
        return sendApiProblem(
          r,
          p,
          new ApiProblem(500, "AI_SETTINGS_FAILED", "配置未保存", "当前输入仍保留，请稍后重试。"),
        );
      }
    };
  app.get(
    "/v1/settings/ai",
    wrap(async (_r, _p, o) => userAiSettings(db, o)),
  );
  app.get(
    "/v1/settings/ai/models",
    wrap(async (_r, _p, o) => {
      const connection = await loadUserAiConnection(db, o, config);
      const url = new URL(connection.baseUrl);
      url.pathname =
        url.pathname.replace(/\/(chat\/completions|responses)\/?$/, "").replace(/\/$/, "") +
        "/models";
      const response = await userProviderFetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${connection.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        return { models: [], notice: "服务商未提供模型列表，可以直接填写模型名称。" };
      const body = z
        .object({ data: z.array(z.object({ id: z.string().max(180) })) })
        .safeParse(await response.json());
      return {
        models: body.success
          ? [...new Set(body.data.data.map((m) => m.id))].sort().slice(0, 500)
          : [],
        notice: body.success ? null : "模型列表格式未识别，可以手动填写。",
      };
    }),
  );
  app.put(
    "/v1/settings/ai",
    wrap(async (r, _p, o) => saveUserAiSettings(db, o, config, r.body)),
  );
  app.post(
    "/v1/settings/ai/test",
    wrap(async (r, _p, o) =>
      queueUserAiTest(
        db,
        o,
        z.object({ revision: z.number().int().positive() }).parse(r.body).revision,
        z.string().min(1).max(200).parse(r.headers["idempotency-key"]),
      ),
    ),
  );
  app.delete(
    "/v1/settings/ai",
    wrap(async (r, _p, o) =>
      db.transaction().execute(async (tx) => {
        await assertActiveOwnerEpoch(tx, o.ownerId, o.ownerEpoch);
        const revision = z.object({ revision: z.number().int().positive() }).parse(r.body).revision;
        const current = (await userAiSettings(tx, o)).settings;
        if (!current) return { deleted: true };
        if (current.revision !== revision)
          throw new ServiceError(409, "AI_SETTINGS_CONFLICT", "配置已更新，请重新载入后删除。");
        await sql`DELETE FROM profile.ai_connections WHERE owner_id=${o.ownerId} AND owner_epoch=${o.ownerEpoch}`.execute(
          tx,
        );
        return { deleted: true };
      }),
    ),
  );
}
