# 当前项目交接：OS-3 已关闭，OS-4 单 Case 决策与固定版本匹配待开始

> 交接日期：2026-08-14
>
> 当前分支：`codex/career-os-ux-convergence`
>
> OS-3 起始 HEAD：`163e8fe feat(career-os): close os2 trusted job entry`
>
> 精确 HEAD、远端跟踪与工作树以 `git log -1`、`git status` 为准。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

当前执行计划：[Career OS 前后端同步改进计划](../plans/career-os-current-delivery-plan.md)

稳定实施契约：[Career OS 端到端体验与系统契约](../14-career-os-end-to-end-experience-contract.md)

当前追踪矩阵：[UX-0 页面—系统—证据追踪矩阵](../plans/career-os-ux-0-end-to-end-traceability-matrix.md)

上一切片关闭证据：[OS-3 申请看板与 Case 命令验收](../evidence/product/career-os-v2/os-3-application-board-and-case-command-acceptance-2026-08-14.md)

上游关闭证据：[OS-2 资料准备与可信岗位入口验收](../evidence/product/career-os-v2/os-2-profile-and-trusted-job-entry-acceptance-2026-08-13.md)

## 1. 当前决定

coco 已要求 Career OS 不做前端独立优化，也不默认后端匹配；每个纵向切片必须同步关闭 Contract、Database/Platform、Web、Integrated Gate 与 Evidence。

**OS-3 申请看板与 Case 命令已经按五项状态关闭。Case list 与固定五列 board 现在由 Platform 提供完整集合语义；看板、列表和 Peek 已接入同一 URL、owner、404、revision 409、幂等和 session 边界。当前决定为“完成 OS-3，进入 OS-4 准备”；OS-4 尚未实施，等待 coco 明确指令。**

不得从 PA-1、旧 M4、历史 Phase 2、旧 R2、供给扩容或 Private Alpha Gate 自动选择任务。

## 2. 可信工程与产品基线

- M1–M4、PA-1、UX-0、OS-1、OS-2 与 OS-3 已完成；这只代表对应本地工程与体验 Gate。
- OS-3 最终全仓 Config 20、Contracts 83、Database 54、Platform 463、Web 154，共 774/774。
- `pnpm lint` 468 files、typecheck、build、audit、全新隔离 PostgreSQL、四视口真实 API 浏览器 Gate 和 diff check 已通过。
- Web main 395.43 kB（gzip 115.57 kB）；Applications 16.35 kB、Resume Editor 29.38 kB、Interview 23.76 kB、数据设置 12.35 kB，重工作区保持 lazy load。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- 工程闭环、合成满态和视觉验收均不得冒充用户价值、真实供给、生产或 Private Alpha 就绪。

### 当前本机运行状态（2026-08-14 OS-3 清理后核验）

- `127.0.0.1:3000`、`127.0.0.1:5173`、`127.0.0.1:5174`、`127.0.0.1:5432` 均未监听。
- 精确测试库 `aijob_os3_test_20260813_f057`、`aijob_os3_verify_test_20260814_f057` 与临时目录 `aijob-os3-runtime-f057-20260814` 已删除；Platform、V2 Web、flag-off Web、PostgreSQL、项目容器与网络均已停止或移除。
- 浏览器成功路径没有 console warning/error 或外部请求；仅刻意注入 503、409、403 与 404。未生成截图。
- 运行边界继续保持离线：不得访问真实招聘来源、真实 AI、真实邮件、真实简历或远程服务器。

## 3. OS-3 已关闭结果

1. **Contract 通过**：Case list 增加 `stage / city / sort / cursor / total`，v2 cursor 绑定查询；新增固定五列 board schema；list/board/transition 均在 Web 边界 runtime parse。
2. **Database/Platform 通过**：list 的 count/page 与 board 五列分别在 repeatable-read 中读取；城市只匹配公共岗位 known location，截止时间 unknown 最后；单列续页复用 list。105 Case 跨页、owner epoch 与删除隔离通过，无 migration 或新索引。
3. **Web 通过**：看板/列表使用服务端完整集合；`view / stage / city / sort / peek` 可刷新和历史恢复；Peek 使用显式阶段命令，409 保留选择并再次确认，session 恢复不重放 mutation；移动端单列和全屏 Peek。
4. **Integrated Gate 通过**：仅用 1 个合成公共岗位、owner 与 26 个合成 Case，在真实 Platform API 上完成 20/22 逐列分页、503 重试、409、session、非法/跨 owner/删除 404、1536/1280/768/320、键盘、网络、console、lazy load 和 flag 回退。
5. **Evidence 通过**：独立证据和动态事实源已同步；决定只关闭 OS-3。

