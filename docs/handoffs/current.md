# 当前项目交接：Aijob Career OS M4-2B 数据真相与错误恢复

> 交接日期：2026-08-12
>
> 当前分支：`codex/career-os-phase-1`
>
> M4-2A Platform/Contracts：`e1ede50 feat(platform): add selective career asset deletion`
>
> M4-2A Web：`9cfe889 feat(web): add explicit career asset deletion controls`
>
> 后续精确 HEAD 以 `git log -1` 为准。
>
> 正常工作树预期只剩未跟踪 `.claude/`；不得读取、修改、暂存、覆盖或清理它。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

唯一活动计划：[Career OS 当前交付计划](../plans/career-os-current-delivery-plan.md)

最近验收：[M4-2A 单项删除与选择性级联](../evidence/product/career-os-v2/m4-2a-selective-deletion-acceptance-2026-08-12.md)

后续 Gate：[Private Alpha 与上线就绪 Gate](../plans/private-alpha-readiness-gates.md)

## 1. 当前唯一目标

当前唯一里程碑是 **M4 旧流程收口与测试候选**，当前唯一执行切片是 **M4-2B 数据真相与错误恢复**。

本切片只收口四个已证明会破坏本地测试可信度的缺口：

1. `/settings/data` 读取并展示当前 owner 的真实 `retentionMode`、到期时间和完整数据范围，包含从 Case 脱离后仍保留的 Resume、Interview 与 Debrief；匿名 owner 不得写成长期账号，account-managed owner 不得写成 30 天自动删除。
2. 简历确认必须把事实、偏好、结构化文档/证据和解析原文清除放在单个 PostgreSQL 事务中；任一 revision 冲突或写入失败时全部回滚，不能继续使用前端三个串行 PUT。
3. 会话失效后可以安全恢复读取，但 mutation 不自动重放；必须清理旧 owner 的 React Query/本地 journey 状态，保留用户尚未提交的界面草稿，并明确要求用户核对后再次提交。
4. 删除用户可见的 M1/M2/M3/Phase/PoC 开发标签；主导航只展示已经具备真实页面的入口，未实现的 Knowledge 和跨 Case Interview 索引不得继续以占位页伪装可用功能。

M4-2B 不实现邮箱验证码、账号认领或 account-managed 转换。它只诚实展示数据库当前模式，并修复本地匿名会话的真实错误路径。

## 2. 已通过基线与已知事实

- M1–M3 已完成真实 Case、Requirements、Resume V2/Review/导出、显式投递、确定性文字面试、反馈复盘和用户确认回流。
- M4-1 已停止 V2 正常路径中的旧 Match/Decision/Tailoring/Recommendation/Insight/official-link-opened 并行写入；旧数据没有删除，旗标关闭策略仍为 `legacy`。
- M4-2A 已接通 Case、Resume、Interview、Debrief 的 owner-protected 单项删除与 Case 选择性删除/脱离；全仓串行回归 736/736，lint 439、typecheck、build、audit 与 diff check 通过。
- M4-2A 删除命令使用 `expectedRevision`、墓碑和自然重放，不存在持久化 `Idempotency-Key` 删除回执；Case revision 递增，但没有伪造不存在的删除 Case event。后续文档与实现不得重新声称这两项能力。
- 脱离后的岗位简历已可从 `/resumes` 发现；脱离后的 Interview/Debrief 目前只有底层记录，没有跨 Case 用户索引。M4-2B 的数据范围必须显式展示并提供删除入口，或作出“修改”决定，不能把不可发现的数据称为已可管理。
- `DataControlPage` 仍写死“本机匿名、最长 30 天”，并只统计旧 Facts/Preferences/Evidence/Document/Decisions；这与现有长期 owner Schema 及 M1–M3 资产范围冲突。
- `ResumeConfirmPage` 当前依次执行 Facts、Preferences、Evidence 三个 PUT；中间失败会形成部分提交。
- `GET /v1/session` 当前只返回 `{ authenticated }`；Contracts 已有 `CareerOwnerSchema`，数据库已有 `retention_mode` 与 `retention_expires_at`，但当前页面没有真实投影。
- 项目前后端和 PostgreSQL 当前关闭；本轮 9 个精确命名隔离测试库已删除。需要集成测试时只启动项目 PostgreSQL，并使用随机命名的 `aijob_*_test_*` 隔离库。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位为 0。

## 3. 固定实现顺序

同一时间只允许一个检查点进行，不为 M4-2B 再派生未来后端：

