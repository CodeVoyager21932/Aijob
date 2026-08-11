import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import {
  ApplicationCaseMutationResponseSchema,
  ApplicationCaseRequirementsSchema,
  ApplicationCaseWithJobContextSchema,
  CreateApplicationCaseResponseSchema,
  CreateInterviewSessionResponseSchema,
  CreateResumeDocumentResponseSchema,
  GetCaseDebriefResponseSchema,
  InterviewSessionDetailSchema,
  ListInterviewSessionsResponseSchema,
  PrepareCaseDebriefResponseSchema,
  SubmitInterviewAnswerResponseSchema,
} from "@aijob/contracts";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME } from "../identity/fastify.js";
import { createAnonymousSession } from "../identity/session-repository.js";

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

describeWithDatabase("Interview Session/Turn owner-protected API", () => {
  let app: FastifyInstance;
  let db: Kysely<Database>;
  let mainSession: Awaited<ReturnType<typeof createAnonymousSession>>;
  let otherSession: Awaited<ReturnType<typeof createAnonymousSession>>;
  const baseDocumentId = randomUUID();
  const baseContentRevisionId = randomUUID();
  const evidenceRevisionId = randomUUID();
  const evidenceId = "interview-confirmed-evidence";
  const sectionId = randomUUID();
  const blockId = randomUUID();

  beforeAll(async () => {
    db = createDatabase(databaseUrl as string);
    await migrateToLatest(db);
    mainSession = await createAnonymousSession({ db });
    otherSession = await createAnonymousSession({ db });
    app = buildApp({ config: config(), db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const ownerIds = [mainSession.context.ownerId, otherSession.context.ownerId];
    await db.transaction().execute(async (transaction) => {
      await transaction
        .deleteFrom("application.debrief_confirmations")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("application.debriefs")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("application.interview_feedback")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("application.interview_turns")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("application.interview_sessions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("application.case_events")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("application.case_requirement_evidence_links")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("application.case_questions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("application.case_requirement_states")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .updateTable("profile.resume_documents")
        .set({ current_content_revision_id: null, current_layout_revision_id: null })
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("profile.resume_layout_revisions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("profile.resume_documents")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("profile.resume_document_revisions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction
        .deleteFrom("profile.resume_evidence_revisions")
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
        .deleteFrom("identity.owner_sessions")
        .where("owner_id", "in", ownerIds)
        .execute();
      await transaction.deleteFrom("identity.owners").where("id", "in", ownerIds).execute();
    });
    await db.destroy();
  });

  it("creates and completes a deterministic template interview with pinned inputs", async () => {
    const headers = sessionHeaders(mainSession);
    const createCase = await app.inject({
      method: "POST",
      url: "/v1/application-cases",
      headers: { ...headers, "idempotency-key": `interview-case-${randomUUID()}` },
      payload: {
        jobContext: {
          kind: "private_input",
          title: "合成产品实习生",
          companyName: "合成测试公司",
          contentText: "合成产品实习生\n要求：\n掌握 SQL。\n每周至少实习 4 天。",
          source: { kind: "unspecified" },
          duplicateHandling: "reuse",
        },
      },
    });
    expect(createCase.statusCode, JSON.stringify(createCase.json())).toBe(201);
    const createdCase = CreateApplicationCaseResponseSchema.parse(
      createCase.json(),
    ).applicationCase;

    const beforeResume = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions`,
      headers: { ...headers, "idempotency-key": `before-resume-${randomUUID()}` },
      payload: { expectedCaseRevision: createdCase.revision },
    });
    expect(beforeResume.statusCode).toBe(409);
    expect(beforeResume.json()).toMatchObject({ code: "INTERVIEW_INPUTS_NOT_READY" });
    expect(
      ApplicationCaseWithJobContextSchema.parse(
        (
          await app.inject({
            method: "GET",
            url: `/v1/application-cases/${createdCase.id}`,
            headers,
          })
        ).json(),
      ).revision,
    ).toBe(1);

    const requirementsResponse = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdCase.id}/requirements`,
      headers,
    });
    const requirements = ApplicationCaseRequirementsSchema.parse(requirementsResponse.json());
    const explicitRequirement = requirements.requirements.find(
      ({ kind, operator }) => kind !== "other" && operator !== "unknown",
    );
    if (!explicitRequirement) throw new Error("EXPLICIT_INTERVIEW_REQUIREMENT_MISSING");
    const requirementWrite = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${createdCase.id}/requirements/${encodeURIComponent(explicitRequirement.id)}`,
      headers,
      payload: {
        expectedRevision: 1,
        state: "confirmed",
        userNote: "合成测试中已核对要求原文",
      },
    });
    expect(requirementWrite.statusCode, JSON.stringify(requirementWrite.json())).toBe(200);
    expect(ApplicationCaseMutationResponseSchema.parse(requirementWrite.json()).caseRevision).toBe(
      2,
    );

    const confirmedAt = new Date();
    await db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("profile.resume_documents")
        .values({
          id: baseDocumentId,
          owner_id: mainSession.context.ownerId,
          owner_epoch: mainSession.context.ownerEpoch,
          kind: "base",
          title: "合成基础简历",
          case_id: null,
          detached_from_case_id: null,
          job_context_kind: null,
          published_job_id: null,
          published_job_version_id: null,
          requirement_set_id: null,
          private_job_snapshot_id: null,
          job_context_revision: null,
          base_document_id: null,
          base_document_revision_id: null,
          evidence_revision_id: null,
          current_content_revision_id: null,
          current_layout_revision_id: null,
          revision: 1,
          creation_idempotency_key: `interview-base-${randomUUID()}`,
          creation_request_hash: "a".repeat(64),
          expires_at: null,
          deleted_at: null,
        })
        .execute();
      await transaction
        .insertInto("profile.resume_document_revisions")
        .values({
          id: baseContentRevisionId,
          owner_id: mainSession.context.ownerId,
          owner_epoch: mainSession.context.ownerEpoch,
          resume_analysis_id: null,
          revision: 1,
          base_revision: null,
          schema_version: "resume-content-v1",
          sections: JSON.stringify([
            {
              id: sectionId,
              ordinal: 0,
              title: "项目经历",
              blocks: [
                {
                  id: blockId,
                  ordinal: 0,
                  text: "合成且已经确认的项目经历。",
                  evidenceIds: [evidenceId],
                },
              ],
            },
          ]),
          content_hash: "b".repeat(64),
          confirmed_at: confirmedAt,
          document_id: baseDocumentId,
          document_revision: 1,
          base_document_revision_id: null,
        })
        .execute();
      await transaction
        .updateTable("profile.resume_documents")
        .set({ current_content_revision_id: baseContentRevisionId })
        .where("id", "=", baseDocumentId)
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("profile.resume_evidence_revisions")
        .values({
          id: evidenceRevisionId,
          owner_id: mainSession.context.ownerId,
          owner_epoch: mainSession.context.ownerEpoch,
          resume_analysis_id: null,
          revision: 1,
          base_revision: null,
          evidence: JSON.stringify([
            {
              id: evidenceId,
              resumeAnalysisId: null,
              section: "项目经历",
              originalText: "合成且已经确认的项目经历。",
              claim: "合成且已经确认的项目经历。",
              skills: ["SQL"],
              outcomes: [],
              confirmed: true,
            },
          ]),
          content_hash: "c".repeat(64),
          confirmed_at: confirmedAt,
          schema_version: "resume-evidence-v1",
          document_revision_id: null,
        })
        .execute();
    });

    const deriveResume = await app.inject({
      method: "POST",
      url: "/v1/resume-documents",
      headers: { ...headers, "idempotency-key": `interview-derived-${randomUUID()}` },
      payload: {
        kind: "case_derived",
        caseId: createdCase.id,
        baseDocumentRevisionId: baseContentRevisionId,
        expectedCaseRevision: 2,
        title: "合成岗位简历",
      },
    });
    expect(deriveResume.statusCode, JSON.stringify(deriveResume.json())).toBe(201);
    const derivedDocument = CreateResumeDocumentResponseSchema.parse(
      deriveResume.json(),
    ).resumeDocument;
    expect(derivedDocument).toMatchObject({
      kind: "case_derived",
      caseId: createdCase.id,
      evidenceRevisionId,
      currentContentRevisionId: expect.any(String),
    });

    const createKey = `interview-session-${randomUUID()}`;
    const created = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions`,
      headers: { ...headers, "idempotency-key": createKey },
      payload: { expectedCaseRevision: 3 },
    });
    expect(created.statusCode, JSON.stringify(created.json())).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    const createdBody = CreateInterviewSessionResponseSchema.parse(created.json());
    expect(createdBody.firstQuestion).toMatchObject({
      sequence: 1,
      kind: "question",
      requirementIds: [explicitRequirement.id],
      evidenceIds: [],
    });
    expect(createdBody.firstQuestion.content).toContain(explicitRequirement.sourceText);

    const replay = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions`,
      headers: { ...headers, "idempotency-key": createKey },
      payload: { expectedCaseRevision: 3 },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(createdBody);
    const reusedCreationKey = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions`,
      headers: { ...headers, "idempotency-key": createKey },
      payload: { expectedCaseRevision: 4 },
    });
    expect(reusedCreationKey.statusCode).toBe(409);
    expect(reusedCreationKey.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const list = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions?limit=1`,
      headers,
    });
    expect(list.statusCode).toBe(200);
    expect(ListInterviewSessionsResponseSchema.parse(list.json()).items).toHaveLength(1);
    const detail = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions/${createdBody.sessionId}`,
      headers,
    });
    const detailBody = InterviewSessionDetailSchema.parse(detail.json());
    expect(detailBody.session).toMatchObject({
      id: createdBody.sessionId,
      caseId: createdCase.id,
      evidenceRevisionId,
      resumeDocumentId: derivedDocument.id,
      resumeContentRevisionId: derivedDocument.currentContentRevisionId,
      mode: "template",
      status: "active",
      revision: 1,
      promptVersion: null,
      providerAdapter: null,
      model: null,
    });

    const answerKey = `interview-answer-${randomUUID()}`;
    const firstAnswer = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions/${createdBody.sessionId}/answers`,
      headers: { ...headers, "idempotency-key": answerKey },
      payload: { expectedRevision: 1, answer: "我会基于真实的合成项目逐步说明。" },
    });
    expect(firstAnswer.statusCode, JSON.stringify(firstAnswer.json())).toBe(200);
    const firstAnswerBody = SubmitInterviewAnswerResponseSchema.parse(firstAnswer.json());
    expect(firstAnswerBody).toMatchObject({
      answer: { sequence: 2, kind: "answer", requirementIds: [explicitRequirement.id] },
      nextQuestion: { sequence: 3, kind: "question", requirementIds: [] },
      appliedRevision: 2,
      completed: false,
    });
    const answerReplay = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions/${createdBody.sessionId}/answers`,
      headers: { ...headers, "idempotency-key": answerKey },
      payload: { expectedRevision: 1, answer: "我会基于真实的合成项目逐步说明。" },
    });
    expect(answerReplay.json()).toEqual(firstAnswerBody);
    const answerKeyReuse = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions/${createdBody.sessionId}/answers`,
      headers: { ...headers, "idempotency-key": answerKey },
      payload: { expectedRevision: 1, answer: "不同回答不得复用请求编号。" },
    });
    expect(answerKeyReuse.statusCode).toBe(409);
    expect(answerKeyReuse.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const emptyDebrief = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdCase.id}/debrief`,
      headers,
    });
    expect(emptyDebrief.statusCode).toBe(200);
    expect(emptyDebrief.headers["cache-control"]).toContain("no-store");
    expect(GetCaseDebriefResponseSchema.parse(emptyDebrief.json())).toEqual({
      feedback: null,
      debrief: null,
    });
    const activeSessionDebrief = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${createdCase.id}/debrief`,
      headers: { ...headers, "idempotency-key": `active-debrief-${randomUUID()}` },
      payload: { interviewSessionId: createdBody.sessionId, expectedSessionRevision: 2 },
    });
    expect(activeSessionDebrief.statusCode).toBe(409);
    expect(activeSessionDebrief.json()).toMatchObject({ code: "INTERVIEW_SESSION_NOT_COMPLETED" });

    const staleAnswer = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions/${createdBody.sessionId}/answers`,
      headers: { ...headers, "idempotency-key": `stale-answer-${randomUUID()}` },
      payload: { expectedRevision: 1, answer: "过期页面回答。" },
    });
    expect(staleAnswer.statusCode).toBe(409);
    expect(staleAnswer.json()).toMatchObject({ code: "INTERVIEW_SESSION_REVISION_CONFLICT" });

    const finalAnswer = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions/${createdBody.sessionId}/answers`,
      headers: { ...headers, "idempotency-key": `final-answer-${randomUUID()}` },
      payload: { expectedRevision: 2, answer: "这是第二个真实、合成的回答。" },
    });
    expect(finalAnswer.statusCode, JSON.stringify(finalAnswer.json())).toBe(200);
    expect(SubmitInterviewAnswerResponseSchema.parse(finalAnswer.json())).toMatchObject({
      nextQuestion: null,
      appliedRevision: 3,
      completed: true,
    });
    const completedDetail = InterviewSessionDetailSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/application-cases/${createdCase.id}/interview-sessions/${createdBody.sessionId}`,
          headers,
        })
      ).json(),
    );
    expect(completedDetail.session).toMatchObject({ status: "completed", revision: 3 });
    expect(completedDetail.turns.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4]);
    expect(completedDetail.turns.every(({ evidenceIds }) => evidenceIds.length === 0)).toBe(true);

    const debriefKey = `case-debrief-${randomUUID()}`;
    const preparedDebrief = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${createdCase.id}/debrief`,
      headers: { ...headers, "idempotency-key": debriefKey },
      payload: { interviewSessionId: createdBody.sessionId, expectedSessionRevision: 3 },
    });
    expect(preparedDebrief.statusCode, JSON.stringify(preparedDebrief.json())).toBe(201);
    const preparedBody = PrepareCaseDebriefResponseSchema.parse(preparedDebrief.json());
    expect(preparedBody).toMatchObject({
      created: true,
      feedback: {
        interviewSessionId: createdBody.sessionId,
        revision: 1,
        generatorMode: "template",
      },
      debrief: {
        caseId: createdCase.id,
        interviewSessionId: createdBody.sessionId,
        evidenceRevisionId,
        status: "draft",
        revision: 1,
      },
    });
    expect(preparedBody.feedback.feedback.items.length).toBeGreaterThan(0);
    expect(preparedBody.debrief.expressionIssues.length).toBeGreaterThan(0);
    expect(preparedBody.debrief.evidenceGaps).toHaveLength(1);
    expect(preparedBody.debrief.practicePlan.length).toBeGreaterThan(0);
    expect(JSON.stringify(preparedBody)).not.toMatch(/ats|录用概率|匹配分|score/i);

    const debriefReplay = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${createdCase.id}/debrief`,
      headers: { ...headers, "idempotency-key": debriefKey },
      payload: { interviewSessionId: createdBody.sessionId, expectedSessionRevision: 3 },
    });
    expect(debriefReplay.statusCode).toBe(201);
    expect(debriefReplay.json()).toEqual(preparedBody);
    const sameResourceNewKey = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${createdCase.id}/debrief`,
      headers: { ...headers, "idempotency-key": `same-debrief-${randomUUID()}` },
      payload: { interviewSessionId: createdBody.sessionId, expectedSessionRevision: 3 },
    });
    expect(sameResourceNewKey.statusCode).toBe(200);
    expect(PrepareCaseDebriefResponseSchema.parse(sameResourceNewKey.json())).toEqual({
      ...preparedBody,
      created: false,
    });
    const debriefKeyReuse = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${createdCase.id}/debrief`,
      headers: { ...headers, "idempotency-key": debriefKey },
      payload: { interviewSessionId: createdBody.sessionId, expectedSessionRevision: 2 },
    });
    expect(debriefKeyReuse.statusCode).toBe(409);
    expect(debriefKeyReuse.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const loadedDebrief = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdCase.id}/debrief`,
      headers,
    });
    expect(loadedDebrief.statusCode).toBe(200);
    expect(GetCaseDebriefResponseSchema.parse(loadedDebrief.json())).toEqual({
      feedback: preparedBody.feedback,
      debrief: preparedBody.debrief,
    });
    const storedReviewCounts = await Promise.all([
      db
        .selectFrom("application.interview_feedback")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("owner_id", "=", mainSession.context.ownerId)
        .where("interview_session_id", "=", createdBody.sessionId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("application.debriefs")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("owner_id", "=", mainSession.context.ownerId)
        .where("case_id", "=", createdCase.id)
        .executeTakeFirstOrThrow(),
    ]);
    expect(storedReviewCounts.map(({ count }) => Number(count))).toEqual([1, 1]);

    const storedEvent = await db
      .selectFrom("application.case_events")
      .select(["sequence", "event_type", "event_data"])
      .where("owner_id", "=", mainSession.context.ownerId)
      .where("case_id", "=", createdCase.id)
      .where("event_type", "=", "interview_started")
      .executeTakeFirstOrThrow();
    expect(storedEvent).toMatchObject({ sequence: 4, event_type: "interview_started" });
    expect(storedEvent.event_data).toEqual(
      expect.objectContaining({ interviewSessionId: createdBody.sessionId, mode: "template" }),
    );

    const secondSessionResponse = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions`,
      headers: { ...headers, "idempotency-key": `second-session-${randomUUID()}` },
      payload: { expectedCaseRevision: 4 },
    });
    expect(secondSessionResponse.statusCode, JSON.stringify(secondSessionResponse.json())).toBe(
      201,
    );
    const secondSession = CreateInterviewSessionResponseSchema.parse(secondSessionResponse.json());
    const secondSessionFirstAnswer = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions/${secondSession.sessionId}/answers`,
      headers: { ...headers, "idempotency-key": `second-answer-one-${randomUUID()}` },
      payload: { expectedRevision: 1, answer: "第二轮第一段合成回答。" },
    });
    expect(secondSessionFirstAnswer.statusCode).toBe(200);
    const secondSessionFinalAnswer = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions/${secondSession.sessionId}/answers`,
      headers: { ...headers, "idempotency-key": `second-answer-two-${randomUUID()}` },
      payload: { expectedRevision: 2, answer: "第二轮第二段合成回答。" },
    });
    expect(
      SubmitInterviewAnswerResponseSchema.parse(secondSessionFinalAnswer.json()),
    ).toMatchObject({ completed: true, appliedRevision: 3 });
    const secondSessionDebrief = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${createdCase.id}/debrief`,
      headers: { ...headers, "idempotency-key": `second-session-debrief-${randomUUID()}` },
      payload: { interviewSessionId: secondSession.sessionId, expectedSessionRevision: 3 },
    });
    expect(secondSessionDebrief.statusCode).toBe(409);
    expect(secondSessionDebrief.json()).toMatchObject({ code: "CASE_DEBRIEF_ALREADY_EXISTS" });

    const crossOwner = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions/${createdBody.sessionId}`,
      headers: sessionHeaders(otherSession),
    });
    expect(crossOwner.statusCode).toBe(404);
    expect(crossOwner.json()).toMatchObject({ code: "APPLICATION_CASE_NOT_FOUND" });
    const crossOwnerDebrief = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdCase.id}/debrief`,
      headers: sessionHeaders(otherSession),
    });
    expect(crossOwnerDebrief.statusCode).toBe(404);
    expect(crossOwnerDebrief.json()).toMatchObject({ code: "APPLICATION_CASE_NOT_FOUND" });
    const invalidCursor = await app.inject({
      method: "GET",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions?cursor=invalid`,
      headers,
    });
    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidCursor.json()).toMatchObject({ code: "INVALID_INTERVIEW_SESSION_CURSOR" });

    const { [CSRF_HEADER_NAME]: _csrf, ...headersWithoutCsrf } = headers;
    const missingCsrf = await app.inject({
      method: "POST",
      url: `/v1/application-cases/${createdCase.id}/interview-sessions`,
      headers: { ...headersWithoutCsrf, "idempotency-key": `csrf-${randomUUID()}` },
      payload: { expectedCaseRevision: 4 },
    });
    expect(missingCsrf.statusCode).toBe(403);
    const missingDebriefCsrf = await app.inject({
      method: "PUT",
      url: `/v1/application-cases/${createdCase.id}/debrief`,
      headers: { ...headersWithoutCsrf, "idempotency-key": `csrf-debrief-${randomUUID()}` },
      payload: { interviewSessionId: createdBody.sessionId, expectedSessionRevision: 3 },
    });
    expect(missingDebriefCsrf.statusCode).toBe(403);
  }, 30_000);
});
