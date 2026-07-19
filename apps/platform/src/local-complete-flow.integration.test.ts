import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import type { JobRequirement, ResumeEvidence } from "@aijob/contracts";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lockLocalCatalogMaterialization } from "./catalog/materialize.js";
import { putJobDecision } from "./decisions/service.js";
import { createAnonymousSession } from "./identity/session-repository.js";
import {
  enqueueMatchRun,
  enqueueRecommendationRun,
  getMatchRun,
  getRecommendationRun,
} from "./matching/service.js";
import {
  putJobPreferences,
  putProfileFacts,
  putResumeEvidence,
} from "./profile/revision-repository.js";
import { getResumeAnalysis, submitResumeAnalysis } from "./resume/repository.js";
import {
  downloadResumeExport,
  enqueueResumeExport,
  enqueueTailoringRun,
  getResumeExport,
  getTailoringRun,
  processTailoringRun,
  updateTailoringSegment,
} from "./tailoring/service.js";
import type { OwnerTaskLease } from "./workers/owner-task-lease.js";
import { runOneOwnerTask } from "./workers/owner-task-worker.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const encryptionKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

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
    workspaceRoot: ".",
  };
}

const known = <T>(value: T, evidenceRef: string) =>
  JSON.stringify({ state: "known", value, evidenceRefs: [evidenceRef] });
const unknown = JSON.stringify({
  state: "unknown",
  reason: "source_not_stated",
});

