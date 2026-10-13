import { randomUUID } from "node:crypto";
import { loadAppConfig } from "@aijob/config";
import { CreateAssistantSessionSchema, SubmitAssistantTurnSchema } from "@aijob/contracts";
import { assertIsolatedTestDatabaseUrl, createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assistantSession,
  createAssistantSession,
  submitAssistantTurn,
} from "../ai/assistant-service.js";
import { queueUserAiTest } from "../ai/user-ai-test.js";
import { saveUserAiSettings, userAiSettings } from "../ai/user-ai-service.js";
import { createAnonymousSession } from "../identity/session-repository.js";
import { runOneOwnerTask } from "./owner-task-worker.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
if (url) assertIsolatedTestDatabaseUrl(url);
(url ? describe : describe.skip)("interactive capacity and truthful queue state", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  const config = loadAppConfig({
    rootDirectory: process.cwd(),
    overrideEnvironment: {
      APP_ENV: "test",
      DATABASE_URL: url ?? "postgresql://unused",
      RESUME_ENCRYPTION_KEY: "a".repeat(64),
    },
  });
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());
  it("defers an owner's busy calls without consuming retries, while another owner progresses", async () => {
    const owner = (await createAnonymousSession({ db })).context;
    const other = (await createAnonymousSession({ db })).context;
    for (const current of [owner, other])
      await saveUserAiSettings(db, current, config, {
        expectedRevision: 0,
        baseUrl: "https://fixture.example/v1",
        model: "capacity-fixture",
        apiKey: "fixture-only",
        concurrency: 1,
        dailyCalls: 20,
        dailyTokens: 1000000,
      });
    const enqueue = async (current: typeof owner) => {
      const session = await createAssistantSession(
        db,
        current,
        CreateAssistantSessionSchema.parse({
          task: "experience",
          context: { initialText: "课程项目：整理访谈资料。" },
        }),
        randomUUID(),
        true,
      );
      return submitAssistantTurn(
        db,
        current,
        session.id,
        SubmitAssistantTurnSchema.parse({
          expectedRevision: session.revision,
          message: "我整理了访谈记录。",
          mode: "ai",
        }),
        randomUUID(),
        config,
      );
    };
    const first = await enqueue(owner),
      second = await enqueue(owner),
      independent = await enqueue(other);
    const secondTurn = second.turns[0];
    if (!secondTurn) throw new Error("MISSING_QUEUED_FIXTURE_TURN");
    expect(secondTurn.executionStatus).toBe("waiting");
    await expect(
      sql`UPDATE task_queue.tasks SET owner_id=${other.ownerId} WHERE payload->>'turnId'=${secondTurn.id}`.execute(
        db,
      ),
    ).rejects.toThrow("IMMUTABLE_TASK_CONTEXT");
    expect((await assistantSession(db, owner, second.id)).turns[0]?.executionStatus).toBe(
      "waiting",
    );
    await sql`UPDATE task_queue.tasks SET status='running',lease_owner='expired-fixture',lease_until=now()-interval '1 second' WHERE payload->>'turnId'=${secondTurn.id}`.execute(
      db,
    );
    expect((await assistantSession(db, owner, second.id)).turns[0]?.executionStatus).toBe(
      "waiting",
    );
    await sql`UPDATE task_queue.tasks SET status='queued',lease_owner=null,lease_until=null WHERE payload->>'turnId'=${secondTurn.id}`.execute(
      db,
    );
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const start = new Promise<void>((done) => {
      started = done;
    });
    let calls = 0;
    const response = () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: "career-assistant-result-v1",
                  kind: "question",
                  reply: "请继续说明整理过程。",
                  question: "哪些工作是你独立完成的？",
                  artifact: null,
                  changes: [],
                  preparation: [],
                  known: [],
                  openQuestions: [],
                }),
              },
            },
          ],
        }),
      );
    const fetchImpl: typeof fetch = async () => {
      calls++;
      return response();
    };
    const running = runOneOwnerTask({
      db,
      config,
      ownerIds: [owner.ownerId],
      taskTypes: ["career_assistant"],
      fetchImpl: async () => {
        calls++;
        started();
        await gate;
        return response();
      },
    });
    try {
      await start;
      expect((await assistantSession(db, owner, first.id)).turns[0]?.executionStatus).toBe(
        "processing",
      );
      await expect(assistantSession(db, other, first.id)).rejects.toMatchObject({
        statusCode: 404,
      });
      for (let i = 0; i < 4; i++) {
        await sql`UPDATE task_queue.tasks SET available_at=now() WHERE owner_id=${owner.ownerId} AND status='queued'`.execute(
          db,
        );
        await runOneOwnerTask({
          db,
          config,
          ownerIds: [owner.ownerId],
          taskTypes: ["career_assistant"],
          fetchImpl,
        });
        expect((await assistantSession(db, owner, second.id)).turns[0]).toMatchObject({
          status: "queued",
          executionStatus: "waiting",
        });
      }
      expect(
        (
          await sql<{
            attempt: number;
          }>`SELECT attempt FROM task_queue.tasks WHERE payload->>'turnId'=${secondTurn.id}`.execute(
            db,
          )
        ).rows[0]?.attempt,
      ).toBe(0);
      await queueUserAiTest(db, owner, 1, randomUUID());
      await runOneOwnerTask({
        db,
        config,
        ownerIds: [owner.ownerId],
        taskTypes: ["ai_connection_test"],
        fetchImpl,
      });
      expect((await userAiSettings(db, owner)).settings?.testStatus).toBe("queued");
      expect((await userAiSettings(db, owner)).usage).toMatchObject({
        calls: 1,
        running: 1,
        failed: 0,
      });
      await runOneOwnerTask({
        db,
        config,
        ownerIds: [other.ownerId],
        taskTypes: ["career_assistant"],
        fetchImpl,
      });
      expect((await assistantSession(db, other, independent.id)).turns[0]?.status).toBe(
        "completed",
      );
      expect(calls).toBe(2);
    } finally {
      release();
      await running;
    }
    await sql`UPDATE task_queue.tasks SET available_at=now() WHERE owner_id=${owner.ownerId} AND status='queued'`.execute(
      db,
    );
    await runOneOwnerTask({
      db,
      config,
      ownerIds: [owner.ownerId],
      taskTypes: ["career_assistant"],
      fetchImpl,
    });
    expect((await assistantSession(db, owner, second.id)).turns[0]).toMatchObject({
      status: "completed",
      executionStatus: null,
    });
    await runOneOwnerTask({
      db,
      config,
      ownerIds: [owner.ownerId],
      taskTypes: ["ai_connection_test"],
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })),
    });
    expect((await userAiSettings(db, owner)).settings?.testStatus).toBe("completed");
    expect((await userAiSettings(db, owner)).usage).toMatchObject({
      calls: 3,
      completed: 3,
      failed: 0,
    });
  }, 20000);
});
