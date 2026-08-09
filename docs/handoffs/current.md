# 当前项目交接：Aijob 求职 OS 2.0 Phase 2B-4A

> 交接日期：2026-08-09
>
> 当前分支：`codex/career-os-phase-1`
>
> `Phase 2B-3 Requirement Service/API` 的实现、migration 029、验收证据和本交接随同一个独立功能提交收口；提交后的精确基线以 `git log -1` 为准，实现前基线为 `54e017a feat(platform): add case transitions and job version upgrades`。
>
> 提交后工作树预期只剩未跟踪 `.claude/`；不得读取、提交、覆盖或清理它。

动态事实源：[MVP 路线](../06-mvp-roadmap.md)

稳定主计划：[Private Alpha 严格开发总计划](../plans/career-os-v2-upgrade-plan-2026-08-04.md)

架构决定：[ADR-0031](../decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md)

Phase 2 API 设计：[领域契约与迁移设计](../plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md)

最近验收：[Phase 2B-3 Requirement Service/API](../evidence/product/career-os-v2/phase-2b3-requirement-service-api-acceptance-2026-08-09.md)

## 1. 当前唯一目标

当前唯一工程切片是 **Phase 2B-4A Resume Document Aggregate API**：只把已经存在于 contracts 与 migrations 024/027 的 Resume Document V2 聚合接入 owner-protected 服务，不提前实现内容编辑、布局编辑或简历审查。

```text
Phase 2B-1 Case list/create/detail（已通过）
-> Phase 2B-2 Transition/Job Version（已通过）
-> Phase 2B-3 Requirement Service/API（已通过）
-> Phase 2B-4A Resume Document Aggregate API（当前唯一目标）
-> 通过后再决定 Phase 2B-4B、修改、回退或停止
```

本切片固定三个 endpoint：

- `GET /v1/resume-documents`：同 owner、未删除 Resume Document 的稳定游标列表。
- `POST /v1/resume-documents`：以 `Idempotency-Key` 幂等创建 base 或 case-derived 文档。
- `GET /v1/resume-documents/:documentId`：同 owner 详情；不存在、已删除或跨 owner 统一 404。

## 2. 已通过基线

- Phase 1A/1B 已通过统一壳层、静态 JD 三态、静态 Resume 建议决策、URL/焦点/响应式与功能旗标 Gate。
- migrations 025–028 已注册长期 owner、公共/私有 Case 与 requirement context、Resume/Review、Interview/Debrief/Knowledge；migration 029 保留 legacy/v1 Case event 并注册 strict `case-event-v2`。
- Phase 2B-1/2/3 已提供 owner-protected Case、阶段/结果事件、岗位版本 diff/显式升级、固定要求三态、已确认证据链接和未知问题。
- 最新隔离 PostgreSQL 串行全仓为 config 17、contracts 57、database 51、platform 439、web 91，共 655/655；lint 384、typecheck、build 与 audit 通过。audit 仍保留 1 个有明确移除条件的 dev-only high ignored，不能宣称已修复。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。Phase 4 前不恢复真实供给扩容。

## 3. Phase 2B-4A 固定范围

### 列表与详情

- 只返回当前 owner、当前 owner epoch、`deleted_at IS NULL` 的文档，使用 `updated_at DESC, id DESC` 稳定 keyset；禁止 offset 分页。
- 聚合必须按 `ResumeDocumentSchema` 映射 public/private JobContext，不把数据库行或 owner 字段交给请求方决定。
- base 文档的 Case、岗位、基础修订和证据引用必须全为空；case-derived 文档必须返回创建时固定的 Case、JobContext、基础文档修订和证据 revision。
- Case 后续岗位版本升级、基础简历继续编辑或证据继续确认，都不得静默改写已创建的派生文档。
- 聚合当前内容/布局指针可以为空；2B-4A 不用空正文、空布局或默认模板伪造已存在的修订。
- 旧 V1 修订没有 `resume_documents` 聚合。实现前必须先用 contracts 测试冻结其发现方式：长期原则是“V1 可通过只读转换器被发现，第一次编辑才创建 V2”，不能让已有用户在新列表中无提示消失，也不能在 GET 中回填数据库。若 B4A 只建立最小虚拟列表项，正文转换仍留给 2B-4B。

### base 创建

- 请求继续使用 strict `{kind:"base", title}`；owner、epoch、ID、revision、生命周期和创建时间全部由服务端生成。
- 新 base 文档初始 `revision=1`，current content/layout 均为空，`expires_at=NULL`，默认长期保留并由用户主动删除。
- 同 owner 同 `Idempotency-Key` + 同请求必须返回同一聚合；同键不同请求返回 `409 IDEMPOTENCY_KEY_REUSED`。

### case-derived 创建

