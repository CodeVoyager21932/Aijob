# 当前项目交接：Aijob 求职 OS 2.0 Phase 2B-3

> 交接日期：2026-08-08
>
> 当前分支：`codex/career-os-phase-1`
>
> `Phase 2B-2 Case Transition/Job Version` 的实现、验收证据和本交接随同一个独立功能提交收口；提交后的精确基线以 `git log -1` 为准，实现前基线为 `6bcc601 feat(platform): add application case API`。
>
> 提交后工作树预期：只剩未跟踪 `.claude/`；不得读取、提交、覆盖或清理它。

动态事实源：[MVP 路线](../06-mvp-roadmap.md)

稳定主计划：[Private Alpha 严格开发总计划](../plans/career-os-v2-upgrade-plan-2026-08-04.md)

架构决定：[ADR-0031](../decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md)

Phase 2 API 设计：[领域契约与迁移设计](../plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md)

最近验收：[Phase 2B-2 Case Transition/Job Version](../evidence/product/career-os-v2/phase-2b2-case-transition-job-version-acceptance-2026-08-08.md)

## 1. 当前唯一目标

当前唯一工程切片是 **Phase 2B-3 Requirement Service/API**：在 Phase 2B-1/2 的 owner-protected Case 聚合上，接入公共/私有固定要求上下文读取、三态更新、同 owner 已确认证据链接和未知问题，并让每次有效写入继续只递增一次 Case revision、追加一条同序号事件。

```text
Phase 2B-1 Case list/create/detail（已通过）
-> Phase 2B-2 Transition/Job Version（已通过）
-> Phase 2B-3 Requirement Service/API（当前唯一目标）
-> 通过后再决定 Phase 2B-4、修改、回退或停止
```

本切片不接前端，不实现 Resume/Interview/Debrief/Knowledge 服务，不新增 migration，不访问真实 AI、真实招聘来源、邮件或服务器，也不读取真实 JD、真实简历或本地业务数据。

## 2. 已通过基线

- Phase 1A/1B 已通过统一壳层、静态 JD 三态、静态 Resume 建议四态、URL/焦点/响应式与功能旗标 Gate。
- migrations 025-028 已注册长期 owner、公共/私有 Case 与 requirement context、Resume/Review、Interview/Debrief/Knowledge；Phase 2B-3 复用 026/026B，不创建新 migration。
- Phase 2B-1 已提供 Case list/create/detail；Phase 2B-2 已提供 transition、job-version diff/upgrade 和可无损旧决定兼容。
- 最新干净串行全仓为 config 17、contracts 55、database 50、platform 438、web 91，共 651/651；lint 383、typecheck、build 与 audit 通过。audit 仍保留 1 个有明确移除条件的 dev-only high ignored，不能宣称已修复。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。Phase 4 前不恢复真实供给扩容。

## 3. Phase 2B-3 固定范围

### 读取模型与已知契约冲突

- `GET /v1/application-cases/:caseId/requirements` 必须从 Case 固定 JobContext 读取要求定义：public 使用固定 `requirement_set_id`，private 使用固定 snapshot/content/`requirement_set_revision`。
- public/private 要求都用 strict `JobRequirement` 解析，返回官方/用户提供的原文、kind、necessity 和稳定 requirement ID；不能从当前岗位版本或模型重新生成。
- 当前 `ApplicationCaseRequirementsSchema` 顶层只有 `requirementSetId: UUID`，也没有要求定义数组，无法表达 private context 或驱动 JD 工作区。这是已登记的文档/代码冲突；实现前先把响应改为 `RequirementContext` 联合类型并包含固定 requirements，不能给 private Case 伪造公共 UUID。
- 对尚无持久化 state 的要求，GET 以确定性 `unconfirmed` 读模型展示但不写库；第一次有效 PUT 才插入 state。不存在的 requirement ID 返回 `422 REQUIREMENT_REFERENCE_INVALID`。

### 三态更新

- `PUT /v1/application-cases/:caseId/requirements/:requirementId` 使用 strict `{expectedRevision,state,userNote}`。
- `expectedRevision` 始终是 ApplicationCase 聚合 revision；子行 revision 只记录最后修改它的 Case revision，不建立第二套并发序列。
- 事务锁 owner、Case，再锁/插入 child；真实变化才递增 Case revision 并追加 `requirement_state_changed`。同状态、同 note 重放返回当前读模型，不伪造新事件。
- 合法状态只有 `confirmed / needs_work / unconfirmed`。系统不能因规则、匹配或存在证据而自动把状态改为 confirmed。

### 证据链接

