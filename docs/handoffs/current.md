# 当前项目交接：OS-2 已关闭，OS-3 申请看板与 Case 命令待开始

> 交接日期：2026-08-13
>
> 当前分支：`codex/career-os-ux-convergence`
>
> OS-2 起始 HEAD：`f57d6cb feat(career-os): close os1 shell runtime contract`
>
> 精确 HEAD 与工作树以 `git log -1`、`git status` 为准。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

当前执行计划：[Career OS 前后端同步改进计划](../plans/career-os-current-delivery-plan.md)

稳定实施契约：[Career OS 端到端体验与系统契约](../14-career-os-end-to-end-experience-contract.md)

当前追踪矩阵：[UX-0 页面—系统—证据追踪矩阵](../plans/career-os-ux-0-end-to-end-traceability-matrix.md)

上一切片关闭证据：[OS-2 资料准备与可信岗位入口验收](../evidence/product/career-os-v2/os-2-profile-and-trusted-job-entry-acceptance-2026-08-13.md)

上游关闭证据：[OS-1 系统外壳与运行契约验收](../evidence/product/career-os-v2/os-1-system-shell-and-runtime-contract-acceptance-2026-08-13.md)

## 1. 当前决定

coco 已要求 Career OS 不做前端独立优化，也不默认后端匹配；每个纵向切片必须同步关闭 Contract、Database/Platform、Web、Integrated Gate 与 Evidence。

**OS-2 资料准备与可信岗位入口已经按五项状态关闭。V2 规范岗位目录/详情、服务器派生推荐、市场洞察、简历导入/确认、从岗位创建 Case 与 URL 恢复已接入同一 Career OS；推荐冻结与 owner/session/runtime schema 语义由 Platform 和共享 Contracts 承担。当前决定为“完成 OS-2，进入 OS-3 准备”；OS-3 尚未实施，等待 coco 明确指令。**

不得从 PA-1、旧 M4、历史 Phase 2、旧 R2、供给扩容或 Private Alpha Gate 自动选择任务。

## 2. 可信工程与产品基线

- M1–M4、PA-1、UX-0、OS-1 与 OS-2 已完成；这只代表对应本地工程与体验 Gate。
- OS-2 最终全仓 Config 20、Contracts 82、Database 54、Platform 462、Web 150，共 768/768。
- `pnpm lint` 466 files、typecheck、build、audit、全新隔离 PostgreSQL、四视口真实 API 浏览器 Gate 和 diff check 已通过。
- 第一次 Platform 全量中 `public-version-pointer.integration.test.ts` 在 30 秒上限暂态超时；同库单文件 9.35 秒通过。精确重建验证库后的完整第二轮 462/462，该用例 684 ms。此暂态反证已写入 OS-2 证据，没有隐藏或放宽 Gate。
- Web main 394.47 kB（gzip 115.29 kB）；Resume Editor 29.38 kB、Interview 23.76 kB、数据设置 12.35 kB，重工作区保持 lazy load。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- 工程闭环、合成满态和视觉验收均不得冒充用户价值、真实供给、生产或 Private Alpha 就绪。

### 当前本机运行状态（2026-08-13 OS-2 清理后核验）

- `127.0.0.1:3000`、`127.0.0.1:5173`、`127.0.0.1:5174`、`127.0.0.1:5432` 均未监听。
- 精确测试库 `aijob_os2_test_20260813_f057`、`aijob_os2_verify_test_20260813_f057` 与空临时目录已删除；Platform、V2 Web、flag-off Web、PostgreSQL、项目容器与网络均已停止或移除。
- 浏览器成功路径没有 console warning/error 或外部请求；仅刻意注入目录 503 和跨 owner 404。未生成截图。
- 运行边界继续保持离线：不得访问真实招聘来源、真实 AI、真实邮件、真实简历或远程服务器。

## 3. OS-2 已关闭结果

1. **Contract 通过**：新增推荐 search scope/view、资料当前态和一次性 profile confirmation runtime schemas；OS-2 触达的岗位、推荐、洞察、简历与资料响应均在 Web 边界解析。
2. **Database/Platform 通过**：`POST /v1/recommendation-runs/from-search` 与 `GET /v1/recommendation-runs/:runId/view` 在现有 RecommendationRun 上实现；repeatable-read 内冻结候选、岗位版本、Requirement Set、新鲜度和确认资料，`23505/40001` 最多重试 3 次；无 migration、无新服务。
3. **Web 通过**：规范 `/jobs*`、`/jobs/recommended*`、`/jobs/insights*`、`/resumes/import*` 统一到 Career OS；筛选和 Run 深链可恢复，旧 V2 路径重定向，flag-off 保留旧壳。
4. **Integrated Gate 通过**：仅用合成岗位/owner/资料/证据/Case，在真实 Platform API 和本地 worker 上完成 Case、推荐与洞察；1536/1280/768/320、503 重试、session mutation 不重放、跨 owner 404、焦点、网络、console、lazy load 和 flag 回退通过。
5. **Evidence 通过**：独立证据和动态事实源已同步；决定只关闭 OS-2。

