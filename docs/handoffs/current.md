# 当前项目交接：Aijob 求职 OS 2.0 Phase 2A-1

> 交接日期：2026-08-05
>
> 当前分支：`codex/career-os-phase-1`
>
> 当前 HEAD：本交接所在 Phase 2 设计提交；用 `git log -1 --oneline` 获取哈希。前序提交为 `24368f5 feat(web): complete Career OS static workspaces`。
>
> 工作树预期：提交后只剩未跟踪 `.claude/`；不得读取、提交、覆盖或清理它。仍须用 `git status --short` 复核。
>
> 动态事实源：[MVP 路线](../06-mvp-roadmap.md)
>
> 稳定主计划：[Private Alpha 严格开发总计划](../plans/career-os-v2-upgrade-plan-2026-08-04.md)
>
> Phase 2 设计：[领域契约与迁移设计](../plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md)

## 1. 当前唯一目标

Phase 1A/1B 与 Phase 2 领域设计 Gate 已通过。当前唯一目标是 **Phase 2A-1：ApplicationCase core contracts + additive migration 023**。

```text
公共 Case 枚举与 strict request/response contracts
-> application schema 的 Case/事件/要求状态/证据连接/问题表
-> stable job/version/requirement-set 复合约束
-> owner 复合外键、30 天 TTL、部分唯一索引、不可变事件
-> 五个运行角色的显式权限
-> 空库和 022 fixture 的隔离 PostgreSQL 验证
-> 继续 / 修改 / 回退 / 停止
```

本切片不注册 HTTP API，不写业务服务，不开始 Resume V2/Interview，不改旧决定双写，不处理真实数据。没有隔离 PostgreSQL 实际结果不能通过 migration 023 Gate。

## 2. 已通过基线

- Phase 1A：`7bb2140`，统一壳层、静态看板、Case 路由、功能旗标与响应式 Gate。
- 依赖安全修复：`5da2390`，`fast-uri` advisory 已清除。
- Phase 1B：`24368f5`，JD 三态与 Resume 静态建议四态、URL/焦点/旗标/浏览器 Gate。
- Phase 2 设计：冻结复用矩阵、领域表、状态机、API、删除顺序、任务、权限、023–027 迁移和测试矩阵；证据见 [设计验收](../evidence/product/career-os-v2/phase-2-domain-contract-design-acceptance-2026-08-05.md)。
- 设计提交工程门：359 文件 lint、TypeScript、528 项非数据库测试、生产构建、依赖审计和 7 个变更文档的相对链接扫描通过；51 项 PostgreSQL 集成测试因无数据库未执行。

产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。Phase 4 前不恢复真实供给扩容。

## 3. migration 023 固定范围

### Contracts

新增并从 `packages/contracts/src/index.ts` 导出：

- `CaseStage = interested | preparing | applied | interviewing | resolved`
- `CaseOutcome = offer | rejected | withdrawn | expired | unknown`
- `RequirementEvidenceState = confirmed | needs_work | unconfirmed`
- ApplicationCase DTO、create/transition/job-version-upgrade/requirement/evidence-link/question 的 strict schemas。
- 请求不得接受客户端 `ownerId/ownerEpoch/expiresAt`；更新必须带 `expectedRevision`，创建/追加由路由层要求 Idempotency-Key。

### Migration 023

新建 `application` schema 与：

- `application_cases`
- `case_events`
- `case_requirement_states`
- `case_requirement_evidence_links`
- `case_questions`

同时：

- 给 `catalog.published_job_versions(published_job_id, id)` 增加可复用唯一约束。
- 复用既有 `catalog.job_requirement_sets(published_job_version_id, id)` 唯一约束。
- 同一 owner/稳定岗位只允许一个 `ended_at IS NULL AND deleted_at IS NULL` Case。
- Case 固定 stable job、job version、requirement set；owner 子表使用复合外键。
- 顶层 Case `expires_at <= created_at + 30 days`，服务未来还须取 owner expiry 的更早值。
- Case event 禁止 UPDATE；event sequence 与 Case revision 一致。
- 新 schema/table 对五个角色显式 GRANT/REVOKE；collector 不得获得 application 数据权限。

### Tests

- contracts 固定枚举、strict object、stage/outcome 配对和长度边界。
- migration registry/Database types。
- 空库 `001 -> 023`。
- 含 V1、旧决定、owner task 的 022 fixture 升级到 023，旧行/接口不变。
- Case 活动唯一性、岗位版本/要求集归属、跨 owner FK、事件不可变、TTL、索引和角色权限。
- PostgreSQL 地址必须通过现有 loopback + `aijob_test*` 隔离守卫。

## 4. 实现时必须保持的决定

- `requirement_id/evidence_id` 使用 text，不假设 UUID。
- `owner_epoch` 不对 owner 当前 epoch 建 FK；删除递增 epoch，迟到写入由事务/lease 拒绝。
- `case_events.event_data` 只保存状态、版本 ID、引用 ID 和无正文原因码，不复制 JD、简历或回答。
- 创建幂等在 owner/scope/key 下比较 request hash；同键不同 payload 返回 `IDEMPOTENCY_KEY_REUSED`。
- 官方链接打开不能迁移 `applied`；resolved 为终态，结果纠错只追加事件。
- migration 023 只 expand；down 不得破坏既有不可变个人历史。
- 新外键列必须有索引；活动 Case 与到期扫描使用部分索引；列表为 keyset cursor 预留 `(owner_id, updated_at DESC, id DESC)`。

## 5. 已知冲突与风险

- `resume_document_revisions` 已存在；后续 024 是新增聚合并 additive 扩展，禁止重复建同名修订表。
- `docs/05-system-architecture.md` 已从过时受限函数描述修正为 ADR-0023 当前任务 RLS/直接表访问事实。
- ADR-0005 要求 session Cookie SameSite=Strict，当前代码为 session Lax/CSRF Strict；属于服务器就绪前身份安全债，不混入 023。
- migration 021 的 `ALL TABLES` 只覆盖当时对象，新表若不显式授权会在运行角色下 fail closed。
- 本机此前没有 Docker/PostgreSQL，51 项数据库测试未执行；先复查运行环境，仍不可用时不得伪造通过或绕过隔离守卫。

## 6. 首轮代码入口

按顺序只读检查：

1. `packages/contracts/src/common.ts`、`enums.ts`、`problem-details.ts`、`index.ts` 与现有 contract tests。
2. `packages/database/src/migrate.ts`、`types.ts`、`migrations/001_initial.ts`、`004_local_complete_mvp.ts`、`005_enforce_owner_isolation.ts`、`011_g2_correctness_foundations.ts`、`013_enforce_correctness_projection_ownership.ts`、`021_runtime_database_roles.ts`、`022_match_worker_owner_deletion_privileges.ts`。
3. `apps/platform/src/profile/deletion-service.ts`、`retention-service.ts`、`workers/owner-task-lease.ts` 与 integration tests，只用于保证 023 不阻断既有路径；本切片不扩服务。
4. [Phase 2 设计](../plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md)第 4、5、10–13 节。

## 7. Gate 与排除项

至少运行：

```text
git diff --check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit:ci
隔离 PostgreSQL：空库迁移、022 fixture 升级、约束/权限/删除兼容测试
```

不得读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机快照；不得访问真实招聘来源、真实 AI 或服务器。已有改动属于 coco；冲突必须记录并复现，不能静默覆盖。
