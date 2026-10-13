import type { AppConfig } from "@aijob/config";
import type { Database } from "@aijob/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, sendApiProblem } from "../identity/http.js";
import type { OwnerScope } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";
import {
  deleteUserDiscoverySettings,
  saveUserDiscoverySettings,
  userDiscoverySettings,
} from "./user-discovery-settings.js";
import { queueUserDiscoveryTest } from "./user-discovery-worker.js";

export function registerUserDiscoveryRoutes(
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
            new ApiProblem(error.statusCode, error.code, "搜索配置尚未完成", error.message),
          );
        if (error instanceof z.ZodError)
          return sendApiProblem(
            r,
            p,
            new ApiProblem(
              400,
              "INVALID_SEARCH_SETTINGS",
              "请检查填写内容",
              error.issues[0]?.message ?? "配置格式不正确",
            ),
          );
        // Do not serialize a provider response or credential-bearing request.
        return sendApiProblem(
          r,
          p,
          new ApiProblem(
            500,
            "SEARCH_SETTINGS_FAILED",
            "配置未完成",
            "当前输入已保留，请稍后重试。",
          ),
        );
      }
    };
  app.get(
    "/v1/settings/discovery",
    wrap(async (_r, _p, o) => userDiscoverySettings(db, o, config)),
  );
  app.put(
    "/v1/settings/discovery",
    wrap(async (r, _p, o) => saveUserDiscoverySettings(db, o, config, r.body)),
  );
  app.delete(
    "/v1/settings/discovery",
    wrap(async (r, _p, o) =>
      deleteUserDiscoverySettings(
        db,
        o,
        z.object({ revision: z.number().int().positive() }).parse(r.body).revision,
      ),
    ),
  );
  app.post(
    "/v1/settings/discovery/test",
    wrap(async (r, _p, o) =>
      queueUserDiscoveryTest(
        db,
        o,
        z.object({ revision: z.number().int().positive() }).parse(r.body).revision,
        z.string().min(1).max(200).parse(r.headers["idempotency-key"]),
      ),
    ),
  );
}
