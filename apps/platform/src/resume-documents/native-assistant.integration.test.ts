import { randomUUID } from "node:crypto";
import { parseAppConfig } from "@aijob/config";
import {
  AdoptAssistantResultSchema,
  AssistantResultSchema,
  CreateAssistantSessionSchema,
  SubmitAssistantTurnSchema,
} from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { newNativeItem } from "@aijob/resume-core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assistantSession,
  createAssistantSession,
  processAssistantTurn,
  submitAssistantTurn,
} from "../ai/assistant-service.js";
import { saveUserAiSettings } from "../ai/user-ai-service.js";
import { createAnonymousSession } from "../identity/session-repository.js";
import { listNativeExperiences } from "./native-experiences.js";
import {
  createNativeStudioDraft,
  getNativeStudioDraft,
  saveNativeStudioDraft,
} from "./native-studio-service.js";
import { adoptAssistantResult } from "./studio-review-service.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("native assistant context and revision boundary", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());
  for (const reviewFails of [false, true])
    it(reviewFails
      ? "retains the first draft when independent review fails"
      : "blocks unsupported reviewed suggestions without touching the native draft", async () => {
      const owner = (await createAnonymousSession({ db })).context;
      let draft = await createNativeStudioDraft(db, owner, "岗位准备夹具", randomUUID());
      const entry = newNativeItem("projects", "fixture:preparation");
      entry.name = "课程调研";
      entry.description = "<p>整理 18 次访谈，未负责销售。</p>";
      draft.document.data.sections.projects.items.push(entry);
      draft = await saveNativeStudioDraft(
        db,
        owner,
        draft.documentId,
        { expectedRevision: draft.revision, title: draft.title, document: draft.document },
        randomUUID(),
      );
      const config = parseAppConfig({
        APP_ENV: "test",
        DATABASE_URL: url,
        ENABLE_AI: "false",
        RESUME_ENCRYPTION_KEY: "a".repeat(64),
      });
      await saveUserAiSettings(db, owner, config, {
        expectedRevision: 0,
        baseUrl: "https://fixture.example/v1",
        model: "fixture-preparation",
        apiKey: "fixture-only",
        dailyCalls: 100,
        dailyTokens: 10000000,
      });
      let session = await createAssistantSession(
        db,
        owner,
        CreateAssistantSessionSchema.parse({
          task: "resume_review",
          workflow: "resume_prepare",
          context: { documentId: draft.documentId },
        }),
        randomUUID(),
        true,
      );
      expect(session.workflow).toBe("resume_prepare");
      session = await submitAssistantTurn(
        db,
        owner,
        session.id,
        SubmitAssistantTurnSchema.parse({
          expectedRevision: session.revision,
          intent: "draft",
          mode: "fixed",
        }),
        randomUUID(),
        config,
      );
      expect(session.turns[0]?.result?.preparationReview?.status).toBe("fixed");
      expect(session.turns[0]?.result?.preparation).toHaveLength(4);
      session = await submitAssistantTurn(
        db,
        owner,
        session.id,
        SubmitAssistantTurnSchema.parse({
          expectedRevision: session.revision,
          intent: "draft",
          mode: "ai",
        }),
        randomUUID(),
        config,
      );
      const turn = session.turns.at(-1);
      if (!turn) throw new Error("Missing preparation fixture turn");
      const leaseOwner = randomUUID();
      const task = (
        await sql<{
          id: string;
          fencing_token: number;
        }>`UPDATE task_queue.tasks SET status='running',lease_owner=${leaseOwner},lease_until=now()+interval '2 minutes',fencing_token=fencing_token+1 WHERE owner_id=${owner.ownerId} AND task_type='career_assistant' AND payload->>'turnId'=${turn.id} RETURNING id,fencing_token`.execute(
          db,
        )
      ).rows[0];
      if (!task) throw new Error("Missing preparation fixture task");
      const candidate = AssistantResultSchema.parse({
        schemaVersion: "career-assistant-result-v1",
        kind: "draft",
        reply: "夹具起草",
        question: null,
        artifact: null,
        changes: [
          {
            id: "prepared",
            target: "entry_body",
            entryId: entry.id,
            sectionIds: [],
            text: "归纳 18 次访谈，未负责销售。",
            reason: "明确贡献边界",
            sourceQuotes: ["整理 18 次访谈，未负责销售。"],
          },
        ],
        preparation: [],
        known: [],
        openQuestions: [],
      });
      let calls = 0;
      await processAssistantTurn({
        db,
        owner,
        sessionId: session.id,
        turnId: turn.id,
        config,
        lease: {
          taskId: task.id,
          taskType: "career_assistant",
          ownerId: owner.ownerId,
          ownerEpoch: owner.ownerEpoch,
          leaseOwner,
          fencingToken: Number(task.fencing_token),
        },
        fetchImpl: async (_url, init) => {
          calls++;
          const payload = JSON.parse(
            JSON.parse(String(init?.body)).messages[1].content,
          ).untrustedData;
          expect(payload.personalFacts.document.editorCore).toBe("native-v1");
          expect(payload).toHaveProperty("jobContext");
          expect(payload).not.toHaveProperty("snapshot");
          if (calls === 2) {
            expect(payload.candidate.changes).toEqual(candidate.changes);
            const retained = (
              await sql<{
                result: unknown;
              }>`SELECT result FROM profile.assistant_turns WHERE id=${turn.id}`.execute(db)
            ).rows[0];
            expect(AssistantResultSchema.parse(retained?.result).changes).toEqual(
              candidate.changes,
            );
            if (reviewFails) return new Response("fixture unavailable", { status: 503 });
          }
          const result =
            calls === 1
              ? candidate
              : {
                  summary: "夹具：标记一处缺少依据",
                  issues: [
                    {
                      changeId: "prepared",
                      severity: "unsupported_fact",
                      detail: "夹具审阅阻止直接采用",
                    },
                  ],
                };
          return new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      });
      session = await assistantSession(db, owner, session.id);
      expect(calls).toBe(2);
      const result = session.turns.at(-1);
      expect(result?.status).toBe("completed");
      expect(result?.result?.changes).toEqual(candidate.changes);
      expect(result?.result?.preparationReview?.status).toBe(reviewFails ? "failed" : "completed");
      expect((await getNativeStudioDraft(db, owner, draft.documentId)).document).toEqual(
        draft.document,
      );
      const adoption = () =>
        adoptAssistantResult(
          db,
          owner,
          turn.id,
          AdoptAssistantResultSchema.parse({
            target: "resume",
            expectedDraftRevision: draft.revision,
            changeIds: ["prepared"],
          }),
          randomUUID(),
          true,
        );
      if (reviewFails) {
        const adopted = (await adoption()) as { draft: typeof draft };
        expect(adopted.draft.document.data.sections.projects.items[0]?.description).toContain(
          "归纳 18 次访谈",
        );
      } else await expect(adoption()).rejects.toMatchObject({ code: "AI_REVIEW_UNSUPPORTED_FACT" });
    }, 30000);
  it("adopts fixture suggestions on native fields and rejects late changes without writing legacy content", async () => {
    const owner = (await createAnonymousSession({ db })).context;
    let draft = await createNativeStudioDraft(db, owner, "原生 AI 夹具", randomUUID());
    const entry = newNativeItem("projects", "import:page1:project1");
    entry.name = "课程项目";
    entry.role = "用户访谈";
    entry.description = "<p>整理 18 次访谈。</p>";
    draft.document.data.sections.projects.items.push(entry);
    draft = await saveNativeStudioDraft(
      db,
      owner,
      draft.documentId,
      { expectedRevision: draft.revision, title: draft.title, document: draft.document },
      randomUUID(),
    );
    const session = await createAssistantSession(
      db,
      owner,
      CreateAssistantSessionSchema.parse({
        task: "resume_review",
        context: { documentId: draft.documentId },
      }),
      randomUUID(),
      true,
    );
    const config = parseAppConfig({
      APP_ENV: "test",
      DATABASE_URL: url,
      ENABLE_AI: "false",
      RESUME_ENCRYPTION_KEY: "a".repeat(64),
    });
    const response = await submitAssistantTurn(
      db,
      owner,
      session.id,
      SubmitAssistantTurnSchema.parse({
        expectedRevision: session.revision,
        message: "请整理我的表达",
        mode: "fixed",
      }),
      randomUUID(),
      config,
    );
    const turn = response.turns.at(-1);
    if (!turn) throw new Error("Missing fixture turn");
    const stored = (
      await sql<{
        input_snapshot: { document: { editorCore: string; content: Record<string, unknown> } };
      }>`SELECT input_snapshot FROM profile.assistant_turns WHERE id=${turn.id}`.execute(db)
    ).rows[0];
    expect(stored?.input_snapshot.document.editorCore).toBe("native-v1");
    expect(stored?.input_snapshot.document.content).not.toHaveProperty("picture");
    expect(stored?.input_snapshot.document.content).not.toHaveProperty("metadata");
    const result = AssistantResultSchema.parse({
      schemaVersion: "career-assistant-result-v1",
      kind: "draft",
      reply: "夹具修改建议，不是真实模型结果",
      question: null,
      artifact: null,
      changes: [
        {
          id: "change",
          target: "entry_body",
          entryId: entry.id,
          sectionIds: [],
          text: "归纳 18 次访谈中的问题。",
          reason: "明确动作",
          sourceQuotes: ["整理 18 次访谈"],
        },
      ],
      preparation: [],
      known: [],
      openQuestions: [],
    });
    await sql`UPDATE profile.assistant_turns SET status='completed',result=${JSON.stringify(result)}::jsonb WHERE id=${turn.id}`.execute(
      db,
    );
    const request = AdoptAssistantResultSchema.parse({
      target: "resume",
      expectedDraftRevision: draft.revision,
      changeIds: ["change"],
    });
    const adopted = (await adoptAssistantResult(
      db,
      owner,
      turn.id,
      request,
      randomUUID(),
      true,
    )) as { draft: typeof draft };
    expect(adopted.draft.document.data.sections.projects.items[0]?.description).toBe(
      "<p>归纳 18 次访谈中的问题。</p>",
    );
    await expect(
      adoptAssistantResult(
        db,
        owner,
        turn.id,
        { ...request, expectedDraftRevision: adopted.draft.revision },
        randomUUID(),
        true,
      ),
    ).rejects.toMatchObject({ code: "NATIVE_AI_SOURCE_CHANGED" });
    expect((await getNativeStudioDraft(db, owner, draft.documentId)).document.schemaVersion).toBe(
      "aijob-native-resume-v1",
    );
    const experience = (await listNativeExperiences(db, owner))[0];
    if (!experience) throw new Error("Expected captured native experience");
    const experienceSession = await createAssistantSession(
      db,
      owner,
      CreateAssistantSessionSchema.parse({
        task: "experience",
        context: { experienceIds: [experience.id] },
      }),
      randomUUID(),
      true,
    );
    const experienceResponse = await submitAssistantTurn(
      db,
      owner,
      experienceSession.id,
      SubmitAssistantTurnSchema.parse({
        expectedRevision: experienceSession.revision,
        mode: "fixed",
      }),
      randomUUID(),
      config,
    );
    const experienceTurn = experienceResponse.turns[0];
    if (!experienceTurn) throw new Error("Expected experience fixture turn");
    const experienceResult = AssistantResultSchema.parse({
      ...result,
      changes: [],
      artifact: {
        title: "课程项目",
        body: "整理并归纳 18 次访谈。",
        sourceQuotes: ["整理 18 次访谈"],
      },
    });
    await sql`UPDATE profile.assistant_turns SET status='completed',result=${JSON.stringify(experienceResult)}::jsonb WHERE id=${experienceTurn.id}`.execute(
      db,
    );
    await adoptAssistantResult(
      db,
      owner,
      experienceTurn.id,
      AdoptAssistantResultSchema.parse({ target: "experience" }),
      randomUUID(),
      true,
    );
    const updatedExperience = (await listNativeExperiences(db, owner))[0];
    expect(updatedExperience?.experience.entry.role).toBe("用户访谈");
    expect(updatedExperience?.experience.entry.description).toContain("整理并归纳");
    expect(
      (await getNativeStudioDraft(db, owner, draft.documentId)).document.data.sections.projects
        .items[0]?.description,
    ).toBe("<p>归纳 18 次访谈中的问题。</p>");
  });
});
