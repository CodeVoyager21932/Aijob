import { buildApp } from "../../apps/platform/src/app.ts";
import { requireOwnerContext } from "../../apps/platform/src/identity/fastify.ts";
import { runOneOwnerTask } from "../../apps/platform/src/workers/owner-task-worker.ts";
import { parseAppConfig } from "../../packages/config/src/index.ts";
import {
  assertIsolatedTestDatabaseUrl,
  createDatabase,
} from "../../packages/database/src/index.ts";

const url = process.env.AIJOB_TEST_DATABASE_URL;
if (!url) throw new Error("Missing isolated database");
assertIsolatedTestDatabaseUrl(url);
const db = createDatabase(url);
const config = parseAppConfig({
  APP_ENV: "test",
  DATABASE_URL: url,
  RESUME_ENCRYPTION_KEY: "a".repeat(64),
  ACCEPTED_ORIGINS: "http://127.0.0.1:5194",
  ENABLE_AI: "false",
  LOG_LEVEL: "warn",
});
const app = buildApp({ config, db });
// Isolated browser harness only: dispatch the just-uploaded owner's real queued parse.
// Production continues to run the separate owner worker.
app.addHook("onResponse", async (req, reply) => {
  if (
    req.method === "POST" &&
    /\/native\/imports(?:\?|\/text)/.test(req.url) &&
    reply.statusCode === 202
  ) {
    const owner = requireOwnerContext(req);
    void runOneOwnerTask({
      db,
      config,
      ownerIds: [owner.ownerId],
      taskTypes: ["resume_studio_import"],
    }).catch((error) => console.error(error instanceof Error ? error.name : "IMPORT_WORKER_ERROR"));
  }
});
await app.listen({ host: "127.0.0.1", port: 3002 });
console.log("Native integration API ready on 3002 (isolated fixtures)");
process.on("SIGTERM", async () => {
  await app.close();
  await db.destroy();
});
