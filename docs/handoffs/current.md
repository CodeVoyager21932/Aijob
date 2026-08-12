# 当前项目交接：Aijob Career OS M4 旧流程收口与测试候选

> 交接日期：2026-08-12
>
> 当前分支：`codex/career-os-phase-1`
>
> M3 总 Gate 修复：`d3177ed fix(career-os): close m3 workflow acceptance gaps`
>
> M3 总验收文档：`4a8ca91 docs(evidence): accept m3 workflow gate`
>
> 后续精确 HEAD 以 `git log -1` 为准。
>
> 正常工作树预期只剩未跟踪 `.claude/`；不得读取、修改、暂存、覆盖或清理它。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

唯一活动计划：[Career OS 当前交付计划](../plans/career-os-current-delivery-plan.md)

当前设计证据：[M4-0 旧入口与一岗闭环差异审计](../plans/career-os-m4-legacy-entry-and-one-job-gap-audit-2026-08-12.md)

最近总验收：[M3 投递、文字面试、复盘与用户确认回流](../evidence/product/career-os-v2/m3-workflow-acceptance-2026-08-12.md)

后续 Gate：[Private Alpha 与上线就绪 Gate](../plans/private-alpha-readiness-gates.md)

## 1. 当前唯一目标

当前唯一里程碑是 **M4 旧流程收口与测试候选**，当前唯一执行切片是 **M4-1 兼容入口与写边界**。

M4-0 已完成只读审计并决定“修改后继续”。M4-1 只隔离 V2 与旧流程的并行写入，不实现删除服务、邮箱、真实 AI、真实来源或未来 OS 模块。不得从旧 Phase 2B、历史 G4-first 总计划、旧验收文档中的“下一步”或对话摘要生成任务。

固定结果：

- V2 下 `/jobs/:jobId` 只保留岗位事实、外链和幂等创建/重开 Case；不再调用旧 Match、Decision、Tailoring 或 official-link-opened mutation。
- V2 下 `/recommendations`、`/insights` 只显示零请求兼容说明；旧运行不删除。
- V2 下 `/resume-tailorings/:runId` 只读显示用户历史，不保存新决定或创建新导出。
- `/resume` 与确认页继续承担共享解析/事实/证据入口，但 V2 的所有完成和已确认出口进入 `/resumes`。
- `/data-control*` 无损进入 `/settings/data*`；旗标关闭时旧 ProductShell、旧路由和旧写入完全不变。

M4-1 不删除旧页面、迁移数据、改 Schema 或用页面隐藏冒充单项删除。M4-2A 才接删除服务。

## 2. 已通过工程与审计基线

- M1 已完成真实公共/私有 Case、Requirements 三态/备注/证据/问题及 Case-derived Resume 创建和恢复。
- M2 已完成 Resume V2、V1 只读转换、结构与岗位派生编辑、确定性 Review、两种中文模板、A4 预览、隔离打印和 DOCX。
- M3 已完成显式投递记录、确定性文字面试、结构化反馈/复盘和用户逐项确认回流；完整工程与浏览器 Gate 通过。
- M3 最终串行回归为 Config 17、Contracts 71、Database 54、Platform 458、Web 125，共 725/725；Web main chunk 为 558.27 kB，相对 Phase 1A 增长约 9.3%。
- M4-0 已确认 `/resume` 不能直接删除；它仍是 `/resumes` 所依赖的唯一解析/确认和 V1 来源入口。旧 Tailoring 含用户编辑历史，V2 只能只读保留。
- M4-0 已确认当前匿名 owner 运行时仍为 30 天 `anonymous_ttl`，只有 `account_managed` owner 才长期；页面同时存在固定长期和固定 30 天的矛盾文案。该数据真相由 M4-2B 修复，M4-1 不伪造账号长期保存。
- 全部 owner 删除已经覆盖 M1–M3 新旧表；单项 Case/Resume/Interview/Debrief 的 `deleted_at` 与 detach guard 已存在，但 Service/API/UI 尚未接入，由 M4-2A 守门。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 可用岗位均为 0。
- 项目前后端与 PostgreSQL 容器当前关闭，端口 3000、5173、5432 未监听。

## 3. M4-1 代码入口

路由与壳层：

- `apps/web/src/App.tsx`
- `apps/web/src/environment.ts`
- `apps/web/src/career-os/navigation.ts`
- `apps/web/src/career-os/pages/CareerOsPlaceholderPage.tsx`

旧入口与岗位交接：

- `apps/web/src/pages/JobDetailPage.tsx`
- `apps/web/src/pages/ResumePage.tsx`
- `apps/web/src/pages/ResumeConfirmPage.tsx`
- `apps/web/src/pages/RecommendationsPage.tsx`
- `apps/web/src/pages/JobInsightsPage.tsx`
- `apps/web/src/pages/ResumeTailoringPage.tsx`
- `apps/web/src/pages/DataControlPage.tsx`
- `apps/web/src/pages/DeletionStatusPage.tsx`

API 与测试：

- `apps/web/src/api/product.ts`
- `apps/web/src/api/career-os.ts`
- `apps/web/src/career-os/runtime-boundary.test.ts`
- `apps/web/src/pages/JobDetailPage.test.ts`
- `apps/web/src/pages/RecommendationsPage.test.tsx`
- `apps/web/src/pages/ResumePage.test.ts`
- `apps/web/src/environment.test.ts`
- `apps/web/src/career-os/navigation.test.ts`

M4-1 默认不修改 Platform、Contracts、Database 或 migrations；若前端无法在不改契约的情况下停止旧写入，必须先记录阻断并作“修改”决定。

## 4. M4-1 退出条件

只有以下全部成立才可进入 M4-2A：

1. V2 正常路由不会触发旧 Match/Decision/Tailoring/Recommendation/Insight/official-link-opened 写入。
2. `/resume` 与确认仍能建立共享事实和 V1 只读来源，所有 V2 出口进入 `/resumes`，没有循环或丢失资料。
3. 旧 Tailoring 用户编辑历史可 owner-scoped 只读，未被猜测绑定 Case；旧数据库内容没有删除。
4. `/data-control*` 进入 `/settings/data*`；旗标关闭的旧壳层、路由、写入和文案保持现状。
5. focused tests、lint、typecheck、build 和 `git diff --check` 通过，并记录继续、修改、回退或停止决定。

## 5. 固定排除

- 不访问真实招聘来源、真实 JD、真实 AI、真实简历、邮件、服务器或参与者数据。
- 不实现 Knowledge、语音/音视频面试、自动投递、站外通知、社区或未来智能生成。
- 不新增数据库、Redis、向量库、第二套队列、第二套认证、通用富文本编辑器或新的 AI SDK。
- 不在 M4-1 删除页面、做 contract migration、重写数据、实现单项删除或顺手扩建后端。
- 不读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地业务数据库、下载产物或本机截图。

## 6. 接手检查表

1. 按顺序读取 `AGENTS.md`、`README.md`、`docs/06-mvp-roadmap.md`、本文件和 `docs/plans/README.md`。
2. 检查分支、HEAD、`git status` 和最近提交；已有改动不得覆盖，`.claude/` 不得处理。
3. 确认路线图、当前交付计划和本交接都只指向 M4-1；归档计划和历史验收不得提供当前任务。
4. 确认项目服务与容器关闭；先运行无需 PostgreSQL 的 focused Web 测试，浏览器验收再使用随机隔离库。
5. 只实现审计矩阵固定的前端写边界；不得提前进入 M4-2A 删除服务或 M4-2B 身份/保留模式。
