import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NormalizedTencentJob } from "../sources/tencent-campus-adapter.js";
import { persistNormalizedTencentJob, type TaskLease } from "./persistence.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("ingestion persistence fencing and idempotency", () => {
  let db: Kysely<Database>;
  const organizationId = randomUUID();
  const sourceId = randomUUID();
  const taskIds = [randomUUID(), randomUUID()];
  const sourceJobId = `concurrency-${randomUUID()}`;
  const leases: TaskLease[] = taskIds.map((taskId, index) => ({
    taskId,
    leaseOwner: `integration-worker-${index}`,
    fencingToken: 1,
  }));
  const firstLease = leases[0];
  if (!firstLease) {
    throw new Error("integration test lease fixture is missing");
  }

  const normalized: NormalizedTencentJob = {
    sourceJobId,
    companyName: "Concurrency Test Company",
    title: "Product Intern",
    jobFamily: { state: "known", value: "product", evidenceRefs: [] },
    locations: { state: "known", value: ["Shenzhen"], evidenceRefs: [] },
    businessGroups: [],
    entryScope: "internship",
    sourceProjectName: null,
    recruitLabelName: null,
    recruitmentType: { state: "known", value: "internship", evidenceRefs: [] },
    responsibilities: "Test responsibilities",
    requirements: "Test requirements",
    structuredFields: {
      arrivalTime: { state: "unknown", reason: "source_not_stated" },
      weeklyAttendanceDays: { state: "unknown", reason: "source_not_stated" },
      durationMonths: { state: "unknown", reason: "source_not_stated" },
      graduationYears: { state: "unknown", reason: "source_not_stated" },
      recruitmentBatch: { state: "unknown", reason: "source_not_stated" },
      publishedAt: { state: "unknown", reason: "source_not_stated" },
      deadline: { state: "unknown", reason: "source_not_stated" },
    },
    ingestionState: "validated",
    publicationState: "review",
    activityState: "active",
    sourceUrl: "https://example.com/jobs/test",
    applyUrl: "https://example.com/jobs/test/apply",
    qualityFlags: [],
    reviewReasons: [],
    revisionContentHash: "a".repeat(64),
    evidence: [],
  };

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await db
      .insertInto("source_control.organizations")
      .values({
        id: organizationId,
        slug: `integration-${organizationId}`,
        name: "Integration Test Company",
        official_domain: "example.com",
      })
      .execute();
    await db
      .insertInto("source_control.sources")
      .values({
        id: sourceId,
        organization_id: organizationId,
        source_candidate_id: null,
        source_key: `integration-${sourceId}`,
        name: "Integration source",
        source_type: "organization_career_site",
        current_policy_version: 1,
      })
      .execute();
    await db
      .insertInto("source_control.source_policy_versions")
      .values({
        source_id: sourceId,
        version: 1,
        policy_status: "approved",
        provenance_level: "organization_owned",
        acquisition_mode: "public_api",
        adapter_key: "integration",
        adapter_version: "1",
        entrypoints: "[]",
        crawl_interval: null,
        policy_notes: "integration test",
        reviewed_at: new Date(),
      })
      .execute();

    await db
      .insertInto("task_queue.tasks")
      .values(
        leases.map((lease) => ({
          id: lease.taskId,
          task_type: "crawl",
          source_id: sourceId,
          policy_version: 1,
          adapter_version: "1",
          run_mode: "probe",
          idempotency_key: `integration-${lease.taskId}`,
          status: "running",
          attempt: 1,
          max_attempts: 3,
          available_at: new Date(),
          backoff_policy: JSON.stringify({
            baseMilliseconds: 500,
            maximumMilliseconds: 5_000,
            jitter: "full",
            respectsRetryAfter: true,
          }),
          lease_owner: lease.leaseOwner,
          lease_until: new Date(Date.now() + 60_000),
          heartbeat_at: new Date(),
          fencing_token: lease.fencingToken,
          last_error_code: null,
          last_error_summary: null,
          completed_at: null,
        })),
      )
      .execute();
  });

  afterAll(async () => {
    const records = await db
      .selectFrom("ingestion.source_job_records")
      .select("id")
      .where("source_id", "=", sourceId)
      .execute();
    const recordIds = records.map((record) => record.id);
    if (recordIds.length > 0) {
      await db
        .deleteFrom("ingestion.source_job_revisions")
        .where("source_job_record_id", "in", recordIds)
        .execute();
      await db.deleteFrom("ingestion.source_job_records").where("id", "in", recordIds).execute();
    }
    await db.deleteFrom("task_queue.tasks").where("id", "in", taskIds).execute();
    await db
      .deleteFrom("source_control.source_policy_versions")
      .where("source_id", "=", sourceId)
      .execute();
    await db.deleteFrom("source_control.sources").where("id", "=", sourceId).execute();
    await db.deleteFrom("source_control.organizations").where("id", "=", organizationId).execute();
    await db.destroy();
  });

  it("atomically reuses one revision across concurrent tasks", async () => {
    const results = await Promise.all(
      leases.map((lease) =>
        persistNormalizedTencentJob({
          db,
          sourceId,
          normalized,
          listFetchId: randomUUID(),
          detailFetchId: randomUUID(),
          observedAt: new Date(),
          lease,
        }),
      ),
    );

    expect(results.filter((result) => result.createdRevision)).toHaveLength(1);
    expect(new Set(results.map((result) => result.revisionId))).toHaveLength(1);
    const revisionCount = await db
      .selectFrom("ingestion.source_job_revisions")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("source_job_record_id", "=", results[0]?.recordId ?? "")
      .executeTakeFirstOrThrow();
    expect(Number(revisionCount.count)).toBe(1);
  });

  it("rejects a stale fencing token before any job row is written", async () => {
    const staleSourceJobId = `stale-${randomUUID()}`;
    await expect(
      persistNormalizedTencentJob({
        db,
        sourceId,
        normalized: { ...normalized, sourceJobId: staleSourceJobId },
        listFetchId: randomUUID(),
        detailFetchId: randomUUID(),
        observedAt: new Date(),
        lease: { ...firstLease, fencingToken: 0 },
      }),
    ).rejects.toThrow("TASK_LEASE_LOST");

    const row = await db
      .selectFrom("ingestion.source_job_records")
      .select("id")
      .where("source_id", "=", sourceId)
      .where("source_job_id", "=", staleSourceJobId)
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });
});
