# 当前项目交接：Aijob 求职 OS 2.0 Phase 2B-4B

> 交接日期：2026-08-09
>
> 当前分支：`codex/career-os-phase-1`
>
> `Phase 2B-4A Resume Document Aggregate API` 的实现、验收证据和本交接随同一个独立功能提交收口；提交后的精确基线以 `git log -1` 为准，实现前基线为 `f10fb74 feat(platform): add application case requirement API`。
>
> 提交后工作树预期只剩未跟踪 `.claude/`；不得读取、提交、覆盖或清理它。

动态事实源：[MVP 路线](../06-mvp-roadmap.md)

稳定主计划：[Private Alpha 严格开发总计划](../plans/career-os-v2-upgrade-plan-2026-08-04.md)

架构决定：[ADR-0031](../decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md)

Phase 2 API 设计：[领域契约与迁移设计](../plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md)

最近验收：[Phase 2B-4A Resume Document Aggregate API](../evidence/product/career-os-v2/phase-2b4a-resume-document-aggregate-api-acceptance-2026-08-09.md)

## 1. 当前唯一目标

当前唯一工程切片是 **Phase 2B-4B Resume Content/Layout Revision API**：在 2B-4A 的真实 Resume Document 聚合上实现 V1 只读转换、第一次编辑生成 V2，以及同文档不可变正文/布局修订；不提前实现 Resume Review、Tailoring、DOCX、Interview、Knowledge 或前端。

```text
Phase 2B-1 Case list/create/detail（已通过）
-> Phase 2B-2 Transition/Job Version（已通过）
-> Phase 2B-3 Requirement Service/API（已通过）
-> Phase 2B-4A Resume Document Aggregate API（已通过）
-> Phase 2B-4B Resume Content/Layout Revision API（当前唯一目标）
-> 通过后再决定 Phase 2B-4C、修改、回退或停止
```

按稳定设计先冻结以下接口，不在实现中临时发明第二套路径：

- `GET /v1/resume-documents/:documentId/revisions`：同 owner 文档的不可变正文修订与当前读模型。
- `POST /v1/resume-documents/:documentId/revisions`：要求 `Idempotency-Key` 和文档 `expectedRevision`，追加正文修订并推进 current pointer。
- `GET /v1/resume-documents/:documentId/layout-revisions`：同 owner 不可变布局修订。
- `POST /v1/resume-documents/:documentId/layout-revisions`：只追加模板、章节顺序和受控 token，不接收语义正文。
- 2B-4A 列表中的顶层 `legacySource` 继续作为旧 V1 的发现与第一次编辑输入；是否增加独立只读转换 endpoint，必须先由 contracts 测试冻结，不能在 GET 中写库。

## 2. 已通过基线

- migrations 025–029 已注册长期 owner、公共/私有 Case、Requirement、Resume/Review、Interview/Debrief/Knowledge 与 strict Case mutation event。
- Phase 2B-1/2/3 已完成 Case、状态/版本、固定要求、证据链接和问题服务。
- Phase 2B-4A 已完成 V2 聚合稳定列表、同 owner 详情、幂等 base/case-derived 创建、V1 只读来源摘要和 public/private 固定引用。
- 2B-4A 执行中发现并修复了应用毫秒时间覆盖 PostgreSQL 微秒时间的竞态；Case 聚合及子实体更新使用数据库单调时间，不放宽约束。
- 最新隔离 PostgreSQL 串行全仓为 config 17、contracts 59、database 51、platform 441、web 91，共 659/659；lint 387、typecheck、build 与 audit 通过。audit 仍保留 1 个有明确移除条件的 dev-only high ignored，不能宣称已修复。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。Phase 4 前不恢复真实供给扩容。

## 3. Phase 2B-4B 固定范围

### V1 只读转换与第一次编辑

- 只读取当前 owner/epoch 最新 `resume-document-v1` 且 `document_id IS NULL` 的 legacy revision；转换器必须保留所有 section/block ID 和文本，不生成新事实。
- GET 转换不插入、不回填、不更新旧行，也不伪造真实 V2 aggregate pointer。
- 第一次编辑请求使用 `expectedRevision=0 + legacySourceRevisionId + strict resume-content-v1`；必须验证 legacy source 属于同 owner/epoch、仍是允许的只读来源。
- 设计中的“第一次编辑原子创建 base 聚合 + content revision + layout revision”与 2B-4A 已允许先创建空 base 聚合之间存在流程分支；实现前必须用 contracts/服务测试明确：对既有空 base 填入首修订，或从 legacy 直接创建新 base。不得产生两个基础简历真源或隐式覆盖 2B-4A 聚合。