describeWithDatabase("complete local MVP service journey", () => {
  let db: Kysely<Database>;
  const ids = {
    organization: randomUUID(),
    source: randomUUID(),
    sourceRecord: randomUUID(),
    sourceRevision: randomUUID(),
    publishedJob: randomUUID(),
    publishedVersion: randomUUID(),
    requirementSet: randomUUID(),
    graduationRequirement: `graduation-${randomUUID()}`,
    skillRequirement: `skill-${randomUUID()}`,
  };
  let ownerId: string | undefined;

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
    const now = new Date();
    await db
      .insertInto("source_control.organizations")
      .values({
        id: ids.organization,
        slug: `flow-${ids.organization}`,
        name: "本地流程测试公司",
        official_domain: "careers.example.test",
      })
      .execute();
    await db
      .insertInto("source_control.sources")
      .values({
        id: ids.source,
        organization_id: ids.organization,
        source_candidate_id: null,
        source_key: `flow-${ids.source}`,
        source_type: "organization_career_site",
        name: "本地流程测试招聘页",
        current_policy_version: 1,
      })
      .execute();
    await db
      .insertInto("source_control.source_policy_versions")
      .values({
        source_id: ids.source,
        version: 1,
        policy_status: "pending_review",
        provenance_level: "organization_owned",
        acquisition_mode: "deterministic_html",
        adapter_key: "integration-fixture",
        adapter_version: "1",
        entrypoints: JSON.stringify(["https://careers.example.test/jobs"]),
        crawl_interval: null,
        policy_notes: "Automated integration fixture; never queried over the network.",
        reviewed_at: null,
      })
      .execute();
    await db
      .insertInto("source_control.source_apply_targets")
      .values({
        id: randomUUID(),
        source_id: ids.source,
        policy_version: 1,
        method: "GET",
        scheme: "https",
        host: "careers.example.test",
        port: 443,
        path_prefix: "/jobs/",
        allow_redirects: false,
        allowed_query_parameters: [],
      })
      .execute();
    await db
      .insertInto("ingestion.source_job_records")
      .values({
        id: ids.sourceRecord,
        source_id: ids.source,
        source_job_id: `fixture-${ids.sourceRecord}`,
        canonical_source_url: `https://careers.example.test/jobs/${ids.sourceRecord}`,
        first_seen_at: now,
        last_seen_at: now,
      })
      .execute();
    await db
      .insertInto("ingestion.source_job_revisions")
      .values({
        id: ids.sourceRevision,
        source_job_record_id: ids.sourceRecord,
        revision_content_hash: "a".repeat(64),
        import_mode: "manual",
        adapter_version: "1",
        normalizer_version: "1",
        company_name: "本地流程测试公司",
        title: "产品实习生",
        job_family: known("product", `${ids.sourceRevision}#family`),
        locations: known(["深圳"], `${ids.sourceRevision}#locations`),
        business_groups: JSON.stringify([]),
        entry_scope: "internship",
        source_project_name: null,
        recruit_label_name: "实习",
        recruitment_type: known("internship", `${ids.sourceRevision}#type`),
        responsibilities: "参与用户研究、需求分析和产品迭代。",
        requirements: "2027 年毕业，具备 SQL 数据分析能力。",
        structured_fields: JSON.stringify({}),
        ingestion_state: "parsed",
        publication_state: "review",
        activity_state: "active",
        source_url: `https://careers.example.test/jobs/${ids.sourceRecord}`,
        apply_url: `https://careers.example.test/jobs/${ids.sourceRecord}/apply`,
        quality_flags: JSON.stringify([]),
      })
      .execute();
    await db
      .insertInto("catalog.published_jobs")
      .values({ id: ids.publishedJob, current_version_id: null })
      .execute();
    await db
      .insertInto("catalog.published_job_versions")
      .values({
        id: ids.publishedVersion,
        published_job_id: ids.publishedJob,
        source_job_revision_id: ids.sourceRevision,
        content_hash: "b".repeat(64),
        company_name: "本地流程测试公司",
        title: "产品实习生",
        job_family: known("product", `${ids.sourceRevision}#family`),
        locations: known(["深圳"], `${ids.sourceRevision}#locations`),
        department: unknown,
        job_code: known("fixture-1", `${ids.sourceRevision}#code`),
        recruitment_type: known("internship", `${ids.sourceRevision}#type`),
        employment_type: known("internship", `${ids.sourceRevision}#employment`),
        recruitment_batch: unknown,
        weekly_attendance_days: known(4, `${ids.sourceRevision}#attendance`),
        duration_months: known(3, `${ids.sourceRevision}#duration`),
        earliest_start_date: unknown,
        graduation_years: known([2027], `${ids.sourceRevision}#graduation`),
        education_levels: unknown,
        majors: unknown,
        languages: unknown,
        salary: unknown,
        work_mode: known("onsite", `${ids.sourceRevision}#work-mode`),
        posted_at: unknown,
        deadline_at: unknown,
        responsibilities: "参与用户研究、需求分析和产品迭代。",
        requirements: "2027 年毕业，具备 SQL 数据分析能力。",
        structured_fields: JSON.stringify({}),
        activity_state: "active",
        source_url: `https://careers.example.test/jobs/${ids.sourceRecord}`,
        apply_url: `https://careers.example.test/jobs/${ids.sourceRecord}/apply`,
        effective_at: now,
      })
      .execute();
    await db
      .updateTable("catalog.published_jobs")
      .set({ current_version_id: ids.publishedVersion })
      .where("id", "=", ids.publishedJob)
      .execute();
    const requirements: JobRequirement[] = [
      {
        id: ids.graduationRequirement,
        kind: "graduation_year",
        operator: "one_of",
        expectedValue: [2027],
        sourceText: "2027 年毕业",
        evidenceRefs: [`${ids.sourceRevision}#requirements`],
        required: true,
      },
      {
        id: ids.skillRequirement,
        kind: "skill",
        operator: "contains",
        expectedValue: ["SQL"],
        sourceText: "具备 SQL 数据分析能力",
        evidenceRefs: [`${ids.sourceRevision}#requirements`],
        required: true,
      },
    ];
    await db
      .insertInto("catalog.job_requirement_sets")
      .values({
        id: ids.requirementSet,
        published_job_version_id: ids.publishedVersion,
        schema_version: "integration-v1",
        requirements: JSON.stringify(requirements),
        content_hash: "c".repeat(64),
      })
      .execute();
  });

  afterAll(async () => {
    if (ownerId) {
      await db.deleteFrom("matching.resume_exports").where("owner_id", "=", ownerId).execute();
      await db
        .deleteFrom("matching.recommendation_items")
        .where("owner_id", "=", ownerId)
        .execute();
      await db
        .deleteFrom("matching.resume_tailoring_runs")
        .where("owner_id", "=", ownerId)
        .execute();
      await db.deleteFrom("matching.recommendation_runs").where("owner_id", "=", ownerId).execute();
      await db.deleteFrom("matching.match_runs").where("owner_id", "=", ownerId).execute();
      await db.deleteFrom("decision.job_decisions").where("owner_id", "=", ownerId).execute();
      await db
        .deleteFrom("profile.resume_evidence_revisions")
        .where("owner_id", "=", ownerId)
        .execute();
      await db
        .deleteFrom("profile.job_preference_revisions")
        .where("owner_id", "=", ownerId)
        .execute();
      await db
        .deleteFrom("profile.profile_fact_revisions")
        .where("owner_id", "=", ownerId)
        .execute();
      await db.deleteFrom("profile.resume_analyses").where("owner_id", "=", ownerId).execute();
      await db.deleteFrom("task_queue.tasks").where("owner_id", "=", ownerId).execute();
      await db.deleteFrom("identity.owner_sessions").where("owner_id", "=", ownerId).execute();
      await db.deleteFrom("identity.owners").where("id", "=", ownerId).execute();
    }
    await db.transaction().execute(async (transaction) => {
      await lockLocalCatalogMaterialization(transaction);
      const fixtureVersions = await transaction
        .selectFrom("catalog.published_job_versions")
        .select("id")
        .where("published_job_id", "=", ids.publishedJob)
        .execute();
      if (fixtureVersions.length > 0) {
        await transaction
          .deleteFrom("catalog.job_requirement_sets")
          .where(
            "published_job_version_id",
            "in",
            fixtureVersions.map((version) => version.id),
          )
          .execute();
      }
      await transaction
        .updateTable("catalog.published_jobs")
        .set({ current_version_id: null })
        .where("id", "=", ids.publishedJob)
        .execute();
      await transaction
        .deleteFrom("catalog.published_job_versions")
        .where("published_job_id", "=", ids.publishedJob)
        .execute();
      await transaction
        .deleteFrom("catalog.published_jobs")
        .where("id", "=", ids.publishedJob)
        .execute();
      await transaction
        .deleteFrom("ingestion.review_items")
        .where("revision_id", "=", ids.sourceRevision)
        .execute();
      await transaction
        .deleteFrom("ingestion.source_job_revision_evidence")
        .where("revision_id", "=", ids.sourceRevision)
        .execute();
      await transaction
        .deleteFrom("ingestion.source_job_revisions")
        .where("id", "=", ids.sourceRevision)
        .execute();
      await transaction
        .deleteFrom("ingestion.source_job_records")
        .where("id", "=", ids.sourceRecord)
        .execute();
      await transaction
        .deleteFrom("source_control.source_apply_targets")
        .where("source_id", "=", ids.source)
        .execute();
      await transaction
        .deleteFrom("source_control.source_policy_versions")
        .where("source_id", "=", ids.source)
        .execute();
      await transaction.deleteFrom("source_control.sources").where("id", "=", ids.source).execute();
      await transaction
        .deleteFrom("source_control.organizations")
        .where("id", "=", ids.organization)
        .execute();
    });
    await db.destroy();
  });

  async function drainUntil(predicate: () => Promise<boolean>): Promise<void> {
    for (let index = 0; index < 20; index += 1) {
      if (await predicate()) return;
      await runOneOwnerTask({
        db,
        config: config(),
        workerId: `integration-worker-${ids.organization}`,
      });
    }
    throw new Error("OWNER_TASK_DID_NOT_COMPLETE");
  }

  it("runs resume, matching, recommendation, tailoring, DOCX and decision end to end", async () => {
    await db.transaction().execute(async (materializationLock) => {
      await lockLocalCatalogMaterialization(materializationLock);
      await db
        .updateTable("ingestion.source_job_revisions")
        .set({ ingestion_state: "validated" })
        .where("id", "=", ids.sourceRevision)
        .executeTakeFirstOrThrow();
      try {
        const session = await createAnonymousSession({ db });
        const owner = session.context;
        ownerId = owner.ownerId;
        const submission = await submitResumeAnalysis({
          db,
          owner,
          idempotencyKey: `resume-${ids.organization}`,
          inputKind: "pasted_text",
          filename: null,
          mediaType: "text/plain",
          plaintext: Buffer.from(
            "项目经历\n负责产品需求分析并使用 SQL 分析用户反馈，完成 3 次用户访谈并输出结论。\n毕业年份 2027",
          ),
          encryptionKey,
        });
        await drainUntil(async () => {
          const analysis = await getResumeAnalysis({
            db,
            ownerId: owner.ownerId,
            ownerEpoch: owner.ownerEpoch,
            analysisId: submission.analysis.id,
            encryptionKey,
          });
          return analysis?.status === "succeeded";
        });
        const analysis = await getResumeAnalysis({
          db,
          ownerId: owner.ownerId,
          ownerEpoch: owner.ownerEpoch,
          analysisId: submission.analysis.id,
          encryptionKey,
        });
        expect(analysis?.status).toBe("succeeded");
        const result = analysis?.result as
          | {
              candidateEvidence?: Array<{
                id: string;
                section: string;
                originalText: string;
                claim: string;
                skills: string[];
                outcomes: string[];
              }>;
            }
          | undefined;
        const candidate = result?.candidateEvidence?.[0];
        expect(candidate).toBeTruthy();

        const facts = await putProfileFacts({
          db,
          owner,
          expectedRevision: 0,
          facts: [
            { key: "current_student", value: true },
            { key: "graduation_year", value: 2027 },
            { key: "weekly_attendance_days", value: 4 },
            { key: "duration_months", value: 3 },
          ],
        });
        const preferences = await putJobPreferences({
          db,
          owner,
          expectedRevision: 0,
          preferences: {
            cities: ["深圳"],
            jobFamilies: ["product"],
            companyNames: [],
            workModes: [],
          },
        });
        const evidenceItem: ResumeEvidence = {
          id: candidate?.id ?? randomUUID(),
          resumeAnalysisId: submission.analysis.id,
          section: candidate?.section ?? "项目经历",
          originalText: candidate?.originalText ?? "使用 SQL 分析用户反馈",
          claim: candidate?.claim ?? "使用 SQL 分析用户反馈",
          skills: candidate?.skills ?? ["SQL"],
          outcomes: candidate?.outcomes ?? [],
          confirmed: true,
        };
        const evidence = await putResumeEvidence({
          db,
          owner,
          expectedRevision: 0,
          resumeAnalysisId: submission.analysis.id,
          evidence: [evidenceItem],
        });

        const matchRequest = {
          publishedJobVersionId: ids.publishedVersion,
          profileFactRevisionId: facts.id,
          preferenceRevisionId: preferences.id,
          evidenceRevisionId: evidence.id,
        };
        const [match, concurrentMatch] = await Promise.all([
          enqueueMatchRun(db, owner, matchRequest, `match-${ids.organization}`),
          enqueueMatchRun(db, owner, matchRequest, `match-${ids.organization}`),
        ]);
        expect(concurrentMatch.id).toBe(match.id);
        await drainUntil(
          async () => (await getMatchRun(db, owner, match.id))?.status === "succeeded",
        );
        expect(await getMatchRun(db, owner, match.id)).toMatchObject({
          result: {
            eligibility: { status: "no_explicit_conflict" },
            evidence: { status: "explicit_evidence" },
            preference: { status: "fits" },
          },
        });

        const recommendationRequest = {
          profileFactRevisionId: facts.id,
          preferenceRevisionId: preferences.id,
          evidenceRevisionId: evidence.id,
          candidateJobVersionIds: [ids.publishedVersion],
        };
        const [recommendation, concurrentRecommendation] = await Promise.all([
          enqueueRecommendationRun(
            db,
            owner,
            recommendationRequest,
            `recommendation-${ids.organization}`,
            { enableLocalMvp: true },
          ),
          enqueueRecommendationRun(
            db,
            owner,
            recommendationRequest,
            `recommendation-${ids.organization}`,
            { enableLocalMvp: true },
          ),
        ]);
        expect(concurrentRecommendation.id).toBe(recommendation.id);
        await expect(
          enqueueRecommendationRun(
            db,
            owner,
            {
              profileFactRevisionId: facts.id,
              preferenceRevisionId: preferences.id,
              evidenceRevisionId: evidence.id,
              candidateJobVersionIds: [ids.publishedVersion],
            },
            `public-recommendation-${ids.organization}`,
            { enableLocalMvp: false },
          ),
        ).rejects.toMatchObject({ code: "CANDIDATE_JOB_NOT_IN_CURRENT_CATALOG" });
        await drainUntil(
          async () =>
            (
              await getRecommendationRun(db, owner, recommendation.id, {
                enableLocalMvp: true,
              })
            )?.status === "succeeded",
        );
        const completedRecommendation = await getRecommendationRun(db, owner, recommendation.id, {
          enableLocalMvp: true,
        });
        expect(completedRecommendation).toMatchObject({
          catalogState: "current",
          items: [{ catalogState: "current" }],
        });
        expect(completedRecommendation?.items).toHaveLength(1);
        const frozenLastVerifiedAt = completedRecommendation?.items[0]?.lastVerifiedAt;
        expect(frozenLastVerifiedAt).toBeTruthy();

        await db
          .updateTable("ingestion.source_job_records")
          .set({ last_seen_at: new Date(Date.now() + 60_000) })
          .where("id", "=", ids.sourceRecord)
          .execute();
        expect(
          await getRecommendationRun(db, owner, recommendation.id, { enableLocalMvp: true }),
        ).toMatchObject({
          catalogState: "current",
          items: [{ catalogState: "current", lastVerifiedAt: frozenLastVerifiedAt }],
        });

        const legacyRecommendationId = randomUUID();
        await db
          .insertInto("matching.recommendation_runs")
          .values({
            id: legacyRecommendationId,
            owner_id: owner.ownerId,
            owner_epoch: owner.ownerEpoch,
            profile_fact_revision_id: facts.id,
            preference_revision_id: preferences.id,
            evidence_revision_id: evidence.id,
            candidate_job_version_ids: JSON.stringify([ids.publishedVersion]),
            candidate_freshness_snapshots: null,
            candidate_set_hash: "d".repeat(64),
            strategy_version: "legacy-without-freshness-snapshot",
            status: "succeeded",
            request_hash: "e".repeat(64),
            idempotency_key: `legacy-recommendation-${ids.organization}`,
            failure_code: null,
            completed_at: new Date(),
          })
          .execute();
        await db
          .insertInto("matching.recommendation_items")
          .values({
            owner_id: owner.ownerId,
            recommendation_run_id: legacyRecommendationId,
            ordinal: 0,
            published_job_version_id: ids.publishedVersion,
            match_run_id: match.id,
            reason_codes: JSON.stringify([]),
            unknown_requirement_ids: JSON.stringify([]),
          })
          .execute();
        expect(
          await getRecommendationRun(db, owner, legacyRecommendationId, { enableLocalMvp: true }),
        ).toMatchObject({
          catalogState: "invalid",
          items: [{ catalogState: "invalid", lastVerifiedAt: null }],
        });

        const tailoringRequest = {
          resumeAnalysisId: submission.analysis.id,
          publishedJobVersionId: ids.publishedVersion,
          evidenceRevisionId: evidence.id,
          privacyConsent: true as const,
        };
        const [tailoring, concurrentTailoring] = await Promise.all([
          enqueueTailoringRun(
            db,
            config(),
            owner,
            tailoringRequest,
            `tailoring-${ids.organization}`,
          ),
          enqueueTailoringRun(
            db,
            config(),
            owner,
            tailoringRequest,
            `tailoring-${ids.organization}`,
          ),
        ]);
        expect(concurrentTailoring.id).toBe(tailoring.id);
        await drainUntil(
          async () => (await getTailoringRun(db, owner, tailoring.id))?.status === "succeeded",
        );
        const completedTailoring = await getTailoringRun(db, owner, tailoring.id);
        expect(completedTailoring?.usedTemplateFallback).toBe(true);
        const segment = completedTailoring?.segments[0];
        expect(segment).toBeTruthy();

        const aiConfig: AppConfig = {
          ...config(),
          ai: {
            enabled: true,
            baseUrl: "https://provider.example/v1",
            model: "fixture-model",
            apiKey: "fixture-key",
            requestTimeoutMs: 5_000,
          },
        };
        const fencedIdempotencyKey = `fenced-tailoring-${ids.organization}`;
        const fencedTailoring = await enqueueTailoringRun(
          db,
          aiConfig,
          owner,
          tailoringRequest,
          fencedIdempotencyKey,
        );
        const queuedTask = await db
          .selectFrom("task_queue.tasks")
          .selectAll()
          .where("idempotency_key", "=", `owner:${owner.ownerId}:tailoring:${fencedIdempotencyKey}`)
          .executeTakeFirstOrThrow();
        const firstWorker = `fenced-worker-a-${ids.organization}`;
        const firstFencingToken = Number(queuedTask.fencing_token) + 1;
        await db
          .updateTable("task_queue.tasks")
          .set({
            status: "running",
            attempt: 1,
            lease_owner: firstWorker,
            lease_until: new Date(Date.now() + 60_000),
            heartbeat_at: new Date(),
            fencing_token: firstFencingToken,
          })
          .where("id", "=", queuedTask.id)
          .executeTakeFirstOrThrow();
        const staleLease: OwnerTaskLease = {
          taskId: queuedTask.id,
          taskType: "resume_tailoring",
          ownerId: owner.ownerId,
          ownerEpoch: owner.ownerEpoch,
          leaseOwner: firstWorker,
          fencingToken: firstFencingToken,
        };
        let signalFetchStarted!: () => void;
        let releaseFetch!: () => void;
        const fetchStarted = new Promise<void>((resolve) => {
          signalFetchStarted = resolve;
        });
        const fetchRelease = new Promise<void>((resolve) => {
          releaseFetch = resolve;
        });
        const providerResponse = () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      selections: [
                        {
                          evidenceId: evidenceItem.id,
                          requirementIds: [ids.skillRequirement],
                          emphasis: ["claim"],
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        const delayedFetch: typeof fetch = async () => {
          signalFetchStarted();
          await fetchRelease;
          return providerResponse();
        };
        const staleProcessing = processTailoringRun(
          db,
          aiConfig,
          owner,
          fencedTailoring.id,
          staleLease,
          delayedFetch,
        );
        await fetchStarted;

        const secondWorker = `fenced-worker-b-${ids.organization}`;
        const secondFencingToken = firstFencingToken + 1;
        await db
          .updateTable("task_queue.tasks")
          .set({
            lease_owner: secondWorker,
            lease_until: new Date(Date.now() + 60_000),
            heartbeat_at: new Date(),
            fencing_token: secondFencingToken,
          })
          .where("id", "=", queuedTask.id)
          .executeTakeFirstOrThrow();
        releaseFetch();
        await expect(staleProcessing).rejects.toThrow("OWNER_TASK_LEASE_LOST");
        expect(await getTailoringRun(db, owner, fencedTailoring.id)).toMatchObject({
          status: "processing",
          segments: [],
        });

        const recoveredLease: OwnerTaskLease = {
          ...staleLease,
          leaseOwner: secondWorker,
          fencingToken: secondFencingToken,
        };
        await processTailoringRun(
          db,
          aiConfig,
          owner,
          fencedTailoring.id,
          recoveredLease,
          async () => providerResponse(),
        );
        expect(await getTailoringRun(db, owner, fencedTailoring.id)).toMatchObject({
          status: "succeeded",
          usedTemplateFallback: false,
          segments: [{ evidenceIds: [evidenceItem.id] }],
        });
        await updateTailoringSegment(db, owner, tailoring.id, segment?.id ?? "", {
          decision: "accepted",
        });

        const resumeExport = await enqueueResumeExport(
          db,
          config(),
          owner,
          tailoring.id,
          `export-${ids.organization}`,
        );
        await drainUntil(
          async () => (await getResumeExport(db, owner, resumeExport.id))?.status === "succeeded",
        );
        const file = await downloadResumeExport(db, config(), owner, resumeExport.id);
        expect(file?.mediaType).toContain("wordprocessingml.document");
        expect(file?.buffer.subarray(0, 2).toString("utf8")).toBe("PK");

        const decision = await putJobDecision(db, owner, ids.publishedJob, {
          expectedRevision: 0,
          status: "preparing_to_apply",
          reason: "资格无明确冲突，且简历中有 SQL 证据。",
        });
        expect(decision.revision).toBe(1);

        const abortingTailoring = await enqueueTailoringRun(
          db,
          aiConfig,
          owner,
          tailoringRequest,
          `aborting-tailoring-${ids.organization}`,
        );
        let signalAbortingFetchStarted!: () => void;
        const abortingFetchStarted = new Promise<void>((resolve) => {
          signalAbortingFetchStarted = resolve;
        });
        let fetchWasAborted = false;
        const abortingFetch: typeof fetch = (_url, init) => {
          signalAbortingFetchStarted();
          return new Promise<Response>((_resolve, reject) => {
            const requestSignal = init?.signal;
            if (requestSignal?.aborted) {
              fetchWasAborted = true;
              reject(new Error("fetch aborted"));
              return;
            }
            requestSignal?.addEventListener(
              "abort",
              () => {
                fetchWasAborted = true;
                reject(new Error("fetch aborted"));
              },
              { once: true },
            );
          });
        };
        const abortingWorker = runOneOwnerTask({
          db,
          config: aiConfig,
          workerId: `aborting-worker-${ids.organization}`,
          signal: new AbortController().signal,
          fetchImpl: abortingFetch,
        });
        await abortingFetchStarted;
        await db
          .updateTable("identity.owners")
          .set({ status: "deletion_pending", epoch: owner.ownerEpoch + 1 })
          .where("id", "=", owner.ownerId)
          .where("epoch", "=", owner.ownerEpoch)
          .executeTakeFirstOrThrow();
        await abortingWorker;
        expect(fetchWasAborted).toBe(true);
        const notWrittenAfterAbort = await db
          .selectFrom("matching.resume_tailoring_runs")
          .select(["status", "failure_code", "completed_at"])
          .where("id", "=", abortingTailoring.id)
          .executeTakeFirstOrThrow();
        expect(notWrittenAfterAbort.status).toBe("processing");
        expect(notWrittenAfterAbort.failure_code).toBeNull();
        expect(notWrittenAfterAbort.completed_at).toBeNull();
      } finally {
        await db
          .updateTable("ingestion.source_job_revisions")
          .set({ ingestion_state: "parsed" })
          .where("id", "=", ids.sourceRevision)
          .execute();
      }
    });
  });
});
