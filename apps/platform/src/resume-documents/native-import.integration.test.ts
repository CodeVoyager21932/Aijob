import { randomUUID } from "node:crypto";
import { parseAppConfig } from "@aijob/config";
import { createDatabase, migrateToLatest } from "@aijob/database";
import {
  applyNativeImportCorrection,
  applyNativeTemplate,
  createNativeResumeDocument,
  newNativeItem,
} from "@aijob/resume-core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnonymousSession } from "../identity/session-repository.js";
import { checkpointNativeDraft } from "./native-checkpoint.js";
import { createNativeDocx } from "./native-docx.js";
import {
  getNativeImport,
  listNativeImports,
  processNativeImport,
  queueNativeImport,
} from "./native-import.js";
import {
  createNativeStudioDraft,
  getNativeStudioDraft,
  saveNativeStudioDraft,
} from "./native-studio-service.js";
import { downloadStudioOriginal } from "./studio-import.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("native import lease and original boundary", () => {
  const db = createDatabase(url ?? "postgresql://unused"),
    key = "a".repeat(64);
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());
  const source = async () => {
    const document = createNativeResumeDocument();
    document.data.basics.name = "导入同学";
    document.data.basics.email = "student@example.com";
    const project = newNativeItem("projects", "fixture-project");
    project.name = "校园调研";
    project.period = "2025.03–2025.06";
    project.description = "<p>完成 18 次访谈，整理报告。</p>";
    document.data.sections.projects.items.push(project);
    return createNativeDocx(document);
  };
  for (const format of ["docx", "text"] as const)
    for (const changed of [false, true])
      it(format +
        ": " +
        (changed
          ? "retains a late parse as a proposal without replacing newer input"
          : "imports into a blank draft and preserves its native template and private original"), async () => {
        const owner = (await createAnonymousSession({ db })).context;
        const initial = await createNativeStudioDraft(db, owner, "导入夹具", randomUUID());
        const draft = await saveNativeStudioDraft(
          db,
          owner,
          initial.documentId,
          {
            expectedRevision: initial.revision,
            title: initial.title,
            document: applyNativeTemplate(initial.document, "gengar-cn"),
          },
          randomUUID(),
        );
        const buffer =
            format === "docx"
              ? await source()
              : Buffer.from("导入同学\n项目经历\n校园调研\n完成 18 次访谈，整理报告。", "utf8"),
          requestKey = randomUUID();
        const input = {
          filename: `fixture.${format === "text" ? "txt" : "docx"}`,
          ...(format === "text" ? { kind: "text" as const } : {}),
          mediaType:
            format === "text"
              ? "text/plain"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer,
          encryptionKey: key,
          expectedRevision: draft.revision,
        };
        const original = await queueNativeImport(db, owner, draft.documentId, input, requestKey);
        expect(await queueNativeImport(db, owner, draft.documentId, input, requestKey)).toEqual(
          original,
        );
        expect(await queueNativeImport(db, owner, draft.documentId, input, randomUUID())).toEqual(
          original,
        );
        await expect(
          queueNativeImport(
            db,
            owner,
            draft.documentId,
            { ...input, filename: "different.docx" },
            requestKey,
          ),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
        const other = (await createAnonymousSession({ db })).context;
        await expect(
          getNativeImport(db, other, draft.documentId, original.originalId),
        ).rejects.toMatchObject({ statusCode: 404 });
        await expect(
          downloadStudioOriginal(db, other, original.originalId, key),
        ).rejects.toMatchObject({ statusCode: 404 });
        if (changed) {
          const document = structuredClone(draft.document);
          document.data.basics.name = "后来输入";
          await saveNativeStudioDraft(
            db,
            owner,
            draft.documentId,
            { expectedRevision: draft.revision, title: draft.title, document },
            randomUUID(),
          );
        }
        const leaseOwner = randomUUID();
        const task = (
          await sql<{
            id: string;
            fencing_token: number;
          }>`UPDATE task_queue.tasks SET status='running',lease_owner=${leaseOwner},lease_until=clock_timestamp()+interval '2 minutes',fencing_token=fencing_token+1 WHERE owner_id=${owner.ownerId} AND task_type='resume_studio_import' RETURNING id,fencing_token`.execute(
            db,
          )
        ).rows[0];
        if (!task) throw new Error("Missing import task");
        const config = parseAppConfig({
          APP_ENV: "test",
          DATABASE_URL: url,
          RESUME_ENCRYPTION_KEY: key,
          ENABLE_AI: "false",
        });
        const request = {
          db,
          owner,
          originalId: original.originalId,
          documentId: draft.documentId,
          expectedRevision: draft.revision,
          config,
          lease: {
            taskId: task.id,
            taskType: "resume_studio_import" as const,
            ownerId: owner.ownerId,
            ownerEpoch: owner.ownerEpoch,
            leaseOwner,
            fencingToken: Number(task.fencing_token),
          },
        };
        await db.connection().execute(async connection=>{
          await sql`SET ROLE aijob_match_worker`.execute(connection);
          try{await processNativeImport({...request,db:connection});}
          finally{await sql`RESET ROLE`.execute(connection);}
        });
        const result = await getNativeImport(db, owner, draft.documentId, original.originalId);
        expect(result.status).toBe(changed ? "ready" : "succeeded");
        expect(JSON.stringify(result.parsed)).toContain("18 次访谈");
        const saved = await getNativeStudioDraft(db, owner, draft.documentId);
        expect(saved.document.data.basics.name).toBe(changed ? "后来输入" : "导入同学");
        expect(saved.document.presentation).toEqual(draft.document.presentation);
        if (!changed) {
          expect(saved.document.sourceBindings?.length).toBeGreaterThan(0);
          expect(
            saved.document.sourceBindings?.every(
              (binding) => binding.originalId === original.originalId,
            ),
          ).toBe(true);
          const copy = await createNativeStudioDraft(db, owner, "来源关联新稿", randomUUID());
          await saveNativeStudioDraft(
            db,
            owner,
            copy.documentId,
            { expectedRevision: copy.revision, title: copy.title, document: saved.document },
            randomUUID(),
          );
          expect(
            (await listNativeImports(db, owner, copy.documentId)).map((item) => item.id),
          ).toContain(original.originalId);
          expect(
            (await getNativeImport(db, owner, copy.documentId, original.originalId)).originalId,
          ).toBe(original.originalId);
          const foreign = await createNativeStudioDraft(db, other, "他人稿", randomUUID());
          await expect(
            saveNativeStudioDraft(
              db,
              other,
              foreign.documentId,
              {
                expectedRevision: foreign.revision,
                title: foreign.title,
                document: saved.document,
              },
              randomUUID(),
            ),
          ).rejects.toMatchObject({ code: "INVALID_RESUME_SOURCE_BINDINGS" });
          const forged = structuredClone(saved.document);
          const forgedBinding = forged.sourceBindings?.[0];
          if (!forgedBinding) throw new Error("Expected imported source binding");
          forgedBinding.blockId = "not-an-extracted-block";
          await expect(
            saveNativeStudioDraft(
              db,
              owner,
              draft.documentId,
              { expectedRevision: saved.revision, title: saved.title, document: forged },
              randomUUID(),
            ),
          ).rejects.toMatchObject({ code: "INVALID_RESUME_SOURCE_BINDINGS" });
          await checkpointNativeDraft(db, owner, draft.documentId, saved.revision);
        }
        expect((await downloadStudioOriginal(db, owner, original.originalId, key)).buffer).toEqual(
          buffer,
        );
        await processNativeImport(request);
        expect((await getNativeStudioDraft(db, owner, draft.documentId)).revision).toBe(
          saved.revision,
        );
        await sql`DELETE FROM profile.resume_originals WHERE id=${original.originalId} AND owner_id=${owner.ownerId}`.execute(
          db,
        );
        await processNativeImport(request);
        await expect(
          queueNativeImport(db, owner, draft.documentId, input, requestKey),
        ).rejects.toMatchObject({ code: "RESUME_ORIGINAL_DELETED" });
        await expect(
          getNativeImport(db, owner, draft.documentId, original.originalId),
        ).rejects.toMatchObject({ statusCode: 404 });
        expect((await getNativeStudioDraft(db, owner, draft.documentId)).document).toEqual(
          saved.document,
        );
        if (!changed) {
          expect(await listNativeImports(db, owner, draft.documentId)).toEqual([]);
          const item = saved.document.data.sections.projects.items[0];
          if (!item) throw new Error("Expected imported project");
          const corrected = applyNativeImportCorrection(saved.document, {
            type: "move-entry",
            itemId: item.id,
            target: "experience",
          });
          const moved = await saveNativeStudioDraft(
            db,
            owner,
            draft.documentId,
            { expectedRevision: saved.revision, title: saved.title, document: corrected },
            randomUUID(),
          );
          expect(moved.document.data.sections.experience.items[0]?.id).toBe(item.id);
          const withoutBindings = structuredClone(moved.document);
          delete withoutBindings.sourceBindings;
          const cleared = await saveNativeStudioDraft(
            db,
            owner,
            draft.documentId,
            { expectedRevision: moved.revision, title: moved.title, document: withoutBindings },
            randomUUID(),
          );
          const restored = await saveNativeStudioDraft(
            db,
            owner,
            draft.documentId,
            { expectedRevision: cleared.revision, title: cleared.title, document: saved.document },
            randomUUID(),
          );
          expect(restored.document).toEqual(saved.document);
        }
      }, 30000);
});
