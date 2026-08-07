# 当前项目交接：Aijob 求职 OS 2.0 Phase 2B-1

> 交接日期：2026-08-07
>
> 当前分支：`codex/career-os-phase-1`
>
> migration 028 为本交接对应的最新验收切片；其独立安全前置基线为 `ff9405e fix(security): patch pdf resume parser`，028 提交后的精确基线以 `git log -1` 为准。
>
> 提交后工作树预期：只剩未跟踪 `.claude/`；不得读取、提交、覆盖或清理它。

动态事实源：[MVP 路线](../06-mvp-roadmap.md)

稳定主计划：[Private Alpha 严格开发总计划](../plans/career-os-v2-upgrade-plan-2026-08-04.md)

架构决定：[ADR-0031](../decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md)

Phase 2 API 设计：[领域契约与迁移设计](../plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md)

最近验收：[Phase 2A-028 Interview/Debrief/Knowledge Expand](../evidence/product/career-os-v2/phase-2a-028-interview-debrief-knowledge-expand-acceptance-2026-08-07.md)

## 1. 当前唯一目标

当前唯一工程切片是 **Phase 2B-1 ApplicationCase Service/API**：只把已注册的 ApplicationCase 领域接入既有 owner-protected 模块化单体，提供列表、public/private 幂等创建和同 owner 详情。

```text
migrations 025–028 长期领域与删除边界（已通过）
-> Phase 2B-1 Case list/create/detail（当前唯一目标）
-> 通过后再决定 Phase 2B-2 Transition/Job Version、修改、回退或停止
```

本切片不实现阶段流转、岗位版本差异/升级、requirement 写入、旧决定兼容、前端接入、真实 AI、真实招聘来源、邮件或服务器，也不读取真实 JD/简历。

## 2. 已通过基线

- Phase 1A/1B 已通过统一壳层、静态 JD 三态、静态 Resume 建议四态、URL/焦点/响应式与功能旗标 Gate。
- migrations 025–028 已注册长期 owner、Account/EmailIdentity、公共/私有 Case 与 requirement context、Resume/Review、Interview/Debrief/Knowledge。
- migration 028 隔离 PostgreSQL 12/12、database 50/50、owner 删除/retention 2/2、串行全仓 645/645 通过；lint 380、typecheck、build、audit 和 `git diff --check` 通过。
- `pdfjs-dist` 新发现的高危 PDF 执行漏洞已由独立提交升级到 `6.2.108`，解析与隐私回归通过。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。Phase 4 前不恢复真实供给扩容。

## 3. Phase 2B-1 固定范围

### 读取

- `GET /v1/application-cases?cursor&limit&stage`：按 `(updated_at,id)` 稳定倒序游标，只返回当前 owner；限制 `limit`，非法游标返回标准 400 Problem Details。
- `GET /v1/application-cases/:caseId`：返回固定 public/private JobContext 与 Case 当前 revision；不存在和跨 owner 统一不可枚举 404。

### 创建

- `POST /v1/application-cases` 只接受 strict `CreateApplicationCaseWithJobContextRequest` 和 `Idempotency-Key`。
- public Case 必须引用当前可在本地业务范围读取的稳定岗位版本和要求集；private Case 必须引用同 owner 已存在的私有 JD snapshot revision。
- 同 owner、同 JobContext 已有未结束 Case 时返回既有 Case，不静默升级 JobContext；同一幂等键不同请求体返回明确冲突。
- 创建 Case 与首条 `case_created` event 必须在一个 PostgreSQL 事务中完成。

### HTTP 与安全

- 复用 `requireOwnerContext`、现有 CSRF 钩子、`ApiProblem/sendApiProblem` 和全局 `no-store` owner 响应策略。
- 不创建第二套身份、错误格式、幂等表或缓存；PostgreSQL 继续是真源。
- 集成测试必须同时覆盖 public/private、重复创建、幂等冲突、跨 owner 404、CSRF、会话失效和 `Cache-Control: no-store`。

## 4. 首轮代码入口

按顺序检查：

1. `packages/contracts/src/application-cases.ts`：复用现有 create/list/cursor/JobContext contracts，只补确有缺口的响应 Schema。
2. `docs/plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md`：核对已冻结 endpoint、游标、幂等和错误语义。
3. `apps/platform/src/identity/fastify.ts`、`identity/http.ts`、`app.ts`：复用 owner、CSRF、Problem Details、`no-store` 和路由注册边界。
4. `apps/platform/src/decisions`、`insights`：复用 service/routes/integration-test 结构，不复用旧决定作为 Case 真源。
5. `packages/database/src/types.ts` 与 migrations 026/026B：按正式 Case/JobContext/strict event 约束写事务，不再创建 migration。
6. 新增 `apps/platform/src/applications/service.ts`、`routes.ts` 和聚焦集成测试；不接前端。

## 5. 退出 Gate

至少证明：

- public/private list/create/detail 契约与数据库结果一致，游标稳定且不跨 owner。
- 创建和 `case_created` event 原子提交；相同幂等请求重放，相同键不同请求拒绝。
- 不存在/跨 owner 统一 404；写操作无 CSRF 被拒绝；所有 owner 响应 `no-store`。
- 旧 `/v1/decisions` 行为在新服务存在时不变，且不会被静默升级为 Case 真源。
- `git diff --check`、`pnpm lint`、`pnpm typecheck`、隔离 PostgreSQL `pnpm test`、`pnpm build`、`pnpm audit:ci` 全部有明确退出码。

通过后形成独立 Phase 2B-1 验收证据，并只作“继续、修改、回退、停止”之一决定。没有前端变化时不重复伪造浏览器验收或产品价值证据。

## 6. 排除项

不得读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机快照；不得访问真实招聘来源、真实 AI、邮件或服务器。已有改动属于 coco；冲突必须记录并复现，不能静默覆盖。
