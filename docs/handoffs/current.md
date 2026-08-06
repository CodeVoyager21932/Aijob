# 当前项目交接：Aijob 求职 OS 2.0 Phase 2A-027

> 交接日期：2026-08-06
>
> 当前分支：`codex/career-os-phase-1`
>
> 最近已推送前置基线：`92fbd33 feat(database): add long-lived application cases`；026B 对应当前分支最新提交与下方验收证据。
>
> 提交后工作树预期：只剩未跟踪 `.claude/`；不得读取、提交、覆盖或清理它。

动态事实源：[MVP 路线](../06-mvp-roadmap.md)

稳定主计划：[Private Alpha 严格开发总计划](../plans/career-os-v2-upgrade-plan-2026-08-04.md)

架构决定：[ADR-0031](../decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md)

Phase 2R 契约：[契约与迁移影响矩阵](../plans/career-os-phase-2r-contract-and-migration-impact-matrix-2026-08-06.md)

前向修复设计：[Phase 2A 前向修复契约与隔离 PostgreSQL 测试设计](../plans/career-os-phase-2a-forward-contract-and-isolated-db-test-design-2026-08-06.md)

最近验收：[Phase 2A-026B Private Requirement Context Forward Repair](../evidence/product/career-os-v2/phase-2a-026b-private-requirement-context-forward-repair-acceptance-2026-08-06.md)

## 1. 当前唯一目标

当前唯一工程切片是 **Phase 2A-027 Resume/Review Forward Repair**：审查 `024F` 未注册原型并将长期 Resume、public/private Case 派生引用、strict Content/Layout、独立 Review 聚合和 owner 删除覆盖正式注册为 additive migration 027。

```text
migration 025 Identity Account/Email Expand（已通过）
-> migration 026 ApplicationCase Long-Lived Forward Repair（工程门通过，决定修改）
-> migration 026B Private Requirement Context Forward Repair（10/10，决定继续）
-> migration 027 Resume/Review Forward Repair（当前唯一目标）
-> 通过后再决定 Phase 2 后续领域迁移、修改、回退或停止
```

本切片不注册 Resume/Review HTTP API，不调用真实 AI，不读取真实 JD/简历，不访问真实招聘来源、邮件或服务器，也不实现 Interview、Debrief、Knowledge 或前端编辑器。

## 2. 已通过基线

- Phase 1A/1B 已通过统一壳层、静态 JD 三态、静态 Resume 建议四态、URL/焦点/响应式与功能旗标 Gate。
- migration 025 已注册长期 owner、Account/EmailIdentity 与删除 epoch 保护。
- migration 026 已注册 owner-only 私有 JD snapshot/revision、公共/私有 Case、长期 Case 和 strict Case event。
- migration 026B 已注册 `PublicRequirementContext | PrivateRequirementContext`、state-scoped evidence/question FK、public/private 唯一性、private strict event 与 legacy public backfill。
- 026B 隔离 PostgreSQL 10/10、database 48/48、owner 删除/retention 2/2、全仓 635/635 通过；lint 376、typecheck、build、audit 和 `git diff --check` 通过。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。Phase 4 前不恢复真实供给扩容。

## 3. Migration 027 固定范围

### Resume document 前向修复

- `profile.resume_documents.expires_at` 对长期文档改为 nullable；历史 expiry 保留可读，不再由长期职业资产 retention 自动删除。
- `base` 文档保持无岗位上下文；`case_derived` 文档严格固定 public 或 private JobContext、source content revision、evidence revision 与 base document revision。
- private 派生文档引用 owner-only snapshot/content revision，不伪造公共岗位或 requirement-set UUID。
- Case 删除时只允许显式执行 `case_id -> detached_from_case_id` 的选择性脱离；默认不静默删除用户选择保留的 Resume/Review。

### Strict Content/Layout

- 新内容写入使用 `resume-content-v1` 语义 section/block Schema；稳定 section/block/evidence ID、顺序和正文边界由数据库验证。
- 新布局写入使用 `resume-layout-v2`；只允许固定模板、章节顺序和受控 layout token，不保存正文或任意 CSS/HTML。
- 既有 `resume-document-v1/v2` 与 `resume-layout-v1` 只读兼容，不批量回填、不原地更新。

