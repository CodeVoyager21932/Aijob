import { randomUUID } from "node:crypto";
import { parseAppConfig } from "@aijob/config";
import {
  CreateApplicationCaseWithJobContextRequestSchema,
  CreateAssistantSessionSchema,
  RESUME_SAMPLE_PHOTO,
  SubmitAssistantTurnSchema,
} from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { joinNativeResumeDocument, newNativeItem } from "@aijob/resume-core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAssistantSession, submitAssistantTurn } from "../ai/assistant-service.js";
import { createApplicationCase, recordManualApplication } from "../applications/service.js";
import {
  exportSubmittedMaterial,
  listSubmittedMaterials,
} from "../applications/submitted-materials.js";
import { deleteResumeDocument } from "../career-assets/deletion-service.js";
import { createAnonymousSession } from "../identity/session-repository.js";
import { prepareInterviewContinuity } from "../interviews/continuity.js";
import { checkpointNativeDraft } from "./native-checkpoint.js";
import { createNativeStudioDraft, getNativeStudioDraft, saveNativeStudioDraft } from "./native-studio-service.js";
import { createResumeDocument } from "./service.js";
import { createNativeExport } from "./native-export.js";
import { downloadResumeExport } from "./export-artifacts.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("native submitted material continuity", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());
  it("retains native fields and photo through edits/deletion and uses the actual submission in interview context", async () => {
    const owner = (await createAnonymousSession({ db })).context,
      stranger = (await createAnonymousSession({ db })).context;
    let draft = await createNativeStudioDraft(db, owner, "实际投递原生稿", randomUUID());
    const item = newNativeItem("projects", "native:submitted:project");
    item.name = "调研项目";
    item.role = "访谈执行";
    item.description = "<p>完成 18 次访谈并形成报告。</p>";
    draft.document.data.basics.name = "投递同学";
    draft.document.data.sections.projects.items.push(item);
    draft.document.data.picture.url = RESUME_SAMPLE_PHOTO;
    draft.document.data.picture.hidden = false;
    draft = await saveNativeStudioDraft(
      db,
      owner,
      draft.documentId,
      { expectedRevision: draft.revision, title: draft.title, document: draft.document },
      randomUUID(),
    );
    let pair = await checkpointNativeDraft(db, owner, draft.documentId, draft.revision);
    let application = (
      await createApplicationCase({
        db,
        owner,
        enableLocalMvp: true,
        idempotencyKey: randomUUID(),
        request: CreateApplicationCaseWithJobContextRequestSchema.parse({
          jobContext: {
            kind: "private_input",
            title: "产品实习",
            companyName: "独立夹具",
            contentText: "负责用户调研与报告整理。本科及以上在读。",
            source: { kind: "unspecified" },
          },
        }),
      })
    ).applicationCase;
    const baseId = draft.documentId;
    const derived = await createResumeDocument({db,owner,idempotencyKey:randomUUID(),request:{
      kind:"case_derived",caseId:application.id,expectedCaseRevision:application.revision,
      baseDocumentRevisionId:pair.contentRevisionId,title:"岗位独立稿",
    }});
    draft = await getNativeStudioDraft(db,owner,derived.resumeDocument.id);
    expect(draft.document.data.sections.projects.items[0]?.role).toBe("访谈执行");
    expect(draft.documentId).not.toBe(baseId);
    pair = await checkpointNativeDraft(db,owner,draft.documentId,draft.revision);
    const encryptionKey="a".repeat(64);
    const artifact=await createNativeExport({db,owner,documentId:draft.documentId,request:{...pair,format:"pdf"},idempotencyKey:randomUUID(),encryptionKey});
    const originalFile=await downloadResumeExport(db,owner,artifact.id,encryptionKey);
    application = {...application, revision:application.revision+1};
    const record = {
      db,
      owner,
      caseId: application.id,
      request: {
        expectedRevision: application.revision,
        submittedResume: { documentId: draft.documentId, ...pair, exportArtifactId:artifact.id },
      },
      idempotencyKey: randomUUID(),
    };
    await recordManualApplication(record);
    await recordManualApplication(record);
    const materials = await listSubmittedMaterials({ db, owner, caseId: application.id });
    expect(materials.items).toHaveLength(1);
    const material = materials.items[0];
    expect(material?.submittedFile?.artifactId).toBe(artifact.id);
    if (!material || material.editorCore !== "native-v1")
      throw new Error("Expected native snapshot");
    const snapshot = joinNativeResumeDocument(material.content, material.layout);
    expect(snapshot.data.sections.projects.items[0]?.role).toBe("访谈执行");
    expect(snapshot.data.picture.url).toBe(RESUME_SAMPLE_PHOTO);
    const entry = draft.document.data.sections.projects.items[0];
    if (!entry) throw new Error("Expected item");
    entry.description = "<p>后来改写为 99 次。</p>";
    await saveNativeStudioDraft(
      db,
      owner,
      draft.documentId,
      { expectedRevision: draft.revision, title: draft.title, document: draft.document },
      randomUUID(),
    );
    expect((await getNativeStudioDraft(db,owner,baseId)).document.data.sections.projects.items[0]?.description).toContain("18 次");
    const continuity = await db.transaction().execute((tx) =>
      prepareInterviewContinuity({
        tx,
        owner,
        caseId: application.id,
        resumeContentRevisionId: pair.contentRevisionId,
        requirements: [],
        persisted: new Set(),
      }),
    );
    expect(continuity.materialQuotes.join(" ")).toContain("18 次");
    expect(continuity.materialQuotes.join(" ")).not.toContain("99 次");
    const session = await createAssistantSession(
      db,
      owner,
      CreateAssistantSessionSchema.parse({
        task: "interview",
        context: { caseId: application.id },
      }),
      randomUUID(),
      true,
    );
    const response = await submitAssistantTurn(
      db,
      owner,
      session.id,
      SubmitAssistantTurnSchema.parse({ expectedRevision: session.revision, mode: "fixed" }),
      randomUUID(),
      parseAppConfig({
        APP_ENV: "test",
        DATABASE_URL: url,
        ENABLE_AI: "false",
        RESUME_ENCRYPTION_KEY: "a".repeat(64),
      }),
    );
    const turn = response.turns[0];
    if (!turn) throw new Error("Expected turn");
    const row = (
      await sql<{
        input_snapshot: unknown;
      }>`SELECT input_snapshot FROM profile.assistant_turns WHERE id=${turn.id}`.execute(db)
    ).rows[0];
    expect(JSON.stringify(row?.input_snapshot)).toContain("18 次");
    expect(JSON.stringify(row?.input_snapshot)).not.toContain("99 次");
    expect(JSON.stringify(row?.input_snapshot)).not.toContain("data:image");
    const doc = await db
      .selectFrom("profile.resume_documents")
      .select("revision")
      .where("id", "=", draft.documentId)
      .executeTakeFirstOrThrow();
    await deleteResumeDocument({
      db,
      owner,
      documentId: draft.documentId,
      request: { expectedRevision: doc.revision },
    });
    expect(
      (await listSubmittedMaterials({ db, owner, caseId: application.id })).items[0]?.content,
    ).toEqual(material.content);
    const file = await exportSubmittedMaterial({
      db,
      owner,
      caseId: application.id,
      materialId: material.id,
      format: "pdf",
      encryptionKey,
    });
    expect(file.buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(file.buffer.equals(originalFile.buffer)).toBe(true);
    await expect(
      exportSubmittedMaterial({
        db,
        owner: stranger,
        caseId: application.id,
        materialId: material.id,
        format: "pdf",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  }, 30000);
});