性能反证：owner/stage/更新时间列表命中既有 `application_cases_owner_updated_idx`，代表性执行约 `0.099 ms`；城市/截止排序约 `0.286 ms`。隔离合成负载没有证明新增索引的必要性。

## 4. 下一候选切片与未完成边界

OS-4 `单 Case 决策与固定版本匹配` 尚未实施。它只在 coco 明确继续后启动，固定范围是：

- 统一 Case Header、Requirements/Evidence、问题、岗位版本状态与规范入口，所有结果继续绑定 Case 固定岗位版本。
- 接入已有岗位版本 diff/upgrade，显式展示变化并确认升级；不得静默切换到目录当前版本。
- 扩展 Case-scoped match state/create adapter，由服务端解析固定 job/requirement 与当前已确认资料 revisions。
- 在现有 matching 任务 union 中增加受 owner、Case revision、删除和固定上下文约束的 `case_pinned` 执行上下文；不新增 Case 外键或第二套 MatchRun。
- 覆盖 public/private、not-run/current/stale/not-applicable、409 保稿、幂等、任务前后竞态、刷新/深链和四视口。
- 只有不可表达的持久语义才允许提出最小 migration；OS-4 当前设计不预设 migration。

以下仍明确未完成：

- OS-5 Resume Studio 三栏、Review v2/受控 AI provenance、requirement 引用和最小 expand migration。
- OS-6 投递、面试、复盘、数据控制的最终统一，以及 OS-7 系统总 Gate。
- 真实供给、真实 AI、邮件、解析镜像、服务器、参与者和 Private Alpha。

## 5. 主要代码入口

- `apps/web/src/App.tsx`、`apps/web/src/career-os/WorkspaceShell.tsx`：规范路由、Peek 与 flag-off 边界。
- `apps/web/src/career-os/pages/ApplicationsPage.tsx`、`components/ContextInspector.tsx`：OS-3 已关闭看板、列表、Peek 与阶段命令基线。
- `apps/web/src/career-os/pages/CaseWorkspacePage.tsx`、`CaseRequirementsWorkspace.tsx`：OS-4 单 Case 页面入口。
- `apps/web/src/api/career-os.ts`：Case、Requirements、岗位版本与后续 match adapter 的 Web runtime response 边界。
- `packages/contracts/src/application-cases.ts`：Case、Requirements、岗位版本 diff/upgrade 契约。
- `packages/contracts/src/matching.ts`：OS-4 Case-scoped match state/create 与任务上下文首要契约入口。
- `apps/platform/src/applications/service.ts`、`routes.ts` 及集成测试：Case owner/revision、固定岗位版本、Requirements 与 diff/upgrade 实现。
- `apps/platform/src/matching` 与 worker 测试：现有 MatchRun、当前目录约束及 OS-4 `case_pinned` 扩展入口。
- `packages/database/src/migrations` 与类型：只用于证明可表达性；OS-3 未修改，OS-4 不预设 migration。
- `apps/platform/scripts/isolated-test-server.ts` 与 `apps/web/scripts/os3-browser-gate.cjs`：OS-3 loopback Gate 基线，不是产品演示模式。

## 6. 固定排除与数据安全

- 不访问真实招聘来源、真实 AI、真实邮件、服务器、参与者或真实简历，不获取外部解析镜像。
- 不新增第二套数据库、BFF、Redis、向量库、消息总线、第二套认证或 AI SDK，不移除 `VITE_CAREER_OS_V2`。
- 不读取、修改、暂存、覆盖、清理或提交 `.claude/`、`.data/`、密钥、令牌、真实简历原文、本地业务数据库、下载产物或截图。
- 测试数据库必须全新且匹配 `aijob_*_test_*`，只写合成数据，结束后精确清理。
- Private Alpha Gate 只用于守门，不得从中生成当前任务。

## 7. 新任务接手检查

1. 依次阅读 `AGENTS.md`、README、路线图、本交接、计划索引和当前前后端同步交付计划。
2. 核对实际分支、HEAD、远端跟踪、工作树、容器与 3000/5173/5174/5432；冲突先报告，不静默选择。
3. 不重复 UX-0 或 OS-1–OS-3，也不从 OS-5、OS-6 或 Private Alpha 抢跑。只有 coco 明确继续后才开始 OS-4。
4. OS-4 按 `Contract → Database/Platform → Web → Integrated Gate → Evidence` 串行关闭，不能只迁页面。
5. 先用全新 `aijob_*_test_*` 隔离库和合成 public/private Case 证明现有表可表达；不得连接本地业务数据库。
6. OS-1–OS-3 的 Shell、session、runtime parse、规范岗位/资料入口、完整集合看板、lazy load 与 flag 回退必须作为回归基线。
7. OS-4 五项状态全部通过并追加独立证据后，只作继续 OS-5、修改、回退或停止之一。