## 4. 下一候选切片与未完成边界

OS-3 `申请看板与 Case 命令` 尚未实施。它只在 coco 明确继续后启动，固定范围是：

- 扩展 Case list 的 `stage / city / sort / total` 与 query-bound cursor。
- 新增同一 repeatable-read 快照的五列 board 首批 read model；后续单列分页不重取五列。
- 统一看板/列表/Peek，覆盖完整集合筛选、计数、排序、深链 404 和移动行为。
- 接入阶段 transition 等 Case 命令，覆盖 owner、CSRF、幂等、revision 409 草稿保留、刷新和历史导航。
- 只有隔离库性能证据证明需要时才评审索引；不因视觉便利新增 migration。

以下仍明确未完成：

- OS-4 Case 固定岗位版本匹配、岗位版本 diff/upgrade 与 Requirements 完整决策。
- OS-5 Resume Studio 三栏、Review v2/受控 AI provenance、requirement 引用和最小 expand migration。
- OS-6 投递、面试、复盘、数据控制的最终统一，以及 OS-7 系统总 Gate。
- 真实供给、真实 AI、邮件、解析镜像、服务器、参与者和 Private Alpha。

## 5. 主要代码入口

- `apps/web/src/App.tsx`：V2 规范路由与 flag-off 边界。
- `apps/web/src/career-os/pages/JobDiscoveryPage.tsx`、`JobWorkspacePage.tsx`、`JobRecommendationsPage.tsx`、`JobInsightsWorkspacePage.tsx`：OS-2 已关闭页面基线。
- `apps/web/src/career-os/job-navigation.ts` 与 `career-os.css`：岗位 URL 状态和统一视觉/响应式基线。
- `apps/web/src/career-os/pages/ApplicationsPage.tsx`：OS-3 看板、筛选与 Peek 当前入口。
- `apps/web/src/api/client.ts`、`career-os.ts`、`product.ts`：session、Case 与业务 runtime response 边界。
- `packages/contracts/src/application-cases.ts`：OS-3 list/board/transition 契约首要入口。
- `apps/platform/src/applications/service.ts`、`repository.ts`、`routes.ts` 及集成测试：Case list/read model、transition、owner/409/幂等实现入口。
- `packages/contracts/src/matching.ts`、`profile.ts` 与 `apps/platform/src/catalog`、`matching`：OS-2 推荐冻结与资料契约基线，不得在 OS-3 退化。
- `apps/platform/scripts/isolated-test-server.ts`、`isolated-owner-task-runner.ts` 与 `apps/web/scripts/os2-browser-gate.cjs`：OS-2 loopback Gate 基线，不是产品演示模式。
- `packages/database/src/migrations` 与类型：只用于证明可表达性；OS-2 未修改，OS-3 不预设 migration。

## 6. 固定排除与数据安全

- 不访问真实招聘来源、真实 AI、真实邮件、服务器、参与者或真实简历，不获取外部解析镜像。
- 不新增第二套数据库、BFF、Redis、向量库、消息总线、第二套认证或 AI SDK，不移除 `VITE_CAREER_OS_V2`。
- 不读取、修改、暂存、覆盖、清理或提交 `.claude/`、`.data/`、密钥、令牌、真实简历原文、本地业务数据库、下载产物或截图。
- 测试数据库必须全新且匹配 `aijob_*_test_*`，只写合成数据，结束后精确清理。
- Private Alpha Gate 只用于守门，不得从中生成当前任务。

## 7. 新任务接手检查

1. 依次阅读 `AGENTS.md`、README、路线图、本交接、计划索引和当前前后端同步交付计划。
2. 核对实际分支、HEAD、远端跟踪、工作树、最近提交、容器和 3000/5173/5432 端口；冲突先报告。
3. 不重复 UX-0、OS-1 或 OS-2，也不从 OS-4/OS-5 或 Private Alpha 抢跑。只有 coco 明确继续后才开始 OS-3。
4. OS-3 按 `Contract → Database/Platform → Web → Integrated Gate → Evidence` 串行关闭，不能只迁页面。
5. 运行时只允许全新 `aijob_*_test_*`、合成数据、V2 Web 与必要 loopback 环境；不读取本地业务库，不访问外部来源。
6. OS-1/OS-2 的 Shell、session、runtime parse、规范岗位/资料入口、lazy load 与 flag 回退必须作为回归基线。
7. OS-3 五项状态全部通过并追加独立证据后，只作继续 OS-4、修改、回退或停止之一。
