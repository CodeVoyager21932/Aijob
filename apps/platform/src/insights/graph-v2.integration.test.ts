import { randomUUID } from "node:crypto";
import {
  GraphItemV2Schema,
  JobGraphScopeSchema,
  JOB_SEMANTICS_V2,
  blankResumeEntry,
  resumeRichText,
  CreatePlannerItemRequestSchema,
} from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { provisionBenchmarkJob } from "../performance/fixtures.js";
import { reindexGraphV2 } from "../catalog/job-semantics-v2-store.js";
import { createAnonymousSession } from "../identity/session-repository.js";
import { compareExperiencesV2 } from "./private-graph-v2.js";
import { getDirectionsV2, getEvidenceV2, getGraphV2 } from "./graph-v2.js";
import { createPlannerItem } from '../planner/service.js';

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("direction graph v2 PostgreSQL projection", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  const scope = JobGraphScopeSchema.parse({ jobFamily: "product", subrole: "product_management" });
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());
  it("projects official clauses once, distinguishes choices and duties, and paginates full context", async () => {
    const fixture = await provisionBenchmarkJob(db, `graph-${randomUUID()}`, {
      title: "产品经理实习生",
      requirements:
        "本科或硕士在读；掌握 Python、Java 任一语言；编写 PRD／产品需求文档；不要求相关实习经验。",
    });
    const result = await getGraphV2({ db, scope, local: false });
    const items = result.groups.flatMap((g) => g.items);
    expect(result.sample.parsedJobCount).toBe(result.sample.jobCount);
    expect(items.find((i) => i.key === "tool:python")).toMatchObject({
      jobCount: 1,
      requiredJobCount: 0,
      conditionalJobCount: 1,
    });
    expect(items.filter((i) => i.key === "deliverable:prd")).toHaveLength(1);
    expect(items.some((i) => i.key === "task:data_analysis")).toBe(false);
    const evidence = await getEvidenceV2({
      db,
      scope,
      local: false,
      key: "tool:python",
      offset: 0,
      limit: 1,
    });
    expect(evidence.items[0]).toMatchObject({
      jobVersionId: fixture.publishedJobVersionId,
      atom: { clauseText: "掌握 Python、Java 任一语言", choiceGroup: { operator: "any" } },
    });
    expect(evidence.nextOffset).toBeNull();
    const owner=(await createAnonymousSession({db})).context, atom=evidence.items[0]!.atom;
    const prepare={db,owner,local:false,idempotencyKey:randomUUID(),request:CreatePlannerItemRequestSchema.parse({kind:'preparation',title:'练习语言选择',source:{jobId:fixture.publishedJobId,jobVersionId:fixture.publishedJobVersionId,key:atom.key,extractionVersion:JOB_SEMANTICS_V2,sourceText:atom.sourceText,section:atom.section,start:atom.sourceSpan.start,end:atom.sourceSpan.end}})};
    const task=await createPlannerItem(prepare);
    expect(await createPlannerItem(prepare)).toEqual(task);
    expect(task.source?.extractionVersion).toBe(JOB_SEMANTICS_V2);
    const before =
      await sql`SELECT atoms FROM catalog.job_semantic_indexes WHERE job_version_id=${fixture.publishedJobVersionId} AND extraction_version<>${JOB_SEMANTICS_V2}`.execute(
        db,
      );
    const versionsBefore =
      await sql`SELECT id FROM catalog.published_job_versions WHERE published_job_id=${fixture.publishedJobId}`.execute(
        db,
      );
    const backfill = await reindexGraphV2(db, 10);
    expect(backfill.failed).toBe(0);
    expect((await reindexGraphV2(db,10)).processed).toBe(0);
    expect(
      (
        await sql`SELECT atoms FROM catalog.job_semantic_indexes WHERE job_version_id=${fixture.publishedJobVersionId} AND extraction_version<>${JOB_SEMANTICS_V2}`.execute(
          db,
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await sql`SELECT id FROM catalog.published_job_versions WHERE published_job_id=${fixture.publishedJobId}`.execute(
          db,
        )
      ).rows,
    ).toEqual(versionsBefore.rows);
    const directions = await getDirectionsV2({ db, scope, local: false });
    expect(
      directions.items
        .find((i) => i.family === "product")
        ?.children.some((i) => i.id === "product_management"),
    ).toBe(true);
    const localBefore=(await getGraphV2({db,scope,local:true})).sample.jobCount;
    await sql`UPDATE source_control.source_policy_versions SET policy_status='pending_review' WHERE source_id=${fixture.sourceId}`.execute(
      db,
    );
    expect((await getGraphV2({ db, scope, local: false })).sample.jobCount).toBe(
      result.sample.jobCount - 1,
    );
    expect(
      (
        await getEvidenceV2({ db, scope, local: false, key: "tool:python", offset: 0, limit: 1 })
      ).items.some((i) => i.jobId === fixture.publishedJobId),
    ).toBe(false);
    expect((await getGraphV2({ db, scope, local: true })).sample.jobCount).toBe(
      localBefore,
    );
  });
  it("uses read privileges for public projections and rejects private writes by the worker", async () => {
    await db.transaction().execute(async (tx) => {
      await sql`SET LOCAL ROLE aijob_web_api`.execute(tx);
      expect(
        (await sql`SELECT atom FROM catalog.job_concept_projections LIMIT 1`.execute(tx)).rows
          .length,
      ).toBe(1);
    });
    await expect(
      db.transaction().execute(async (tx) => {
        await sql`SET LOCAL ROLE aijob_match_worker`.execute(tx);
        await sql`DELETE FROM catalog.job_concept_projections`.execute(tx);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("compares complete experiences with current owner isolation and never writes them into public atoms", async () => {
    const owner = (await createAnonymousSession({ db })).context,
      other = (await createAnonymousSession({ db })).context;
    const id = randomUUID(),
      entry = {
        ...blankResumeEntry(randomUUID()),
        title: "课程访谈",
        body: resumeRichText("使用 SQL 分析课程调查结果，整理访谈并提交报告。"),
      };
    await sql`INSERT INTO profile.experiences(id,owner_id,owner_epoch,kind,title,entry,capture_hash) VALUES(${id},${owner.ownerId},${owner.ownerEpoch},'project',${entry.title},${JSON.stringify(entry)}::jsonb,${randomUUID()})`.execute(
      db,
    );
    const item = GraphItemV2Schema.parse({
      key: "tool:sql",
      label: "SQL",
      kind: "tool",
      jobCount: 0,
      companyCount: 0,
      mentionRate: 0,
      companyCoverage: 0,
      requiredJobCount: 0,
      preferredJobCount: 0,
      unknownJobCount: 0,
      negatedJobCount: 0,
      conditionalJobCount: 0,
      dutyJobCount: 0,
      parentKeys: [],
      examples: [],
    });
    const count = async () =>
      (
        await sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM catalog.job_concept_projections`.execute(db)
      ).rows[0]!.n;
    const before = await count();
    expect((await compareExperiencesV2({ db, owner, item })).candidates[0]).toMatchObject({
      experienceId: id,
      title: entry.title,
    });
    expect((await compareExperiencesV2({ db, owner: other, item })).candidates).toEqual([]);
    expect(await count()).toBe(before);
  });
});