- 请求继续使用 strict `{kind:"case_derived", caseId, baseDocumentRevisionId, title}`；不能接受请求方直接提交 owner、JobContext 或 evidence revision。
- Case 必须属于同 owner/epoch、未删除，并从其当前固定 public/private JobContext 复制不可变引用。
- `baseDocumentRevisionId` 必须属于同 owner 的 base 文档，并且是 strict V2 semantic content revision；不允许引用 case-derived、跨 owner、未知或 legacy V1 修订。
- 服务端在同一事务内选择并固定同 owner 当前已确认的 evidence revision；没有可用的已确认 evidence 时返回明确冲突，不创建空或伪造 revision。
- 同一未删除 Case 最多一个派生文档；相同幂等命令重放原聚合，不同命令与已有派生文档冲突时返回明确 Problem Details，不能静默覆盖或生成第二份真源。
- 创建后 Case、JobContext、base revision 与 evidence revision 不可修改；删除 Case 时只允许既有 027 规则把引用转为 detached，不删除长期简历资产。

### 安全、错误与并发

- 复用 `requireOwnerContext`、Origin/CSRF、Problem Details、全局 `no-store`、PostgreSQL 和既有运行角色；不创建第二套认证、数据库、缓存、队列或 AI SDK。
- POST 必须要求 1–200 字符 `Idempotency-Key`；请求 hash 使用 canonical JSON，并按 owner 隔离。
- owner/epoch、Case、base 文档、base revision 与 evidence revision 必须在同一事务重新验证；不能先读后写留下跨 owner 或版本竞态。
- PostgreSQL 唯一约束冲突必须转换成稳定业务错误，不把 SQL、表名或对象归属泄漏给客户端。
- 本切片不新增 migration，除非先得到可复现的 contract/schema 冲突并像 Phase 2B-3 一样记录“修改”决定；禁止直接改写历史 migration。

## 4. 首轮代码入口

按顺序检查：

1. `packages/contracts/src/resume-documents.ts` 与测试：补列表、游标、聚合详情/创建响应和必要的 legacy 虚拟列表契约；复用已有 `ResumeDocumentSchema`、`CreateResumeDocumentRequestSchema` 与 `LegacyResumeDocumentVirtualSchema`。
2. `packages/database/src/migrations/024_resume_document_v2_expand.ts`、`packages/database/src/forward-contract/024f_resume_document_review.ts` 与 `packages/database/src/types.ts`：确认长期 nullable expiry、public/private 固定引用、唯一 Case 派生文档和 owner 复合外键。
3. `apps/platform/src/profile/revision-repository.ts`：复用同 owner evidence/V1 revision 读取语义；不要把旧上传解析路由变成第二套 Resume V2 聚合。
4. `apps/platform/src/applications/service.ts`：复用 Case 当前 JobContext 映射与 owner/epoch 约束；如需抽取共享 mapper，只做最小无行为变化重构。
5. 新建单一 `apps/platform/src/resume-documents/` 模块并在 `apps/platform/src/app.ts` 注册；不要把聚合 API 混入旧 `/v1/resume-analyses` 上传解析路由。
6. `apps/platform/src/profile/deletion-service.ts` 与 027/owner deletion 集成测试：只做回归；除非可复现失败，不猜测性改写删除顺序。

## 5. 退出 Gate

至少证明：

- 空列表、base/case-derived 混合列表、稳定 cursor、并列时间戳和下一页无重复/遗漏。
- base 创建、派生创建、相同幂等重放、同键不同请求、同 Case 不同键冲突和并发创建行为确定。
- public/private Case 都固定正确 JobContext；Case 升级后旧派生文档不变，新建行为由同 Case 唯一约束明确拒绝。
- base revision 必须属于同 owner base 文档且为 strict V2；cross-owner、case-derived、legacy、未知与删除文档均被拒绝。
- evidence revision 必须同 owner/epoch、已确认且可 strict 解析；无 evidence、跨 owner、迟到 owner epoch 和并发变化全部 fail closed。
- 旧 V1 用户在聚合发现层的行为有明确 contract 与测试；GET 不写库，首次编辑仍留给 2B-4B。
- 详情、列表与创建均满足 CSRF、会话、`no-store`、Problem Details、不可枚举 404 和删除回归。
- `git diff --check`、`pnpm lint`、`pnpm typecheck`、隔离 PostgreSQL `pnpm test`、`pnpm build`、`pnpm audit:ci` 均有明确退出码。

通过后形成独立 Phase 2B-4A 验收证据，并只作“继续、修改、回退、停止”之一决定。没有前端变化时不重复伪造浏览器验收或产品价值证据。

## 6. 排除项

不得读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机快照；不得访问真实招聘来源、真实 AI、邮件或服务器。已有改动属于 coco；冲突必须记录并复现，不能静默覆盖。
