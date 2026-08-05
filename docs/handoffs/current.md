# 当前项目交接：Aijob 求职 OS 2.0 Phase 2

> 交接日期：2026-08-05
>
> 当前分支：`codex/career-os-phase-1`
>
> 当前 HEAD：本交接所在 Phase 1B 提交；用 `git log -1 --oneline` 获取哈希。已知父提交为 `5da2390 chore(deps): patch fast-uri advisories`，Phase 1A 基线为 `7bb2140`。
>
> 工作树预期：Phase 1B 提交后只剩未跟踪 `.claude/`；不得读取、提交、覆盖或清理它。仍须用 `git status --short` 复核。
>
> 动态事实源：[MVP 路线](../06-mvp-roadmap.md)
>
> 稳定主计划：[Private Alpha 严格开发总计划](../plans/career-os-v2-upgrade-plan-2026-08-04.md)

## 1. 当前唯一目标

Phase 1A 与 Phase 1B 已通过。当前唯一目标是 **Phase 2 的第一切片：领域契约与迁移设计包**，不是立即创建表。

```text
盘点既有数据与安全能力
→ 冻结 ApplicationCase / Resume V2 / Interview-Debrief-Knowledge 契约
→ 冻结 owner、TTL、墓碑、迟到任务和删除矩阵
→ 冻结 API / Problem Details / 幂等 / expectedRevision
→ 冻结 additive 迁移顺序、V1 兼容和 PostgreSQL 测试矩阵
→ 设计审查
→ 通过后才开始第一条迁移
```

本切片只允许输出设计文档、契约测试草案和迁移计划；不得访问真实招聘来源、调用真实 AI、购买或部署服务器、处理真实简历，也不得在设计审查前写数据库迁移。

## 2. 已通过基线

### Phase 1A

- `VITE_CAREER_OS_V2` 关闭保持原 `ProductShell`，开启懒加载统一 `WorkspaceShell`。
- `/applications` 静态列表/看板、URL 筛选排序和 `?peek=` 侧览。
- 六个 Case 子路由共享 `CaseHeader / CaseTabs`、岗位版本与焦点规则。
- 证据：[Phase 1A 工作台壳层验收](../evidence/product/career-os-v2/phase-1a-workspace-shell-acceptance-2026-08-04.md)。

### Phase 1B

- `/applications/:caseId/requirements` 已有三组要求、静态原文、三态、`?requirement=` 和检查器焦点返回。
- `/applications/:caseId/resume` 已有结构导航、两模板、A4 预览、`?block=` 与建议检查器。
- 接受、编辑后采用、拒绝、撤销只在会话内改变预览；刷新复位，不持久化，不调用 AI。
- 1920/1280/768/320 无整页横向溢出，320 为全宽抽屉；旗标关闭仍回旧 `/jobs`。
- 证据：[Phase 1B 静态工作区验收](../evidence/product/career-os-v2/phase-1b-static-workspaces-acceptance-2026-08-05.md)。

### 工程门

- `pnpm lint`：359 files。
- `pnpm typecheck`：全仓通过。
- `pnpm test`：528 项非数据库测试通过；平台 38 + database 13 项 PostgreSQL 集成测试因本机无数据库未执行。
- `pnpm build`：通过；主包仍为既有 510.96 kB warning，Case 路由懒加载。
- `pnpm audit:ci`：通过；`fast-uri` override 已升级到 3.1.5/4.1.2。

## 3. 产品和数据事实

- 当前可信分母仍为 22 岗 / 3 家企业 / 3 个官方 ATS；公共岗位、Alpha 岗位和人工来源均为 0。
- 产品证据仍为 `E0`；G0/G1 未启动。
- 100 家/1000 岗是 G2 硬门，110/1100 是运营缓冲。Phase 4 前不恢复真实供给扩容。
- G1 的 300–500 岗是从通过 G2 的 1000 岗中冻结的研究子集，不是供给门槛。
- G3 是至少 3 个已准入确定性 canonical 来源连续 7 天、每 12 小时完成应到刷新。
- 服务器 Gate 已定义，但供应商、地区、预算和数据路径仍须 coco 另行授权。

