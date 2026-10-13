/** Offline fixture/worker harness for the opportunity browser journey. Never calls a source URL. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertIsolatedTestDatabaseUrl,
  createDatabase,
} from "../../packages/database/src/index.ts";
import { parseAppConfig } from "../../packages/config/src/index.ts";
import { provisionBenchmarkJob } from "../../apps/platform/src/performance/fixtures.ts";
import { scheduleOpportunityDigests } from "../../apps/platform/src/opportunities/digests.ts";
import { runOneOwnerTask } from "../../apps/platform/src/workers/owner-task-worker.ts";

const url = process.env.AIJOB_TEST_DATABASE_URL;
if (!url) throw new Error("Missing isolated database");
if (process.env.AIJOB_TEST_DESKTOP_DATA_ROOT) {
  const directory = resolve(process.env.AIJOB_TEST_DESKTOP_DATA_ROOT),
    parsed = new URL(url);
  if (
    !directory.startsWith(resolve(".data") + "\\desktop-smoke-") ||
    parsed.hostname !== "127.0.0.1" ||
    Number(parsed.port) !==
      JSON.parse(readFileSync(resolve(directory, "runtime.json"), "utf8")).pgPort
  )
    throw Error("NOT_DESKTOP_TEST_DATABASE");
} else assertIsolatedTestDatabaseUrl(url);
const db = createDatabase(url);
try {
  const [command, argument, extra] = process.argv.slice(2);
  if (command === "seed") {
    const marker = argument ?? `browser${Date.now()}`;
    const title = `${marker} ${extra === "new" ? "新增" : "基线"}数据分析实习生`;
    const fixture = await provisionBenchmarkJob(db, `browser-${randomUUID()}`, {
      title,
      requirements: "在校生，使用 SQL 参与数据分析；学历条件未说明。",
    });
    console.log(JSON.stringify({ marker, title, jobId: fixture.publishedJobId }));
  } else if (command === "digest") {
    if (!argument || !/^[\da-f-]{36}$/.test(argument))
      throw new Error("Expected isolated owner id");
    const now = new Date(Date.now() + 60_000 + (extra === "next" ? 86_400_000 : 0));
    await scheduleOpportunityDigests(db, now);
    const config = parseAppConfig({
      APP_ENV: "test",
      DATABASE_URL: url,
      RESUME_ENCRYPTION_KEY: "a".repeat(64),
      ENABLE_AI: "false",
    });
    const processed = await runOneOwnerTask({
      db,
      config,
      ownerIds: [argument],
      taskTypes: ["opportunity_digest"],
      now,
    });
    if (!processed) throw new Error("No due digest task for fixture owner");
    console.log(JSON.stringify({ processed }));
  } else throw new Error("Expected seed or digest");
} finally {
  await db.destroy();
}