### 不可变正文修订

- `resume-content-v1` 只保存 section/block 的稳定 ID、ordinal、文本和 evidence IDs；Review suggestion decision 不得写回正文。
- 第一修订 `documentRevision=1/baseDocumentRevisionId=NULL`；后续修订严格递增并指向同 owner、同 document 的基修订。
- POST 同时校验文档 `expectedRevision`、current content pointer、base revision 和 owner epoch；同一事务插入 immutable revision、推进 pointer 和聚合 revision。
- canonical content hash 相同的无变化请求不得伪造新修订；幂等重放返回原结果，同键不同请求返回稳定冲突。
- case-derived 文档正文必须从已固定基础修订开始，不能读取基础简历后来版本或 Case 后来 JobContext。

### 不可变布局修订

- 只允许 `cn_classic_single_column` 与 `cn_compact_technical`，章节顺序只能引用当前正文中的稳定 section ID。
- settings 只接受 `resume-layout-settings-v1` 的受控 font/spacing/color/page-break token；不接收 CSS、HTML、脚本或正文。
- 换模板、章节排序或布局 token 只创建 layout revision，不创建 content revision，不改变 section/block/evidence ID。
- 第一布局修订和后续基修订规则、文档 `expectedRevision`、幂等和 current pointer 更新与正文修订同等级严格。

### 安全、删除与兼容

- 复用 2B-4A 模块、owner session、Origin/CSRF、Problem Details、`no-store`、PostgreSQL 和既有运行角色；不创建第二套简历服务。
- 跨 owner、墓碑、错误 epoch、错误文档类型、错误基修订和并发 stale revision 必须 fail closed；不可枚举资源统一 404。
- V1 永久只读；旧 `/v1/profile/document` 只能继续读取 legacy V1，不能误把 `resume-content-v1` 当成旧页面文档。
- 单项删除和 owner 全量删除必须覆盖新增修订/指针；迟到请求不得复活文档。
- 本切片不新增 migration，除非出现可复现的 schema/contract 冲突并先记录“修改”决定；禁止改写历史 migration。

## 4. 首轮代码入口

按顺序检查：

1. `packages/contracts/src/resume-documents.ts` 与测试：复核 `ResumeSemanticContentRevisionSchema`、`PutResumeDocumentContentRevisionRequestSchema`、layout revision/request、read model 与 legacy source 契约。
2. `docs/plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md` 6.2–6.4 与 8.2：先收口“legacy 直接创建”与“已有空 base 首次编辑”的唯一语义。
3. `packages/database/src/migrations/024_resume_document_v2_expand.ts`、`packages/database/src/forward-contract/024f_resume_document_review.ts`、`packages/database/src/types.ts`：确认不可变 trigger、复合 FK、current pointer 与 owner 全局旧 revision 兼容。
4. `apps/platform/src/resume-documents/service.ts`、`routes.ts` 与 2B-4A 集成测试：在同一模块纵向扩展，不另建上传/编辑服务。
5. `apps/platform/src/profile/revision-repository.ts` 与旧 `/v1/profile/document`：只读兼容回归，不让 V2 行泄漏到 V1 页面。
6. `apps/platform/src/profile/deletion-service.ts`、retention/owner deletion 集成测试：验证新增 revision/pointer 删除与迟到 owner epoch。

## 5. 退出 Gate

至少证明：

- V1 转换保留稳定 section/block ID、无写入、跨 owner/epoch/错误 source 拒绝。
- 第一次编辑只产生一个明确的 V2 base 真源，并原子创建/推进内容与布局 pointer；失败事务不留半成品。
- 内容/layout 修订不可 UPDATE，文档内 revision 严格递增，基修订必须同文档；并发 stale `expectedRevision` 只有一个成功。
- no-op、幂等重放、同键不同请求、错误 current pointer、错误 base revision 均有稳定结果。
- 换模板/排序不改变语义正文或 evidence ID，未知/重复 section ID 和宽 JSON 被拒绝。
- base 与 case-derived、public/private、墓碑、owner/CSRF/`no-store`、删除和旧 V1 路由回归通过。
- `git diff --check`、`pnpm lint`、`pnpm typecheck`、隔离 PostgreSQL 串行 `pnpm test`、`pnpm build`、`pnpm audit:ci` 均有明确退出码。

通过后形成独立 Phase 2B-4B 验收证据，并只作“继续、修改、回退、停止”之一决定。没有前端变化时不重复伪造浏览器验收或产品价值证据。

## 6. 排除项

不得读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机快照；不得访问真实招聘来源、真实 AI、邮件或服务器。已有改动属于 coco；冲突必须记录并复现，不能静默覆盖。
