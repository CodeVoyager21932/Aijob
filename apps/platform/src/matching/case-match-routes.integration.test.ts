import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import {
  CaseMatchStateSchema,
  CreateApplicationCaseResponseSchema,
  MatchRunTaskPayloadSchema,
} from "@aijob/contracts";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME } from "../identity/fastify.js";
import { createAnonymousSession } from "../identity/session-repository.js";
import {
  putJobPreferences,
  putProfileFacts,
  putResumeEvidence,
} from "../profile/revision-repository.js";
import type { OwnerTaskLease } from "../workers/owner-task-lease.js";
import { finishOwnerTask } from "../workers/owner-task-worker.js";
import { getMatchRun, processMatchRun } from "./service.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const encryptionKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const unknown = JSON.stringify({ state: "unknown", reason: "source_not_stated" });

function config(): AppConfig {
  return {
    appEnv: "test",
    databaseUrl: databaseUrl as string,
    snapshotDirectory: ".data/job-snapshots",
    host: "127.0.0.1",
    port: 3000,
    probeRequestIntervalMs: 750,
    logLevel: "silent",
    enableInternalPreview: true,
    enableSourceProbe: false,
    enableLocalMvp: true,
    resumeEncryptionKey: encryptionKey,
    resumeMaxBytes: 5 * 1024 * 1024,
    ai: { enabled: false, requestTimeoutMs: 30_000 },
    identity: { acceptedOrigins: [], alphaInviteCodeHashes: [] },
    workspaceRoot: ".",
  };
}

function sessionHeaders(session: { sessionToken: string; csrfToken: string }) {
  return {
    host: "127.0.0.1:3000",
    origin: "http://127.0.0.1:3000",
    cookie: `${SESSION_COOKIE_NAME}=${session.sessionToken}; ${CSRF_COOKIE_NAME}=${session.csrfToken}`,
    [CSRF_HEADER_NAME]: session.csrfToken,
  };
}