- `PUT /v1/application-cases/:caseId/requirements/:requirementId/evidence-links` 使用 strict `{expectedRevision,evidenceRevisionId,evidenceIds[]}`，把数组视为期望集合做原子差分。
- evidence revision 必须属于同 owner、同 epoch，使用 `ResumeEvidenceRevisionSchema` 解析；每个 ID 必须真实存在且 `confirmed=true`。不存在、跨 owner、跨 revision 或未确认统一返回 `422 EVIDENCE_REFERENCE_INVALID`，不能泄漏对象归属。
- 缺失 requirement state 时可在同一事务插入 `unconfirmed` state 作为链接锚点，但链接行为本身不得自动改变三态。
- 新增链接写 `linked_at`；移除设置 `removed_at`；重新连接清空 `removed_at`。一次期望集合变更只递增一次 Case revision，并追加一条 `requirement_evidence_changed`，事件只保存 ID 差分，不复制证据正文。

### 未知问题

- `POST /v1/application-cases/:caseId/questions` 使用 `{expectedRevision,requirementId?,question}` 和 `Idempotency-Key`；可创建 Case 级问题或固定 requirement 级问题。
- `PUT /v1/application-cases/:caseId/questions/:questionId` 使用 `{expectedRevision,status,answer?}`；`answered` 必须有非空 answer，`open/dismissed` 不得有 answer。
- 创建追加 `question_added`，有效更新追加 `question_updated`；问题和回答属于用户输入，不得据此静默改变要求三态或岗位事实。
- question 不存在、已删除或跨 owner 统一 404；引用 requirement 时必须属于 Case 当前固定上下文。

### 幂等、并发与安全

- PUT 的 `expectedRevision` 和请求 hash 形成 revision-scoped 幂等回放；POST question 继续要求 1-200 字符 `Idempotency-Key`。同键同请求重放原结果，同键不同请求返回 `409 IDEMPOTENCY_KEY_REUSED`。
- 每次有效写入必须满足 `case.revision == event.sequence == child.revision`；一次请求只追加一条 Case event。
- 复用 `requireOwnerContext`、Origin/CSRF hook、Problem Details、`ServiceError`、全局 `no-store`、PostgreSQL 和既有运行角色。
- 跨 owner、删除、不存在与失效会话保持不可枚举边界；owner 删除、Case 删除和 owner epoch 迟到写入回归必须继续通过。

## 4. 首轮代码入口

按顺序检查：

1. `packages/contracts/src/application-cases.ts` 与测试：修正 requirements 顶层 public/private 联合响应，补固定 requirement 定义和各写命令响应；不要重复定义 evidence 或 JobRequirement。
2. `apps/platform/src/applications/service.ts`、`routes.ts` 与集成测试：在同一 ApplicationCase 模块增加五个 endpoint，不创建平行 requirement 服务或第二个 Case 聚合。
3. `packages/contracts/src/profile.ts` 与既有 profile repository/service：复用 `ResumeEvidenceRevisionSchema` 和已确认 evidence 语义，不直接相信请求中的 evidence ID。
4. `packages/database/src/types.ts`、migrations 026/026B：复用 state-scoped FK、public/private context guard、event strict Schema 和 owner 删除顺序；不新增 migration。
5. `apps/platform/src/profile/deletion-service.ts` 与 retention/integration tests：只做回归验证，除非可复现失败，不猜测性改写删除逻辑。
6. `docs/plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md`：以 Case 聚合 revision、固定接口和错误码为实现边界；发现歧义先记录再收口。

## 5. 退出 Gate

至少证明：

- public/private Case 都从固定版本读取同一形状的 requirements；岗位升级后只读取升级后的固定上下文，历史事件不被改写。
- 三态首次写入、更新、无变化重放、非法 requirement、过期 revision 和并发冲突行为确定。
- evidence 期望集合的新增、移除、重连、空集合、重复 ID、跨 owner、错误 revision、未知 ID 和未确认事实全部覆盖。
- Case 级/requirement 级问题的创建、回答、重新打开、dismiss、非法 answer、跨 owner 和幂等重放全部覆盖。
- Case revision、child revision 和 event sequence 在成功、失败、并发、回滚与删除下保持一致。
- CSRF、会话失效、`no-store`、Problem Details、不可枚举 404、owner 删除和 Phase 2B-1/2 回归全部通过。
- `git diff --check`、`pnpm lint`、`pnpm typecheck`、隔离 PostgreSQL `pnpm test`、`pnpm build`、`pnpm audit:ci` 均有明确退出码。

通过后形成独立 Phase 2B-3 验收证据，并只作“继续、修改、回退、停止”之一决定。没有前端变化时不重复伪造浏览器验收或产品价值证据。

## 6. 排除项

不得读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机快照；不得访问真实招聘来源、真实 AI、邮件或服务器。已有改动属于 coco；冲突必须记录并复现，不能静默覆盖。
