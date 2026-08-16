# 当前项目交接：OS-5 已关闭，OS-6 待开始

> 交接日期：2026-08-16
>
> 当前分支：`codex/career-os-ux-convergence`
>
> OS-5 起始 HEAD：`3158b0b feat(career-os): close os4 pinned case matching`
>
> 精确 HEAD、远端跟踪与工作树以 `git log -1`、`git status` 为准。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

当前执行计划：[Career OS 前后端同步改进计划](../plans/career-os-current-delivery-plan.md)

稳定实施契约：[Career OS 端到端体验与系统契约](../14-career-os-end-to-end-experience-contract.md)

当前追踪矩阵：[UX-0 页面—系统—证据追踪矩阵](../plans/career-os-ux-0-end-to-end-traceability-matrix.md)

上一切片关闭证据：[OS-5 Resume Studio 与唯一 Review 写入验收](../evidence/product/career-os-v2/os-5-resume-studio-and-review-v2-acceptance-2026-08-16.md)

上游关闭证据：[OS-4 单 Case 决策与固定版本匹配验收](../evidence/product/career-os-v2/os-4-case-decision-and-pinned-match-acceptance-2026-08-14.md)

## 1. 当前决定

coco 要求每个纵向切片同步关闭 Contract、Database/Platform、Web、Integrated Gate 与 Evidence，不做前端或后端单层优化。

**OS-5 Resume Studio 与唯一 Review 写入已经按五项状态关闭。基础/岗位简历、固定 Requirements、Review v1/v2、逐建议决定、DOCX/打印和旧 Tailoring 历史只读现在从同一规范 Resume Studio 可用；Review 是 template 与受控 AI 的唯一新写入所有者。当前决定为“完成 OS-5，进入 OS-6 准备”；OS-6 尚未实施，等待 coco 明确指令。**

不得从 PA-1、旧 M4、历史 Phase 2、旧 R2、供给扩容或 Private Alpha Gate 自动选择任务。

## 2. 可信工程与产品基线

- M1–M4、PA-1、UX-0 与 OS-1–OS-5 已完成；这只代表对应本地工程与体验 Gate。
- OS-5 最终全仓 Config 20、Contracts 86、Database 54、Platform 466、Web 165，共 791/791。
- `pnpm lint` 480 files、typecheck、build、标准 audit、全新隔离 PostgreSQL、四视口真实 API 浏览器 Gate 与 diff check 均通过。
- Web main 400.47 kB（gzip 116.74 kB）；Resume Editor 40.79 kB（gzip 12.57 kB）、Case Resume Workspace 6.21 kB、Interview 23.76 kB，重工作区保持 lazy load；主包较 OS-4 增加 2.67 kB。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- 工程闭环、合成满态和视觉验收均不得冒充用户价值、真实供给、生产或 Private Alpha 就绪。

### 当前本机运行状态（2026-08-16 OS-5 清理后核验）

- `127.0.0.1:3000`、`127.0.0.1:5173`、`127.0.0.1:5174`、`127.0.0.1:5432` 均未监听。
- `aijob_os5_test_20260816_f057_browser`、`aijob_os5_test_20260816_f057_final`、任务临时运行目录、Platform、V2 Web、flag-off Web 与项目 PostgreSQL 均已清理或停止。
- 浏览器成功路径没有 console warning/error 或外部请求；只注入预期的 503、409、403 与 404。未生成截图。
- 运行边界继续保持离线：不访问真实招聘来源、真实 AI、真实邮件、真实简历或远程服务器。

## 3. OS-5 已关闭结果

1. **Contract 通过**：Review Run v1/v2 strict union；创建请求为 template 或带本次明确同意的 controlled AI；Current/Create 响应返回固定 Requirements；v2 Finding/Suggestion 带 requirement IDs，Run 带 provenance/failure/fallback。
2. **Database 通过**：migration 033 expand-only 扩展现有 Review 聚合和 `resume_review_v2` 任务类型；legacy v1 不伪造 provenance，public/private requirement 引用在数据库验证并包含 owner epoch，生成输入/结果有不可变 guard。`down` no-op；出现 v2 Run 后禁止回滚 pre-v2 代码，只能前向修复。
3. **Platform/Worker 通过**：v1/v2 双读、双 handler；旧 Worker 不领取 v2。template/controlled AI 都读取固定 Requirements、内容修订和确认证据；provider 在事务外调用，写回前重验 lease/owner/epoch/状态/requirements。旧 Tailoring 不恢复写入。
4. **Web 通过**：左结构/版本/证据、中 A4 文稿、右 Requirements/引用/建议三栏；窄屏“结构 / 文稿 / 建议”模式 URL 可恢复。草稿站内导航/后退保护、409 保稿、session mutation 不重放、逐建议接受/编辑后采用/拒绝、controlled AI 同意和 fallback 明示均已接入。
5. **Integrated Gate 通过**：真实 Platform API、PostgreSQL、Worker 与 1536/1280/768/320 浏览器覆盖 public/private Requirements、template Review、模拟受控 AI/`AI_DISABLED`、owner/404/409/session、删除、DOCX、打印、deep link、lazy load 与 flag 回退；网络仅 loopback。
6. **Evidence 通过**：独立证据、README、路线图、计划索引、当前计划、追踪矩阵、稳定契约、证据索引和本交接已同步；决定只关闭 OS-5。

