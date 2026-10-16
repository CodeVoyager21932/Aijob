import { randomUUID } from "node:crypto";
import { createDatabase } from "@aijob/database";
import { applyNativeTemplate, type NativeResumeDocument } from "@aijob/resume-core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnonymousSession } from "../identity/session-repository.js";
import { checkpointNativeDraft, loadNativeSnapshot } from "./native-checkpoint.js";
import {
  createNativeStudioDraft,
  getNativeStudioDraft,
  saveNativeStudioDraft,
} from "./native-studio-service.js";
import { createResumeDocument } from "./service.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "native field layout persistence in an existing test database",
  () => {
    const db = createDatabase(url ?? "postgresql://unused");
    beforeAll(async () => {
      // This regression must not provision/migrate a database or use the local business DB.
      const target = new URL(url ?? "postgresql://unused");
      expect(target.port).not.toBe("55439");
      const result = await sql<{
        database_name: string;
      }>`SELECT current_database() database_name`.execute(db);
      expect(result.rows[0]?.database_name).toMatch(/test/i);
    });
    afterAll(() => db.destroy());

    it("saves, reopens, snapshots, copies and reverses field formatting without changing facts", async () => {
      const owner = (await createAnonymousSession({ db })).context;
      let draft = await createNativeStudioDraft(db, owner, "字段排版保留夹具", randomUUID());
      const original = applyNativeTemplate(draft.document, "studio-sidebar-cn");
      original.data.basics.headline = "小学教育 · 教研与阅读活动助理";
      original.data.basics.email = "shuning.zhou@example.com";
      const save = async (document: NativeResumeDocument) => {
        draft = await saveNativeStudioDraft(
          db,
          owner,
          draft.documentId,
          { expectedRevision: draft.revision, title: draft.title, document },
          randomUUID(),
        );
        return draft;
      };
      await save(original);
      const baseline = structuredClone(draft.document);
      const first = await checkpointNativeDraft(db, owner, draft.documentId, draft.revision);
      const adjusted = structuredClone(baseline);
      adjusted.fieldLayout = {
        headline: { fontSize: 11.5, lineMode: "manual", breakAfter: 7, position: "main" },
        email: { fontSize: 10.5, lineMode: "single", position: "main" },
      };
      await save(adjusted);
      expect((await getNativeStudioDraft(db, owner, draft.documentId)).document).toEqual(adjusted);
      const second = await checkpointNativeDraft(db, owner, draft.documentId, draft.revision);
      expect(second.layoutRevisionId).not.toBe(first.layoutRevisionId);

      const rows = await sql<{
        content: unknown;
        content_hash: string;
        layout: unknown;
        layout_hash: string;
      }>`
      SELECT c.studio_content content, c.content_hash,
        l.studio_layout layout, l.content_hash layout_hash
      FROM profile.resume_document_revisions c
      JOIN profile.resume_layout_revisions l ON c.document_id=l.document_id
        AND c.result_document_revision=l.result_document_revision
      WHERE c.id IN (${first.contentRevisionId}, ${second.contentRevisionId})
    `.execute(db);
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows[0]?.content).toEqual(rows.rows[1]?.content);
      expect(rows.rows[0]?.content_hash).toEqual(rows.rows[1]?.content_hash);
      expect(rows.rows[0]?.layout_hash).not.toEqual(rows.rows[1]?.layout_hash);
      expect(rows.rows.every((row) => !("fieldLayout" in (row.content as object)))).toBe(true);
      expect((await loadNativeSnapshot(db, owner, draft.documentId, first)).document).toEqual(
        baseline,
      );
      expect((await loadNativeSnapshot(db, owner, draft.documentId, second)).document).toEqual(
        adjusted,
      );

      const copy = await createResumeDocument({
        db,
        owner,
        idempotencyKey: randomUUID(),
        request: {
          kind: "base",
          title: "保留格式的副本",
          copyFrom: { documentId: draft.documentId, ...second },
        },
      });
      expect((await getNativeStudioDraft(db, owner, copy.resumeDocument.id)).document).toEqual(
        adjusted,
      );

      // Editor undo/redo persists whole document states through this same save boundary.
      await save(baseline);
      expect((await getNativeStudioDraft(db, owner, draft.documentId)).document).toEqual(baseline);
      await save(adjusted);
      expect((await getNativeStudioDraft(db, owner, draft.documentId)).document).toEqual(adjusted);
      const restored = structuredClone(adjusted);
      delete restored.fieldLayout?.headline;
      await save(restored);
      expect((await getNativeStudioDraft(db, owner, draft.documentId)).document).toEqual(restored);
      expect(draft.document.data).toEqual(baseline.data);
      expect(draft.document.fieldLayout?.email).toEqual(adjusted.fieldLayout.email);
      expect((await loadNativeSnapshot(db, owner, draft.documentId, second)).document).toEqual(
        adjusted,
      );
      expect((await getNativeStudioDraft(db, owner, copy.resumeDocument.id)).document).toEqual(
        adjusted,
      );
    });
  },
);
