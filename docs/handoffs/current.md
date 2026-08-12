# 当前项目交接：Aijob Career OS M4 旧流程收口与测试候选

> 交接日期：2026-08-12
>
> 当前分支：`codex/career-os-phase-1`
>
> M3 总 Gate 修复：`d3177ed fix(career-os): close m3 workflow acceptance gaps`
>
> 文档提交后的精确 HEAD 以 `git log -1` 为准。
>
> 正常工作树预期只剩未跟踪 `.claude/`；不得读取、修改、暂存、覆盖或清理它。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

唯一活动计划：[Career OS 当前交付计划](../plans/career-os-current-delivery-plan.md)

后续 Gate：[Private Alpha 与上线就绪 Gate](../plans/private-alpha-readiness-gates.md)

计划索引：[docs/plans](../plans/README.md)

最近总验收：[M3 投递、文字面试、复盘与用户确认回流](../evidence/product/career-os-v2/m3-workflow-acceptance-2026-08-12.md)

## 1. 当前唯一目标

当前唯一里程碑是 **M4 旧流程收口与测试候选**，当前唯一执行切片是 **M4-0 旧入口与一岗闭环差异审计**。

M4-0 只做只读审计和可复现检查，不修改业务行为。输出一张旧入口与新 Case 闭环的处置矩阵，为 M4-1 固定最小改动范围。不得从旧 Phase 2B、历史 G4-first 总计划、旧验收文档中的“下一步”或对话摘要生成任务。

审计矩阵固定包含：

- 路由与用户任务。
- 当前壳层、读取接口、写入接口和事实真源。
- 与 Case 工作区的功能重复或能力缺口。
- 功能旗标开启/关闭时的实际行为。
- 删除、404、409、会话失效和失败恢复行为。
- 唯一处置：保留为当前新入口、兼容跳转/引导、保留只读历史，或只在旗标关闭时保留。

M4-0 不直接删除旧页面、迁移数据或增加未来能力。只有矩阵完成并确认每条路径的真源与处置后，才进入 M4-1。

## 2. 已通过工程基线

- M1 已完成真实公共/私有 Case、Requirements 三态/备注/证据/问题及 Case-derived Resume 创建和恢复。
- M2 已完成 Resume V2、V1 只读转换、结构与岗位派生编辑、确定性 Review、两种中文模板、A4 预览、隔离打印和 DOCX。
- M3 已完成显式投递记录、确定性文字面试、结构化反馈/复盘和用户逐项确认回流；打开外链不会自动标记已投递，确认不会创建经历或覆盖职业资产。
- M3 最终串行 Gate：Config 17、Contracts 71、Database 54、Platform 458、Web 125，共 725/725；lint、typecheck、build、audit 和 `git diff --check` 通过。
- M3 浏览器全链路在合成数据和隔离 PostgreSQL 上通过刷新、深链、前进/后退、revision conflict、1280/320 CSS px、200% 等效视口、焦点返回、旗标回退和控制台检查。
- Web main chunk 为 558.27 kB，相对 Phase 1A 510.96 kB 增长约 9.3%；Resume、Interview、Requirements 工作区继续独立懒加载。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 可用岗位均为 0。工程 Gate 不冒充用户价值或供给 Gate。
- M3 测试数据库和临时浏览器环境已清理；项目服务与 PostgreSQL 容器应保持关闭，需验证时再显式启动。

## 3. M4-0 审计入口

必须覆盖的旧入口：

- `/resume`、`/resume/confirm/:analysisId`
- `/recommendations`
- `/insights`
- `/resume-tailorings/:runId`
- `/resumes`、`/resumes/:documentId`

必须对照的 Case 闭环：

- `/applications/:caseId/requirements`
- `/applications/:caseId/resume`
- `/applications/:caseId/application`
- `/applications/:caseId/interview`
- `/applications/:caseId/debrief`

主要 Web 入口：

- `apps/web/src/App.tsx`
- `apps/web/src/components/ProductShell.tsx`
- `apps/web/src/career-os/navigation.ts`
- `apps/web/src/pages/ResumePage.tsx`
- `apps/web/src/pages/ResumeConfirmPage.tsx`
- `apps/web/src/pages/RecommendationsPage.tsx`
- `apps/web/src/pages/JobInsightsPage.tsx`
- `apps/web/src/pages/ResumeTailoringPage.tsx`
- `apps/web/src/pages/DataControlPage.tsx`
- `apps/web/src/pages/JobListPage.tsx`
- `apps/web/src/pages/JobDetailPage.tsx`
- `apps/web/src/career-os/pages/ResumeAssetsPage.tsx`
- `apps/web/src/career-os/pages/CaseResumeWorkspace.tsx`
- `apps/web/src/career-os/pages/CaseRequirementsWorkspace.tsx`
- `apps/web/src/api/product.ts`
- `apps/web/src/api/career-os.ts`

主要 Platform 入口：

- `apps/platform/src/resume/routes.ts`
- `apps/platform/src/resume-documents/routes.ts`
- `apps/platform/src/tailoring/routes.ts`
- `apps/platform/src/insights/routes.ts`
- `apps/platform/src/decisions/routes.ts`
- `apps/platform/src/decisions/service.ts`
- 个人数据删除、保留期和墓碑相关路由及服务。

## 4. M4-0 退出条件

只有以下全部成立才可进入 M4-1：

1. 每个旧入口和 Case 入口都有明确用户任务、读取/写入接口、唯一事实真源和处置决定。
2. 已识别所有重复功能、不可无损迁移的历史记录和隐藏写入路径。
3. 删除、404、409、会话失效、旗标回退和空/失败状态的缺口形成可复现清单。
4. M4-1 被压缩为不超过 0.5 个有效开发日的兼容改动，不提前实现 M4-2 至 M4-4。
5. 作出且记录“继续、修改、回退、停止”之一；默认不是自动继续。

## 5. 固定排除

- 不访问真实招聘来源、真实 JD、真实 AI、真实简历、邮件、服务器或参与者数据。
- 不实现 Knowledge、语音/音视频面试、自动投递、站外通知、社区或未来智能生成。
- 不新增数据库、Redis、向量库、第二套队列、第二套认证、通用富文本编辑器或新的 AI SDK。
- 不在 M4-0 删除页面、做 contract migration、重写数据或顺手扩建后端。
- 不读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地业务数据库、下载产物或本机截图。

## 6. 接手检查表

1. 按顺序读取 `AGENTS.md`、`README.md`、`docs/06-mvp-roadmap.md`、本文件和 `docs/plans/README.md`。
2. 检查分支、HEAD、`git status` 和最近提交；已有改动不得覆盖，`.claude/` 不得处理。
3. 确认路线图、当前交付计划和本交接都只指向 M4-0；归档计划和历史验收不得提供当前任务。
4. 确认项目服务与容器关闭；M4-0 默认不需要启动数据库或前后端。
5. 只读检查上述入口并形成处置矩阵；没有矩阵前不得开始兼容迁移或删除。