describeWithDatabase("Case-scoped matching API and worker context", () => {
  let app: FastifyInstance;
  let db: Kysely<Database>;
  let ownerSession: Awaited<ReturnType<typeof createAnonymousSession>>;
  let otherSession: Awaited<ReturnType<typeof createAnonymousSession>>;
  const organizationId = randomUUID();
  const sourceId = randomUUID();
  const jobs = {
    upgrade: {
      jobId: randomUUID(),
      recordId: randomUUID(),
      versions: [
        { versionId: randomUUID(), revisionId: randomUUID(), requirementSetId: randomUUID() },
        { versionId: randomUUID(), revisionId: randomUUID(), requirementSetId: randomUUID() },
      ],
    },
    deletion: {
      jobId: randomUUID(),
      recordId: randomUUID(),
      versions: [
        { versionId: randomUUID(), revisionId: randomUUID(), requirementSetId: randomUUID() },
      ],
    },
  };

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
    ownerSession = await createAnonymousSession({ db });
    otherSession = await createAnonymousSession({ db });
    await db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("source_control.organizations")
        .values({
          id: organizationId,
          slug: `case-match-${organizationId}`,
          name: "Case Match Synthetic Company",
          official_domain: "case-match.example.test",
        })
        .execute();
      await transaction
        .insertInto("source_control.sources")
        .values({
          id: sourceId,
          organization_id: organizationId,
          source_candidate_id: null,
          source_key: `case-match-${sourceId}`,
          source_type: "organization_career_site",
          name: "Case Match Synthetic Source",
          current_policy_version: 1,
        })
        .execute();
      await transaction
        .insertInto("source_control.source_policy_versions")
        .values({
          source_id: sourceId,
          version: 1,
          policy_status: "approved",
          config_registered: true,
          catalog_role: "canonical",
          runtime_scope: "local",
          provenance_level: "organization_owned",
          acquisition_mode: "public_api",
          adapter_key: "case-match-synthetic",
          adapter_version: "1",
          entrypoints: JSON.stringify(["https://case-match.example.test/jobs"]),
          crawl_interval: "24h",
          policy_notes: "Offline synthetic OS-4 fixture.",
          reviewed_at: new Date(),
        })
        .execute();
      await transaction
        .insertInto("source_control.source_runtime_states")
        .values({
          source_id: sourceId,
          policy_version: 1,
          freshness_state: "fresh",
          last_complete_run_at: new Date(),
          consecutive_failures: 0,
          last_error_code: null,
          next_due_at: null,
        })
        .execute();

      for (const [jobIndex, fixture] of Object.values(jobs).entries()) {
        const sourceUrl = `https://case-match.example.test/jobs/${fixture.recordId}`;
        await transaction
          .insertInto("ingestion.source_job_records")
          .values({
            id: fixture.recordId,
            source_id: sourceId,
            source_job_id: `case-match-${fixture.recordId}`,
            canonical_source_url: sourceUrl,
            first_seen_at: new Date(),
            last_seen_at: new Date(),
          })
          .execute();
        await transaction
          .insertInto("catalog.published_jobs")
          .values({ id: fixture.jobId, current_version_id: null, public_version_id: null })
          .execute();
        for (const [versionIndex, version] of fixture.versions.entries()) {
          const hashCharacter = String.fromCharCode(97 + jobIndex * 4 + versionIndex);
          await transaction
            .insertInto("ingestion.source_job_revisions")
            .values({
              id: version.revisionId,
              source_job_record_id: fixture.recordId,
              revision_content_hash: hashCharacter.repeat(64),
              import_mode: "manual",
              adapter_version: "1",
              normalizer_version: "1",
              company_name: "Case Match Synthetic Company",
              title: `Synthetic product internship ${jobIndex + 1}.${versionIndex + 1}`,
              job_family: JSON.stringify({
                state: "known",
                value: "product",
                evidenceRefs: [`${version.revisionId}#family`],
              }),
              locations: JSON.stringify({
                state: "known",
                value: ["Shanghai"],
                evidenceRefs: [`${version.revisionId}#location`],
              }),
              business_groups: JSON.stringify([]),
              entry_scope: "internship",
              source_project_name: null,
              recruit_label_name: "internship",
              recruitment_type: JSON.stringify({
                state: "known",
                value: "internship",
                evidenceRefs: [`${version.revisionId}#type`],
              }),
              responsibilities: "Synthetic product research responsibilities.",
              requirements: "Current student; familiar with SQL.",
              structured_fields: JSON.stringify({}),
              ingestion_state: "validated",
              publication_state: "published",
              activity_state: "active",
              source_url: sourceUrl,
              apply_url: `${sourceUrl}/apply`,
              quality_flags: JSON.stringify([]),
            })
            .execute();
          await transaction
            .insertInto("catalog.published_job_versions")
            .values({
              id: version.versionId,
              published_job_id: fixture.jobId,
              source_job_revision_id: version.revisionId,
              content_hash: hashCharacter.repeat(64),
              company_name: "Case Match Synthetic Company",
              title: `Synthetic product internship ${jobIndex + 1}.${versionIndex + 1}`,
              job_family: JSON.stringify({
                state: "known",
                value: "product",
                evidenceRefs: [`${version.revisionId}#family`],
              }),
              locations: unknown,
              responsibilities: "Synthetic product research responsibilities.",
              requirements: "Current student; familiar with SQL.",
              structured_fields: JSON.stringify({}),
              activity_state: "active",
              source_url: sourceUrl,
              apply_url: `${sourceUrl}/apply`,
              effective_at: new Date(Date.now() + versionIndex * 1_000),
            })
            .execute();
          await transaction
            .insertInto("catalog.job_requirement_sets")
            .values({
              id: version.requirementSetId,
              published_job_version_id: version.versionId,
              schema_version: "case-match-synthetic-v1",
              requirements: JSON.stringify([
                {
                  id: `sql-${version.versionId}`,
                  kind: "skill",
                  operator: "contains",
                  expectedValue: "SQL",
                  sourceText: "熟悉 SQL",
                  evidenceRefs: [`${version.revisionId}#sql`],
                  sourceSpan: null,
                  necessity: "required",
                },
              ]),
              content_hash: hashCharacter.repeat(64),
            })
            .execute();
          await transaction
            .insertInto("catalog.job_condition_projections")
            .values({
              published_job_version_id: version.versionId,
              requirement_set_id: version.requirementSetId,
              locations: JSON.stringify({
                state: "known",
                value: ["Shanghai"],
                evidenceRefs: [`${version.revisionId}#location`],
              }),
              weekly_attendance_days: unknown,
              duration_months: unknown,
              earliest_start_date: unknown,
              graduation_years: unknown,
              student_status: unknown,
              education_levels: unknown,
              majors: unknown,
              languages: unknown,
            })
            .execute();
          await transaction
            .updateTable("catalog.published_job_versions")
            .set({ active_requirement_set_id: version.requirementSetId })
            .where("id", "=", version.versionId)
            .execute();
        }
        const initial = fixture.versions[0];
        if (!initial) throw new Error("CASE_MATCH_VERSION_FIXTURE_MISSING");
        await transaction
          .updateTable("catalog.published_jobs")
          .set({ current_version_id: initial.versionId, public_version_id: initial.versionId })
          .where("id", "=", fixture.jobId)
          .execute();
      }
    });
    app = buildApp({ config: config(), db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const ownerIds = [ownerSession.context.ownerId, otherSession.context.ownerId];
    const allJobs = Object.values(jobs);
    const jobIds = allJobs.map(({ jobId }) => jobId);
    const recordIds = allJobs.map(({ recordId }) => recordId);
    const versions = allJobs.flatMap(({ versions: items }) => items);
    const versionIds = versions.map(({ versionId }) => versionId);
    await db.transaction().execute(async (transaction) => {
      await transaction.deleteFrom("task_queue.tasks").where("owner_id", "in", ownerIds).execute();
      await transaction
        .deleteFrom("matching.match_runs")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("application.application_cases")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .updateTable("application.private_job_snapshots")
        .set({ current_content_revision: null, current_requirement_set_revision: null })
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("application.private_job_snapshots")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("profile.resume_evidence_revisions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("profile.resume_document_revisions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("profile.job_preference_revisions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("profile.profile_fact_revisions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("identity.owner_sessions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction.deleteFrom("identity.owners").where("id", "in", ownerIds).execute();
      await transaction
        .updateTable("catalog.published_jobs")
        .set({ current_version_id: null, public_version_id: null })
        .where("id", "in", jobIds)
        .execute();
      await transaction
        .updateTable("catalog.published_job_versions")
        .set({ active_requirement_set_id: null })
        .where("id", "in", versionIds)
        .execute();
      await transaction
        .deleteFrom("catalog.job_condition_projections")
        .where("published_job_version_id", "in", versionIds)
        .execute();
      await transaction
        .deleteFrom("catalog.job_requirement_sets")
        .where("published_job_version_id", "in", versionIds)
        .execute();
      await transaction
        .deleteFrom("catalog.published_job_versions")
        .where("id", "in", versionIds)
        .execute();
      await transaction.deleteFrom("catalog.published_jobs").where("id", "in", jobIds).execute();
      await transaction
        .deleteFrom("ingestion.source_job_revisions")
        .where(
          "id",
          "in",
          versions.map(({ revisionId }) => revisionId),
        )
        .execute();
      await transaction
        .deleteFrom("ingestion.source_job_records")
        .where("id", "in", recordIds)
        .execute();
      await transaction
        .deleteFrom("source_control.source_runtime_states")
        .where("source_id", "=", sourceId)
        .execute();
      await transaction
        .deleteFrom("source_control.source_policy_versions")
        .where("source_id", "=", sourceId)
        .execute();
      await transaction.deleteFrom("source_control.sources").where("id", "=", sourceId).execute();
      await transaction
        .deleteFrom("source_control.organizations")
        .where("id", "=", organizationId)
        .execute();
    });
    await db.destroy();
  });

  async function createPublicCase(job: (typeof jobs)[keyof typeof jobs]) {
    const version = job.versions[0];
    if (!version) throw new Error("CASE_MATCH_VERSION_FIXTURE_MISSING");
    const response = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: {
        ...sessionHeaders(ownerSession),
        "idempotency-key": `case-match-case-${randomUUID()}`,
      },
      payload: {
        jobContext: {
          kind: "public",
          publishedJobId: job.jobId,
          publishedJobVersionId: version.versionId,
        },
      },
    });
    expect(response.statusCode).toBe(201);
    return CreateApplicationCaseResponseSchema.parse(response.json()).applicationCase;
  }

  async function claimCaseMatchTask(idempotencyKey: string) {
    const leaseOwner = `case-match-test-${randomUUID()}`;
    const task = await db
      .updateTable("task_queue.tasks")
      .set((expression) => ({
        status: "running",
        attempt: expression("attempt", "+", 1),
        lease_owner: leaseOwner,
        lease_until: new Date(Date.now() + 60_000),
        heartbeat_at: new Date(),
        fencing_token: expression("fencing_token", "+", 1),
      }))
      .where(
        "idempotency_key",
        "=",
        `owner:${ownerSession.context.ownerId}:match:${idempotencyKey}`,
      )
      .where("status", "=", "queued")
      .returningAll()
      .executeTakeFirstOrThrow();
    const payload = MatchRunTaskPayloadSchema.parse(task.payload);
    if (!("executionContext" in payload)) throw new Error("CASE_MATCH_CONTEXT_MISSING");
    const lease: OwnerTaskLease = {
      taskId: task.id,
      taskType: task.task_type,
      ownerId: ownerSession.context.ownerId,
      ownerEpoch: ownerSession.context.ownerEpoch,
      leaseOwner,
      fencingToken: Number(task.fencing_token),
    };
    return { task, payload, lease };
  }

  it("keeps Case matching pinned, owner-scoped, idempotent and race-safe", async () => {
    const headers = sessionHeaders(ownerSession);
    const upgradeCase = await createPublicCase(jobs.upgrade);
    const incomplete = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${upgradeCase.id}/match-state`,
      headers,
    });
    expect(incomplete.statusCode).toBe(200);
    expect(CaseMatchStateSchema.parse(incomplete.json())).toMatchObject({
      status: "profile_incomplete",
      catalogState: "current",
      missingInputs: ["facts", "preferences", "evidence"],
      input: null,
      run: null,
    });

    const crossOwner = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${upgradeCase.id}/match-state`,
      headers: sessionHeaders(otherSession),
    });
    expect(crossOwner.statusCode).toBe(404);
    expect(crossOwner.json()).toMatchObject({ code: "APPLICATION_CASE_NOT_FOUND" });

    const privateCreated = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": `private-case-${randomUUID()}` },
      payload: {
        jobContext: {
          kind: "private_input",
          title: "Synthetic private internship",
          companyName: null,
          contentText: "Synthetic private JD used only for OS-4 integration verification.",
          source: { kind: "unspecified" },
        },
      },
    });
    expect(privateCreated.statusCode).toBe(201);
    const privateCase = CreateApplicationCaseResponseSchema.parse(
      privateCreated.json(),
    ).applicationCase;
    const privateState = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${privateCase.id}/match-state`,
      headers,
    });
    expect(CaseMatchStateSchema.parse(privateState.json())).toMatchObject({
      status: "not_applicable_private",
      input: null,
      catalogState: null,
      run: null,
    });
    const privatePost = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${privateCase.id}/match-runs`,
      headers: { ...headers, "idempotency-key": `private-match-${randomUUID()}` },
      payload: { expectedCaseRevision: privateCase.revision },
    });
    expect(privatePost.statusCode).toBe(422);
    expect(privatePost.json()).toMatchObject({ code: "CASE_MATCH_NOT_APPLICABLE_PRIVATE" });

    const facts = await putProfileFacts({
      db,
      owner: ownerSession.context,
      expectedRevision: 0,
      facts: [
        { key: "current_student", value: true },
        { key: "weekly_attendance_days", value: 4 },
      ],
    });
    await putJobPreferences({
      db,
      owner: ownerSession.context,
      expectedRevision: 0,
      preferences: {
        cities: ["Shanghai"],
        jobFamilies: ["product"],
        companyNames: [],
        workModes: [],
      },
    });
    await putResumeEvidence({
      db,
      owner: ownerSession.context,
      expectedRevision: 0,
      resumeAnalysisId: null,
      document: {
        schemaVersion: "resume-document-v1",
        sections: [
          {
            id: randomUUID(),
            ordinal: 0,
            title: "合成项目经历",
            blocks: [
              {
                id: randomUUID(),
                ordinal: 0,
                text: "仅用于 OS-4 隔离测试的合成项目经历。",
              },
            ],
          },
        ],
      },
      evidence: [],
    });
    const ready = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${upgradeCase.id}/match-state`,
      headers,
    });
    expect(CaseMatchStateSchema.parse(ready.json())).toMatchObject({
      status: "not_run",
      catalogState: "current",
      missingInputs: [],
      input: { profileFactRevisionId: facts.id },
    });

    const staleRevision = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${upgradeCase.id}/match-runs`,
      headers: { ...headers, "idempotency-key": `stale-case-${randomUUID()}` },
      payload: { expectedCaseRevision: upgradeCase.revision + 1 },
    });
    expect(staleRevision.statusCode).toBe(409);
    expect(staleRevision.json()).toMatchObject({ code: "APPLICATION_CASE_REVISION_CONFLICT" });

    const firstMatchKey = `fixed-old-version-${randomUUID()}`;
    const queued = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${upgradeCase.id}/match-runs`,
      headers: { ...headers, "idempotency-key": firstMatchKey },
      payload: { expectedCaseRevision: upgradeCase.revision },
    });
    expect(queued.statusCode).toBe(202);
    const queuedState = CaseMatchStateSchema.parse(queued.json());
    expect(queuedState).toMatchObject({ status: "queued", catalogState: "current" });
    const replay = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${upgradeCase.id}/match-runs`,
      headers: { ...headers, "idempotency-key": firstMatchKey },
      payload: { expectedCaseRevision: upgradeCase.revision },
    });
    expect(CaseMatchStateSchema.parse(replay.json()).run?.id).toBe(queuedState.run?.id);

    const upgradeTarget = jobs.upgrade.versions[1];
    if (!upgradeTarget) throw new Error("CASE_MATCH_UPGRADE_FIXTURE_MISSING");
    await db
      .updateTable("catalog.published_jobs")
      .set({
        current_version_id: upgradeTarget.versionId,
        public_version_id: upgradeTarget.versionId,
      })
      .where("id", "=", jobs.upgrade.jobId)
      .execute();
    const firstTask = await claimCaseMatchTask(firstMatchKey);
    await processMatchRun(db, ownerSession.context, firstTask.payload.runId, firstTask.lease, {
      enableLocalMvp: true,
      executionContext: firstTask.payload.executionContext,
    });
    await finishOwnerTask(db, firstTask.task, firstTask.lease.leaseOwner);
    const fixedOldResult = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${upgradeCase.id}/match-state`,
      headers,
    });
    expect(CaseMatchStateSchema.parse(fixedOldResult.json())).toMatchObject({
      status: "current",
      catalogState: "stale",
      input: { publishedJobVersionId: jobs.upgrade.versions[0]?.versionId },
      run: { status: "succeeded" },
    });

    const changedFacts = await putProfileFacts({
      db,
      owner: ownerSession.context,
      expectedRevision: facts.revision,
      facts: [
        { key: "current_student", value: true },
        { key: "weekly_attendance_days", value: 5 },
      ],
    });
    const staleProfile = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${upgradeCase.id}/match-state`,
      headers,
    });
    expect(CaseMatchStateSchema.parse(staleProfile.json())).toMatchObject({
      status: "stale",
      staleReasons: ["profile_facts"],
      input: { profileFactRevisionId: changedFacts.id },
    });
    const reusedAfterInputChange = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${upgradeCase.id}/match-runs`,
      headers: { ...headers, "idempotency-key": firstMatchKey },
      payload: { expectedCaseRevision: upgradeCase.revision },
    });
    expect(reusedAfterInputChange.statusCode).toBe(409);
    expect(reusedAfterInputChange.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const upgradeRaceKey = `upgrade-race-${randomUUID()}`;
    const upgradeRaceQueued = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${upgradeCase.id}/match-runs`,
      headers: { ...headers, "idempotency-key": upgradeRaceKey },
      payload: { expectedCaseRevision: upgradeCase.revision },
    });
    const upgradeRaceRunId = CaseMatchStateSchema.parse(upgradeRaceQueued.json()).run?.id;
    expect(upgradeRaceRunId).toBeTruthy();
    const upgraded = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${upgradeCase.id}/job-version-upgrades`,
      headers: { ...headers, "idempotency-key": `confirm-upgrade-${randomUUID()}` },
      payload: {
        expectedRevision: upgradeCase.revision,
        targetPublishedJobVersionId: upgradeTarget.versionId,
      },
    });
    expect(upgraded.statusCode).toBe(200);
    const upgradeRaceTask = await claimCaseMatchTask(upgradeRaceKey);
    await expect(
      processMatchRun(
        db,
        ownerSession.context,
        upgradeRaceTask.payload.runId,
        upgradeRaceTask.lease,
        { enableLocalMvp: true, executionContext: upgradeRaceTask.payload.executionContext },
      ),
    ).rejects.toMatchObject({ code: "CASE_MATCH_CONTEXT_CHANGED" });
    await expect(
      getMatchRun(db, ownerSession.context, upgradeRaceRunId as string),
    ).resolves.toMatchObject({ status: "failed", failureCode: "CASE_MATCH_CONTEXT_CHANGED" });
    const upgradedState = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${upgradeCase.id}/match-state`,
      headers,
    });
    expect(CaseMatchStateSchema.parse(upgradedState.json())).toMatchObject({
      status: "stale",
      catalogState: "current",
      staleReasons: ["case_job_version"],
    });

    const deletionCase = await createPublicCase(jobs.deletion);
    const deleteRaceKey = `delete-race-${randomUUID()}`;
    const deleteRaceQueued = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${deletionCase.id}/match-runs`,
      headers: { ...headers, "idempotency-key": deleteRaceKey },
      payload: { expectedCaseRevision: deletionCase.revision },
    });
    const deleteRaceRunId = CaseMatchStateSchema.parse(deleteRaceQueued.json()).run?.id;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    const deleted = await app
      .inject({
        method: "DELETE",
        url: `/v1/application-cases/${deletionCase.id}`,
        headers,
        payload: {
          expectedRevision: deletionCase.revision,
          resumeDocuments: "delete",
          interviewSessions: "delete",
          debriefs: "delete",
        },
      })
      .finally(() => vi.useRealTimers());
    expect(deleted.statusCode, deleted.body).toBe(200);
    const deleteRaceTask = await claimCaseMatchTask(deleteRaceKey);
    await expect(
      processMatchRun(
        db,
        ownerSession.context,
        deleteRaceTask.payload.runId,
        deleteRaceTask.lease,
        { enableLocalMvp: true, executionContext: deleteRaceTask.payload.executionContext },
      ),
    ).rejects.toMatchObject({ code: "CASE_MATCH_CONTEXT_CHANGED" });
    await expect(
      getMatchRun(db, ownerSession.context, deleteRaceRunId as string),
    ).resolves.toMatchObject({ status: "failed", failureCode: "CASE_MATCH_CONTEXT_CHANGED" });
    const deletedState = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${deletionCase.id}/match-state`,
      headers,
    });
    expect(deletedState.statusCode).toBe(404);
    expect(deletedState.json()).toMatchObject({ code: "APPLICATION_CASE_NOT_FOUND" });

    const activeTaskCount = await db
      .selectFrom("task_queue.tasks")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("owner_id", "=", ownerSession.context.ownerId)
      .where("task_type", "=", "match_run")
      .where("status", "=", "succeeded")
      .executeTakeFirstOrThrow();
    expect(Number(activeTaskCount.count)).toBeGreaterThanOrEqual(1);
    await sql`select 1`.execute(db);
  }, 45_000);
});
