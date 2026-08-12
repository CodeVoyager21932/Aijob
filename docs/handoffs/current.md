# 当前项目交接：Aijob Career OS M4-2A 单项删除与选择性级联

> 交接日期：2026-08-12
>
> 当前分支：`codex/career-os-phase-1`
>
> M4-0 审计：`cb0b245 docs(plan): accept m4 legacy route audit`
>
> M4-1 代码：`84ebe34 feat(web): isolate legacy career os writes`
>
> 后续精确 HEAD 以 `git log -1` 为准。
>
> 正常工作树预期只剩未跟踪 `.claude/`；不得读取、修改、暂存、覆盖或清理它。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

唯一活动计划：[Career OS 当前交付计划](../plans/career-os-current-delivery-plan.md)

当前审计基线：[M4-0 旧入口与一岗闭环差异审计](../plans/career-os-m4-legacy-entry-and-one-job-gap-audit-2026-08-12.md)

最近验收：[M4-1 兼容入口与写边界](../evidence/product/career-os-v2/m4-1-legacy-write-boundary-acceptance-2026-08-12.md)

后续 Gate：[Private Alpha 与上线就绪 Gate](../plans/private-alpha-readiness-gates.md)

## 1. 当前唯一目标

当前唯一里程碑是 **M4 旧流程收口与测试候选**，当前唯一执行切片是 **M4-2A 单项删除与选择性级联**。

只为以下当前资产接真实 owner-protected 删除：

- ApplicationCase。
- Resume Document V2。
- Interview Session。
- Debrief。

删除 Case 时，必须让用户分别决定其派生 Resume、Interview 与 Debrief 是“同时删除”还是“保留并脱离 Case”；不得使用数据库物理级联替用户作决定。私有 JD 只能对当前 owner 可见，最后一个引用它的 Case 删除后不得留下可访问正文。

所有命令必须使用 `expectedRevision`、稳定幂等键、CSRF、`no-store` 和不可枚举跨 owner 404。删除后同一 owner 刷新、重新建立会话、重放旧幂等键或收到迟到任务时，资产不得重新可见或被继续写入。

M4-2A 不处理账号/邮箱、真实保留模式、简历确认原子化、会话失效总线或开发标签清理；这些仍属于 M4-2B。

## 2. 已通过基线

- M1–M3 已完成真实 Case、Requirements、Resume V2/Review/导出、显式投递、确定性文字面试、反馈复盘和用户确认回流。
- M4-0 已确认旧 `/resume` 必须保留为共享解析入口，旧 Tailoring 必须保留只读历史。
- M4-1 已停止 V2 正常路径中的旧 Match/Decision/Tailoring/Recommendation/Insight/official-link-opened 并行写入；旧数据没有删除，旗标关闭策略保持 `legacy`。
- M4-1 Web 完整回归 33 files、131/131；typecheck、lint 436、build 和 diff check 通过。主包 560.59 kB，相对 M3 增长约 0.42%。
- 全部 owner 删除 `DELETE /v1/profile` 已覆盖 M1–M3 新旧数据，但不能替代本切片的单项删除。
- Schema 已有 Case、Resume Document、Interview Session、Debrief 的 `deleted_at`；派生 Resume、Interview 与 Debrief 已有 `detached_from_case_id` 和只允许从当前 Case 脱离一次的数据库 guard。当前缺口是公开 Contract、Service、Route 与 Web 确认界面。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位为 0。
- 项目前后端和 PostgreSQL 当前关闭；需要集成测试时只启动项目 PostgreSQL，并使用随机命名的 `aijob_*_test_*` 隔离库。

## 3. 固定实现顺序