## 4. Phase 2 必须冻结的不变量

### ApplicationCase

- 同一 owner 对同一稳定岗位最多一个未结束 Case。
- Case 固定 `publishedJobId + publishedJobVersionId`，升级只能显式执行并追加事件。
- 阶段：`interested / preparing / applied / interviewing / resolved`。
- 结果：`offer / rejected / withdrawn / expired / unknown`。
- 阶段、要求状态、证据连接和用户未知问题都要有修订/追加语义。

### Resume V2

- 基础简历与 Case 派生简历分开；内容、证据与布局修订分离。
- V1 行不可修改，读取经转换器；首次编辑才创建 V2。
- 区块/证据 ID 在编辑、排序和换模板时稳定。
- 派生简历固定基础修订、岗位版本和证据修订。

### Interview / Debrief / Knowledge

- 会话固定 Case、岗位版本、模式和输入证据版本；turn/feedback 追加保存。
- 复盘不能创造经历，用户确认后才允许生成新表达。
- Knowledge Clip 只保存 URL、标题、短摘要、适用场景、核验时间和用户笔记，不抓全文。

### 安全与生命周期

- PostgreSQL 是唯一查询和任务真源；复用现有 owner 会话、CSRF 和任务队列。
- 所有新实体必须有 owner 隔离、owner epoch、最长 30 天 TTL、删除墓碑和迟到任务拒绝。
- 导出最长 24 小时，无正文审计最长 90 天。
- API 写操作要求 CSRF；创建要求幂等键，更新要求 `expectedRevision`；跨 owner 返回不可枚举 404。
- 迁移只做 expand/additive；G4 前不做 contract migration。

## 5. 首轮代码入口

先只读检查：

- `packages/database/src/index.ts` 与 `packages/database/src/migrations/001_initial.ts`–`022_match_worker_owner_deletion_privileges.ts`：迁移注册、owner 约束、运行角色和删除权限。
- `packages/contracts/src/profile.ts`、`identity.ts`、`decisions.ts`、`problem-details.ts`：现有公共类型和错误契约。
- `apps/platform/src/profile/revision-repository.ts`、`retention-service.ts`、`deletion-service.ts`：修订、TTL、墓碑与 owner epoch。
- `apps/platform/src/resume/repository.ts`、`routes.ts`、`export-docx.ts`：Resume V1、导出和现有 API。
- `apps/platform/src/decisions/service.ts` 与 `routes.ts`：旧五态决定兼容入口。
- `apps/platform/src/workers/owner-task-lease.ts`、`owner-task-worker.ts`、`match-worker.ts`：PostgreSQL 租约、迟到任务与权限边界。
- `apps/platform/src/identity/http.ts`、`fastify.ts` 和 `apps/platform/src/lib/service-error.ts`：会话、CSRF、不可枚举错误与 Problem Details 映射。

## 6. Phase 2 设计包验收清单

```text
[ ] 现有表/列/索引/权限复用矩阵
[ ] 新表、索引、唯一约束和外键图
[ ] owner / epoch / TTL / 墓碑 / 删除顺序矩阵
[ ] Case 阶段、结果、版本升级和事件状态机
[ ] Resume V1 → V2 只读转换与首次编辑流程
[ ] owner 保护 API、幂等、expectedRevision 与 Problem Details
[ ] PostgreSQL 任务类型、租约、迟到任务拒绝和删除竞态
[ ] expand 迁移顺序、旧应用兼容、回退与前向修复
[ ] 隔离 PostgreSQL 集成测试矩阵
[ ] “继续 / 修改 / 回退 / 停止”设计决定
```

没有隔离 PostgreSQL 环境时可以完成设计包，但不能通过 Phase 2 迁移 Gate。

## 7. 接手命令与排除项

```text
git branch --show-current
git status --short
git log -3 --oneline --decorate
rg --files packages/database apps/platform/src packages/contracts/src
```

不得读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机快照。已有改动属于 coco；若文档、代码和运行结果冲突，先记录并复现，不静默选择一方。
