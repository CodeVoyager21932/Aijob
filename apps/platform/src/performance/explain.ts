import { createDatabase, assertIsolatedTestDatabaseUrl } from "@aijob/database";
import { sql } from "kysely";
import { writeFile } from "node:fs/promises";
import { catalogRowsQuery } from "../catalog/repository.js";
import { scopedJobs } from "../insights/graph-scope.js";
import { JobGraphScopeSchema } from "@aijob/contracts";
const url = process.env.AIJOB_BENCH_DATABASE_URL;
if (!url) throw new Error("Dedicated benchmark URL required");
assertIsolatedTestDatabaseUrl(url);
const db = createDatabase(url);
try {
  const result = await sql`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${catalogRowsQuery(false)}`.execute(
    db,
  );
  await writeFile(
    "../../.data/core-catalog-query-explain.json",
    JSON.stringify(result.rows, null, 2),
  );
  const graph =
    await sql`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT job.id ${scopedJobs(JobGraphScopeSchema.parse({}), false)}`.execute(
      db,
    );
  await writeFile("../../.data/core-graph-query-explain.json", JSON.stringify(graph.rows, null, 2));
} finally {
  await db.destroy();
}
