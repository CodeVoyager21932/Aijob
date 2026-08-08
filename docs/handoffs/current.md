# 当前项目交接：Aijob 求职 OS 2.0 Phase 2B-2

> 交接日期：2026-08-08
>
> 当前分支：`codex/career-os-phase-1`
>
> `Phase 2B-1 ApplicationCase Service/API` 的实现、验收证据和本交接随同一个独立功能提交收口；提交后的精确基线以 `git log -1` 为准，独立安全前置提交为 `eee9856 chore(security): refresh frontend toolchain audit baseline`。
>
> 提交后工作树预期：只剩未跟踪 `.claude/`；不得读取、提交、覆盖或清理它。

动态事实源：[MVP 路线](../06-mvp-roadmap.md)

稳定主计划：[Private Alpha 严格开发总计划](../plans/career-os-v2-upgrade-plan-2026-08-04.md)

架构决定：[ADR-0031](../decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md)

Phase 2 API 设计：[领域契约与迁移设计](../plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md)

最近验收：[Phase 2B-1 ApplicationCase Service/API](../evidence/product/career-os-v2/phase-2b1-application-case-service-api-acceptance-2026-08-08.md)

## 1. 当前唯一目标

当前唯一工程切片是 **Phase 2B-2 Case Transition/Job Version**：在 Phase 2B-1 的 owner-protected Case 服务上增加阶段/结果事件、乐观并发、确定性岗位版本差异和用户显式升级，并只兼容可无损表达的旧决定。

```text
Phase 2B-1 Case list/create/detail（已通过）
-> Phase 2B-2 Transition/Job Version（当前唯一目标）
-> 通过后再决定 Phase 2B-3 Requirement Service/API、修改、回退或停止
```

本切片不实现 requirement 三态/证据/问题写入，不接前端，不实现 Resume/Interview/Knowledge 服务，不访问真实 AI、真实招聘来源、邮件或服务器，也不读取真实 JD、真实简历或本地业务数据。

## 2. 已通过基线

- Phase 1A/1B 已通过统一壳层、静态 JD 三态、静态 Resume 建议四态、URL/焦点/响应式与功能旗标 Gate。
- migrations 025–028 已注册长期 owner、公共/私有 Case 与 requirement context、Resume/Review、Interview/Debrief/Knowledge；不再新增 migration 完成 Phase 2B-2。
- Phase 2B-1 已提供 `GET/POST /v1/application-cases` 与 `GET /v1/application-cases/:caseId`，覆盖 public/private JobContext、owner/epoch、幂等并发、CSRF、`no-store` 和不可枚举 404。
- 最新干净串行全仓为 config 17、contracts 54、database 50、platform 436、web 91，共 648/648；lint 382、typecheck、build 与 audit 通过。audit 仍保留 1 个有明确移除条件的 dev-only high ignored，不能宣称已修复。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。Phase 4 前不恢复真实供给扩容。

## 3. Phase 2B-2 固定范围

### 状态机与结果

```text
interested  -> preparing | resolved
preparing   -> interested | applied | resolved
applied     -> interviewing | resolved
interviewing -> applied | resolved
resolved    -> 终态
```

- `POST /v1/application-cases/:caseId/transitions` 接受 strict `{expectedRevision,toStage,outcome?,reason?}` 和 `Idempotency-Key`。
- 进入 `resolved` 必须有 outcome 并设置 `ended_at`；非 `resolved` 必须保持 outcome/`ended_at` 为空。
- 合法阶段变化追加 `stage_transitioned`；已 resolved Case 只允许在 `expectedRevision` 保护下纠正 outcome，追加 `outcome_corrected`，不得重新打开。
- Case 写事务必须先锁同 owner Case，校验 owner epoch 与 `expectedRevision`，恰好递增一次聚合 revision，并以相同序号追加一条事件。过期 revision 返回 `409 APPLICATION_CASE_REVISION_CONFLICT`。
- 非法迁移、同阶段无变化或 outcome 配对错误返回 `409 INVALID_CASE_TRANSITION`；不存在、删除和跨 owner 继续统一 404。
- 打开官方链接不自动变为 `applied`；本切片不新增自动投递或代投行为。

### 岗位版本差异与显式升级

