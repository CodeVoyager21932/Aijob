import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { chineseResumeSample, resumeTemplateLayout, RESUME_TEMPLATES } from "@aijob/contracts";
import { sql } from "kysely";
import { createAnonymousSession } from "../identity/session-repository.js";
import {
  setTemplatePreference,
  templatePreferences,
  uploadResumePhoto,
  readResumePhoto,
  deleteResumePhoto,
} from "./template-library.js";
import {
  createStudioDocument,
  saveStudioDraft,
  checkpointStudioDraft,
  getStudioDraft,
} from "./studio-service.js";
import { loadResumeExportSnapshot } from "./export-service.js";
const url = process.env.AIJOB_TEST_DATABASE_URL;
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
(url ? describe : describe.skip)("template library and studio v2 PostgreSQL", () => {
  const db = createDatabase(url ?? "postgresql://unused"),
    encryptionKey = "b".repeat(64);
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());
  it("keeps favorites isolated, checks revisions and preserves successful retries", async () => {
    const owner = (await createAnonymousSession({ db })).context,
      other = (await createAnonymousSession({ db })).context,
      key = randomUUID();
    const body = { templateId: "jp_classic", favorite: true, expectedRevision: 0 };
    const first = await setTemplatePreference(db, owner, body, key);
    expect(await setTemplatePreference(db, owner, body, key)).toEqual(first);
    expect((await templatePreferences(db, other)).items).toEqual([]);
    await expect(
      setTemplatePreference(db, owner, { ...body, favorite: false }, randomUUID()),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it("saves all template versions without changing content, keeps fixed pairs and rejects foreign photos", async () => {
    const owner = (await createAnonymousSession({ db })).context,
      other = (await createAnonymousSession({ db })).context;
    let draft = await createStudioDocument(db, owner, { title: "模板切换合成检查" }, randomUUID());
    const content = chineseResumeSample("medium");
    draft = await saveStudioDraft(
      db,
      owner,
      draft.documentId,
      { expectedRevision: draft.revision, title: draft.title, content, layout: draft.layout },
      randomUUID(),
    );
    const originalContent = structuredClone(draft.content),
      fixed = await checkpointStudioDraft(db, owner, draft.documentId, draft.revision);
    for (const template of RESUME_TEMPLATES) {
      draft = await saveStudioDraft(
        db,
        owner,
        draft.documentId,
        {
          expectedRevision: draft.revision,
          title: draft.title,
          content: draft.content,
          layout: resumeTemplateLayout(template.id),
        },
        randomUUID(),
      );
      expect(draft.content).toEqual(originalContent);
    }
    const snapshot = await loadResumeExportSnapshot({
      db,
      owner,
      documentId: draft.documentId,
      query: fixed,
      allowHistorical: true,
    });
    expect(snapshot.studio?.content).toEqual(originalContent);
    expect(snapshot.studio?.layout.templateKey).toBe("lapis_cn");
    expect(snapshot.studio?.layout.rendererVersion).toBe("studio-pages-v3");
    await expect(loadResumeExportSnapshot({db,owner:other,documentId:draft.documentId,query:fixed,allowHistorical:true})).rejects.toMatchObject({statusCode:404});
    const currentPair=await checkpointStudioDraft(db,owner,draft.documentId,draft.revision);
    await expect(loadResumeExportSnapshot({db,owner,documentId:draft.documentId,query:fixed})).rejects.toMatchObject({statusCode:409});
    await expect(loadResumeExportSnapshot({db,owner,documentId:draft.documentId,query:{contentRevisionId:fixed.contentRevisionId,layoutRevisionId:currentPair.layoutRevisionId},allowHistorical:true})).rejects.toMatchObject({statusCode:409});
    expect((await templatePreferences(db, owner)).items.filter((t) => t.lastUsedAt)).toHaveLength(
      40,
    );
    await expect(getStudioDraft(db, other, draft.documentId)).rejects.toMatchObject({
      statusCode: 404,
    });
    const photo = await uploadResumePhoto(db, other, tinyPng, "image/png", encryptionKey);
    await expect(
      saveStudioDraft(
        db,
        owner,
        draft.documentId,
        {
          expectedRevision: draft.revision,
          title: draft.title,
          content: { ...draft.content, basics: { ...draft.content.basics, photoId: photo.id } },
          layout: draft.layout,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      saveStudioDraft(
        db,
        owner,
        draft.documentId,
        {
          expectedRevision: draft.revision,
          title: draft.title,
          content: draft.content,
          layout: { ...draft.layout, templateVersion: "non-existent" },
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it("encrypts photos, includes them in fixed exports, and never revives a deleted upload on retry", async () => {
    const owner = (await createAnonymousSession({ db })).context,
      other = (await createAnonymousSession({ db })).context,
      key = randomUUID();
    const photo = await uploadResumePhoto(db, owner, tinyPng, "image/png", encryptionKey, key);
    expect(await uploadResumePhoto(db, owner, tinyPng, "image/png", encryptionKey, key)).toEqual(
      photo,
    );
    expect(await readResumePhoto(db, other, photo.id, encryptionKey)).toBeNull();
    expect(
      (await readResumePhoto(db, owner, photo.id, encryptionKey))?.buffer.equals(tinyPng),
    ).toBe(true);
    let draft = await createStudioDocument(db, owner, { title: "照片测试" }, randomUUID());
    const content = chineseResumeSample("short");
    content.basics.photoId = photo.id;
    draft = await saveStudioDraft(
      db,
      owner,
      draft.documentId,
      { expectedRevision: draft.revision, title: draft.title, content, layout: draft.layout },
      randomUUID(),
    );
    const pair = await checkpointStudioDraft(db, owner, draft.documentId, draft.revision),
      snapshot = await loadResumeExportSnapshot({
        db,
        owner,
        documentId: draft.documentId,
        query: pair,
        encryptionKey,
      });
    expect(snapshot.studio?.resources.photoDataUrl).toBe(
      `data:image/png;base64,${tinyPng.toString("base64")}`,
    );
    const copy = await createStudioDocument(db, owner, { title: '保留照片的方向稿', copyFromDocumentId: draft.documentId }, randomUUID());
    const detached = structuredClone(draft.content); detached.basics.photoId = null;
    await saveStudioDraft(db, owner, draft.documentId, { expectedRevision: draft.revision, title: draft.title, content: detached, layout: draft.layout }, randomUUID());
    expect(copy.content.basics.photoId).toBe(photo.id);
    expect((await readResumePhoto(db, owner, copy.content.basics.photoId!, encryptionKey))?.buffer.equals(tinyPng)).toBe(true);
    await deleteResumePhoto(db, owner, photo.id);
    expect(await readResumePhoto(db, owner, photo.id, encryptionKey)).toBeNull();
    await expect(
      uploadResumePhoto(db, owner, tinyPng, "image/png", encryptionKey, key),
    ).rejects.toMatchObject({ statusCode: 410 });
    expect(
      (
        await sql<{
          ciphertext: Buffer | null;
        }>`SELECT ciphertext FROM profile.resume_photos WHERE id=${photo.id}`.execute(db)
      ).rows[0]?.ciphertext,
    ).toBeNull();
    await expect(
      uploadResumePhoto(db, owner, Buffer.from("<svg/>"), "image/png", encryptionKey),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
  it("prevents collector reads of private template and photo data", async () => {
    for (const table of [
      "resume_photos",
      "resume_template_preferences",
      "resume_template_receipts",
    ])
      await expect(
        db.transaction().execute(async (tx) => {
          await sql`SET LOCAL ROLE aijob_collector_worker`.execute(tx);
          await sql`SELECT 1 FROM ${sql.id("profile", table)}`.execute(tx);
        }),
      ).rejects.toMatchObject({ code: "42501" });
  });
});