1. **只读差异矩阵**：核对 owner/session 字段、全部资产表、脱离资产查询、Resume Confirmation 三次写入与原文清除顺序、401/403/409 行为和用户可见开发标签；先写最小契约与退出条件。
2. **数据真相**：增加最小 owner/data-scope 读取投影，按 owner epoch 统计当前可见 Facts、Preferences、Evidence、Resume Documents/Reviews、Cases、Interviews、Debriefs 及脱离资产；`/settings/data` 使用真实数据并保留全部删除入口。不要建设账号注册页。
3. **原子确认**：复用现有 profile/revision repository 与 Resume Analysis 清除逻辑，在一个事务中校验三个 expected revision、写入事实/偏好/文档/证据并清除原文；Web 只调用一个确认命令。旧三个 PUT 继续兼容其他现有调用，不做 contract migration。
4. **会话失效恢复**：集中识别 `SESSION_REQUIRED`/owner epoch 失效；读取最多安全重建一次本地匿名会话，写入绝不自动重放。owner 改变时清空旧缓存和 journey ID，页面显示“会话已更新，请核对后再次提交”。
5. **产品文案与入口**：移除用户界面中的 M1/M2/M3/Phase/PoC 字样；保留真实的今日、岗位、Case、简历和设置入口，隐藏尚无真实资产索引的 Knowledge/Interview 顶层入口，Case 内面试流程不受影响。
6. **Gate 与决定**：运行 focused Contracts/Platform/Web、随机隔离 PostgreSQL，再运行与改动相称的 lint、typecheck、串行 tests、build、audit 和 diff check。只有数据范围真实、确认不部分提交、会话不静默覆盖且旧旗标回退不变，才决定继续 M4-3。

## 4. 准备检查的代码入口

Identity / Data scope：

- `packages/contracts/src/identity.ts`
- `apps/platform/src/identity/fastify.ts`
- `apps/platform/src/identity/session-repository.ts`
- `apps/platform/src/profile/routes.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/pages/DataControlPage.tsx`

Resume confirmation：

- `packages/contracts/src/profile.ts`
- `apps/platform/src/profile/revision-repository.ts`
- `apps/platform/src/resume/repository.ts`
- `apps/platform/src/resume/routes.ts`
- `apps/web/src/pages/ResumeConfirmPage.tsx`
- `apps/web/src/product/resume-confirmation.ts`

Navigation / copy：

- `apps/web/src/App.tsx`
- `apps/web/src/career-os/navigation.ts`
- `apps/web/src/career-os/components/GlobalSidebar.tsx`
- `apps/web/src/career-os/pages/CareerOsHomePage.tsx`
- `apps/web/src/career-os/pages/CareerOsPlaceholderPage.tsx`
- `apps/web/src/career-os/components/DebriefConfirmationPanel.tsx`
- `apps/web/src/career-os/pages/CaseRequirementsWorkspace.tsx`
- `apps/web/src/career-os/pages/CaseResumeWorkspace.tsx`
- `apps/web/src/career-os/pages/CaseInterviewWorkspace.tsx`

## 5. M4-2B 退出条件

只有以下全部成立才可进入 M4-3：

1. 设置页显示当前 owner 的真实保留模式和到期时间；资产计数覆盖 M1–M3、新旧兼容资产及脱离 Case 的资产，未知或尚未实现的账号能力不被伪造。
2. 脱离后的 Resume、Interview、Debrief 都能从数据范围发现并由 owner 单项删除；跨 owner 仍为不可枚举 404。
3. 简历确认任一 revision 冲突或内部失败时 Facts、Preferences、Document/Evidence 与解析原文均保持原状；成功时四类结果一次提交且原文按边界清除。
4. 会话失效不自动重放 mutation、不沿用旧 owner 缓存；用户草稿不被静默丢弃，重新建立会话后的首次写入需要再次明确操作。
5. 用户可见页面不再出现 M1/M2/M3/Phase/PoC 开发标签；主导航不再暴露只有占位文案的功能；旗标关闭时旧 ProductShell 不变。
6. focused 与全仓工程检查通过，并记录继续 M4-3、修改、回退或停止之一。

## 6. 固定排除

- 不访问真实招聘来源、真实 JD、真实 AI、真实简历、邮件、服务器或参与者数据。
- 不实现邮箱验证码、手机号、账号认领、Knowledge、跨 Case 智能生成、语音/音视频面试、自动投递或站外通知。
- 不新增数据库、migration、Redis、向量库、第二套队列、第二套认证或新的 AI SDK。
- 不做 G4 前 contract migration，不删除无法证明已迁移的旧资产，不移除 `VITE_CAREER_OS_V2` 回退路径。
- 不读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地业务数据库、下载产物或本机截图。

## 7. 接手检查表

1. 按顺序读取 `AGENTS.md`、`README.md`、`docs/06-mvp-roadmap.md`、本文件和 `docs/plans/README.md`。
2. 检查分支、HEAD、`git status` 和最近提交；已有改动不得覆盖，`.claude/` 不得处理。
3. 确认路线图、当前交付计划和本交接都只指向 M4-2B；归档计划和历史验收不得提供当前任务。
4. 先完成只读差异矩阵，不以新增账号系统、未来跨 Case 中心或 migration 解决当前诚实性问题。
5. 所有 PostgreSQL 测试使用随机隔离库；结束后按精确库名清理并关闭项目容器。
