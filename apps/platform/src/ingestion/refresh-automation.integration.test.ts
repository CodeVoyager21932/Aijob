import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobSearchQuerySchema } from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCatalogRepository } from "../catalog/repository.js";
import { writeLocalRefreshControl } from "../sources/local-refresh-control.js";
import { listSourceKeys, loadSourceConfig } from "../sources/source-config.js";
import {
  COLLECTOR_ADVISORY_LOCK_KEY,
  runCollectorWorker,
  runOneCollectorCycle,
  waitForCollectorIdle,
} from "../workers/collector-worker.js";
import { applyDirectSourceJobClosures, updateSourceJobActivityAfterRun } from "./job-activity.js";
import {
  lockScheduledPolicyForAcceptance,
  type ProbeResult,
  reconcileAcceptedScheduledCatalog,
} from "./probe.js";
import {
  refreshFreshnessAndSnapshotReminders,
  selectDueSourceRefreshes,
} from "./refresh-scheduler.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("source refresh automation PostgreSQL integration", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");
  const testPrefix = `refresh-it-${randomUUID()}`;
  const sourceIds: string[] = [];
  const taskIds: string[] = [];
  const runIds: string[] = [];
  const recordIds: string[] = [];
  const revisionIds: string[] = [];
  const fetchIds: string[] = [];
  let workspaceRoot = "";
  let originalCircuit:
    | { open_until: Date | string | null; reason: string | null; updated_at: Date | string }
    | undefined;

  async function createSource(
    input: {
      sourceKey?: string;
      adapterVersion?: string;
      refreshCoverage?: "full_scope" | "tracked_records" | "manual_snapshot";
      absencePolicy?: "none" | "close_after_two_complete_absences";
      nextDueAt?: Date | null;
      policyVersion?: number;
    } = {},
  ) {
    const sourceId = randomUUID();
    const organizationId = randomUUID();
    const sourceKey = input.sourceKey ?? `${testPrefix}-${sourceIds.length}`;
    const policyVersion = input.policyVersion ?? 1;
    const adapterVersion = input.adapterVersion ?? "refresh-integration-v1";
    const now = new Date("2026-08-01T00:00:00.000Z");
    sourceIds.push(sourceId);
    await db
      .insertInto("source_control.organizations")
      .values({
        id: organizationId,
        slug: `${testPrefix}-${organizationId}`,
        name: `Refresh integration organization ${sourceId}`,
        official_domain: "refresh-integration.example.test",
      })
      .execute();
    await db
      .insertInto("source_control.sources")
      .values({
        id: sourceId,
        organization_id: organizationId,
        source_candidate_id: null,
        source_key: sourceKey,
        name: `Refresh integration source ${sourceId}`,
        source_type: "organization_career_site",
        current_policy_version: policyVersion,
      })
      .execute();
    await db
      .insertInto("source_control.source_policy_versions")
      .values({
        source_id: sourceId,
        version: policyVersion,
        policy_status: "pending_review",
        provenance_level: "organization_owned",
        acquisition_mode: "public_api",
        adapter_key: "refresh-integration",
        adapter_version: adapterVersion,
        entrypoints: JSON.stringify([]),
        crawl_interval: "24h",
        refresh_coverage: input.refreshCoverage ?? "full_scope",
        absence_policy: input.absencePolicy ?? "none",
        policy_notes: "Offline refresh automation integration fixture.",
        reviewed_at: now,
      })
      .execute();
    await db
      .insertInto("source_control.source_runtime_states")
      .values({
        source_id: sourceId,
        policy_version: policyVersion,
        freshness_state: input.nextDueAt && input.nextDueAt <= now ? "due" : "fresh",
        last_complete_run_at: null,
        consecutive_failures: 0,
        last_error_code: null,
        next_due_at: input.nextDueAt ?? null,
        updated_at: now,
      })
      .execute();
    return { sourceId, organizationId, sourceKey, policyVersion, adapterVersion };
  }

  async function createRun(input: {
    sourceId: string;
    policyVersion?: number;
    adapterVersion?: string;
    completion?: "complete" | "partial" | "failed";
    startedAt: Date;
    automationAcceptance?: "pending" | "accepted" | "rejected";
  }) {
    const taskId = randomUUID();
    const runId = randomUUID();
    taskIds.push(taskId);
    runIds.push(runId);
    await db
      .insertInto("task_queue.tasks")
      .values({
        id: taskId,
        task_type: "crawl",
        source_id: input.sourceId,
        policy_version: input.policyVersion ?? 1,
        adapter_version: input.adapterVersion ?? "refresh-integration-v1",
        run_mode: "scheduled",
        idempotency_key: `${testPrefix}-${taskId}`,
        status: "succeeded",
        attempt: 1,
        max_attempts: 3,
        available_at: input.startedAt,
        backoff_policy: JSON.stringify({
          baseMilliseconds: 500,
          maximumMilliseconds: 5_000,
          jitter: "full",
          respectsRetryAfter: true,
        }),
        lease_owner: null,
        lease_until: null,
        heartbeat_at: input.startedAt,
        fencing_token: 1,
        last_error_code: null,
        last_error_summary: null,
        completed_at: input.startedAt,
      })
      .execute();
    await db
      .insertInto("ingestion.crawl_runs")
      .values({
        id: runId,
        task_id: taskId,
        source_id: input.sourceId,
        policy_version: input.policyVersion ?? 1,
        adapter_version: input.adapterVersion ?? "refresh-integration-v1",
        run_mode: "scheduled",
        automation_acceptance: input.automationAcceptance ?? "accepted",
        completion: input.completion ?? "complete",
        reported_totals: JSON.stringify({}),
        request_count: 1,
        discovered_count: 1,
        normalized_count: 1,
        rejected_count: 0,
        error_summary: JSON.stringify([]),
        started_at: input.startedAt,
        finished_at: input.startedAt,
      })
      .execute();
    return runId;
  }

  async function createRecord(sourceId: string) {
    const recordId = randomUUID();
    recordIds.push(recordId);
    await db
      .insertInto("ingestion.source_job_records")
      .values({
        id: recordId,
        source_id: sourceId,
        source_job_id: `${testPrefix}-${recordId}`,
        canonical_source_url: `https://refresh-integration.example.test/jobs/${recordId}`,
        first_seen_at: new Date("2026-08-01T00:00:00.000Z"),
        last_seen_at: new Date("2026-08-01T00:00:00.000Z"),
      })
      .execute();
    return recordId;
  }

  async function loadUnusedScheduledSourceConfigs(count: number) {
    const configs = [];
    for (const sourceKey of await listSourceKeys()) {
      const config = await loadSourceConfig(sourceKey);
      if (
        !config.policy.crawlInterval.enabled ||
        config.policy.refreshCoverage === "manual_snapshot"
      ) {
        continue;
      }
      const existing = await db
        .selectFrom("source_control.sources")
        .select("id")
        .where("source_key", "=", sourceKey)
        .executeTakeFirst();
      if (existing) continue;
      configs.push(config);
      if (configs.length === count) return configs;
    }
    throw new Error(`missing ${count} unused scheduled source configurations`);
  }

  function fakeProbeResult(): ProbeResult {
    return {
      reused: false,
      taskId: randomUUID(),
      runId: randomUUID(),
      completion: "partial",
      discoveredCount: 1,
      normalizedCount: 1,
      rejectedCount: 0,
      errors: [],
    };
  }

  beforeAll(async () => {
    await migrateToLatest(db);
    originalCircuit = await db
      .selectFrom("source_control.refresh_circuit_breaker")
      .select(["open_until", "reason", "updated_at"])
      .where("id", "=", "global")
      .executeTakeFirst();
    await db
      .updateTable("source_control.refresh_circuit_breaker")
      .set({ open_until: null, reason: null, updated_at: new Date() })
      .where("id", "=", "global")
      .execute();
    workspaceRoot = await mkdtemp(join(tmpdir(), "aijob-refresh-automation-"));
  });

  afterAll(async () => {
    if (revisionIds.length > 0) {
      const catalogRows = await db
        .selectFrom("catalog.published_job_version_revision_links as link")
        .innerJoin(
          "catalog.published_job_versions as version",
          "version.id",
          "link.published_job_version_id",
        )
        .select(["version.id as versionId", "version.published_job_id as jobId"])
        .where("link.source_job_revision_id", "in", revisionIds)
        .execute();
      const versionIds = [...new Set(catalogRows.map(({ versionId }) => versionId))];
      const jobIds = [...new Set(catalogRows.map(({ jobId }) => jobId))];
      if (jobIds.length > 0) {
        await db
          .deleteFrom("catalog.company_quota_selections")
          .where("published_job_id", "in", jobIds)
          .execute();
        await db
          .updateTable("catalog.published_jobs")
          .set({ current_version_id: null })
          .where("id", "in", jobIds)
          .execute();
      }
      if (versionIds.length > 0) {
        await db
          .deleteFrom("catalog.job_condition_projections")
          .where("published_job_version_id", "in", versionIds)
          .execute();
        await db
          .updateTable("catalog.published_job_versions")
          .set({ active_requirement_set_id: null })
          .where("id", "in", versionIds)
          .execute();
        await db
          .deleteFrom("catalog.job_requirement_sets")
          .where("published_job_version_id", "in", versionIds)
          .execute();
        await db
          .deleteFrom("catalog.published_job_version_revision_links")
          .where("published_job_version_id", "in", versionIds)
          .execute();
        await db
          .deleteFrom("catalog.published_job_versions")
          .where("id", "in", versionIds)
          .execute();
      }
      if (jobIds.length > 0) {
        await db.deleteFrom("catalog.published_jobs").where("id", "in", jobIds).execute();
      }
    }
    if (revisionIds.length > 0) {
      await db
        .deleteFrom("ingestion.source_job_revision_evidence")
        .where("revision_id", "in", revisionIds)
        .execute();
    }
    if (fetchIds.length > 0) {
      await db.deleteFrom("ingestion.crawl_fetches").where("id", "in", fetchIds).execute();
    }
    if (recordIds.length > 0) {
      await db
        .deleteFrom("ingestion.source_job_activity_states")
        .where("source_job_record_id", "in", recordIds)
        .execute();
    }
    if (revisionIds.length > 0) {
      await db
        .deleteFrom("ingestion.review_items")
        .where("revision_id", "in", revisionIds)
        .execute();
      await db
        .deleteFrom("ingestion.source_job_revisions")
        .where("id", "in", revisionIds)
        .execute();
    }
    if (recordIds.length > 0) {
      await db.deleteFrom("ingestion.source_job_records").where("id", "in", recordIds).execute();
    }
    if (runIds.length > 0) {
      await db.deleteFrom("ingestion.crawl_runs").where("id", "in", runIds).execute();
    }
    if (taskIds.length > 0) {
      await db.deleteFrom("task_queue.tasks").where("id", "in", taskIds).execute();
    }
    for (const sourceId of sourceIds) {
      const source = await db
        .selectFrom("source_control.sources")
        .select("organization_id")
        .where("id", "=", sourceId)
        .executeTakeFirst();
      if (!source) continue;
      await db
        .deleteFrom("source_control.source_runtime_states")
        .where("source_id", "=", sourceId)
        .execute();
      await db
        .deleteFrom("source_control.source_policy_versions")
        .where("source_id", "=", sourceId)
        .execute();
      await db.deleteFrom("source_control.sources").where("id", "=", sourceId).execute();
      await db
        .deleteFrom("source_control.organizations")
        .where("id", "=", source.organization_id)
        .execute();
    }
    if (originalCircuit) {
      await db
        .updateTable("source_control.refresh_circuit_breaker")
        .set({
          open_until: originalCircuit.open_until ? new Date(originalCircuit.open_until) : null,
          reason: originalCircuit.reason,
          updated_at: new Date(originalCircuit.updated_at),
        })
        .where("id", "=", "global")
        .execute();
    }
    await db.destroy();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("uses due time then source key ordering and caps scheduled source selection per hour", async () => {
    const now = new Date("2026-07-01T12:00:00.000Z");
    const dueAt = new Date("2026-07-01T11:00:00.000Z");
    const sources = await Promise.all(
      ["delta", "alpha", "charlie", "bravo"].map((suffix) =>
        createSource({ sourceKey: `aaa-${testPrefix}-${suffix}`, nextDueAt: dueAt }),
      ),
    );

    const selected = await selectDueSourceRefreshes(db, now, 3);
    expect(selected.map(({ sourceKey }) => sourceKey)).toEqual(
      sources
        .map(({ sourceKey }) => sourceKey)
        .sort()
        .slice(0, 3),
    );

    for (const source of sources.slice(0, 3)) {
      await createRun({
        sourceId: source.sourceId,
        startedAt: new Date("2026-07-01T11:30:00.000Z"),
      });
    }
    expect(await selectDueSourceRefreshes(db, now, 3)).toEqual([]);
  });

  it("reminds manual snapshots without scheduling network work", async () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const source = await createSource({
      refreshCoverage: "manual_snapshot",
      nextDueAt: new Date("2026-08-01T11:00:00.000Z"),
    });
    await refreshFreshnessAndSnapshotReminders(db, now);
    const runtime = await db
      .selectFrom("source_control.source_runtime_states")
      .select(["manual_snapshot_required", "manual_snapshot_due_at", "freshness_state"])
      .where("source_id", "=", source.sourceId)
      .executeTakeFirstOrThrow();
    expect(runtime).toMatchObject({ manual_snapshot_required: true, freshness_state: "due" });
    expect(new Date(runtime.manual_snapshot_due_at ?? 0).toISOString()).toBe(
      "2026-08-01T11:00:00.000Z",
    );
    expect(
      (await selectDueSourceRefreshes(db, now, 10)).map(({ sourceId }) => sourceId),
    ).not.toContain(source.sourceId);
  });

  it("only closes full-scope records after two complete absences one interval apart", async () => {
    const source = await createSource({
      refreshCoverage: "full_scope",
      absencePolicy: "close_after_two_complete_absences",
    });
    const recordId = await createRecord(source.sourceId);
    const firstAt = new Date("2026-08-01T00:00:00.000Z");
    const firstRun = await createRun({ sourceId: source.sourceId, startedAt: firstAt });
    await updateSourceJobActivityAfterRun({
      db,
      sourceId: source.sourceId,
      runId: firstRun,
      observedAt: firstAt,
      completion: "complete",
      refreshCoverage: "full_scope",
      absencePolicy: "close_after_two_complete_absences",
      minimumHours: 24,
    });

    const partialRun = await createRun({
      sourceId: source.sourceId,
      startedAt: new Date("2026-08-01T12:00:00.000Z"),
      completion: "partial",
    });
    await updateSourceJobActivityAfterRun({
      db,
      sourceId: source.sourceId,
      runId: partialRun,
      observedAt: new Date("2026-08-01T12:00:00.000Z"),
      completion: "partial",
      refreshCoverage: "full_scope",
      absencePolicy: "close_after_two_complete_absences",
      minimumHours: 24,
    });
    const trackedRun = await createRun({
      sourceId: source.sourceId,
      startedAt: new Date("2026-08-01T18:00:00.000Z"),
    });
    await updateSourceJobActivityAfterRun({
      db,
      sourceId: source.sourceId,
      runId: trackedRun,
      observedAt: new Date("2026-08-01T18:00:00.000Z"),
      completion: "complete",
      refreshCoverage: "tracked_records",
      absencePolicy: "none",
      minimumHours: 24,
    });
    const tooSoonRun = await createRun({
      sourceId: source.sourceId,
      startedAt: new Date("2026-08-01T23:59:59.000Z"),
    });
    await updateSourceJobActivityAfterRun({
      db,
      sourceId: source.sourceId,
      runId: tooSoonRun,
      observedAt: new Date("2026-08-01T23:59:59.000Z"),
      completion: "complete",
      refreshCoverage: "full_scope",
      absencePolicy: "close_after_two_complete_absences",
      minimumHours: 24,
    });
    expect(
      await db
        .selectFrom("ingestion.source_job_activity_states")
        .select(["absence_state", "consecutive_complete_absences"])
        .where("source_job_record_id", "=", recordId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ absence_state: "uncertain", consecutive_complete_absences: 1 });

    const secondRun = await createRun({
      sourceId: source.sourceId,
      startedAt: new Date("2026-08-02T00:00:00.000Z"),
    });
    await updateSourceJobActivityAfterRun({
      db,
      sourceId: source.sourceId,
      runId: secondRun,
      observedAt: new Date("2026-08-02T00:00:00.000Z"),
      completion: "complete",
      refreshCoverage: "full_scope",
      absencePolicy: "close_after_two_complete_absences",
      minimumHours: 24,
    });
    expect(
      await db
        .selectFrom("ingestion.source_job_activity_states")
        .select(["absence_state", "consecutive_complete_absences", "closed_reason"])
        .where("source_job_record_id", "=", recordId)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      absence_state: "closed",
      consecutive_complete_absences: 2,
      closed_reason: "two_complete_absences",
    });
  });

  it("keeps an accepted source due until catalog reconciliation succeeds", async () => {
    const completedAt = new Date("2026-08-02T06:00:00.000Z");
    const source = await createSource({ nextDueAt: completedAt });
    await expect(
      reconcileAcceptedScheduledCatalog({
        db,
        sourceId: source.sourceId,
        policyVersion: source.policyVersion,
        minimumHours: 24,
        completedAt,
        materializeCatalog: async () => {
          throw new Error("simulated catalog materialization failure");
        },
      }),
    ).rejects.toThrow("simulated catalog materialization failure");
    expect(
      await db
        .selectFrom("source_control.source_runtime_states")
        .select(["freshness_state", "last_error_code", "next_due_at"])
        .where("source_id", "=", source.sourceId)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      freshness_state: "due",
      last_error_code: "CATALOG_MATERIALIZATION_FAILED",
      next_due_at: completedAt,
    });

    await reconcileAcceptedScheduledCatalog({
      db,
      sourceId: source.sourceId,
      policyVersion: source.policyVersion,
      minimumHours: 24,
      completedAt,
      materializeCatalog: async () => ({
        eligibleRevisions: 0,
        createdVersions: 0,
        createdRequirementSets: 0,
        suspectedDuplicatePairs: 0,
        quotaSelectedJobs: 0,
        quotaSuppressedJobs: 0,
      }),
    });
    expect(
      await db
        .selectFrom("source_control.source_runtime_states")
        .select(["freshness_state", "last_error_code", "next_due_at"])
        .where("source_id", "=", source.sourceId)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      freshness_state: "fresh",
      last_error_code: null,
      next_due_at: new Date("2026-08-03T06:00:00.000Z"),
    });
  });

  it("locks and rejects an in-flight scheduled run after policy or adapter advancement", async () => {
    const source = await createSource({ nextDueAt: new Date("2026-08-02T06:00:00.000Z") });
    expect(
      await db.transaction().execute((transaction) =>
        lockScheduledPolicyForAcceptance({
          transaction,
          sourceId: source.sourceId,
          policyVersion: source.policyVersion,
          adapterKey: "refresh-integration",
          adapterVersion: source.adapterVersion,
        }),
      ),
    ).toBe(true);

    await db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("source_control.source_policy_versions")
        .values({
          source_id: source.sourceId,
          version: 2,
          policy_status: "pending_review",
          provenance_level: "organization_owned",
          acquisition_mode: "public_api",
          adapter_key: "refresh-integration-v2",
          adapter_version: "refresh-integration-v2",
          entrypoints: JSON.stringify([]),
          crawl_interval: "24h",
          refresh_coverage: "full_scope",
          absence_policy: "none",
          policy_notes: "Advanced policy fixture.",
          reviewed_at: new Date("2026-08-02T07:00:00.000Z"),
        })
        .execute();
      await transaction
        .updateTable("source_control.sources")
        .set({ current_policy_version: 2 })
        .where("id", "=", source.sourceId)
        .execute();
      await transaction
        .updateTable("source_control.source_runtime_states")
        .set({
          policy_version: 2,
          freshness_state: "due",
          next_due_at: new Date("2026-08-02T07:00:00.000Z"),
        })
        .where("source_id", "=", source.sourceId)
        .execute();
    });

    expect(
      await db.transaction().execute((transaction) =>
        lockScheduledPolicyForAcceptance({
          transaction,
          sourceId: source.sourceId,
          policyVersion: source.policyVersion,
          adapterKey: "refresh-integration",
          adapterVersion: source.adapterVersion,
        }),
      ),
    ).toBe(false);
    expect(
      await db.transaction().execute((transaction) =>
        lockScheduledPolicyForAcceptance({
          transaction,
          sourceId: source.sourceId,
          policyVersion: 2,
          adapterKey: "refresh-integration-v2",
          adapterVersion: "refresh-integration-v2",
        }),
      ),
    ).toBe(true);
  });

  it("keeps rejected scheduled revisions out of previews until their run is accepted", async () => {
    const source = await createSource();
    const runId = await createRun({
      sourceId: source.sourceId,
      startedAt: new Date("2026-08-01T00:00:00.000Z"),
      automationAcceptance: "rejected",
    });
    const recordId = await createRecord(source.sourceId);
    const revisionId = randomUUID();
    const noEvidenceRevisionId = randomUUID();
    const fetchId = randomUUID();
    revisionIds.push(revisionId);
    revisionIds.push(noEvidenceRevisionId);
    fetchIds.push(fetchId);
    await db
      .insertInto("ingestion.crawl_fetches")
      .values({
        id: fetchId,
        crawl_run_id: runId,
        snapshot_object_id: null,
        method: "GET",
        request_url: "https://refresh-integration.example.test/jobs/one",
        final_url: "https://refresh-integration.example.test/jobs/one",
        request_fingerprint: "a".repeat(64),
        http_status: 200,
        content_type: "application/json",
        response_headers: JSON.stringify({}),
        fetch_result: "success",
        error_code: null,
        fetched_at: new Date("2026-08-01T00:00:00.000Z"),
      })
      .execute();
    await db
      .insertInto("ingestion.source_job_revisions")
      .values({
        id: revisionId,
        source_job_record_id: recordId,
        revision_content_hash: "b".repeat(64),
        import_mode: "collector",
        adapter_version: source.adapterVersion,
        normalizer_version: "refresh-integration-v1",
        company_name: "Refresh integration company",
        title: "Refresh integration intern",
        job_family: JSON.stringify({ state: "known", value: "product", evidenceRefs: [] }),
        locations: JSON.stringify({ state: "known", value: ["Shanghai"], evidenceRefs: [] }),
        business_groups: JSON.stringify([]),
        entry_scope: "internship",
        source_project_name: null,
        recruit_label_name: "internship",
        recruitment_type: JSON.stringify({ state: "known", value: "internship", evidenceRefs: [] }),
        responsibilities: "Support product delivery.",
        requirements: "Current student.",
        structured_fields: JSON.stringify({}),
        ingestion_state: "validated",
        publication_state: "review",
        activity_state: "active",
        source_url: "https://refresh-integration.example.test/jobs/one",
        apply_url: "https://refresh-integration.example.test/jobs/one/apply",
        quality_flags: JSON.stringify([]),
      })
      .execute();
    await db
      .insertInto("ingestion.source_job_revision_evidence")
      .values({
        id: randomUUID(),
        revision_id: revisionId,
        crawl_fetch_id: fetchId,
        evidence_role: "detail",
        field_name: "title",
        json_pointer: "/title",
        raw_value_hash: "c".repeat(64),
      })
      .execute();
    await db
      .insertInto("ingestion.source_job_revisions")
      .values({
        id: noEvidenceRevisionId,
        source_job_record_id: recordId,
        revision_content_hash: "d".repeat(64),
        import_mode: "collector",
        adapter_version: source.adapterVersion,
        normalizer_version: "refresh-integration-v1",
        company_name: "Refresh integration company",
        title: "Unevidenced refresh integration intern",
        job_family: JSON.stringify({ state: "known", value: "product", evidenceRefs: [] }),
        locations: JSON.stringify({ state: "known", value: ["Shanghai"], evidenceRefs: [] }),
        business_groups: JSON.stringify([]),
        entry_scope: "internship",
        source_project_name: null,
        recruit_label_name: "internship",
        recruitment_type: JSON.stringify({
          state: "known",
          value: "internship",
          evidenceRefs: [],
        }),
        responsibilities: "This revision has no source evidence.",
        requirements: "Current student.",
        structured_fields: JSON.stringify({}),
        ingestion_state: "validated",
        publication_state: "review",
        activity_state: "active",
        source_url: "https://refresh-integration.example.test/jobs/one",
        apply_url: "https://refresh-integration.example.test/jobs/one/apply",
        quality_flags: JSON.stringify([]),
      })
      .execute();

    expect(
      await db
        .selectFrom("catalog.internal_job_previews")
        .select("revision_id")
        .where("revision_id", "=", revisionId)
        .execute(),
    ).toEqual([]);
    expect(
      await db
        .selectFrom("catalog.internal_job_previews")
        .select("revision_id")
        .where("revision_id", "=", noEvidenceRevisionId)
        .execute(),
    ).toEqual([]);
    await db
      .updateTable("ingestion.crawl_runs")
      .set({ automation_acceptance: "accepted" })
      .where("id", "=", runId)
      .execute();
    expect(
      await db
        .selectFrom("catalog.internal_job_previews")
        .select("revision_id")
        .where("revision_id", "=", revisionId)
        .execute(),
    ).toEqual([{ revision_id: revisionId }]);
    expect(
      await db
        .selectFrom("catalog.internal_job_previews")
        .select("revision_id")
        .where("revision_id", "=", noEvidenceRevisionId)
        .execute(),
    ).toEqual([]);
    const publicCatalog = createCatalogRepository({ db, enableLocalMvp: false });
    expect(
      await publicCatalog.search(
        JobSearchQuerySchema.parse({ keyword: "Refresh integration intern" }),
      ),
    ).toMatchObject({
      items: [],
    });

    await applyDirectSourceJobClosures({
      db,
      recordIds: [recordId],
      runId,
      reason: "http_404",
      observedAt: new Date("2026-08-01T01:00:00.000Z"),
    });
    expect(
      await db
        .selectFrom("ingestion.source_job_activity_states")
        .select(["direct_state", "direct_reason"])
        .where("source_job_record_id", "=", recordId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ direct_state: "closed", direct_reason: "http_404" });
    await updateSourceJobActivityAfterRun({
      db,
      sourceId: source.sourceId,
      runId,
      observedAt: new Date("2026-08-01T02:00:00.000Z"),
      completion: "partial",
      refreshCoverage: "tracked_records",
      absencePolicy: "none",
      minimumHours: 24,
    });
    expect(
      await db
        .selectFrom("ingestion.source_job_activity_states")
        .select(["direct_state", "direct_reason"])
        .where("source_job_record_id", "=", recordId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ direct_state: "active", direct_reason: null });
  });

  it("keeps the collector network path disabled and pauses stale DB task policy", async () => {
    let executeCalls = 0;
    expect(
      await runOneCollectorCycle({
        db,
        config: {
          appEnv: "local",
          enableSourceProbe: true,
          snapshotDir: workspaceRoot,
          probeRequestIntervalMs: 2_000,
          workspaceRoot,
        },
        executeRefresh: async () => {
          executeCalls += 1;
          throw new Error("network execution must remain disabled");
        },
      }),
    ).toMatchObject({ state: "disabled" });
    expect(executeCalls).toBe(0);

    const controller = new AbortController();
    const cycleStates: string[] = [];
    await runCollectorWorker({
      db,
      config: {
        appEnv: "local",
        enableSourceProbe: true,
        snapshotDir: workspaceRoot,
        probeRequestIntervalMs: 2_000,
        workspaceRoot,
      },
      signal: controller.signal,
      scanIntervalMs: 1,
      onCycle: (result) => {
        cycleStates.push(result.state);
        controller.abort();
      },
    });
    expect(cycleStates).toEqual(["disabled"]);

    let refreshControlReads = 0;
    expect(
      await runOneCollectorCycle({
        db,
        now: new Date("2026-08-03T11:59:00.000Z"),
        config: {
          appEnv: "local",
          enableSourceProbe: true,
          snapshotDir: workspaceRoot,
          probeRequestIntervalMs: 2_000,
          workspaceRoot,
        },
        readRefreshControl: () => ({
          version: 1,
          enabled: refreshControlReads++ === 0,
          updatedAt: new Date("2026-08-03T11:59:00.000Z").toISOString(),
        }),
        executeRefresh: async () => {
          executeCalls += 1;
          throw new Error("network execution must stop after refresh disable");
        },
      }),
    ).toMatchObject({ state: "disabled" });
    expect(refreshControlReads).toBe(2);
    expect(executeCalls).toBe(0);

    let configSourceKey: string | undefined;
    for (const sourceKey of await listSourceKeys()) {
      const existing = await db
        .selectFrom("source_control.sources")
        .select("id")
        .where("source_key", "=", sourceKey)
        .executeTakeFirst();
      if (!existing) {
        configSourceKey = sourceKey;
        break;
      }
    }
    if (!configSourceKey)
      throw new Error("missing unused configured source key for stale-policy test");
    const configured = await loadSourceConfig(configSourceKey);
    await db
      .updateTable("source_control.source_runtime_states")
      .set({ next_due_at: null })
      .where("source_id", "in", sourceIds)
      .execute();
    writeLocalRefreshControl({ rootDirectory: workspaceRoot, enabled: true });
    const stale = await createSource({
      sourceKey: configSourceKey,
      policyVersion: configured.policy.version,
      adapterVersion: `${configured.policy.adapterVersion}-stale`,
      nextDueAt: new Date("2026-08-03T00:00:00.000Z"),
    });
    expect(
      await runOneCollectorCycle({
        db,
        now: new Date("2026-08-03T12:00:00.000Z"),
        config: {
          appEnv: "local",
          enableSourceProbe: true,
          snapshotDir: workspaceRoot,
          probeRequestIntervalMs: 2_000,
          workspaceRoot,
        },
      }),
    ).toMatchObject({
      state: "source_paused",
      sourceKey: configSourceKey,
      errorCode: "SCHEDULED_TASK_POLICY_STALE",
    });
    expect(
      await db
        .selectFrom("source_control.source_runtime_states")
        .select(["automation_paused", "automation_pause_reason", "next_due_at"])
        .where("source_id", "=", stale.sourceId)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      automation_paused: true,
      automation_pause_reason: "SCHEDULED_TASK_POLICY_STALE",
      next_due_at: null,
    });
    expect(
      await runOneCollectorCycle({
        db,
        now: new Date("2026-08-03T12:01:00.000Z"),
        config: {
          appEnv: "local",
          enableSourceProbe: true,
          snapshotDir: workspaceRoot,
          probeRequestIntervalMs: 2_000,
          workspaceRoot,
        },
      }),
    ).toMatchObject({ state: "circuit_open_or_not_due" });
  });

  it("isolates an exhausted scheduled task so the next due source can run", async () => {
    await db
      .updateTable("source_control.source_runtime_states")
      .set({ next_due_at: null })
      .where("source_id", "in", sourceIds)
      .execute();
    const [deadConfig, followingConfig] = await loadUnusedScheduledSourceConfigs(2);
    if (!deadConfig || !followingConfig) throw new Error("missing scheduled source fixtures");
    const now = new Date("2030-01-01T12:00:00.000Z");
    const deadSource = await createSource({
      sourceKey: deadConfig.sourceKey,
      policyVersion: deadConfig.policy.version,
      adapterVersion: deadConfig.policy.adapterVersion,
      nextDueAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    const followingSource = await createSource({
      sourceKey: followingConfig.sourceKey,
      policyVersion: followingConfig.policy.version,
      adapterVersion: followingConfig.policy.adapterVersion,
      nextDueAt: new Date("2030-01-01T11:00:00.000Z"),
    });
    writeLocalRefreshControl({ rootDirectory: workspaceRoot, enabled: true });

    const executeRefresh = vi.fn(async (input: { sourceKey: string }) => {
      if (input.sourceKey === deadSource.sourceKey) throw new Error("PROBE_TASK_DEAD");
      return fakeProbeResult();
    });
    expect(
      await runOneCollectorCycle({
        db,
        now,
        config: {
          appEnv: "local",
          enableSourceProbe: true,
          snapshotDir: workspaceRoot,
          probeRequestIntervalMs: 2_000,
          workspaceRoot,
        },
        executeRefresh,
      }),
    ).toMatchObject({
      state: "source_deferred",
      sourceKey: deadSource.sourceKey,
      errorCode: "PROBE_TASK_DEAD",
    });
    expect(
      await db
        .selectFrom("source_control.source_runtime_states")
        .select([
          "freshness_state",
          "automation_paused",
          "automation_pause_reason",
          "consecutive_failures",
          "last_error_code",
          "next_due_at",
        ])
        .where("source_id", "=", deadSource.sourceId)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      freshness_state: "stale",
      automation_paused: false,
      automation_pause_reason: null,
      consecutive_failures: 1,
      last_error_code: "PROBE_TASK_DEAD",
      next_due_at: new Date(
        now.getTime() + deadConfig.policy.crawlInterval.minimumHours * 60 * 60 * 1_000,
      ),
    });

    expect(
      await runOneCollectorCycle({
        db,
        now,
        config: {
          appEnv: "local",
          enableSourceProbe: true,
          snapshotDir: workspaceRoot,
          probeRequestIntervalMs: 2_000,
          workspaceRoot,
        },
        executeRefresh,
      }),
    ).toMatchObject({ state: "ran", sourceKey: followingSource.sourceKey });
    expect(executeRefresh).toHaveBeenCalledTimes(2);
    await db
      .updateTable("source_control.source_runtime_states")
      .set({ next_due_at: null })
      .where("source_id", "=", followingSource.sourceId)
      .execute();
  });

  it("waits for the active collector cycle before disable can return", async () => {
    await db
      .updateTable("source_control.source_runtime_states")
      .set({ next_due_at: null })
      .where("source_id", "in", sourceIds)
      .execute();
    const [sourceConfig] = await loadUnusedScheduledSourceConfigs(1);
    if (!sourceConfig) throw new Error("missing scheduled source fixture");
    const now = new Date("2030-01-02T12:00:00.000Z");
    await createSource({
      sourceKey: sourceConfig.sourceKey,
      policyVersion: sourceConfig.policy.version,
      adapterVersion: sourceConfig.policy.adapterVersion,
      nextDueAt: new Date("2030-01-02T11:00:00.000Z"),
    });

    let refreshControlReads = 0;
    const executeBeforeFinalCheck = vi.fn(async () => fakeProbeResult());
    await expect(
      runOneCollectorCycle({
        db,
        now,
        config: {
          appEnv: "local",
          enableSourceProbe: true,
          snapshotDir: workspaceRoot,
          probeRequestIntervalMs: 2_000,
          workspaceRoot,
        },
        readRefreshControl: () => ({
          version: 1,
          enabled: refreshControlReads++ < 2,
          updatedAt: now.toISOString(),
        }),
        executeRefresh: executeBeforeFinalCheck,
      }),
    ).resolves.toMatchObject({ state: "disabled" });
    expect(refreshControlReads).toBe(3);
    expect(executeBeforeFinalCheck).not.toHaveBeenCalled();

    writeLocalRefreshControl({ rootDirectory: workspaceRoot, enabled: true });

    let markExecutionStarted: (() => void) | undefined;
    const executionStarted = new Promise<void>((resolve) => {
      markExecutionStarted = resolve;
    });
    let finishExecution: (() => void) | undefined;
    const executionCanFinish = new Promise<void>((resolve) => {
      finishExecution = resolve;
    });
    const cycle = runOneCollectorCycle({
      db,
      now,
      config: {
        appEnv: "local",
        enableSourceProbe: true,
        snapshotDir: workspaceRoot,
        probeRequestIntervalMs: 2_000,
        workspaceRoot,
      },
      executeRefresh: async () => {
        markExecutionStarted?.();
        await executionCanFinish;
        return fakeProbeResult();
      },
    });
    await executionStarted;

    writeLocalRefreshControl({ rootDirectory: workspaceRoot, enabled: false });
    const barrier = waitForCollectorIdle(db).then(() => "released" as const);
    expect(
      await Promise.race([
        barrier,
        new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 50)),
      ]),
    ).toBe("waiting");

    finishExecution?.();
    await expect(cycle).resolves.toMatchObject({ state: "ran" });
    await expect(barrier).resolves.toBe("released");

    const executeAfterDisable = vi.fn(async () => fakeProbeResult());
    await expect(
      runOneCollectorCycle({
        db,
        now,
        config: {
          appEnv: "local",
          enableSourceProbe: true,
          snapshotDir: workspaceRoot,
          probeRequestIntervalMs: 2_000,
          workspaceRoot,
        },
        executeRefresh: executeAfterDisable,
      }),
    ).resolves.toMatchObject({ state: "disabled" });
    expect(executeAfterDisable).not.toHaveBeenCalled();
  });

  it("uses a PostgreSQL advisory lock for global collector single concurrency", async () => {
    writeLocalRefreshControl({ rootDirectory: workspaceRoot, enabled: true });
    await db.connection().execute(async (connection) => {
      await sql`SELECT pg_advisory_lock(${COLLECTOR_ADVISORY_LOCK_KEY})`.execute(connection);
      try {
        expect(
          await runOneCollectorCycle({
            db,
            now: new Date("2026-08-04T12:00:00.000Z"),
            config: {
              appEnv: "local",
              enableSourceProbe: true,
              snapshotDir: workspaceRoot,
              probeRequestIntervalMs: 2_000,
              workspaceRoot,
            },
          }),
        ).toMatchObject({ state: "collector_busy" });
      } finally {
        await sql`SELECT pg_advisory_unlock(${COLLECTOR_ADVISORY_LOCK_KEY})`.execute(connection);
      }
    });
  });
});