- `GET /v1/application-cases/:caseId/job-version-diff` 只适用于 public Case，比较 Case 固定版本与同一稳定岗位的目标当前版本，输出由冻结字段和要求 ID 计算的确定性差异，不调用模型、不写库。
- 无更新时明确返回无变化；目标必须属于同一 `published_job_id`，不能借版本参数枚举其他岗位或 owner 对象。
- `POST /v1/application-cases/:caseId/job-version-upgrades` 接受 strict `{expectedRevision,targetPublishedJobVersionId}` 和 `Idempotency-Key`。只有用户显式请求才能更新 Case 固定岗位版本与要求集，并追加 `job_version_upgraded`。
- 升级不得级联改写既有 Resume、Interview、Debrief 或历史事件；private Case 不伪造公共版本升级能力。
- 目标版本仍需满足既有本地业务范围、准入和版本归属规则；不能因 Case 已存在而绕过公共岗位可用性边界。

### 旧决定兼容

- 只处理无损映射：`saved -> interested`、`preparing_to_apply -> preparing`、`applied -> applied`、`abandoned -> resolved/withdrawn`；`undecided` 不创建 Case。
- 新 Case 中 `interviewing`、`offer`、`rejected`、`expired` 等无法写回旧五态的状态必须返回 `409 CAREER_OS_STATE_NOT_REPRESENTABLE`，不得压扁或猜测。
- 旧 `/v1/job-decisions` 路由继续保留；兼容写入必须与可表示的 Case 状态在同一事务内一致，不得建立第二个真源。

### HTTP 与安全

- 复用 `requireOwnerContext`、现有 Origin/CSRF hook、`ApiProblem/sendApiProblem`、`ServiceError`、全局 `no-store` 和 PostgreSQL，不新增认证、缓存、幂等表、队列或数据库。
- 所有追加型 POST 要求 1–200 字符 `Idempotency-Key`；同 key/同请求重放原结果，同 key/不同请求返回 `409 IDEMPOTENCY_KEY_REUSED`。
- private/public、不存在/跨 owner、会话失效、CSRF、并发 revision、非法迁移和版本归属都必须有聚焦集成测试。

## 4. 首轮代码入口

按顺序检查：

1. `packages/contracts/src/application-cases.ts` 与测试：复用现有 transition/upgrade/event Schema，只补确定性 diff 和响应契约的真实缺口。
2. `apps/platform/src/applications/service.ts`、`routes.ts` 与集成测试：在 Phase 2B-1 服务中增加三个 endpoint，不新建平行应用模块。
3. `packages/database/src/types.ts`、migrations 026/026B：按正式 `application_cases`、`case_events`、public/private JobContext、revision 与角色权限实现短事务；不创建新 migration。
4. `catalog.published_jobs`、`published_job_versions`、`job_requirement_sets` 及既有 `job_version_eligibility` 查询：复用稳定岗位、版本归属、要求集和动态准入语义生成 diff/升级目标。
5. `apps/platform/src/decisions/service.ts`、`routes.ts` 与测试：只在可无损映射时建立事务兼容，保留旧接口与显式冲突。
6. `docs/plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md`：状态机、endpoint、错误码和旧决定映射是实现边界，不在代码中静默改写。

## 5. 退出 Gate

至少证明：

- 状态机所有允许/拒绝边、resolved outcome 纠正、终态不可重开和同阶段无变化行为确定。
- Case revision 与 event 序号在并发写入、幂等重放和失败回滚下保持一致；每次有效写入只追加一条对应事件。
- public 版本 diff 可复现；同稳定岗位显式升级成功，跨岗位/旧版本/不可用版本拒绝；private Case 不泄漏或伪装升级。
- 旧决定只做无损兼容；无法表示的 Case 状态明确冲突，官方链接点击仍不等于已投递。
- owner/epoch、跨 owner 404、CSRF、会话失效、`no-store`、Problem Details 与 Phase 2B-1 回归全部通过。
- `git diff --check`、`pnpm lint`、`pnpm typecheck`、隔离 PostgreSQL `pnpm test`、`pnpm build`、`pnpm audit:ci` 均有明确退出码。

通过后形成独立 Phase 2B-2 验收证据，并只作“继续、修改、回退、停止”之一决定。没有前端变化时不重复伪造浏览器验收或产品价值证据。

## 6. 排除项

不得读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机快照；不得访问真实招聘来源、真实 AI、邮件或服务器。已有改动属于 coco；冲突必须记录并复现，不能静默覆盖。
