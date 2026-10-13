import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CreateApplicationCaseWithJobContextRequestSchema,
  CreateMaterialSnippetRequestSchema,
  JobGraphScopeSchema,
  type ResumePrintInput,
} from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createAnonymousSession, type OwnerContext } from "../identity/session-repository.js";
import { bulkCaseProgress } from "../applications/bulk-progress.js";
import { createApplicationCase, recordManualApplication } from "../applications/service.js";
import { listSubmittedMaterials } from "../applications/submitted-materials.js";
import { deleteResumeDocument } from "../career-assets/deletion-service.js";
import { requestOwnerDeletion, processOwnerDeletion } from "../profile/deletion-service.js";
import { getPrivateJobGraph, getPrivateGraphEvidence } from "../insights/private-graph.js";
import { getCurrentJobGraph } from "../insights/current-graph.js";
import { parseResumeBuffer } from "../resume/parse.js";
import { createResumeDocument } from "./service.js";
import { putResumeDocumentContentRevision } from "./revision-service.js";
import {
  createMaterialSnippet,
  listMaterialSnippets,
  updateMaterialSnippet,
  deleteMaterialSnippet,
} from "./material-snippets.js";
import { renderResumePdf } from "./pdf-service.js";
const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("product material continuity in PostgreSQL", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  const owners: OwnerContext[] = [];
  const purged = new Set<string>();
  beforeAll(() => migrateToLatest(db), 60000);
  async function createContext() {
    const session = await createAnonymousSession({ db });
    owners.push(session.context);
    return { db, owner: session.context };
  }
  async function purge(owner: OwnerContext) {
    if (purged.has(owner.ownerId)) return;
    const requested = await requestOwnerDeletion({ db, owner });
    const now = new Date(),
      leaseOwner = `materials-delete-${randomUUID()}`;
    const task = await db
      .updateTable("task_queue.tasks")
      .set({
        status: "running",
        attempt: 1,
        lease_owner: leaseOwner,
        lease_until: new Date(now.getTime() + 60000),
        heartbeat_at: now,
        fencing_token: 1,
      })
      .where("task_type", "=", "owner_deletion")
      .where("owner_id", "=", owner.ownerId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await processOwnerDeletion({
      db,
      deletionId: requested.deletion.id,
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
      now,
    });
    purged.add(owner.ownerId);
  }
  afterAll(async () => {
    try {
      for (const owner of owners) await purge(owner);
      const ids = owners.map((owner) => owner.ownerId);
      if (ids.length) {
        for (const table of ["task_queue.tasks", "identity.owner_sessions"] as const)
          await db.deleteFrom(table).where("owner_id", "in", ids).execute();
        await sql`DELETE FROM decision_feedback_audit.audit_events WHERE subject_id IN (SELECT id::text FROM decision.owner_deletions WHERE owner_id=ANY(${ids}::uuid[]))`.execute(
          db,
        );
        await db.deleteFrom("decision.owner_deletions").where("owner_id", "in", ids).execute();
        await db.deleteFrom("identity.owners").where("id", "in", ids).execute();
      }
    } finally {
      await db.destroy();
    }
  }, 60000);
  async function resume(context: Awaited<ReturnType<typeof createContext>>) {
    const { resumeDocument } = await createResumeDocument({
      ...context,
      request: { kind: "base", title: "测试同学-数据分析" },
      idempotencyKey: randomUUID(),
    });
    const sectionId = randomUUID(),
      blockId = randomUUID(),
      contentId = randomUUID(),
      layoutId = randomUUID();
    const snapshot: ResumePrintInput = {
      title: resumeDocument.title,
      content: {
        schemaVersion: "resume-content-v1",
        sections: [
          {
            id: sectionId,
            ordinal: 0,
            title: "项目经历",
            blocks: [
              {
                id: blockId,
                ordinal: 0,
                text: "使用 SQL 分析校园活动报名数据，形成一份数据报告。",
                evidenceIds: [],
              },
            ],
          },
        ],
      },
      templateKey: "cn_classic_single_column",
      sectionOrder: [sectionId],
      settings: {
        schemaVersion: "resume-layout-settings-v1",
        fontSizeToken: "standard",
        lineSpacingToken: "standard",
        sectionSpacingToken: "standard",
        colorToken: "charcoal",
        pageBreakPolicy: "keep_sections",
      },
    };
    await db
      .insertInto("profile.resume_document_revisions")
      .values({
        id: contentId,
        owner_id: context.owner.ownerId,
        owner_epoch: context.owner.ownerEpoch,
        resume_analysis_id: null,
        revision: 1,
        base_revision: null,
        schema_version: "resume-content-v1",
        sections: JSON.stringify(snapshot.content.sections),
        content_hash: "1".repeat(64),
        confirmed_at: new Date(),
        document_id: resumeDocument.id,
        document_revision: 1,
        base_document_revision_id: null,
      })
      .execute();
    await db
      .insertInto("profile.resume_layout_revisions")
      .values({
        id: layoutId,
        owner_id: context.owner.ownerId,
        owner_epoch: context.owner.ownerEpoch,
        document_id: resumeDocument.id,
        layout_revision: 1,
        base_layout_revision: null,
        schema_version: "resume-layout-v2",
        template_key: snapshot.templateKey,
        section_order: JSON.stringify(snapshot.sectionOrder),
        settings: JSON.stringify(snapshot.settings),
        content_hash: "2".repeat(64),
      })
      .execute();
    await db
      .updateTable("profile.resume_documents")
      .set({ current_content_revision_id: contentId, current_layout_revision_id: layoutId })
      .where("id", "=", resumeDocument.id)
      .execute();
    return {
      documentId: resumeDocument.id,
      contentRevisionId: contentId,
      layoutRevisionId: layoutId,
      snapshot,
      blockId,
    };
  }
  async function application(context: Awaited<ReturnType<typeof createContext>>) {
    return (
      await createApplicationCase({
        ...context,
        enableLocalMvp: true,
        idempotencyKey: randomUUID(),
        request: CreateApplicationCaseWithJobContextRequestSchema.parse({
          jobContext: {
            kind: "private_input",
            title: "数据分析实习生",
            companyName: "私有招聘夹具",
            contentText: "岗位职责：使用 SQL 制作报告。\n岗位要求：硕士或博士在读，熟悉 SQL。",
            source: { kind: "unspecified" },
          },
        }),
      })
    ).applicationCase;
  }
  it("copies a direction document and retains exactly the submitted revisions through later editing and source deletion", async () => {
    const a = await createContext(),
      b = await createContext(),
      source = await resume(a),
      caseItem = await application(a);
    const reference = {
      documentId: source.documentId,
      contentRevisionId: source.contentRevisionId,
      layoutRevisionId: source.layoutRevisionId,
    };
    const copyInput = {
      ...a,
      request: {
        kind: "base" as const,
        title: "数据方向稿",
        directionScope: JobGraphScopeSchema.parse({ jobFamily: "data_ai" }),
        copyFrom: reference,
      },
      idempotencyKey: randomUUID(),
    };
    const copy = await createResumeDocument(copyInput);
    expect(await createResumeDocument(copyInput)).toEqual(copy);
    expect(copy.resumeDocument.currentContentRevisionId).not.toBe(source.contentRevisionId);
    expect(copy.resumeDocument.copiedFromRevisionId).toBe(source.contentRevisionId);
    await expect(
      createResumeDocument({ ...copyInput, ...b, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "RESUME_DOCUMENT_NOT_FOUND" });
    const recordInput = {
      ...a,
      caseId: caseItem.id,
      request: { expectedRevision: 1, submittedResume: reference },
      idempotencyKey: randomUUID(),
    };
    const recorded = await recordManualApplication(recordInput);
    expect(await recordManualApplication(recordInput)).toEqual(recorded);
    const snapshot = (await listSubmittedMaterials({ ...a, caseId: caseItem.id })).items[0];
    expect(snapshot?.content).toEqual(source.snapshot.content);
    expect((await listSubmittedMaterials({ ...b, caseId: caseItem.id })).items).toHaveLength(0);
    await expect(
      db
        .updateTable("application.submitted_materials")
        .set({ title: "tamper" })
        .where("id", "=", snapshot?.id ?? "")
        .execute(),
    ).rejects.toThrow();
    const modified = structuredClone(source.snapshot.content);
    modified.sections[0]!.blocks[0]!.text = "后来补充的项目成果，尚未投递。";
    const edit = await putResumeDocumentContentRevision({
      ...a,
      documentId: source.documentId,
      request: {
        expectedRevision: 1,
        baseDocumentRevisionId: source.contentRevisionId,
        content: modified,
      },
      idempotencyKey: randomUUID(),
    });
    await expect(
      createResumeDocument({ ...copyInput, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "COPY_SOURCE_CHANGED" });
    await deleteResumeDocument({
      ...a,
      documentId: source.documentId,
      request: { expectedRevision: edit.documentRevision },
    });
    expect((await listSubmittedMaterials({ ...a, caseId: caseItem.id })).items[0]?.content).toEqual(
      source.snapshot.content,
    );
    const copied = await db
      .selectFrom("profile.resume_document_revisions")
      .select("sections")
      .where("id", "=", copy.resumeDocument.currentContentRevisionId as string)
      .executeTakeFirstOrThrow();
    expect(copied.sections).toEqual(source.snapshot.content.sections);
    await purge(a.owner);
    expect(
      await db
        .selectFrom("application.submitted_materials")
        .select("id")
        .where("owner_id", "=", a.owner.ownerId)
        .execute(),
    ).toHaveLength(0);
    await expect(recordManualApplication(recordInput)).rejects.toThrow("OWNER_EPOCH_STALE");
  });
  it("keeps snippets private, validates source blocks and erases retry payloads after deletion", async () => {
    const a = await createContext(),
      b = await createContext(),
      source = await resume(a);
    const request = CreateMaterialSnippetRequestSchema.parse({
      kind: "project_short",
      title: "项目短版",
      body: "用户自行整理的项目描述",
      sourceDocumentId: source.documentId,
      sourceContentRevisionId: source.contentRevisionId,
      sourceBlockIds: [source.blockId],
    });
    const input = { ...a, request, idempotencyKey: randomUUID() },
      snippet = await createMaterialSnippet(input);
    expect((await listMaterialSnippets({ ...b, offset: 0, limit: 50 })).items).toHaveLength(0);
    await expect(
      createMaterialSnippet({
        ...a,
        request: { ...request, sourceBlockIds: [randomUUID()] },
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "MATERIAL_BLOCK_NOT_FOUND" });
    await expect(
      updateMaterialSnippet({
        ...b,
        snippetId: snippet.id,
        request: { ...request, expectedRevision: 1 },
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "MATERIAL_NOT_FOUND" });
    await deleteMaterialSnippet({
      ...a,
      snippetId: snippet.id,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
    });
    await expect(createMaterialSnippet(input)).rejects.toMatchObject({
      code: "PLANNER_ITEM_DELETED",
    });
    const receipts = await db
      .selectFrom("application.planner_mutation_receipts")
      .select("result")
      .where("owner_id", "=", a.owner.ownerId)
      .execute();
    expect(JSON.stringify(receipts)).not.toContain(request.body);
  });
  it("reports batch conflicts separately and retries completed cases without duplicate events", async () => {
    const a = await createContext(),
      b = await createContext(),
      first = await application(a),
      foreign = await application(b);
    const input = {
      ...a,
      request: {
        items: [
          { caseId: first.id, expectedRevision: 1 },
          { caseId: foreign.id, expectedRevision: 1 },
        ],
        action: {
          kind: "transition" as const,
          request: { expectedRevision: 1, toStage: "preparing" as const },
        },
      },
      idempotencyKey: randomUUID(),
    };
    const result = await bulkCaseProgress(input);
    expect(result.items.map((item) => item.status)).toEqual(["succeeded", "failed"]);
    expect(await bulkCaseProgress(input)).toEqual(result);
    expect(
      await db
        .selectFrom("application.case_events")
        .select("id")
        .where("case_id", "=", first.id)
        .execute(),
    ).toHaveLength(2);
  });
  it("analyzes private JD only for its owner and never changes the public aggregate", async () => {
    const a = await createContext(),
      b = await createContext(),
      scope = JobGraphScopeSchema.parse({});
    const before = await getCurrentJobGraph({ db, scope, local: false });
    const c = await application(a);
    const graph = await getPrivateJobGraph({ ...a, scope });
    expect(graph.sample.jobCount).toBe(1);
    expect(graph.dataset).toBe("private");
    const atom = graph.items.find((item) => item.label === "SQL");
    expect(atom).toBeDefined();
    const quotes = await getPrivateGraphEvidence({
      ...a,
      scope,
      key: atom!.key,
      offset: 0,
      limit: 10,
    });
    expect(quotes.items.every((item) => item.caseId === c.id)).toBe(true);
    expect((await getPrivateJobGraph({ ...b, scope })).sample.jobCount).toBe(0);
    expect((await getCurrentJobGraph({ db, scope, local: false })).sample).toEqual(before.sample);
  });
  it.skipIf(!process.env.AIJOB_TEST_BROWSER_EXECUTABLE || !process.env.AIJOB_TEST_PDF_FONT)(
    "renders multiple Chinese pages with copyable text and releases capacity after failure",
    async () => {
      const a = await createContext(),
        source = await resume(a),
        runtime = {
          executablePath: process.env.AIJOB_TEST_BROWSER_EXECUTABLE!,
          fontPath: process.env.AIJOB_TEST_PDF_FONT!,
          concurrency: 1,
          timeoutMs: 30000,
        };
      const snapshot = structuredClone(source.snapshot);
      snapshot.content.sections[0]!.blocks = Array.from({ length: 90 }, (_, index) => ({
        id: randomUUID(),
        ordinal: index,
        text: `第 ${index + 1} 项：使用 SQL 分析校园数据，编写报告。<img src="https://invalid.example/track">`,
        evidenceIds: [],
      }));
      const buffer = await renderResumePdf({ db, snapshot, runtime });
      expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
      expect((buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(
        1,
      );
      const text = await parseResumeBuffer({ kind: "pdf", buffer });
      expect(text.replace(/\s/g, "")).toContain("分析校园数据");
      expect(text).toContain("invalid.example/track");
      const target = resolve(
        "../../docs/evidence/product-core-upgrade-2026-09-06/materials-chinese-fixture.pdf",
      );
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, buffer);
      await expect(
        renderResumePdf({
          db,
          snapshot,
          runtime: { ...runtime, executablePath: resolve("missing-browser-fixture") },
        }),
      ).rejects.toMatchObject({ code: "PDF_RENDER_FAILED" });
      const result = await db.connection().execute(async (connection) => {
        const lock = await sql<{
          ok: boolean;
        }>`SELECT pg_try_advisory_lock(hashtextextended('aijob:pdf-render:0',0)) AS ok`.execute(
          connection,
        );
        await sql`SELECT pg_advisory_unlock(hashtextextended('aijob:pdf-render:0',0))`.execute(
          connection,
        );
        return lock.rows[0]?.ok;
      });
      expect(result).toBe(true);
    },
    60000,
  );
});
