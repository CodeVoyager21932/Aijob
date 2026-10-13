import { randomUUID } from "node:crypto";
import {parseAppConfig} from '@aijob/config';
import {
  blankResumeEntry,
  CreateApplicationCaseWithJobContextRequestSchema,
  type ResumeStudioDraft,
  resumeRichText,
  chineseResumeSample,
  resumeTemplateLayout,
} from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplicationCase } from "../applications/service.js";
import { deleteResumeDocument } from "../career-assets/deletion-service.js";
import { createAnonymousSession } from "../identity/session-repository.js";
import { parseResumeBuffer } from "../resume/parse.js";
import { loadResumeExportSnapshot } from "./export-service.js";
import { createResumeDocument } from "./service.js";
import { importStudioText } from "./studio-content.js";
import { createStudioDocx } from "./studio-docx.js";
import {
  applyStudioParsedOriginal,
  createStudioImport,
  downloadStudioOriginal,
  processStudioImport,
} from "./studio-import.js";
import {
  checkpointStudioDraft,
  createStudioDocument,
  getStudioDraft,
  listExperiences,
  saveStudioDraft,
  updateExperience,
} from "./studio-service.js";

const url = process.env.AIJOB_TEST_DATABASE_URL;
(url ? describe : describe.skip)("resume studio integration", () => {
  const db = createDatabase(url ?? "postgresql://unused");
  beforeAll(() => migrateToLatest(db), 120000);
  afterAll(() => db.destroy());
  const context = async () => (await createAnonymousSession({ db })).context;
  const project = (text: string) => ({
    id: randomUUID(),
    kind: "project" as const,
    title: "项目经历",
    hidden: false,
    pageBreakBefore: false,
    column: "main" as const,
    entries: [
      {
        ...blankResumeEntry(randomUUID()),
        title: "课程项目",
        role: "小组成员",
        body: resumeRichText(text),
      },
    ],
  });
  const request = (draft: ResumeStudioDraft) => ({
    expectedRevision: draft.revision,
    title: draft.title,
    content: structuredClone(draft.content),
    layout: draft.layout,
  });
  it('keeps the selected v3 layout when a background import applies its content',async()=>{
    const owner=await context(),key='a'.repeat(64);
    const source=await createStudioDocx(chineseResumeSample('short'),resumeTemplateLayout('lapis_cn'));
    const imported=await createStudioImport(db,owner,{filename:'synthetic.docx',mediaType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:source,encryptionKey:key},randomUUID());
    const original=imported.originals[0];expect(original).toBeDefined();if(!original)throw new Error('missing original');
    const leaseOwner=randomUUID();
    const task=(await sql<{id:string;fencing_token:number}>`UPDATE task_queue.tasks SET status='running',lease_owner=${leaseOwner},lease_until=now()+interval '2 minutes',fencing_token=fencing_token+1 WHERE owner_id=${owner.ownerId} AND task_type='resume_studio_import' RETURNING id,fencing_token`.execute(db)).rows[0];
    if(!task)throw new Error('missing import task');
    const config=parseAppConfig({APP_ENV:'test',DATABASE_URL:url,RESUME_ENCRYPTION_KEY:key,ENABLE_AI:'false'});
    await processStudioImport({db,owner,originalId:original.id,documentId:imported.draft.documentId,expectedRevision:imported.draft.revision,config,lease:{taskId:task.id,taskType:'resume_studio_import',ownerId:owner.ownerId,ownerEpoch:owner.ownerEpoch,leaseOwner,fencingToken:Number(task.fencing_token)}});
    const applied=await getStudioDraft(db,owner,imported.draft.documentId);
    expect(applied.layout).toEqual(imported.draft.layout);
    expect(applied.layout.rendererVersion).toBe('studio-pages-v3');
    expect(applied.layout.templateKey).toBe('lapis_cn');
    expect(applied.content.basics.email).toBe('lin.zhixia@example.com');
    expect(JSON.stringify(applied.content)).toContain('校园学习空间');
    const pair=await checkpointStudioDraft(db,owner,applied.documentId,applied.revision);
    const snapshot=await loadResumeExportSnapshot({db,owner,documentId:applied.documentId,query:pair,allowHistorical:true,encryptionKey:key});
    expect(snapshot.studio?.layout).toEqual(applied.layout);
    await sql`UPDATE task_queue.tasks SET status='succeeded',lease_owner=NULL,lease_until=NULL,completed_at=now() WHERE id=${task.id}`.execute(db);
  },30000);
  it("applies a delayed parse exactly once and leaves later draft changes intact", async () => {
    const owner = await context();
    const imported = await createStudioImport(
      db,
      owner,
      {
        filename: "deferred.pdf",
        mediaType: "application/pdf",
        buffer: Buffer.from("fixture"),
        encryptionKey: "a".repeat(64),
      },
      randomUUID(),
    );
    const originalId = imported.originals[0]!.id;
    const content = importStudioText(
      "测试同学\n13800138000\n项目经历\n校园项目 2025.03 — 2025.06\n整理课程调研报告",
    );
    await sql`UPDATE profile.resume_originals SET status='ready',parsed_content=${JSON.stringify(content)}::jsonb WHERE id=${originalId}`.execute(
      db,
    );
    const key = randomUUID(),
      revision = imported.draft.revision;
    const applied = await applyStudioParsedOriginal(db, owner, originalId, revision, key);
    const changed = request(applied);
    changed.content.basics.headline = "后来修改的方向稿";
    await saveStudioDraft(db, owner, applied.documentId, changed, randomUUID());
    expect(await applyStudioParsedOriginal(db, owner, originalId, revision, key)).toEqual(applied);
    expect((await getStudioDraft(db, owner, applied.documentId)).content.basics.headline).toBe(
      "后来修改的方向稿",
    );
    await expect(
      applyStudioParsedOriginal(db, owner, originalId, revision + 1, key),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const other = await context();
    await expect(
      applyStudioParsedOriginal(db, other, originalId, revision, key),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
  it("starts blank without legacy evidence, saves one draft and captures the full first experience", async () => {
    const owner = await context();
    let d = await createStudioDocument(db, owner, { title: "通用简历" }, randomUUID());
    expect(d.content.sections.map(s=>s.kind)).toEqual(['education','internship','project','skills']);
    expect(await listExperiences(db, owner)).toHaveLength(0);
    await expect(checkpointStudioDraft(db, owner, d.documentId, d.revision)).rejects.toMatchObject({code:'RESUME_EMPTY'});
    const replay = await createStudioDocument(db, owner, {title:'空白重试'}, 'template-starter-retry');
    expect(await createStudioDocument(db, owner, {title:'空白重试'}, 'template-starter-retry')).toEqual(replay);
    const body = request(d);
    body.content.sections = [project("整理访谈")];
    d = await saveStudioDraft(db, owner, d.documentId, body, randomUUID());
    const second = request(d);
    second.content.sections[0]!.entries[0]!.body = resumeRichText(
      "整理 12 份访谈记录，归纳使用问题，完成课程报告。",
    );
    d = await saveStudioDraft(db, owner, d.documentId, second, randomUUID());
    expect(await listExperiences(db, owner)).toHaveLength(1);
    expect(JSON.stringify((await listExperiences(db, owner))[0]?.entry)).toContain("12 份访谈");
    const pair = await checkpointStudioDraft(db, owner, d.documentId, d.revision);
    expect(await checkpointStudioDraft(db, owner, d.documentId, d.revision)).toEqual(pair);
    const third = request(d);
    third.content.sections[0]!.entries[0]!.body = resumeRichText(
      "面向产品方向：归纳使用问题并整理调研报告。",
    );
    d = await saveStudioDraft(db, owner, d.documentId, third, randomUUID());
    expect(JSON.stringify((await listExperiences(db, owner))[0]?.entry)).toContain("12 份访谈");
    const snapshot = await loadResumeExportSnapshot({
      db,
      owner,
      documentId: d.documentId,
      query: pair,
      allowHistorical: true,
    });
    expect(JSON.stringify(snapshot.studio?.content)).toContain("12 份访谈");
  });
  it("retries once, rejects stale saves and does not let another owner read a draft", async () => {
    const owner = await context(),
      other = await context();
    const d = await createStudioDocument(db, owner, { title: "重试" }, randomUUID());
    const body = request(d);
    body.content.basics.name = "林同学";
    const key = randomUUID();
    const saved = await saveStudioDraft(db, owner, d.documentId, body, key);
    expect(await saveStudioDraft(db, owner, d.documentId, body, key)).toEqual(saved);
    await expect(
      saveStudioDraft(db, owner, d.documentId, { ...body, title: "冲突" }, randomUUID()),
    ).rejects.toMatchObject({ code: "RESUME_DRAFT_CONFLICT" });
    await expect(getStudioDraft(db, other, d.documentId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it("copies format and grouped entries, reimport deduplicates experiences and source updates leave drafts intact", async () => {
    const owner = await context();
    let a = await createStudioDocument(db, owner, { title: "原稿" }, randomUUID());
    const body = request(a);
    body.content.sections = [project("完成调研报告")];
    body.layout = { ...a.layout, templateKey: "cn_simple_two_column" };
    a = await saveStudioDraft(db, owner, a.documentId, body, randomUUID());
    await checkpointStudioDraft(db, owner, a.documentId, a.revision);
    const b = await createStudioDocument(
      db,
      owner,
      { title: "方向稿", copyFromDocumentId: a.documentId },
      randomUUID(),
    );
    expect(b.layout.templateKey).toBe("cn_simple_two_column");
    expect(b.content).toEqual(a.content);
    const c = await createStudioDocument(db, owner, { title: "再次导入" }, randomUUID());
    const next = request(c);
    next.content.sections = [project("完成调研报告")];
    await saveStudioDraft(db, owner, c.documentId, next, randomUUID());
    expect(await listExperiences(db, owner)).toHaveLength(1);
    const e = (await listExperiences(db, owner))[0]!;
    await updateExperience(db, owner, e.id, e.revision, { ...e.entry, role: "用户补充的角色" });
    expect(
      (await getStudioDraft(db, owner, b.documentId)).content.sections[0]!.entries[0]!.role,
    ).toBe("小组成员");
  });
  it("creates a pinned Case resume from a studio draft without evidence and keeps the selected historical layout", async () => {
    const owner = await context();
    let base = await createStudioDocument(db, owner, { title: "通用稿" }, randomUUID());
    const content = request(base);
    content.content.basics.name = "测试同学";
    content.content.sections = [project("访谈并整理用户反馈")];
    content.layout = { ...content.layout, templateKey: "cn_simple_two_column", fontSize: 12 };
    base = await saveStudioDraft(db, owner, base.documentId, content, randomUUID());
    const firstPair = await checkpointStudioDraft(db, owner, base.documentId, base.revision);
    const changed = request(base);
    changed.layout = { ...changed.layout, templateKey: "cn_compact_technical" };
    base = await saveStudioDraft(db, owner, base.documentId, changed, randomUUID());
    await checkpointStudioDraft(db, owner, base.documentId, base.revision);
    const application = await createApplicationCase({
      db,
      owner,
      enableLocalMvp: true,
      idempotencyKey: randomUUID(),
      request: CreateApplicationCaseWithJobContextRequestSchema.parse({
        jobContext: {
          kind: "private_input",
          title: "产品实习生",
          companyName: "示例团队",
          contentText: "在校生实习，协助用户访谈和需求整理。",
          source: { kind: "unspecified" },
        },
        initialStage: "preparing",
      }),
    });
    const derived = await createResumeDocument({
      db,
      owner,
      idempotencyKey: randomUUID(),
      request: {
        kind: "case_derived",
        caseId: application.applicationCase.id,
        expectedCaseRevision: application.applicationCase.revision,
        baseDocumentRevisionId: firstPair.contentRevisionId,
        title: "岗位稿",
      },
    });
    expect(derived.resumeDocument.evidenceRevisionId).toBeNull();
    const draft = await getStudioDraft(db, owner, derived.resumeDocument.id);
    expect(draft.layout.templateKey).toBe("cn_simple_two_column");
    expect(draft.content.sections[0]?.entries[0]?.title).toBe("课程项目");
    const exported = await loadResumeExportSnapshot({
      db,
      owner,
      documentId: draft.documentId,
      query: {
        contentRevisionId: derived.resumeDocument.currentContentRevisionId!,
        layoutRevisionId: derived.resumeDocument.currentLayoutRevisionId!,
      },
      allowHistorical: true,
    });
    expect(exported.studio?.layout.templateKey).toBe("cn_simple_two_column");
    const direction = request(draft);
    direction.content.sections[0]!.entries[0]!.body = resumeRichText("岗位稿的改写");
    await saveStudioDraft(db, owner, draft.documentId, direction, randomUUID());
    expect(JSON.stringify((await listExperiences(db, owner))[0]?.entry)).toContain("访谈并整理");
    expect(
      JSON.stringify((await getStudioDraft(db, owner, base.documentId)).content),
    ).not.toContain("岗位稿的改写");
  });
  it("does not create empty documents from missing or foreign experience sources", async () => {
    const owner = await context();
    await expect(
      createStudioDocument(
        db,
        owner,
        { title: "无效来源", experienceIds: [randomUUID()] },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "EXPERIENCE_NOT_FOUND" });
    await expect(
      createStudioDocument(
        db,
        owner,
        { title: "无效副本", copyFromDocumentId: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(
      await db
        .selectFrom("profile.resume_documents")
        .select("id")
        .where("owner_id", "=", owner.ownerId)
        .execute(),
    ).toHaveLength(0);
  });
  it("retains a downloadable original independently of document content and rejects downloads after document deletion", async () => {
    const owner = await context(),
      key = "a".repeat(64),
      buffer = Buffer.from("fixture original bytes");
    const result = await createStudioImport(
      db,
      owner,
      { filename: "测试原件.pdf", mediaType: "application/pdf", buffer, encryptionKey: key },
      randomUUID(),
    );
    const original = result.originals[0]!;
    expect((await downloadStudioOriginal(db, owner, original.id, key)).buffer).toEqual(buffer);
    await sql`DELETE FROM profile.resume_originals WHERE id=${original.id} AND owner_id=${owner.ownerId}`.execute(
      db,
    );
    expect((await getStudioDraft(db, owner, result.draft.documentId)).documentId).toBe(
      result.draft.documentId,
    );
    const another = await createStudioImport(
      db,
      owner,
      { filename: "另一份.pdf", mediaType: "application/pdf", buffer, encryptionKey: key },
      randomUUID(),
    );
    const doc = await db
      .selectFrom("profile.resume_documents")
      .select("revision")
      .where("id", "=", another.draft.documentId)
      .executeTakeFirstOrThrow();
    await deleteResumeDocument({
      db,
      owner,
      documentId: another.draft.documentId,
      request: { expectedRevision: doc.revision },
    });
    await expect(
      downloadStudioOriginal(db, owner, another.originals[0]!.id, key),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
  it("keeps contact details, grouped context, Chinese text and links in DOCX", async () => {
    const content = importStudioText(
      "林小雨\n电话：13800138000 邮箱：lin@example.cn\n教育经历\n2023.09 — 2027.06 示例大学 本科\n自动化专业\n项目经历\n2025.03 — 2025.06 调研项目\n访谈、整理、交付报告。\n2025.07 — 2025.08 社区项目\n参与内容策划。",
    );
    expect(content.basics.phone).toBe("13800138000");
    expect(content.basics.email).toBe("lin@example.cn");
    expect(content.sections.find((s) => s.kind === "project")?.entries).toHaveLength(2);
    const d = await createStudioDocument(db, await context(), { title: "DOCX" }, randomUUID());
    const buffer = await createStudioDocx(content, d.layout);
    const parsed = await parseResumeBuffer({ kind: "docx", buffer });
    expect(parsed).toContain("13800138000");
    expect(parsed).toContain("交付报告");
  }, 30000);
});
