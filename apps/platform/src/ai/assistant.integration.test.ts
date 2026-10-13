import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import {
  AdoptAssistantResultSchema,
  AssistantResultSchema,
  blankResumeEntry,
  CreateAssistantSessionSchema,
  CreateApplicationCaseWithJobContextRequestSchema,
  resumeRichText,
  SubmitAssistantTurnSchema,
} from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplicationCase } from "../applications/service.js";
import { deleteApplicationCase, deleteResumeDocument } from "../career-assets/deletion-service.js";
import { createAnonymousSession } from "../identity/session-repository.js";
import { processOwnerDeletion, requestOwnerDeletion } from "../profile/deletion-service.js";
import { adoptAssistantResult } from "../resume-documents/studio-review-service.js";
import { setTemplatePreference, templatePreferences, uploadResumePhoto } from '../resume-documents/template-library.js';
import {
  createStudioDocument,
  getStudioDraft,
  listExperiences,
  saveStudioDraft,
} from "../resume-documents/studio-service.js";
import {
  assistantSession,
  createAssistantSession,
  processAssistantTurn,
  retryAssistantTurn,
  setAssistantSessionStatus,
  submitAssistantTurn,
} from "./assistant-service.js";
import { assistantFactSources, validateAssistantGrounding } from "./assistant-strategies.js";
import { saveUserAiSettings } from "./user-ai-service.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("adaptive assistant and independent ResumeReview", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  const config: AppConfig = {
    appEnv: "test",
    databaseUrl: url ?? "",
    snapshotDirectory: ".data/test",
    host: "127.0.0.1",
    port: 3000,
    probeRequestIntervalMs: 750,
    ownerTaskInteractiveConcurrency: 8,
    logLevel: "silent",
    enableInternalPreview: true,
    enableSourceProbe: false,
    enableLocalMvp: true,
    resumeReviewV2WriteEnabled: true,
    resumeEncryptionKey: "a".repeat(64),
    resumeMaxBytes: 5242880,
    identity: { acceptedOrigins: [], alphaInviteCodeHashes: [] },
    workspaceRoot: ".",
    ai: {
      enabled: true,
      baseUrl: "https://fixture.example/v1",
      model: "fixture-adaptive",
      apiKey: "test-only",
      requestTimeoutMs: 5000,
      budget: { dailyCalls: 10000, dailyTokens: 100000000, concurrency: 2, maxOutputTokens: 3000 },
    },
  };
  const fixtureOwners: string[] = [];
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(async () => {
    if (fixtureOwners.length)
      await db.deleteFrom("task_queue.tasks").where("owner_id", "in", fixtureOwners).execute();
    await db.destroy();
  });
  const context = async () => {
    const owner = (await createAnonymousSession({ db })).context;
    fixtureOwners.push(owner.ownerId);
    await saveUserAiSettings(db, owner, config, {
      expectedRevision: 0,
      baseUrl: "https://fixture.example/v1",
      model: "fixture-adaptive",
      apiKey: "test-only",
      dailyCalls: 1000,
      dailyTokens: 10000000,
    });
    return owner;
  };
  const result = (reply: string) =>
    AssistantResultSchema.parse({
      schemaVersion: "career-assistant-result-v1",
      kind: "question",
      reply,
      question: "具体是怎么做的？",
      artifact: null,
      changes: [],
      preparation: [],
      known: [],
      openQuestions: [],
    });
  async function complete(
    owner: Awaited<ReturnType<typeof context>>,
    sessionId: string,
    turnId: string,
    fetchImpl: typeof fetch,
  ) {
    const leaseOwner = randomUUID(),
      task = (
        await sql<{
          id: string;
          fencing_token: number;
        }>`UPDATE task_queue.tasks SET status='running',lease_owner=${leaseOwner},lease_until=now()+interval '60 seconds',fencing_token=fencing_token+1,attempt=attempt+1 WHERE id=(SELECT id FROM task_queue.tasks WHERE task_type='career_assistant' AND owner_id=${owner.ownerId} AND payload->>'turnId'=${turnId} AND status='queued' ORDER BY created_at DESC LIMIT 1) RETURNING id,fencing_token`.execute(
          db,
        )
      ).rows[0]!;
    await processAssistantTurn({
      db,
      owner,
      sessionId,
      turnId,
      config,
      fetchImpl,
      lease: {
        taskId: task.id,
        taskType: "career_assistant",
        ownerId: owner.ownerId,
        ownerEpoch: owner.ownerEpoch,
        leaseOwner,
        fencingToken: Number(task.fencing_token),
      },
    });
    await db
      .updateTable("task_queue.tasks")
      .set({
        status: "succeeded",
        completed_at: new Date(),
        lease_until: null,
        lease_owner: null,
        heartbeat_at: null,
      })
      .where("id", "=", task.id)
      .where("fencing_token", "=", Number(task.fencing_token))
      .execute();
  }
  const casePractice = async () => {
    const owner = await context();
    const { applicationCase } = await createApplicationCase({ db, owner, enableLocalMvp: true,
      idempotencyKey: randomUUID(), request: CreateApplicationCaseWithJobContextRequestSchema.parse({
        jobContext: { kind: "private_input", title: "产品实习生", companyName: "合成测试团队",
          contentText: "在校生实习，整理访谈和调研材料。", source: { kind: "unspecified" } }, initialStage: "preparing",
      }) });
    const session = await createAssistantSession(db, owner, CreateAssistantSessionSchema.parse({
      task: "interview", context: { caseId: applicationCase.id },
    }), randomUUID(), true);
    return { owner, applicationCase, session };
  };
  it("erases application assistant material and rejects a late provider result and incompatible deletion replay", async () => {
    const { owner, applicationCase, session } = await casePractice();
    const submitted = await submitAssistantTurn(db, owner, session.id, SubmitAssistantTurnSchema.parse({
      expectedRevision: session.revision, message: "我整理了访谈提纲", mode: "ai",
    }), randomUUID(), config);
    const request = { expectedRevision: applicationCase.revision, resumeDocuments: "delete", interviewSessions: "delete", debriefs: "delete" } as const;
    await complete(owner, session.id, submitted.turns[0]!.id, async () => {
      const deletion = await deleteApplicationCase({ db, owner, caseId: applicationCase.id, request });
      expect(deletion.relatedAssets.interviewSessions.deletedIds).toContain(session.id);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result("具体做了什么？")) } }] }), {status: 200});
    });
    await expect(assistantSession(db, owner, session.id)).rejects.toMatchObject({statusCode:404});
    const row = (await sql<{ snapshot: unknown; context: unknown }>`SELECT snapshot,context FROM profile.assistant_sessions WHERE id=${session.id}`.execute(db)).rows[0];
    expect(row).toEqual({snapshot:{},context:{}});
    expect((await sql`SELECT id FROM profile.assistant_turns WHERE session_id=${session.id}`.execute(db)).rows).toHaveLength(0);
    const replay = await deleteApplicationCase({ db, owner, caseId: applicationCase.id, request });
    expect(replay.relatedAssets.interviewSessions.deletedIds).toContain(session.id);
    await expect(deleteApplicationCase({ db, owner, caseId: applicationCase.id, request: {...request,interviewSessions:"detach"} })).rejects.toMatchObject({statusCode:409});
    await expect(createAssistantSession(db, owner, CreateAssistantSessionSchema.parse({task:"interview",context:{caseId:applicationCase.id}}),randomUUID(),true)).rejects.toMatchObject({statusCode:404});
  });
  it("keeps selected practice independently with its frozen materials and owner isolation", async () => {
    const { owner, applicationCase, session } = await casePractice();
    const before = (await sql<{snapshot: unknown}>`SELECT snapshot FROM profile.assistant_sessions WHERE id=${session.id}`.execute(db)).rows[0]!.snapshot;
    const deletion = await deleteApplicationCase({ db, owner, caseId: applicationCase.id,
      request: {expectedRevision:applicationCase.revision,resumeDocuments:"delete",interviewSessions:"detach",debriefs:"delete"} });
    expect(deletion.relatedAssets.interviewSessions.detachedIds).toContain(session.id);
    const retained = await assistantSession(db, owner, session.id);
    expect(retained.context.caseId).toBeUndefined();
    expect((await sql<{snapshot: unknown}>`SELECT snapshot FROM profile.assistant_sessions WHERE id=${session.id}`.execute(db)).rows[0]!.snapshot).toEqual(before);
    await expect(assistantSession(db, await context(), session.id)).rejects.toMatchObject({statusCode:404});
    const continued = await submitAssistantTurn(db, owner, session.id, SubmitAssistantTurnSchema.parse({ expectedRevision:retained.revision, message:"继续练习",mode:"fixed" }),randomUUID(),config);
    expect(continued.turns).toHaveLength(1);
  });
  it("passes the latest free answer to the provider, retains retries and produces different follow-up context", async () => {
    const owner = await context();
    let s = await createAssistantSession(
      db,
      owner,
      CreateAssistantSessionSchema.parse({
        task: "experience",
        context: { initialText: "我做过社团公众号排版。" },
      }),
      randomUUID(),
      true,
    );
    const observed: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)),
        payload = JSON.parse(body.messages[1].content).untrustedData;
      observed.push(payload.userMessage);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  result(
                    payload.userMessage.includes("排版")
                      ? "我们继续看排版过程。"
                      : "我们继续看你整理的反馈。",
                  ),
                ),
              },
            },
          ],
        }),
      );
    };
    s = await submitAssistantTurn(
      db,
      owner,
      s.id,
      SubmitAssistantTurnSchema.parse({
        expectedRevision: s.revision,
        message: "我负责排版，没有参与选题。",
      }),
      randomUUID(),
      config,
    );
    await complete(owner, s.id, s.turns.at(-1)!.id, fetchImpl);
    s = await assistantSession(db, owner, s.id);
    expect(s.turns[0]?.result?.reply).toContain("排版过程");
    s = await submitAssistantTurn(
      db,
      owner,
      s.id,
      SubmitAssistantTurnSchema.parse({
        expectedRevision: s.revision,
        message: "我整理了读者反馈。",
        questionId: s.turns[0]!.id,
        intent: "retry",
      }),
      randomUUID(),
      config,
    );
    await complete(owner, s.id, s.turns.at(-1)!.id, fetchImpl);
    s = await assistantSession(db, owner, s.id);
    expect(observed).toEqual(["我负责排版，没有参与选题。", "我整理了读者反馈。"]);
    expect(s.turns).toHaveLength(2);
    expect(s.turns[1]?.result?.reply).toContain("整理的反馈");
  });
  it("reviews a general resume without a Case, atomically adopts edits and rejects stale targets", async () => {
    const owner = await context();
    let d = await createStudioDocument(db, owner, { title: "通用简历" }, randomUUID());
    const entry = {
      ...blankResumeEntry(randomUUID()),
      title: "读书会",
      body: resumeRichText("整理读者反馈"),
    };
    d = await saveStudioDraft(
      db,
      owner,
      d.documentId,
      {
        expectedRevision: d.revision,
        title: d.title,
        layout: d.layout,
        content: {
          ...d.content,
          sections: [
            {
              id: randomUUID(),
              kind: "project",
              title: "项目",
              hidden: false,
              pageBreakBefore: false,
              column: "main",
              entries: [entry],
            },
          ],
        },
      },
      randomUUID(),
    );
    let s = await createAssistantSession(
      db,
      owner,
      CreateAssistantSessionSchema.parse({
        task: "resume_review",
        context: { documentId: d.documentId },
      }),
      randomUUID(),
      true,
    );
    const output = {
      ...result("可以把工作对象说得更清楚。"),
      kind: "draft",
      question: null,
      changes: [
        {
          id: "edit-feedback",
          target: "entry_body",
          entryId: entry.id,
          sectionIds: [],
          text: "整理读书会读者反馈。",
          reason: "明确工作对象。",
          sourceQuotes: ["整理读者反馈"],
        },
        { id: 'edit-title', target: 'entry_title', entryId: entry.id, sectionIds: [], text: '读书会反馈整理', reason: '明确经历标题', sourceQuotes: ['整理读者反馈'] },
      ],
    };
    s = await submitAssistantTurn(
      db,
      owner,
      s.id,
      SubmitAssistantTurnSchema.parse({
        expectedRevision: s.revision,
        message: "请优化这份通用简历。",
      }),
      randomUUID(),
      config,
    );
    const turnId = s.turns[0]!.id;
    await complete(
      owner,
      s.id,
      turnId,
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }),
        ),
    );
    const request = AdoptAssistantResultSchema.parse({
        target: "resume",
        expectedDraftRevision: d.revision,
        changeIds: ["edit-feedback"],
      }),
      key = randomUUID();
    const adopted = await adoptAssistantResult(db, owner, turnId, request, key, true);
    expect(await adoptAssistantResult(db, owner, turnId, request, key, true)).toEqual(adopted);
    expect(JSON.stringify((await getStudioDraft(db, owner, d.documentId)).content)).toContain(
      "整理读书会读者反馈",
    );
    const afterBody=await getStudioDraft(db,owner,d.documentId);
    await adoptAssistantResult(db,owner,turnId,AdoptAssistantResultSchema.parse({target:'resume',expectedDraftRevision:afterBody.revision,changeIds:['edit-title']}),randomUUID(),true);
    expect((await getStudioDraft(db,owner,d.documentId)).content.sections[0]?.entries[0]?.title).toBe('读书会反馈整理');
    await expect(
      adoptAssistantResult(
        db,
        owner,
        turnId,
        { ...request, expectedDraftRevision: d.revision + 1 },
        randomUUID(),
        true,
      ),
    ).rejects.toMatchObject({ code: "RESUME_DRAFT_CONFLICT" });
  });
  it("keeps fixed help distinct, rejects unsupported numeric facts and unavailable budgets", async () => {
    const owner = await context();
    let s = await createAssistantSession(
      db,
      owner,
      CreateAssistantSessionSchema.parse({ task: "interview", context: {} }),
      randomUUID(),
      true,
    );
    s = await submitAssistantTurn(
      db,
      owner,
      s.id,
      SubmitAssistantTurnSchema.parse({ expectedRevision: s.revision, mode: "fixed" }),
      randomUUID(),
      config,
    );
    expect(s.turns[0]?.status).toBe("fixed");
    expect(s.turns[0]?.model).toBeNull();
    expect(() =>
      validateAssistantGrounding(
        {
          ...result("成稿"),
          artifact: { title: "经历", body: "提升 50%", sourceQuotes: ["整理反馈"] },
        },
        { text: "整理反馈" },
      ),
    ).toThrow("数字");
    await saveUserAiSettings(db, owner, config, {
      expectedRevision: 1,
      baseUrl: "https://fixture.example/v1",
      model: "fixture-adaptive",
      enabled: false,
    });
    await expect(
      submitAssistantTurn(
        db,
        owner,
        s.id,
        SubmitAssistantTurnSchema.parse({ expectedRevision: s.revision }),
        randomUUID(),
        config,
      ),
    ).rejects.toMatchObject({ code: "AI_NOT_READY" });
  });
  it("deletes new owned stores through the existing all-data deletion worker and rejects late saves", async () => {
    const owner = await context(),
      d = await createStudioDocument(db, owner, { title: "待删除" }, randomUUID());
    const photoBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'), uploadKey=randomUUID();
    await uploadResumePhoto(db,owner,photoBytes,'image/png',config.resumeEncryptionKey!,uploadKey);
    const preferenceRevision=(await templatePreferences(db,owner)).items.find(item=>item.templateId==='jp_classic')?.revision??0;
    await setTemplatePreference(db,owner,{templateId:'jp_classic',favorite:true,expectedRevision:preferenceRevision},randomUUID());
    await createAssistantSession(
      db,
      owner,
      CreateAssistantSessionSchema.parse({
        task: "interview",
        context: { documentId: d.documentId },
      }),
      randomUUID(),
      true,
    );
    const request = await requestOwnerDeletion({ db, owner }),
      leaseOwner = randomUUID();
    const task = await db
      .updateTable("task_queue.tasks")
      .set({
        status: "running",
        lease_owner: leaseOwner,
        lease_until: new Date(Date.now() + 60000),
        fencing_token: 1,
        attempt: 1,
      })
      .where("owner_id", "=", owner.ownerId)
      .where("task_type", "=", "owner_deletion")
      .returningAll()
      .executeTakeFirstOrThrow();
    await processOwnerDeletion({
      db,
      deletionId: request.deletion.id,
      ownerId: owner.ownerId,
      requestedOwnerEpoch: owner.ownerEpoch,
      lease: {
        taskId: task.id,
        taskType: "owner_deletion",
        ownerId: owner.ownerId,
        ownerEpoch: owner.ownerEpoch,
        leaseOwner,
        fencingToken: 1,
      },
      now: new Date(),
    });
    for(const table of ['resume_photos','resume_template_preferences','resume_template_receipts']) expect((await sql`SELECT 1 FROM ${sql.id('profile',table)} WHERE owner_id=${owner.ownerId}`.execute(db)).rows).toHaveLength(0);
    await expect(uploadResumePhoto(db,owner,photoBytes,'image/png',config.resumeEncryptionKey!,uploadKey)).rejects.toBeDefined();
    await expect(setTemplatePreference(db,owner,{templateId:'jp_classic',favorite:true,expectedRevision:0},randomUUID())).rejects.toBeDefined();
    expect(
      (
        await sql`SELECT id FROM profile.assistant_sessions WHERE owner_id=${owner.ownerId}`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await sql`SELECT document_id FROM profile.resume_document_drafts WHERE owner_id=${owner.ownerId}`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      saveStudioDraft(
        db,
        owner,
        d.documentId,
        { expectedRevision: d.revision, title: d.title, content: d.content, layout: d.layout },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });

  it("retries the failed original answer once without replacing a newer composer input", async () => {
    const owner = await context();
    let s = await createAssistantSession(
      db,
      owner,
      CreateAssistantSessionSchema.parse({
        task: "experience",
        context: { initialText: "我整理了读者反馈。" },
      }),
      randomUUID(),
      true,
    );
    s = await submitAssistantTurn(
      db,
      owner,
      s.id,
      SubmitAssistantTurnSchema.parse({
        expectedRevision: s.revision,
        message: "我只负责整理，没有参与选题。",
        intent: "draft",
      }),
      randomUUID(),
      config,
    );
    const turnId = s.turns[0]!.id;
    const before = (
      await sql<{
        input_snapshot: unknown;
      }>`SELECT input_snapshot FROM profile.assistant_turns WHERE id=${turnId}`.execute(db)
    ).rows[0]!.input_snapshot;
    await complete(owner, s.id, turnId, async () => new Response("", { status: 429 }));
    s = await assistantSession(db, owner, s.id);
    expect(s.turns[0]).toMatchObject({ status: "failed", failureCode: "AI_RATE_LIMITED" });
    const revision = s.revision,
      key = randomUUID();
    s = await retryAssistantTurn(db, owner, turnId, revision, key);
    expect(await retryAssistantTurn(db, owner, turnId, revision, key)).toEqual(s);
    let observed: Record<string, unknown> = {};
    await complete(owner, s.id, turnId, async (_url, init) => {
      observed = JSON.parse(JSON.parse(String(init?.body)).messages[1].content).untrustedData;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(result("我们先整理你的工作。")) } }],
        }),
      );
    });
    s = await assistantSession(db, owner, s.id);
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]?.status).toBe("completed");
    expect(observed).toMatchObject({
      userMessage: "我只负责整理，没有参与选题。",
      intent: "draft",
      ...assistantFactSources(before, ["我只负责整理，没有参与选题。"]),
    });
    const other = await context();
    await expect(
      retryAssistantTurn(db, other, turnId, s.revision, randomUUID()),
    ).rejects.toMatchObject({ code: "ASSISTANT_SESSION_NOT_FOUND" });
  });
  it("pauses, resumes and completes an interview while keeping the selected question and history", async () => {
    const owner = await context();
    let s = await createAssistantSession(
      db,
      owner,
      CreateAssistantSessionSchema.parse({ task: "interview", context: {}, pace: "simulation" }),
      randomUUID(),
      true,
    );
    s = await setAssistantSessionStatus(db, owner, s.id, s.revision, "paused");
    await expect(
      submitAssistantTurn(
        db,
        owner,
        s.id,
        SubmitAssistantTurnSchema.parse({
          expectedRevision: s.revision,
          message: "尚未发出的回答",
        }),
        randomUUID(),
        config,
      ),
    ).rejects.toMatchObject({ code: "ASSISTANT_PAUSED" });
    s = await setAssistantSessionStatus(db, owner, s.id, s.revision, "active");
    s = await submitAssistantTurn(
      db,
      owner,
      s.id,
      SubmitAssistantTurnSchema.parse({
        expectedRevision: s.revision,
        message: "这一轮先到这里，请复盘。",
        intent: "finish",
      }),
      randomUUID(),
      config,
    );
    await expect(
      setAssistantSessionStatus(db, owner, s.id, s.revision, "paused"),
    ).rejects.toMatchObject({ code: "ASSISTANT_TURN_PENDING" });
    await complete(
      owner,
      s.id,
      s.turns[0]!.id,
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: JSON.stringify(result("本轮复盘已完成，可以继续整理表达。")) },
              },
            ],
          }),
        ),
    );
    s = await assistantSession(db, owner, s.id);
    expect(s.status).toBe("completed");
    expect(s.turns[0]?.result?.question).toBeNull();
    s = await setAssistantSessionStatus(db, owner, s.id, s.revision, "active");
    expect(s.turns).toHaveLength(1);
  });
  it("discards a late provider response after the linked document is deleted", async () => {
    const owner = await context(),
      document = await createStudioDocument(db, owner, { title: "删除中的简历" }, randomUUID());
    let s = await createAssistantSession(
      db,
      owner,
      CreateAssistantSessionSchema.parse({
        task: "resume_review",
        context: { documentId: document.documentId },
      }),
      randomUUID(),
      true,
    );
    s = await submitAssistantTurn(
      db,
      owner,
      s.id,
      SubmitAssistantTurnSchema.parse({ expectedRevision: s.revision, message: "检查这份简历。" }),
      randomUUID(),
      config,
    );
    await complete(owner, s.id, s.turns[0]!.id, async () => {
      const row = await db
        .selectFrom("profile.resume_documents")
        .select("revision")
        .where("id", "=", document.documentId)
        .executeTakeFirstOrThrow();
      await deleteResumeDocument({
        db,
        owner,
        documentId: document.documentId,
        request: { expectedRevision: Number(row.revision) },
      });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(result("这份简历可以继续完善。")) } }],
        }),
      );
    });
    await expect(assistantSession(db, owner, s.id)).rejects.toMatchObject({
      code: "ASSISTANT_SESSION_NOT_FOUND",
    });
    expect(
      (await sql`SELECT id FROM profile.assistant_turns WHERE session_id=${s.id}`.execute(db)).rows,
    ).toHaveLength(0);
  });

  it("updates a single whole experience without duplicating it or overwriting resumes and links preparation", async () => {
    const owner = await context();
    let draft = await createStudioDocument(db, owner, { title: "经历回流" }, randomUUID());
    const entry = {
      ...blankResumeEntry(randomUUID()),
      title: "实验助理",
      organization: "校内实验室",
      role: "学生助理",
      startDate: "2026.03",
      endDate: "2026.06",
      body: resumeRichText("整理实验记录和读者反馈。"),
    };
    draft = await saveStudioDraft(
      db,
      owner,
      draft.documentId,
      {
        expectedRevision: draft.revision,
        title: draft.title,
        layout: draft.layout,
        content: {
          ...draft.content,
          sections: [
            {
              id: randomUUID(),
              kind: "research",
              title: "科研经历",
              hidden: false,
              pageBreakBefore: false,
              column: "main",
              entries: [entry],
            },
          ],
        },
      },
      randomUUID(),
    );
    const original = (await listExperiences(db, owner))[0];
    if (!original) throw new Error("EXPERIENCE_FIXTURE_MISSING");
    let s = await createAssistantSession(
      db,
      owner,
      CreateAssistantSessionSchema.parse({
        task: "experience",
        context: { experienceIds: [original.id] },
      }),
      randomUUID(),
      true,
    );
    s = await submitAssistantTurn(
      db,
      owner,
      s.id,
      SubmitAssistantTurnSchema.parse({
        expectedRevision: s.revision,
        intent: "draft",
        message: "我还负责检查记录是否缺项。",
      }),
      randomUUID(),
      config,
    );
    const turn = s.turns[0];
    if (!turn) throw new Error("TURN_FIXTURE_MISSING");
    const output = {
      ...result("已整理成完整经历。"),
      question: null,
      kind: "draft",
      artifact: {
        title: "实验记录整理",
        body: "整理实验记录并检查记录是否缺项。",
        sourceQuotes: ["整理实验记录和读者反馈。", "我还负责检查记录是否缺项。"],
      },
      preparation: [{ title: "准备记录整理案例", detail: "找一份可说明检查过程的材料。" }],
    };
    await complete(
      owner,
      s.id,
      turn.id,
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }),
        ),
    );
    await adoptAssistantResult(
      db,
      owner,
      turn.id,
      AdoptAssistantResultSchema.parse({ target: "experience" }),
      randomUUID(),
      true,
    );
    const updated = await listExperiences(db, owner);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      id: original.id,
      kind: "research",
      revision: original.revision + 1,
      entry: {
        organization: "校内实验室",
        role: "学生助理",
        startDate: "2026.03",
        endDate: "2026.06",
      },
    });
    expect((await getStudioDraft(db, owner, draft.documentId)).content).toEqual(draft.content);
    const preparation = await adoptAssistantResult(
      db,
      owner,
      turn.id,
      AdoptAssistantResultSchema.parse({ target: "preparation", changeIds: ["preparation:0"] }),
      randomUUID(),
      true,
    );
    expect(preparation).toMatchObject({
      target: "preparation",
      items: [{ sourceExperienceIds: [original.id] }],
    });
    await expect(
      adoptAssistantResult(
        db,
        owner,
        turn.id,
        AdoptAssistantResultSchema.parse({ target: "experience", editedBody: "迟到的改写" }),
        randomUUID(),
        true,
      ),
    ).rejects.toMatchObject({ code: "EXPERIENCE_REVISION_CONFLICT" });
  });
});
