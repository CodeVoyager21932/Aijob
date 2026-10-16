import { randomUUID } from "node:crypto";
import {
  blankResumeEntry,
  CreateMaterialSnippetRequestSchema,
  RESUME_SAMPLE_PHOTO,
  resumeRichText,
} from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { applyNativeTemplate, newNativeItem } from "@aijob/resume-core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteResumeDocument } from "../career-assets/deletion-service.js";
import { createAnonymousSession } from "../identity/session-repository.js";
import {
  deleteResumeExport,
  downloadResumeExport,
  listResumeExports,
  purgeExpiredPreviewArtifacts,
} from "./export-artifacts.js";
import { createMaterialSnippet } from "./material-snippets.js";
import {
  checkpointNativeDraft,
  listNativeSnapshots,
  loadNativeSnapshot,
} from "./native-checkpoint.js";
import {
  listNativeExperiences,
  listReusableNativeExperiences,
  updateNativeExperience,
} from "./native-experiences.js";
import { createNativeExport } from "./native-export.js";
import { resolveNativePhoto } from "./native-photo.js";
import { createNativePreview } from "./native-preview.js";
import {
  createNativeStudioDraft,
  getNativeStudioDraft,
  saveNativeStudioDraft,
} from "./native-studio-service.js";
import { createResumeDocument } from "./service.js";
import {
  checkpointStudioDraft,
  createStudioDocument,
  getStudioDraft,
  listExperiences,
  saveStudioDraft,
  updateExperience,
} from "./studio-service.js";
import {
  deleteResumePhoto,
  nativeTemplatePreferences,
  setNativeTemplatePreference,
  uploadResumePhoto,
} from "./template-library.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("native studio PostgreSQL boundary", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());
  it("pairs the current PDF preview, retains downloaded bytes, and expires only disposable previews", async () => {
    const owner = (await createAnonymousSession({ db })).context;
    let draft = await createNativeStudioDraft(db, owner, "当前预览夹具", randomUUID());
    draft.document.data.basics.name = "预览同学";
    draft = await saveNativeStudioDraft(
      db,
      owner,
      draft.documentId,
      { expectedRevision: draft.revision, title: draft.title, document: draft.document },
      randomUUID(),
    );
    const input = {
      db,
      owner,
      documentId: draft.documentId,
      expectedDraftRevision: draft.revision,
      requestGeneration: 4,
      idempotencyKey: randomUUID(),
      encryptionKey: "a".repeat(64),
    };
    const preview = await createNativePreview(input);
    expect(preview.artifact.state).toBe("ready");
    expect(preview.requestGeneration).toBe(4);
    expect(preview.pageCount).toBe(1);
    const candidate = await createNativePreview({
      ...input,
      templateId: "studio-compact-cn",
      idempotencyKey: randomUUID(),
    });
    expect(candidate.artifact.id).not.toBe(preview.artifact.id);
    expect(candidate.pageCount).toBe(1);
    await expect(
      createNativePreview({ ...input, templateId: "studio-compact-cn" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect((await getNativeStudioDraft(db, owner, draft.documentId)).document).toEqual(
      draft.document,
    );

    expect((await listNativeSnapshots(db, owner, draft.documentId)).items).toHaveLength(0);
    expect((await listResumeExports(db, owner, draft.documentId)).items).toHaveLength(0);
    const screen = await downloadResumeExport(db, owner, preview.artifact.id, input.encryptionKey, {
      preview: true,
    });
    const download = await downloadResumeExport(
      db,
      owner,
      preview.artifact.id,
      input.encryptionKey,
    );
    expect(download.buffer.equals(screen.buffer)).toBe(true);
    expect((await listNativeSnapshots(db, owner, draft.documentId)).items).toHaveLength(1);
    expect((await listResumeExports(db, owner, draft.documentId)).items[0]?.id).toBe(
      preview.artifact.id,
    );
    draft.document.data.basics.name = "修改后的当前正文";
    draft = await saveNativeStudioDraft(
      db,
      owner,
      draft.documentId,
      { expectedRevision: draft.revision, title: draft.title, document: draft.document },
      randomUUID(),
    );
    await expect(
      createNativePreview({ ...input, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "RESUME_DRAFT_CONFLICT" });
    const later = await createNativePreview({
      ...input,
      expectedDraftRevision: draft.revision,
      requestGeneration: 5,
      idempotencyKey: randomUUID(),
    });
    expect(later.artifact.id).not.toBe(preview.artifact.id);
    await sql`UPDATE profile.resume_export_artifacts SET expires_at=now()-interval '1 hour' WHERE id IN (${preview.artifact.id},${later.artifact.id})`.execute(
      db,
    );
    await purgeExpiredPreviewArtifacts(db);
    await expect(
      downloadResumeExport(db, owner, later.artifact.id, input.encryptionKey, { preview: true }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(
      (await downloadResumeExport(db, owner, preview.artifact.id, input.encryptionKey)).sha256,
    ).toBe(download.sha256);
    expect(
      (await loadNativeSnapshot(db, owner, draft.documentId, later)).document.data.basics.name,
    ).toBe("修改后的当前正文");
    draft.document.data.summary.content = Array.from(
      { length: 100 },
      (_, index) =>
        `<p>第 ${index + 1} 条经历：整理校园用户访谈记录，归纳首次使用问题，完成原型验证并记录用户反馈和后续改进。</p>`,
    ).join("");
    draft = await saveNativeStudioDraft(
      db,
      owner,
      draft.documentId,
      { expectedRevision: draft.revision, title: draft.title, document: draft.document },
      randomUUID(),
    );
    const overflow = await createNativePreview({
      ...input,
      expectedDraftRevision: draft.revision,
      requestGeneration: 6,
      idempotencyKey: randomUUID(),
    });
    expect(overflow.pageCount).toBeGreaterThan(1);
    expect((overflow.fit as { bodyFontSize?: number })?.bodyFontSize).toBe(9.5);
    expect(
      (
        await downloadResumeExport(db, owner, overflow.artifact.id, input.encryptionKey, {
          preview: true,
        })
      ).buffer.length,
    ).toBeGreaterThan(0);
    await expect(
      downloadResumeExport(db, owner, overflow.artifact.id, input.encryptionKey),
    ).rejects.toMatchObject({ code: "NATIVE_SINGLE_PAGE_OVERFLOW" });
  }, 60000);
  it("creates from native originals atomically and preserves idempotency and owner isolation", async () => {
    const owner = (await createAnonymousSession({ db })).context;
    let source = await createNativeStudioDraft(db, owner, "经历来源", randomUUID());
    const item = newNativeItem("projects", "source-project");
    item.name = "原生完整项目";
    item.role = "研究设计";
    item.description = "<p>整理 18 次访谈。</p>";
    source.document.data.sections.projects.items.push(item);
    source = await saveNativeStudioDraft(
      db,
      owner,
      source.documentId,
      { expectedRevision: source.revision, title: source.title, document: source.document },
      randomUUID(),
    );
    const original = (await listNativeExperiences(db, owner))[0];
    if (!original) throw new Error("missing fixture original");
    const key = randomUUID();
    const created = await createNativeStudioDraft(db, owner, "经历起草", key, [original.id]);
    expect(created.document.data.sections.projects.items[0]).toMatchObject({
      name: item.name,
      role: item.role,
      description: item.description,
    });
    expect(
      (await createNativeStudioDraft(db, owner, "经历起草", key, [original.id])).documentId,
    ).toBe(created.documentId);
    await expect(createNativeStudioDraft(db, owner, "经历起草", key, [])).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    const stranger = (await createAnonymousSession({ db })).context;
    await expect(
      createNativeStudioDraft(db, stranger, "不能取他人经历", randomUUID(), [original.id]),
    ).rejects.toMatchObject({ code: "EXPERIENCE_NOT_FOUND" });
    const count = await db
      .selectFrom("profile.resume_documents")
      .select("id")
      .where("owner_id", "=", stranger.ownerId)
      .execute();
    expect(count).toHaveLength(0);
    expect(await listNativeExperiences(db, owner)).toHaveLength(1);
    // A selected original can be older than the recent-list window.
    await sql`INSERT INTO profile.experiences(id,owner_id,owner_epoch,kind,title,entry,capture_hash,updated_at)
      SELECT gen_random_uuid(),owner_id,owner_epoch,kind,title,entry,'fixture-recent-'||n,now()+interval '1 day'
      FROM profile.experiences CROSS JOIN generate_series(1,501) n WHERE id=${original.id}`.execute(
      db,
    );
    expect((await listNativeExperiences(db, owner)).some((item) => item.id === original.id)).toBe(
      false,
    );
    expect((await listNativeExperiences(db, owner, [original.id]))[0]?.id).toBe(original.id);
    expect(await listNativeExperiences(db, stranger, [original.id])).toEqual([]);
    const older = await createNativeStudioDraft(db, owner, "较早经历仍可使用", randomUUID(), [
      original.id,
    ]);
    expect(older.document.data.sections.projects.items[0]?.name).toBe(item.name);
  });

  const firstItem = <T>(items: T[]): T => {
    const item = items[0];
    if (!item) throw new Error("Expected fixture item");
    return item;
  };
  const owner = async () => (await createAnonymousSession({ db })).context;
  it("keeps native template favorites private and records only successfully saved applications", async () => {
    const scope = await owner(),
      stranger = await owner();
    const draft = await createNativeStudioDraft(db, scope, "模板偏好", randomUUID());
    const initial = await nativeTemplatePreferences(db, scope);
    expect(
      initial.items.find((item) => item.templateId === "studio-campus-cn")?.lastUsedAt,
    ).toBeTruthy();
    const key = randomUUID();
    const input = { templateId: "onyx-cn", favorite: true, expectedRevision: 0 };
    const result = await setNativeTemplatePreference(db, scope, input, key);
    expect(result.items.find((item) => item.templateId === "onyx-cn")).toMatchObject({
      favorite: true,
      revision: 1,
      lastUsedAt: null,
    });
    expect(await setNativeTemplatePreference(db, scope, input, key)).toEqual(result);
    expect((await nativeTemplatePreferences(db, stranger)).items).toEqual([]);
    await expect(
      setNativeTemplatePreference(db, scope, { ...input, favorite: false }, randomUUID()),
    ).rejects.toMatchObject({ code: "TEMPLATE_PREFERENCE_CONFLICT" });
    await expect(
      setNativeTemplatePreference(db, scope, { ...input, favorite: false }, key),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const document = applyNativeTemplate(draft.document, "onyx-cn");
    await expect(
      saveNativeStudioDraft(
        db,
        scope,
        draft.documentId,
        { expectedRevision: 0, title: draft.title, document },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "RESUME_DRAFT_CONFLICT" });
    expect(
      (await nativeTemplatePreferences(db, scope)).items.find(
        (item) => item.templateId === "onyx-cn",
      )?.lastUsedAt,
    ).toBeNull();
    await saveNativeStudioDraft(
      db,
      scope,
      draft.documentId,
      { expectedRevision: draft.revision, title: draft.title, document },
      randomUUID(),
    );
    expect(
      (await nativeTemplatePreferences(db, scope)).items.find(
        (item) => item.templateId === "onyx-cn",
      ),
    ).toMatchObject({ favorite: true, revision: 1 });
    expect(
      (await nativeTemplatePreferences(db, scope)).items.find(
        (item) => item.templateId === "onyx-cn",
      )?.lastUsedAt,
    ).toBeTruthy();
  });
  it("captures complete native experiences once, deduplicates imports and freezes originals before tailoring", async () => {
    const scope = await owner(),
      stranger = await owner();
    let draft = await createNativeStudioDraft(db, scope, "经历积累", randomUUID());
    const item = newNativeItem("projects", "import:project:1");
    item.name = "社区调研";
    item.role = "访谈整理";
    item.method = "主题编码";
    item.description = "<p>完成 18 次访谈。</p>";
    draft.document.data.sections.projects.items.push(item);
    const save = () =>
      saveNativeStudioDraft(
        db,
        scope,
        draft.documentId,
        { expectedRevision: draft.revision, title: draft.title, document: draft.document },
        randomUUID(),
      );
    draft = await save();
    const first = (await listNativeExperiences(db, scope))[0];
    expect(first?.experience.entry).toMatchObject({ role: "访谈整理", method: "主题编码" });
    expect(await listNativeExperiences(db, stranger)).toEqual([]);
    firstItem(draft.document.data.sections.projects.items).description =
      "<p>完成 20 次访谈并整理原始记录。</p>";
    draft = await save();
    expect(await listNativeExperiences(db, scope)).toHaveLength(1);
    expect((await listNativeExperiences(db, scope))[0]?.revision).toBe(2);
    await checkpointNativeDraft(db, scope, draft.documentId, draft.revision);
    firstItem(draft.document.data.sections.projects.items).description =
      "<p>针对运营岗位重写。</p>";
    draft = await save();
    expect((await listNativeExperiences(db, scope))[0]?.experience.entry.description).toContain(
      "20 次",
    );
    let other = await createNativeStudioDraft(db, scope, "重复导入", randomUUID());
    const original = firstItem(await listNativeExperiences(db, scope));
    other.document.data.sections.projects.items.push({
      ...original.experience.entry,
      id: "import:new-id",
    } as typeof item);
    other = await saveNativeStudioDraft(
      db,
      scope,
      other.documentId,
      { expectedRevision: other.revision, title: other.title, document: other.document },
      randomUUID(),
    );
    expect(await listNativeExperiences(db, scope)).toHaveLength(1);
    firstItem(other.document.data.sections.projects.items).description = "<p>另一方向改写。</p>";
    await saveNativeStudioDraft(
      db,
      scope,
      other.documentId,
      { expectedRevision: other.revision, title: other.title, document: other.document },
      randomUUID(),
    );
    expect((await listNativeExperiences(db, scope))[0]?.experience.entry.description).toContain(
      "20 次",
    );
    const revisedOriginal = structuredClone(original.experience);
    revisedOriginal.entry.description = "<p>主动补充完整方法与结果。</p>";
    const updated = await updateNativeExperience(
      db,
      scope,
      original.id,
      original.revision,
      revisedOriginal,
    );
    expect(updated?.revision).toBe(3);
    expect(
      await updateNativeExperience(db, scope, original.id, original.revision, revisedOriginal),
    ).toEqual(updated);
    expect(
      (await getNativeStudioDraft(db, scope, draft.documentId)).document.data.sections.projects
        .items[0]?.description,
    ).toContain("运营岗位");
    await expect(
      updateNativeExperience(db, stranger, original.id, 3, revisedOriginal),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      updateExperience(db, scope, original.id, 3, blankResumeEntry(randomUUID())),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await listExperiences(db, scope)).toEqual([]);
    const oldRevision = (
      await sql<{
        entry: unknown;
      }>`SELECT entry FROM profile.experience_revisions WHERE experience_id=${original.id} AND revision=2`.execute(
        db,
      )
    ).rows[0];
    expect(JSON.stringify(oldRevision?.entry)).toContain("20 次");
    await sql`DELETE FROM profile.experiences WHERE id=${original.id} AND owner_id=${scope.ownerId}`.execute(
      db,
    );
    firstItem(draft.document.data.sections.projects.items).description = "<p>删除后继续编辑。</p>";
    await save();
    expect(await listNativeExperiences(db, scope)).toHaveLength(0);
  });
  it("reuses native entry sources in materials and keeps immutable sources independent of current edits", async () => {
    const scope = await owner(),
      stranger = await owner();
    let draft = await createNativeStudioDraft(db, scope, "原生材料来源", randomUUID());
    const entry = newNativeItem("projects", "import:page-1:project-2");
    entry.name = "课程项目";
    entry.description = "<p>完成 18 次访谈。</p>";
    draft.document.data.sections.projects.items.push(entry);
    draft = await saveNativeStudioDraft(
      db,
      scope,
      draft.documentId,
      { expectedRevision: draft.revision, title: draft.title, document: draft.document },
      randomUUID(),
    );
    const request = CreateMaterialSnippetRequestSchema.parse({
      kind: "project_short",
      title: "项目短介绍",
      body: "课程项目中完成 18 次访谈。",
      sourceDocumentId: draft.documentId,
      sourceBlockIds: [entry.id],
    });
    const material = await createMaterialSnippet({
      db,
      owner: scope,
      request,
      idempotencyKey: randomUUID(),
    });
    expect(material.sourceBlockIds).toEqual([entry.id]);
    await expect(
      createMaterialSnippet({ db, owner: stranger, request, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ statusCode: 404 });
    const pair = await checkpointNativeDraft(db, scope, draft.documentId, draft.revision);
    draft.document.data.sections.projects.items = [];
    await saveNativeStudioDraft(
      db,
      scope,
      draft.documentId,
      { expectedRevision: draft.revision, title: draft.title, document: draft.document },
      randomUUID(),
    );
    await expect(
      createMaterialSnippet({ db, owner: scope, request, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "MATERIAL_ENTRY_NOT_FOUND" });
    const historical = await createMaterialSnippet({
      db,
      owner: scope,
      request: { ...request, sourceContentRevisionId: pair.contentRevisionId },
      idempotencyKey: randomUUID(),
    });
    expect(historical.sourceContentRevisionId).toBe(pair.contentRevisionId);
    expect(
      (await getNativeStudioDraft(db, scope, draft.documentId)).document.data.sections.projects
        .items,
    ).toEqual([]);
  });
  it("explicitly converts an old snapshot into a new native document and preserves its experience link", async () => {
    const scope = await owner();
    const old = await createStudioDocument(db, scope, { title: "保留的旧稿" }, randomUUID());
    const photo = await uploadResumePhoto(
      db,
      scope,
      Buffer.from(RESUME_SAMPLE_PHOTO.split(",")[1] ?? "", "base64"),
      "image/png",
      "a".repeat(64),
    );
    old.content.basics.photoId = photo.id;
    const entry = {
      ...blankResumeEntry(randomUUID()),
      title: "校内课程项目",
      body: resumeRichText("完成 18 次访谈，保留全部过程。"),
    };
    old.content.sections = [
      {
        id: randomUUID(),
        kind: "project",
        title: "我的项目",
        hidden: false,
        pageBreakBefore: false,
        column: "main",
        entries: [entry],
      },
    ];
    const saved = await saveStudioDraft(
      db,
      scope,
      old.documentId,
      {
        expectedRevision: old.revision,
        title: old.title,
        content: old.content,
        layout: old.layout,
      },
      randomUUID(),
    );
    const pair = await checkpointStudioDraft(db, scope, old.documentId, saved.revision);
    const before = await getStudioDraft(db, scope, old.documentId);
    const oldOriginals = await listExperiences(db, scope);
    const oldOriginal = oldOriginals[0];
    if (!oldOriginal) throw new Error("missing old original");
    const reusable = await listReusableNativeExperiences(db, scope, [oldOriginal.id]);
    expect(reusable[0]).toMatchObject({ id: oldOriginal.id, legacy: true });
    expect(reusable[0]?.experience.entry.description).toContain("18 次访谈");
    const reused = await createNativeStudioDraft(db, scope, "直接取用旧经历", randomUUID(), [
      oldOriginal.id,
    ]);
    expect(reused.document.data.sections.projects.items[0]?.name).toBe(entry.title);
    expect(await listExperiences(db, scope)).toEqual(oldOriginals);
    expect(await listReusableNativeExperiences(db, await owner(), [oldOriginal.id])).toEqual([]);
    const input = {
      db,
      owner: scope,
      idempotencyKey: randomUUID(),
      request: {
        kind: "base" as const,
        title: "原生转换稿",
        copyFrom: { documentId: old.documentId, ...pair, targetCore: "native-v1" as const },
      },
    };
    const converted = await createResumeDocument(input);
    const native = await getNativeStudioDraft(db, scope, converted.resumeDocument.id);
    expect(native.document.data.customSections[0]?.items[0]?.id).toBe(entry.id);
    expect(native.document.data.picture.url).toBe(`aijob-photo:${photo.id}`);
    expect(
      (await resolveNativePhoto(db, scope, native.document, "a".repeat(64))).data.picture.url,
    ).toBe(RESUME_SAMPLE_PHOTO);
    expect(JSON.stringify(native.document)).toContain("18 次访谈");
    expect(await getStudioDraft(db, scope, old.documentId)).toEqual(before);
    expect((await createResumeDocument(input)).resumeDocument.id).toBe(native.documentId);
    const links = (
      await sql<{
        document_id: string;
        experience_id: string;
      }>`SELECT document_id,experience_id FROM profile.resume_experience_links WHERE owner_id=${scope.ownerId} AND entry_id=${entry.id}`.execute(
        db,
      )
    ).rows;
    expect(links).toHaveLength(2);
    expect(links[0]?.experience_id).toBe(links[1]?.experience_id);
    await expect(
      createResumeDocument({ ...input, owner: await owner(), idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
  it("validates owner-bound photo references and refuses missing photo exports", async () => {
    const scope = await owner(),
      foreign = await owner(),
      key = "a".repeat(64);
    const photo = await uploadResumePhoto(
      db,
      scope,
      Buffer.from(RESUME_SAMPLE_PHOTO.split(",")[1] ?? "", "base64"),
      "image/png",
      key,
    );
    const draft = await createNativeStudioDraft(db, foreign, "照片权限", randomUUID());
    draft.document.data.picture.url = `aijob-photo:${photo.id}`;
    draft.document.data.picture.hidden = false;
    await expect(
      saveNativeStudioDraft(
        db,
        foreign,
        draft.documentId,
        { title: draft.title, document: draft.document, expectedRevision: draft.revision },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(resolveNativePhoto(db, foreign, draft.document, key)).rejects.toMatchObject({
      statusCode: 404,
    });
    await deleteResumePhoto(db, scope, photo.id);
    await expect(resolveNativePhoto(db, scope, draft.document, key)).rejects.toMatchObject({
      statusCode: 404,
    });
    draft.document.data.picture.hidden = true;
    expect((await resolveNativePhoto(db, scope, draft.document, key)).data.picture.url).toBe("");
  });
  it("copies native paired content transactionally without passing through legacy sections", async () => {
    const scope = await owner(),
      draft = await createNativeStudioDraft(db, scope, "原稿", randomUUID());
    const value = structuredClone(draft.document);
    value.data.basics.name = "复制前内容";
    const saved = await saveNativeStudioDraft(
      db,
      scope,
      draft.documentId,
      { title: draft.title, document: value, expectedRevision: draft.revision },
      randomUUID(),
    );
    const pair = await checkpointNativeDraft(db, scope, draft.documentId, saved.revision);
    const input = {
      db,
      owner: scope,
      idempotencyKey: randomUUID(),
      request: {
        kind: "base" as const,
        title: "方向稿",
        copyFrom: { documentId: draft.documentId, ...pair },
      },
    };
    const result = await createResumeDocument(input);
    const copied = await getNativeStudioDraft(db, scope, result.resumeDocument.id);
    expect(copied.document).toEqual(value);
    expect((await createResumeDocument(input)).resumeDocument.id).toBe(result.resumeDocument.id);
    copied.document.data.basics.name = "只改方向稿";
    await saveNativeStudioDraft(
      db,
      scope,
      copied.documentId,
      { title: copied.title, document: copied.document, expectedRevision: copied.revision },
      randomUUID(),
    );
    expect(
      (await getNativeStudioDraft(db, scope, draft.documentId)).document.data.basics.name,
    ).toBe("复制前内容");
    await expect(
      createResumeDocument({ ...input, owner: await owner(), idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
  it("checkpoints through the web-api role while immutable native rows reject updates", async () => {
    const scope = await owner();
    const draft = await createNativeStudioDraft(db, scope, "权限夹具", randomUUID());
    const pair = await db.connection().execute(async (connection) => {
      await sql`SET ROLE aijob_web_api`.execute(connection);
      try {
        return await checkpointNativeDraft(connection, scope, draft.documentId, draft.revision);
      } finally {
        await sql`RESET ROLE`.execute(connection);
      }
    });
    await expect(
      sql`UPDATE profile.resume_document_revisions SET studio_content='{}'::jsonb WHERE id=${pair.contentRevisionId}`.execute(
        db,
      ),
    ).rejects.toThrow();
    expect((await loadNativeSnapshot(db, scope, draft.documentId, pair)).document).toEqual(
      draft.document,
    );
  });
  it("renders and retains the exact native PDF, without re-rendering downloads", async () => {
    const scope = await owner();
    const draft = await createNativeStudioDraft(db, scope, "原生导出夹具", randomUUID());
    const document = applyNativeTemplate(draft.document, "lapis-cn");
    document.data.basics.name = "林知夏";
    const project = newNativeItem("projects", randomUUID());
    project.name = "校园访谈";
    project.description = "<p>完成 12 次用户访谈。</p>";
    document.data.sections.projects.items.push(project);
    const saved = await saveNativeStudioDraft(
      db,
      scope,
      draft.documentId,
      { title: draft.title, expectedRevision: draft.revision, document },
      randomUUID(),
    );
    const pair = await checkpointNativeDraft(db, scope, draft.documentId, saved.revision);
    expect(
      (await loadNativeSnapshot(db, scope, draft.documentId, pair)).document.presentation?.id,
    ).toBe("lapis-cn");
    const input = {
      db,
      owner: scope,
      documentId: draft.documentId,
      request: { ...pair, format: "pdf" as const },
      idempotencyKey: randomUUID(),
      encryptionKey: "a".repeat(64),
    };
    const artifact = await createNativeExport(input);
    expect(artifact.state).toBe("ready");
    expect(artifact.pageCount).toBe(1);
    const first = await downloadResumeExport(db, scope, artifact.id, input.encryptionKey);
    expect(first.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(
      (await downloadResumeExport(db, scope, artifact.id, input.encryptionKey)).buffer.equals(
        first.buffer,
      ),
    ).toBe(true);
    expect((await createNativeExport(input)).id).toBe(artifact.id);
    await expect(
      downloadResumeExport(db, await owner(), artifact.id, input.encryptionKey),
    ).rejects.toMatchObject({ statusCode: 404 });
    const docx = await createNativeExport({
      ...input,
      request: { ...pair, format: "docx" },
      idempotencyKey: randomUUID(),
    });
    expect(docx.state).toBe("ready");
    const docxBytes = await downloadResumeExport(db, scope, docx.id, input.encryptionKey);
    expect(docxBytes.buffer.subarray(0, 2).toString()).toBe("PK");
    expect(
      (await downloadResumeExport(db, scope, docx.id, input.encryptionKey)).buffer.equals(
        docxBytes.buffer,
      ),
    ).toBe(true);
    await deleteResumeExport(db, scope, artifact.id);
    await expect(createNativeExport(input)).rejects.toMatchObject({ statusCode: 410 });
  }, 90000);
  it("fixes immutable native pairs and rejects stale or crossed revisions", async () => {
    const scope = await owner();
    const draft = await createNativeStudioDraft(db, scope, "原生版本夹具", randomUUID());
    const first = await checkpointNativeDraft(db, scope, draft.documentId, draft.revision);
    expect(await checkpointNativeDraft(db, scope, draft.documentId, draft.revision)).toEqual(first);
    const changed = structuredClone(draft.document);
    changed.data.basics.name = "最新输入";
    const saved = await saveNativeStudioDraft(
      db,
      scope,
      draft.documentId,
      { title: draft.title, expectedRevision: draft.revision, document: changed },
      randomUUID(),
    );
    await expect(
      checkpointNativeDraft(db, scope, draft.documentId, draft.revision),
    ).rejects.toMatchObject({ statusCode: 409 });
    const second = await checkpointNativeDraft(db, scope, draft.documentId, saved.revision);
    const listed = await listNativeSnapshots(db, scope, draft.documentId);
    expect(listed.items.map((value) => value.contentRevisionId)).toEqual([
      second.contentRevisionId,
      first.contentRevisionId,
    ]);
    await expect(listNativeSnapshots(db, await owner(), draft.documentId)).rejects.toMatchObject({
      statusCode: 404,
    });
    const restored = await saveNativeStudioDraft(
      db,
      scope,
      draft.documentId,
      {
        title: draft.title,
        expectedRevision: saved.revision,
        document: (await loadNativeSnapshot(db, scope, draft.documentId, first)).document,
      },
      randomUUID(),
    );
    expect(restored.document.data.basics.name).toBe("");
    expect(restored.revision).toBeGreaterThan(saved.revision);
    expect(
      (await loadNativeSnapshot(db, scope, draft.documentId, first)).document.data.basics.name,
    ).toBe("");
    expect(
      (await loadNativeSnapshot(db, scope, draft.documentId, second)).document.data.basics.name,
    ).toBe("最新输入");
    await expect(
      loadNativeSnapshot(db, scope, draft.documentId, {
        ...first,
        layoutRevisionId: second.layoutRevisionId,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      loadNativeSnapshot(db, await owner(), draft.documentId, first),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("saves and reopens native data using the existing isolated draft tables", async () => {
    const scope = await owner();
    const draft = await createNativeStudioDraft(db, scope, "原生中文夹具", randomUUID());
    const document = structuredClone(draft.document);
    document.data.basics.name = "林知夏";
    const project = newNativeItem("projects", randomUUID());
    project.name = "校园访谈项目";
    project.description = "<p>完成 12 次访谈并整理报告。</p>";
    document.data.sections.projects.items.push(project);
    const publication = newNativeItem("publications", randomUUID());
    publication.publisher = "示例学报";
    publication.title = "实验方法研究";
    document.data.sections.publications.items.push(publication);
    document.data.sections.education.items.push({
      id: randomUUID(),
      hidden: false,
      school: "",
      degree: "本科",
      area: "自动化",
      grade: "",
      location: "",
      period: "2023.09–2027.06",
      website: { url: "", label: "", inlineLink: false },
      description: "<p>尚未填写学校但已有课程实验经历。</p>",
    });
    const request = { expectedRevision: draft.revision, title: draft.title, document };
    const key = randomUUID();
    const saved = await saveNativeStudioDraft(db, scope, draft.documentId, request, key);
    expect((await getNativeStudioDraft(db, scope, draft.documentId)).document).toEqual(document);
    expect(await saveNativeStudioDraft(db, scope, draft.documentId, request, key)).toEqual(saved);
    await expect(
      saveNativeStudioDraft(db, scope, draft.documentId, { ...request, title: "不同内容" }, key),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(
      saveNativeStudioDraft(db, scope, draft.documentId, request, randomUUID()),
    ).rejects.toMatchObject({ code: "RESUME_DRAFT_CONFLICT" });
    await expect(getNativeStudioDraft(db, await owner(), draft.documentId)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(getStudioDraft(db, scope, draft.documentId)).rejects.toMatchObject({
      code: "RESUME_CORE_VERSION_MISMATCH",
    });
    const stored = (
      await sql<{
        content: Record<string, unknown>;
        layout: Record<string, unknown>;
      }>`SELECT content,layout FROM profile.resume_document_drafts WHERE document_id=${draft.documentId}`.execute(
        db,
      )
    ).rows[0];
    expect(stored?.content.data).not.toHaveProperty("metadata");
    expect(stored?.layout).toHaveProperty("metadata");
  });

  it("serializes two writers and does not create a revision for identical content", async () => {
    const scope = await owner();
    const draft = await createNativeStudioDraft(db, scope, "并发夹具", randomUUID());
    const noChange = await saveNativeStudioDraft(
      db,
      scope,
      draft.documentId,
      { expectedRevision: draft.revision, title: draft.title, document: draft.document },
      randomUUID(),
    );
    expect(noChange.revision).toBe(draft.revision);
    const results = await Promise.allSettled(
      ["甲", "乙"].map((name) => {
        const document = structuredClone(draft.document);
        document.data.basics.name = name;
        return saveNativeStudioDraft(
          db,
          scope,
          draft.documentId,
          { expectedRevision: draft.revision, title: draft.title, document },
          randomUUID(),
        );
      }),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("does not revive a deleted document with a delayed write or read", async () => {
    const scope = await owner();
    const draft = await createNativeStudioDraft(db, scope, "删除夹具", randomUUID());
    const row = await db
      .selectFrom("profile.resume_documents")
      .select("revision")
      .where("id", "=", draft.documentId)
      .executeTakeFirstOrThrow();
    await deleteResumeDocument({
      db,
      owner: scope,
      documentId: draft.documentId,
      request: { expectedRevision: row.revision },
    });
    await expect(getNativeStudioDraft(db, scope, draft.documentId)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      saveNativeStudioDraft(
        db,
        scope,
        draft.documentId,
        { expectedRevision: draft.revision, title: draft.title, document: draft.document },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("requires an explicit migration instead of rewriting a legacy draft", async () => {
    const scope = await owner();
    const legacy = await createStudioDocument(db, scope, { title: "旧稿" }, randomUUID());
    await expect(getNativeStudioDraft(db, scope, legacy.documentId)).rejects.toMatchObject({
      code: "RESUME_CORE_VERSION_MISMATCH",
    });
    expect((await getStudioDraft(db, scope, legacy.documentId)).content).toEqual(legacy.content);
  });
});
