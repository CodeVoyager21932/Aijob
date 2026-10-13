import { randomUUID } from "node:crypto";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { z } from "zod";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { cachedPublicProjection } from "./projection-cache.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("shared projection cache integrity", () => {
  const db = createDatabase(url ?? "postgresql://unused"),
    keys: string[] = [];
  const schema = z.object({ value: z.string() });
  beforeAll(() => migrateToLatest(db), 60000);
  afterAll(async () => {
    try {
      if (keys.length)
        await sql`DELETE FROM catalog.job_graph_cache WHERE projection_key=ANY(${keys.map(hashCanonicalJson)}::text[])`.execute(
          db,
        );
    } finally {
      await db.destroy();
    }
  });
  const key = () => {
    const value = randomUUID();
    keys.push(value);
    return value;
  };
  it("coalesces concurrent misses, refreshes an expired entry and invalidates on generation changes", async () => {
    const cacheKey = key();
    let calls = 0;
    const read = () =>
      cachedPublicProjection({
        db,
        key: cacheKey,
        schema,
        load: async () => ({ value: String(++calls) }),
      });
    const results = await Promise.all(Array.from({ length: 20 }, read));
    expect(new Set(results.map((item) => item.value))).toEqual(new Set(["1"]));
    await sql`UPDATE catalog.job_graph_cache SET expires_at=now()-interval '1 second' WHERE projection_key=${hashCanonicalJson(cacheKey)}`.execute(
      db,
    );
    expect(await read()).toEqual({ value: "2" });
    expect(await read()).toEqual({ value: "2" });
    await sql`UPDATE catalog.job_graph_generation SET generation=generation+1 WHERE id=true`.execute(
      db,
    );
    expect(await read()).toEqual({ value: "3" });
  });
  it("lets the recommendation worker use public cached queries with its actual runtime privileges", async () => {
    await db.transaction().execute(async (tx) => {
      await sql`SET LOCAL ROLE aijob_match_worker`.execute(tx);
      expect(
        await cachedPublicProjection({
          db: tx,
          key: key(),
          schema,
          load: async () => ({ value: "public-fixture" }),
        }),
      ).toEqual({ value: "public-fixture" });
    });
  });
  it("retains cache generation for empty and identical catalog writes", async () => {
    const generation = async () =>
      (
        await sql<{
          generation: string;
        }>`SELECT generation::text FROM catalog.job_graph_generation WHERE id=true`.execute(db)
      ).rows[0]?.generation;
    const before = await generation();
    await sql`UPDATE catalog.published_jobs SET current_version_id=current_version_id WHERE false`.execute(
      db,
    );
    await sql`UPDATE catalog.published_jobs SET current_version_id=current_version_id WHERE id IN (SELECT id FROM catalog.published_jobs LIMIT 1)`.execute(
      db,
    );
    await sql`DELETE FROM catalog.job_semantic_indexes WHERE false`.execute(db);
    expect(await generation()).toBe(before);
  });
  it("does not attach a post-withdrawal read to an older in-flight generation", async () => {
    const cacheKey = key();
    let release: () => void = () => {};
    let started: () => void = () => {};
    const began = new Promise<void>((resolve) => {
        started = resolve;
      }),
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
    const older = cachedPublicProjection({
      db,
      key: cacheKey,
      schema,
      load: async () => {
        started();
        await hold;
        return { value: "before-withdrawal" };
      },
    });
    await began;
    try {
      await sql`UPDATE catalog.job_graph_generation SET generation=generation+1 WHERE id=true`.execute(
        db,
      );
      expect(
        await cachedPublicProjection({
          db,
          key: cacheKey,
          schema,
          load: async () => ({ value: "after-withdrawal" }),
        }),
      ).toEqual({ value: "after-withdrawal" });
    } finally {
      release();
      await older;
    }
    expect(
      await cachedPublicProjection({
        db,
        key: cacheKey,
        schema,
        load: async () => ({ value: "should-be-cached" }),
      }),
    ).toEqual({ value: "after-withdrawal" });
  });
});
