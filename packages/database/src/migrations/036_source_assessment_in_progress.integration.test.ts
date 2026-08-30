import { randomUUID } from "node:crypto";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../index.js";
import { migrateToForTesting, migrateToLatest } from "../migrate.js";
import type { Database } from "../types.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/**
 * 「评估未完成」与「评估不合格」必须在持久记录里分开。
 *
 * 原始配置的 `hardGates.*.status` 本是三态，归一化时被压成布尔，`pending` 与 `fail` 都得出
 * `ineligible`。于是 33 个仅在等连续运行证据的来源，记录上与被否决的来源无法区分——而它们
 * 要产出那份证据恰恰得先跑起来。入口阻塞等价于零供给。
 */
describeWithDatabase("source assessment in-progress migration", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");
  const ids = { organization: randomUUID(), candidate: randomUUID(), assessment: randomUUID() };
  // 回滚断言必须在**自己的**数据库上做。共享测试库同时被多个套件使用，在它上面回滚迁移会让
  // 别的套件看到缺列的 schema——`phase-2a-forward-contract` 已经用一次性库解决了这个问题，
  // 这里沿用同一做法。
  const rollbackDatabaseName = `aijob_test_m036_rollback_${randomUUID().replaceAll("-", "")}`;
  let adminDb: Kysely<Database>;
  let rollbackDb: Kysely<Database>;

  const decisionConstraint = async (connection: Kysely<Database>) => {
    const { rows } = await sql<{ definition: string }>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'source_control.source_assessments'::regclass
        AND conname = 'source_assessments_decision_check'
    `.execute(connection);
    return rows[0]?.definition ?? "";
  };

  beforeAll(async () => {
    await migrateToLatest(db);
    adminDb = createDatabase(databaseUrl as string);
    await sql.raw(`CREATE DATABASE "${rollbackDatabaseName}"`).execute(adminDb);
    const rollbackUrl = new URL(databaseUrl as string);
    rollbackUrl.pathname = `/${rollbackDatabaseName}`;
    rollbackDb = createDatabase(rollbackUrl.toString());
    await migrateToLatest(rollbackDb);
    await db
      .insertInto("source_control.organizations")
      .values({
        id: ids.organization,
        slug: `migration-036-${ids.organization}`,
        name: "Migration 036 Company",
        official_domain: "migration-036.example.test",
      })
      .execute();
    await db
      .insertInto("source_control.source_candidates")
      .values({
        id: ids.candidate,
        organization_id: ids.organization,
        source_key: `migration-036-${ids.candidate}`,
        name: "Migration 036 Candidate",
        entrypoint_url: "https://migration-036.example.test/jobs",
        provenance_level: "organization_owned",
        acquisition_mode: "public_api",
        candidate_status: "technical_probe",
      })
      .execute();
    // 额外建一个库并在其上跑完全部迁移，默认 5 秒钩子超时不够。
  }, 60_000);

  afterAll(async () => {
    await migrateToLatest(db);
    await db
      .deleteFrom("source_control.source_assessments")
      .where("source_candidate_id", "=", ids.candidate)
      .execute();
    await db
      .deleteFrom("source_control.source_candidates")
      .where("id", "=", ids.candidate)
      .execute();
    await db
      .deleteFrom("source_control.organizations")
      .where("id", "=", ids.organization)
      .execute();
    await db.destroy();
    if (rollbackDb) await rollbackDb.destroy();
    if (adminDb) {
      await sql
        .raw(`DROP DATABASE IF EXISTS "${rollbackDatabaseName}" WITH (FORCE)`)
        .execute(adminDb);
      await adminDb.destroy();
    }
  });

  const insertAssessment = async (decision: string, id = randomUUID()) =>
    db
      .insertInto("source_control.source_assessments")
      .values({
        id,
        source_candidate_id: ids.candidate,
        assessment_hash: id.replace(/-/g, "").padEnd(64, "0").slice(0, 64),
        assessor: "migration-036-test",
        hard_gates: JSON.stringify({ stableIdentityAndFields: "pending" }),
        scores: JSON.stringify({ policyAccess: 0 }),
        total_score: 43,
        decision,
        evidence_notes: "offline migration fixture",
      })
      .execute();


  it("accepts assessing so a source waiting on evidence is not recorded as rejected", async () => {
    expect(await decisionConstraint(db)).toContain("assessing");
    await insertAssessment("assessing", ids.assessment);

    expect(
      await db
        .selectFrom("source_control.source_assessments")
        .select("decision")
        .where("id", "=", ids.assessment)
        .executeTakeFirstOrThrow(),
    ).toEqual({ decision: "assessing" });
  });

  it("still rejects decisions outside the vocabulary", async () => {
    await expect(insertAssessment("maybe_later")).rejects.toThrow(
      /source_assessments_decision_check/,
    );
  });

  it("folds assessing back into ineligible when rolled back, then restores it", async () => {
    // 在专属库上做，且自备数据：回滚会改 schema，不能让共享库的其他套件受影响。
    const rollbackIds = {
      organization: randomUUID(),
      candidate: randomUUID(),
      assessment: randomUUID(),
    };
    await rollbackDb
      .insertInto("source_control.organizations")
      .values({
        id: rollbackIds.organization,
        slug: `migration-036-rollback-${rollbackIds.organization}`,
        name: "Migration 036 Rollback Company",
        official_domain: "migration-036-rollback.example.test",
      })
      .execute();
    await rollbackDb
      .insertInto("source_control.source_candidates")
      .values({
        id: rollbackIds.candidate,
        organization_id: rollbackIds.organization,
        source_key: `migration-036-rollback-${rollbackIds.candidate}`,
        name: "Migration 036 Rollback Candidate",
        entrypoint_url: "https://migration-036-rollback.example.test/jobs",
        provenance_level: "organization_owned",
        acquisition_mode: "public_api",
        candidate_status: "technical_probe",
      })
      .execute();
    await rollbackDb
      .insertInto("source_control.source_assessments")
      .values({
        id: rollbackIds.assessment,
        source_candidate_id: rollbackIds.candidate,
        assessment_hash: rollbackIds.assessment.replace(/-/g, "").padEnd(64, "0").slice(0, 64),
        assessor: "migration-036-rollback-test",
        hard_gates: JSON.stringify({ stableIdentityAndFields: "pending" }),
        scores: JSON.stringify({ policyAccess: 0 }),
        total_score: 43,
        decision: "assessing",
        evidence_notes: "offline rollback fixture",
      })
      .execute();

    const readDecision = async () =>
      rollbackDb
        .selectFrom("source_control.source_assessments")
        .select("decision")
        .where("id", "=", rollbackIds.assessment)
        .executeTakeFirstOrThrow();

    await migrateToForTesting(rollbackDb, "035_reconciled_publication");
    // 回滚不能因为存在 `assessing` 行而失败，也不能把它留成违反旧 CHECK 的值。
    expect(await decisionConstraint(rollbackDb)).not.toContain("assessing");
    expect(await readDecision()).toEqual({ decision: "ineligible" });

    await migrateToLatest(rollbackDb);
    expect(await decisionConstraint(rollbackDb)).toContain("assessing");
    // 不回填历史行：归并后的 `ineligible` 是当时写下的事实，重新上行不伪造回 `assessing`。
    expect(await readDecision()).toEqual({ decision: "ineligible" });
    // 一次回滚加一次重新上行，5 秒默认超时不够；耗时与正确性无关。
  }, 60_000);
});