### 最终复核说明

- 最后的 owner-epoch 加固同时落在 private requirement 的数据库 guard 和 Platform 读取条件；全新库完整 791/791 在该最终代码上通过。
- 浏览器 Gate 返回 `passed: true`、三项 Review 决定、`AI_DISABLED` fallback 和四个固定视口；没有真实 provider、真实岗位或成功响应 mock。
- 标准 `pnpm audit:ci` 已在本轮同一未变依赖图上退出码 0，只有 1 个既有 high 由仓库基线忽略；一次附加不支持的 `--offline` 参数只产生 CLI 参数错误，未被计入通过。

## 4. 下一候选切片与未完成边界

OS-6 `投递、面试、复盘与数据控制` 尚未实施。它只在 coco 明确继续后启动，固定方向来自当前计划和追踪矩阵，而不是本交接自动生成任务：

- 收敛 `/today`、显式投递、面试、复盘、数据设置、访问状态、选择性/全部删除与兼容 URL。
- 保持“打开官方页面不等于已投递”，只有用户显式记录才写 application event。
- 面试继续使用确定性模板；复盘只有确认后才能回流，不能由页面或模型自动写职业资产。
- 同步覆盖 owner/404、revision 409、幂等、session mutation 不重放、删除后不可读、刷新/深链/历史、四视口、lazy load 和 flag 回退。

以下仍明确未完成：

- OS-6 投递/面试/复盘/数据控制收敛与 OS-7 系统总 Gate。
- 真实供给、真实 AI、真实邮件、解析镜像、服务器、参与者和 Private Alpha。

## 5. 主要代码入口

- `packages/contracts/src/resume-documents.ts`：OS-5 Review v1/v2、创建请求、provenance、requirement citation 契约。
- `packages/database/src/migrations/033_resume_review_v2_expand.ts`、`packages/database/src/types.ts`：expand-only migration、固定引用与不可变 guard。
- `apps/platform/src/resume-documents/review-service.ts`、`routes.ts`：唯一 Review 写入、固定 Requirements、template/controlled AI 与错误语义。
- `apps/platform/src/workers/owner-task-worker.ts`：`resume_review` / `resume_review_v2` 双 handler 与旧 Worker fail-closed 边界。
- `apps/web/src/career-os/components/ResumeDocumentEditor.tsx`、`ResumeReviewPanel.tsx`：三栏 Studio、URL 状态、草稿与逐建议交互。
- `apps/web/src/career-os/components/ResumeDraftNavigationGuard.tsx`、`SessionMutationRecoveryNotice.tsx`：导航草稿和 session mutation 不重放反馈。
- `apps/web/scripts/os5-browser-gate.cjs`：OS-5 loopback 浏览器回归脚本，不是产品演示模式。
- OS-6 入口以当前计划中 `/today`、Case application/interview/debrief、`/settings/data*` 及对应 Contracts/Platform 模块为准；开始前重新做逐用例核验。

## 6. 固定排除与数据安全

- 不访问真实招聘来源、真实 AI、真实邮件、服务器、参与者或真实简历，不获取外部解析镜像。
- 不新增第二套数据库、BFF、Redis、向量库、消息总线、认证或 AI SDK，不移除 `VITE_CAREER_OS_V2`。
- 不读取、修改、暂存、覆盖、清理或提交 `.claude/`、`.data/`、密钥、令牌、真实简历原文、本地业务数据库、下载产物或截图。
- 测试数据库必须全新且匹配 `aijob_*_test_*`，只写合成数据；浏览器和服务只允许 loopback。
- Private Alpha Gate 只用于守门，不得从中生成当前任务。

## 7. 新任务接手检查表

1. 依次读取 `AGENTS.md`、`README.md`、路线图、本交接、计划索引、当前交付计划和 OS-5 证据。
2. 核对分支、HEAD、远端跟踪、tracked 工作树、最近提交、容器和 3000/5173/5174/5432；冲突先报告。
3. 不重复 UX-0 或 OS-1–OS-5，不从 OS-7 或 Private Alpha 抢跑。只有 coco 明确继续后才开始 OS-6。
4. OS-6 仍按 `Contract → Database/Platform → Web → Integrated Gate → Evidence` 串行关闭，不能只迁页面或只扩后端。
5. OS-5 的 Review v1/v2 兼容、migration/rollback、唯一写入、旧 Tailoring 只读、runtime parse、草稿保护、lazy load 和真实 AI 关闭必须作为回归基线。
6. OS-6 五项状态全部通过并追加独立证据后，只作继续 OS-7、修改、回退或停止之一。
