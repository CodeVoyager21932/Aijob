# 当前项目交接：Aijob 求职 OS 2.0 Phase 2A-028

> 交接日期：2026-08-06
>
> 当前分支：`codex/career-os-phase-1`
>
> migration 027 为本交接对应的最新验收切片；提交与推送后的精确基线以 `git log -1` 为准，前置提交为 `3042683 feat(database): support private requirement contexts`。
>
> 提交后工作树预期：只剩未跟踪 `.claude/`；不得读取、提交、覆盖或清理它。

动态事实源：[MVP 路线](../06-mvp-roadmap.md)

稳定主计划：[Private Alpha 严格开发总计划](../plans/career-os-v2-upgrade-plan-2026-08-04.md)

架构决定：[ADR-0031](../decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md)

Phase 2R 契约：[契约与迁移影响矩阵](../plans/career-os-phase-2r-contract-and-migration-impact-matrix-2026-08-06.md)

前向修复设计：[Phase 2A 前向修复契约与隔离 PostgreSQL 测试设计](../plans/career-os-phase-2a-forward-contract-and-isolated-db-test-design-2026-08-06.md)

最近验收：[Phase 2A-027 Resume Document/Review Forward Repair](../evidence/product/career-os-v2/phase-2a-027-resume-document-review-forward-repair-acceptance-2026-08-06.md)

## 1. 当前唯一目标

当前唯一工程切片是 **Phase 2A-028 Interview/Debrief/Knowledge Expand**：只通过 strict contracts 和 additive migration 补齐文字面试、复盘和引用式经验库的长期领域基础。

```text
migration 025 Identity Account/Email Expand（已通过）
-> migration 026/026B ApplicationCase + Requirement Context（已通过）
-> migration 027 Resume/Review Forward Repair（11/11，决定继续）
-> migration 028 Interview/Debrief/Knowledge Expand（当前唯一目标）
-> 通过后再决定 Phase 2 服务/API、修改、回退或停止
```

本切片不注册 HTTP API，不实现前端，不调用真实 AI，不读取真实 JD/简历，不访问真实招聘来源、邮件或服务器，也不实现面试生成服务或知识正文抓取。

## 2. 已通过基线

- Phase 1A/1B 已通过统一壳层、静态 JD 三态、静态 Resume 建议四态、URL/焦点/响应式与功能旗标 Gate。
- migrations 025/026/026B 已注册长期 owner、Account/EmailIdentity、owner-only 私有 JD、公共/私有 Case 与对等 requirement context。
- migration 027 已注册长期 Resume、public/private Case 派生引用、strict Content/Layout、独立 Review 四表、owner 删除与迟到写入保护。
- migration 027 隔离 PostgreSQL 11/11、database 49/49、owner 删除/retention 2/2、串行全仓 636/636 通过；lint 377、typecheck、build、audit 和 `git diff --check` 通过。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。Phase 4 前不恢复真实供给扩容。

## 3. Migration 028 固定范围

### Interview

- `interview_sessions` 固定 owner/epoch、Case 或 detached Case、public/private JobContext、模式、输入 evidence revision 和创建幂等键。
- `interview_turns` 追加保存问题、回答、追问及顺序；新行只能引用同一 Session/owner，已写 turn 不原地修改。
- `interview_feedback` 保存 versioned strict 结构化反馈、能力项和已确认 evidence 引用；不能写入新经历事实。
- 当前只冻结 `template | controlled_ai` 模式契约；不接模型，不实现生成器。

### Debrief

- `debriefs` 固定 Case/JobContext/Interview Session（可空）和 evidence revision，保存表达问题、证据缺口与练习计划。
- 用户确认必须是追加式确认记录；只有后续服务显式确认后才可转为新经历表达，本切片不创建 Resume 内容。
- Case 删除时支持显式脱离并保留用户选择的复盘资产，不静默删除长期职业资产。

### Knowledge

- `knowledge_clips` 只允许 HTTPS URL、标题、短摘要、适用场景、核验时间和用户笔记；不保存抓取正文。
- Case 关联使用独立 `knowledge_clip_case_links`；删除 Case 只移除/脱离关联，不删除用户选择保留的 Clip。
- Clip 单项删除只删除其关联，不影响 Case、Interview、Debrief 或 Resume。

### 生命周期、删除与权限

- 三类资产默认长期，不设置 30 天自动删除；仍具备 owner 主动单项删除和 owner 全量删除。
- 所有 owner 资产固定 owner epoch；epoch 变化后拒绝迟到任务结果。
- collector 不可访问；web/match/ops/migrator 按职责最小化。match-worker 可写受控生成结果，但不能代替用户创建确认或决定。
- migration 028 只做 expand/migrate；`down` 非破坏，不删除历史。

## 4. 开始前必须复核的冲突

- 既有任务队列和 `match-worker` 已有任务类型不能直接等同于 Interview Session；需要先区分任务执行记录与用户领域聚合，避免第二业务真源。
- 旧 tailoring/insight evidence revision 的引用方式必须复用，不能新建第二套事实库或把自由文本当已确认经历。
- Knowledge Clip 是 owner-only 引用资产，不是岗位来源或公共内容；不得进入公共目录、来源准入或跨用户推荐。
- Case 当前 JobContext 可显式升级；已有 Interview/Debrief 必须继续固定生成时版本，不能随 Case 指针漂移。
- Resume Review 的用户 Decision 权限边界已证明；028 中面试反馈、复盘确认必须沿用“系统建议与用户确认分离”，不能让 worker 代替用户确认。

## 5. 首轮代码入口

按顺序检查：

1. `packages/contracts/src/application-cases.ts`、`resume-documents.ts`：复用 JobContext、owner/epoch、strict version 和 evidence 引用模式。
2. `packages/database/src/migrations/023_application_case_core.ts`、`026_application_case_long_lived_forward_repair.ts`、`027_resume_document_review_forward_repair.ts`：复用 Case、选择性脱离和前向迁移模式。
3. `packages/database/src/forward-contract/phase-2a-forward-contract.integration.test.ts`：扩展隔离 PostgreSQL fixture，不创建第二测试体系。
4. `packages/database/src/types.ts`、`packages/database/src/migrate.ts`：注册 028 类型和迁移。
5. `apps/platform/src/profile/deletion-service.ts` 与 `retention-service.integration.test.ts`：补 owner 全量删除、长期保留和迟到任务拒绝。
6. `apps/platform/src/workers` 与现有 PostgreSQL task 类型：只复核权限和引用，不实现真实生成任务。

## 6. 退出 Gate

至少证明：

- 空库 `001 -> 028` 与含 public/private Case、requirement context、Resume/Review 的升级库均成功。
- Interview Session/Turn/Feedback、Debrief/确认、Knowledge Clip/Case Link 使用 strict versioned Schema 并保持 owner 隔离。
- public/private JobContext 固定，Case 升级不漂移，Case 选择性脱离和各资产单项删除无悬空引用。
- owner 全量删除、collector 拒绝、match-worker 最小权限、owner epoch 迟到写入和非破坏回退通过。
- `git diff --check`、`pnpm lint`、`pnpm typecheck`、使用隔离 PostgreSQL 的 `pnpm test`、`pnpm build`、`pnpm audit:ci` 全部有明确退出码。

通过后形成独立 migration 028 验收证据，并只作“继续、修改、回退、停止”之一决定。没有前端变化时不重复伪造浏览器验收或产品价值证据。

## 7. 排除项

不得读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机快照；不得访问真实招聘来源、真实 AI、邮件或服务器。已有改动属于 coco；冲突必须记录并复现，不能静默覆盖。