1. 先逐表核对 FK、状态/修订 guard、Review/Export/Turn/Feedback/Debrief 依赖与现有全部删除顺序，形成命令到数据动作矩阵；不新增 migration。
2. 在现有 Contracts 中增加最小删除请求与结果，固定 `expectedRevision` 和 Case 的三类 `delete | detach` 选择；先补解析测试。
3. 在现有 Platform 模块中用单个 PostgreSQL 事务锁定 owner 资产、校验 revision、执行墓碑/脱离、处理私有 JD 最后引用，并记录必要的不可变 Case event；先补集成测试再注册路由。
4. 在 Career OS API/query keys 中接删除命令；mutation 不自动重试，409 保留用户选择并重读，404 回到真实不存在状态。
5. 在 Case、Resume、Interview 与 Debrief 当前页面增加明确删除入口。Case 确认界面逐类说明删除/脱离结果；默认不替用户选择，不使用模糊“清理”文案。
6. 运行 focused Contracts/Platform/Web、隔离 PostgreSQL，再运行与变更相称的全仓 Gate。只有删除后不复活和旗标回退通过，才更新到 M4-2B。

## 4. 代码入口

Contracts：

- `packages/contracts/src/application-cases.ts`
- `packages/contracts/src/resume-documents.ts`
- `packages/contracts/src/interview-debrief-knowledge.ts`
- 对应 `.test.ts`

Platform：

- `apps/platform/src/applications/service.ts`
- `apps/platform/src/applications/routes.ts`
- `apps/platform/src/applications/routes.integration.test.ts`
- `apps/platform/src/resume-documents/service.ts`
- `apps/platform/src/resume-documents/routes.ts`
- `apps/platform/src/resume-documents/routes.integration.test.ts`
- `apps/platform/src/interviews/service.ts`
- `apps/platform/src/interviews/debrief-service.ts`
- `apps/platform/src/interviews/routes.ts`
- `apps/platform/src/interviews/routes.integration.test.ts`

Web：

- `apps/web/src/api/career-os.ts`
- `apps/web/src/career-os/pages/ApplicationsPage.tsx`
- `apps/web/src/career-os/pages/CaseWorkspacePage.tsx`
- `apps/web/src/career-os/pages/ResumeAssetsPage.tsx`
- `apps/web/src/career-os/pages/CaseInterviewWorkspace.tsx`
- `apps/web/src/career-os/components/CaseHeader.tsx`
- 相关 query/view/component tests

## 5. M4-2A 退出条件

只有以下全部成立才可进入 M4-2B：

1. Case、Resume、Interview、Debrief 均可由 owner 单项删除，并立即从列表、详情和后续写入中消失。
2. Case 删除对三类派生资产逐类执行用户所选的删除或脱离；脱离资产不再反向依赖已删除 Case，保留其固定岗位/证据来源且不会伪造成新的 Case。
3. 跨 owner 返回不可枚举 404；stale revision 返回标准 409；幂等重放返回同一结果，同键不同请求明确冲突；CSRF 与 `no-store` 通过。
4. 私有 JD 不进入公共目录；最后引用删除后不留下 owner 可读正文。删除、刷新、重登、旧命令重放和迟到任务均不复活数据。
5. 功能旗标关闭的旧 ProductShell 与旧数据不受影响；没有 migration、第二套删除队列或隐式物理级联。
6. focused 与全仓工程检查通过，并记录继续 M4-2B、修改、回退或停止之一。

## 6. 固定排除

- 不访问真实招聘来源、真实 JD、真实 AI、真实简历、邮件、服务器或参与者数据。
- 不实现 Knowledge、语音/音视频面试、自动投递、站外通知、社区或未来智能生成。
- 不新增数据库、migration、Redis、向量库、第二套队列、第二套认证或新的 AI SDK。
- 不在 M4-2A 修改匿名 30 天兼容 TTL、实现邮箱账号、原子简历确认或清理导航标签。
- 不读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地业务数据库、下载产物或本机截图。

## 7. 接手检查表

1. 按顺序读取 `AGENTS.md`、`README.md`、`docs/06-mvp-roadmap.md`、本文件和 `docs/plans/README.md`。
2. 检查分支、HEAD、`git status` 和最近提交；已有改动不得覆盖，`.claude/` 不得处理。
3. 确认路线图、当前交付计划和本交接都只指向 M4-2A；归档计划和历史验收不得提供当前任务。
4. 先完成只读 FK/guard/依赖矩阵，再写 Contract；如果既有 Schema 无法表达用户选择，记录阻断并作“修改”决定，不顺手增加 migration。
5. 所有 PostgreSQL 测试使用随机隔离库；结束后按精确库名清理并关闭项目容器。
