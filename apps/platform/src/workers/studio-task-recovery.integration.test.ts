import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { loadAppConfig } from "@aijob/config";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { CreateAssistantSessionSchema, SubmitAssistantTurnSchema } from "@aijob/contracts";
import { sql } from "kysely";
import { createAnonymousSession } from "../identity/session-repository.js";
import { saveUserAiSettings, userAiSettings } from "../ai/user-ai-service.js";
import { queueUserAiTest } from "../ai/user-ai-test.js";
import {
  assistantSession,
  createAssistantSession,
  submitAssistantTurn,
} from "../ai/assistant-service.js";
import { createStudioImport, listStudioOriginals } from "../resume-documents/studio-import.js";
import { runOneOwnerTask, runOwnerTaskWorker } from "./owner-task-worker.js";
const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("studio task terminal recovery", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  const config = loadAppConfig({
    rootDirectory: process.cwd(),
    overrideEnvironment: {
      APP_ENV: "test",
      DATABASE_URL: url ?? "postgresql://unused",
      RESUME_ENCRYPTION_KEY: "a".repeat(64),
      ENABLE_AI: "false",
    },
  });
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());
  it("turns exhausted imports, assistant replies and API tests into visible failures without overwriting a fresh retry", async () => {
    const { context: owner } = await createAnonymousSession({ db });
    await saveUserAiSettings(db, owner, config, {
      expectedRevision: 0,
      baseUrl: "https://fixture.example/v1",
      model: "fixture-model",
      apiKey: "fixture-only-key",
      dailyCalls: 20,
      dailyTokens: 100000,
    });
    await queueUserAiTest(db, owner, 1, randomUUID());
    const session = await createAssistantSession(
      db,
      owner,
      CreateAssistantSessionSchema.parse({
        task: "experience",
        context: { initialText: "我参与了课程调研。" },
      }),
      randomUUID(),
      true,
    );
    await submitAssistantTurn(
      db,
      owner,
      session.id,
      SubmitAssistantTurnSchema.parse({
        expectedRevision: session.revision,
        message: "我整理了访谈记录。",
      }),
      randomUUID(),
      config,
    );
    const imported = await createStudioImport(
      db,
      owner,
      {
        filename: "fixture.pdf",
        mediaType: "application/pdf",
        buffer: Buffer.from("not a real PDF: terminal-state fixture"),
        encryptionKey: config.resumeEncryptionKey,
      },
      randomUUID(),
    );
    await sql`UPDATE task_queue.tasks SET attempt=max_attempts WHERE owner_id=${owner.ownerId} AND status='queued'`.execute(
      db,
    );
    await expect(
      runOneOwnerTask({
        db,
        config,
        ownerIds: [owner.ownerId],
        taskTypes: [],
        fetchImpl: async () => {
          throw new Error("UNEXPECTED_NETWORK");
        },
      }),
    ).resolves.toBe(false);
    expect((await userAiSettings(db, owner)).settings?.testStatus).toBe("failed");
    expect((await assistantSession(db, owner, session.id)).turns.at(-1)?.failureCode).toBe(
      "OWNER_TASK_ATTEMPTS_EXHAUSTED",
    );
    expect((await listStudioOriginals(db, owner, imported.draft.documentId))[0]?.status).toBe(
      "failed",
    );
    await queueUserAiTest(db, owner, 1, randomUUID());
    await runOneOwnerTask({ db, config, ownerIds: [owner.ownerId], taskTypes: [] });
    expect((await userAiSettings(db, owner)).settings?.testStatus).toBe("queued");
    await db
      .updateTable("task_queue.tasks")
      .set({ status: "dead", completed_at: new Date() })
      .where("owner_id", "=", owner.ownerId)
      .where("status", "=", "queued")
      .execute();
  });
  it("recovers terminal state in the worker maintenance loop even when no task is claimable", async () => {
    const { context: owner } = await createAnonymousSession({ db });
    await saveUserAiSettings(db, owner, config, {
      expectedRevision: 0,
      baseUrl: "https://fixture.example/v1",
      model: "fixture-model",
      apiKey: "fixture-only-key",
      dailyCalls: 20,
      dailyTokens: 100000,
    });
    await queueUserAiTest(db, owner, 1, randomUUID());
    await sql`UPDATE task_queue.tasks SET attempt=max_attempts WHERE owner_id=${owner.ownerId} AND status='queued'`.execute(
      db,
    );
    const controller = new AbortController();
    let networkCalls = 0;
    const worker = runOwnerTaskWorker({
      db,
      config,
      signal: controller.signal,
      idleDelayMs: 20,
      fetchImpl: async () => {
        networkCalls++;
        throw new Error("UNEXPECTED_NETWORK");
      },
    });
    try {
      const deadline = Date.now() + 4000;
      let status: string | null | undefined;
      do {
        status = (await userAiSettings(db, owner)).settings?.testStatus;
        if (status === "failed") break;
        await new Promise((done) => setTimeout(done, 25));
      } while (Date.now() < deadline);
      expect(status).toBe("failed");
      expect(networkCalls).toBe(0);
      expect(
        (
          await db
            .selectFrom("task_queue.tasks")
            .select("status")
            .where("owner_id", "=", owner.ownerId)
            .execute()
        ).map((row) => row.status),
      ).toEqual(["dead"]);
    } finally {
      controller.abort();
      await worker;
    }
  }, 10000);
});