### Resume Review 聚合

- 正式注册 `resume_review_runs/findings/suggestions/decisions`。
- Review 固定 owner/epoch、Case 或 detached Case、document/content revision、JobContext、evidence revision 与模式。
- Finding/Suggestion/Decision 使用 strict Schema；suggestion 的 pending/accepted/edited/rejected 不写入 Resume 正文 block。
- accepted/edited 必须引用新 content revision；rejected 不创建正文修订；findings 和 decisions 追加/不可原地修改。
- `aijob_match_worker` 只生成任务结果所需 finding/suggestion，不得创建用户 Review aggregate 或决定。

### 删除、权限与回退

- 扩展 owner 全量删除顺序，先删 decision/suggestion/finding/run，再删 layout/content/document；owner epoch 改变后迟到结果不得写回。
- collector 对所有 Resume/Review 表继续不可读；web/match/ops/migrator 权限按职责最小化。
- 单项 Review 删除不自动删除 Resume；单项 Resume 删除必须处理 Review 引用而不能留下悬空正文。
- migration 027 只做 expand/migrate；`down` 非破坏，不删除 Resume/Review 历史。

## 4. 开始前必须复核的冲突

- `024F` 目前只在隔离测试中手动执行，不能直接因测试通过就注册；必须逐项复核它对 migration 026B、owner deletion service 和最新 Kysely 类型的兼容。
- migration 024 的 `expires_at NOT NULL + 30 天` 是历史实现；ADR-0031 要求职业资产默认长期保留，但原始上传/临时解析仍最长 24 小时，不能一起放宽。
- `ResumeSuggestionDecision` 已存在于旧正文 block DTO；027 的真源必须是 Review aggregate，旧字段只作 legacy 读取，不能双写成两个业务真源。
- Case 当前版本可升级；已生成 Resume/Review 必须继续固定生成时的 JobContext revision，不能随 Case 指针漂移。
- 当前 owner 删除服务尚未删除 Resume V2/Review 新表；没有删除、跨 owner 与迟到任务证据，不得宣称 migration 027 通过。

## 5. 首轮代码入口

按顺序检查：

1. `packages/contracts/src/resume-documents.ts` 与测试：semantic content、strict layout、Review DTO 和 legacy V1/V2 边界。
2. `packages/database/src/migrations/024_resume_document_v2_expand.ts`：历史表、TTL、FK、不可变触发器和角色权限。
3. `packages/database/src/forward-contract/024f_resume_document_review.ts`：未注册原型；不得未经复核直接复制或注册。
4. `packages/database/src/forward-contract/phase-2a-forward-contract.integration.test.ts`：已有 public/private Resume/Review 夹具、选择性 Case 删除和角色测试。
5. `packages/database/src/types.ts`、`packages/database/src/migrate.ts`。
6. `apps/platform/src/profile/deletion-service.ts` 与 `retention-service.integration.test.ts`：补 owner 删除顺序和迟到写入拒绝。

## 6. 退出 Gate

至少证明：

- 空库 `001 -> 027` 与含 V1、024 V2、public/private Case、026B requirement context 的升级库均成功。
- V1/V2 历史行逐列兼容；长期 Resume 不再自动到期，短期原文/导出限制不变。
- public/private 派生文档、strict content/layout、Review 四表状态机与跨 owner 约束通过。
- Case 选择性脱离、单项删除、owner 全量删除、collector 拒绝、match-worker 最小权限、迟到任务和非破坏回退通过。
- `git diff --check`、`pnpm lint`、`pnpm typecheck`、使用隔离 PostgreSQL 的 `pnpm test`、`pnpm build`、`pnpm audit:ci` 全部有明确退出码。

通过后形成独立 migration 027 验收证据，并只作“继续、修改、回退、停止”之一决定。没有前端变化时不重复伪造浏览器验收或产品价值证据。

## 7. 排除项

不得读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机快照；不得访问真实招聘来源、真实 AI、邮件或服务器。已有改动属于 coco；冲突必须记录并复现，不能静默覆盖。
