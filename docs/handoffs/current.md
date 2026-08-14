# 当前项目交接：OS-4 已关闭，OS-5 Resume Studio 与唯一 Review 写入待开始

> 交接日期：2026-08-14
>
> 当前分支：`codex/career-os-ux-convergence`
>
> OS-4 起始 HEAD：`ff1f769 feat(career-os): close os3 application board`
>
> 精确 HEAD、远端跟踪与工作树以 `git log -1`、`git status` 为准。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

当前执行计划：[Career OS 前后端同步改进计划](../plans/career-os-current-delivery-plan.md)

稳定实施契约：[Career OS 端到端体验与系统契约](../14-career-os-end-to-end-experience-contract.md)

当前追踪矩阵：[UX-0 页面—系统—证据追踪矩阵](../plans/career-os-ux-0-end-to-end-traceability-matrix.md)

上一切片关闭证据：[OS-4 单 Case 决策与固定版本匹配验收](../evidence/product/career-os-v2/os-4-case-decision-and-pinned-match-acceptance-2026-08-14.md)

上游关闭证据：[OS-3 申请看板与 Case 命令验收](../evidence/product/career-os-v2/os-3-application-board-and-case-command-acceptance-2026-08-14.md)

## 1. 当前决定

coco 要求每个纵向切片同步关闭 Contract、Database/Platform、Web、Integrated Gate 与 Evidence，不做前端或后端单层优化。

**OS-4 单 Case 决策与固定版本匹配已经按五项状态关闭。Case 固定岗位版本、Requirements、三轴匹配、目录版本状态与显式 diff/upgrade 现在从同一规范 Case 路径可用；服务端派生固定输入，Worker 计算前后重验，Web 不提交或拼接 revisions。当前决定为“完成 OS-4，进入 OS-5 准备”；OS-5 尚未实施，等待 coco 明确指令。**

不得从 PA-1、旧 M4、历史 Phase 2、旧 R2、供给扩容或 Private Alpha Gate 自动选择任务。

## 2. 可信工程与产品基线

- M1–M4、PA-1、UX-0 与 OS-1–OS-4 已完成；这只代表对应本地工程与体验 Gate。
- OS-4 最终全仓 Config 20、Contracts 85、Database 54、Platform 465、Web 158，共 782/782。
- `pnpm lint` 474 files、typecheck、build、离线缓存 audit、全新隔离 PostgreSQL、四视口真实 API 浏览器 Gate 与 diff check 均通过。
- Web main 397.80 kB（gzip 116.09 kB）；Case 24.05 kB、Requirements 13.61 kB、Resume Editor 29.38 kB、Interview 23.76 kB，重工作区保持 lazy load。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- 工程闭环、合成满态和视觉验收均不得冒充用户价值、真实供给、生产或 Private Alpha 就绪。

### 当前本机运行状态（2026-08-14 OS-4 清理后核验）

- `127.0.0.1:3000`、`127.0.0.1:5173`、`127.0.0.1:5174`、`127.0.0.1:5432` 均未监听。
- OS-4 精确测试库、临时运行目录、Platform、V2 Web、flag-off Web 与项目 PostgreSQL 均已清理或停止。
- 浏览器成功路径没有 console warning/error 或外部请求；只注入预期的 503、409、403、422 与 404。未生成截图。
- 运行边界继续保持离线：不访问真实招聘来源、真实 AI、真实邮件、真实简历或远程服务器。

## 3. OS-4 已关闭结果

1. **Contract 通过**：新增 `GET /v1/application-cases/:caseId/match-state`、`POST /v1/application-cases/:caseId/match-runs`、严格的 Case match state/schema 与旧 `{ runId }` / 新 `case_pinned` task payload union；Web 对 match state、job-version diff 与 upgrade 响应做 runtime parse。
2. **Database/Platform 通过**：Platform 从同 owner、未删除 Case 派生固定 job version、requirement set 与当前 fact/preference/evidence revisions；幂等 hash 包含请求与全部派生输入。现有 MatchRun、任务表和三轴引擎继续作为唯一事实，不新增 Case 外键、第二套 Run、migration、服务或依赖。
3. **Worker 竞态通过**：`case_pinned` Worker 在计算前和写回前重验 owner/epoch、Case revision、删除状态、固定 job version 与 requirement set；Case 删除或升级不会让旧任务写回。目录 `stale/closed/unavailable` 与 run 输入 stale 分开表达。
4. **Web 通过**：Case Overview 分别显示资格、经历证据和偏好，不输出总分或“匹配良好/中/差”；覆盖 private/profile incomplete/not run/queued/processing/current/stale/failed。岗位版本变化只在 diff 对话框显式确认后升级，409 保留对话框并要求再次确认。
5. **Integrated Gate 通过**：真实 Platform API、PostgreSQL、Worker 与 1536/1280/768/320 浏览器覆盖固定版本运行、资料修订陈旧、岗位版本升级、Requirements 深链/刷新/历史、owner/404/409/session、删除、lazy load 与 flag 回退；网络仅 loopback。
6. **Evidence 通过**：独立证据、路线图、计划索引、当前计划、追踪矩阵、证据索引和本交接已同步；决定只关闭 OS-4。

浏览器验收期间还复现并修复了 Windows 与 PostgreSQL 时钟偏差下“快速创建后立即删除”可能触发的 500：Case、Resume Document、Interview 与 Debrief 的默认删除时间统一使用 PostgreSQL `clock_timestamp()`；显式测试时间参数继续保留。

### 验证插曲与结论

- 第一轮全仓测试中，既有 `local-owner-flow.integration.test.ts` 超过默认 5 秒，未完成事务随后与清理形成 deadlock；该轮没有被记录为通过。
- 在同一已污染库单独复现时，测试先领取了残留 `owner_deletion`，因此出现“resume analysis fixture was not processed”；只读队列核验确认原因后没有修改产品代码或测试来掩盖它。
- 全新库中的单独 Platform 套件随后通过 465/465；最终又在全新 `aijob_os4_test_final_20260814_f057` 上按 workspace 顺序完成一次完整 782/782。最终 Gate 以这次完整绿色运行和独立浏览器 Gate 为准。

## 4. 下一候选切片与未完成边界

OS-5 `Resume Studio 与唯一 Review 写入` 尚未实施。它只在 coco 明确继续后启动，固定范围是：

- 把基础简历、岗位简历、内容/布局修订、岗位 Requirements、Review 决策和 DOCX 收敛为同一三栏 Studio；移动端使用结构/文稿/建议模式切换。
- Resume V2 Review 成为 template 与受控 AI 的唯一新写入所有者；旧 Tailoring 只保留历史读取，不恢复第二套可写流程。
- 按已锁定兼容方案实施最小 expand migration：v1/v2 双读、双 handler、版本化 task、生成 provenance/failure/fallback 与受校验的 requirement 引用；一旦写入 v2 Run，不允许回滚到 pre-v2 代码。
- 离线 Gate 只使用确定性模板和 loopback 模拟 provider；真实 AI 与公开/远程启用继续关闭。
- 覆盖 public/private Requirements、建议接受/编辑后采用/拒绝、草稿与 revision 409、删除、DOCX、打印、刷新/深链、四视口、lazy load 和旧历史读取。

以下仍明确未完成：

- OS-5 Resume Studio/Review v2、OS-6 投递/面试/复盘/数据控制收敛与 OS-7 系统总 Gate。
- 真实供给、真实 AI、真实邮件、解析镜像、服务器、参与者和 Private Alpha。

## 5. 主要代码入口

- `apps/web/src/career-os/pages/CaseWorkspacePage.tsx`、`components/CaseMatchPanel.tsx`、`components/CaseVersionControl.tsx`：OS-4 已关闭的 Case 固定版本与三轴核对回归基线。
- `packages/contracts/src/matching.ts`、`apps/platform/src/matching/service.ts`、`routes.ts` 与 `workers/owner-task-worker.ts`：OS-4 Case-scoped adapter、任务 union 与 Worker 重验边界。
- `apps/platform/src/matching/case-match-routes.integration.test.ts`、`apps/web/scripts/os4-browser-gate.cjs`：OS-4 PostgreSQL 与 loopback 浏览器回归证据。
- `apps/web/src/career-os/components/ResumeDocumentEditor.tsx` 与 `pages/CaseResumeWorkspace.tsx`：OS-5 三栏 Studio 与唯一写入的 Web 入口。
- `packages/contracts/src/resume-documents.ts`、`apps/platform/src/resume-documents/review-service.ts`、相关 routes/worker/tests：OS-5 Review v1/v2 契约与生成入口。
- `packages/database/src/migrations` 与数据库类型：OS-5 已证明需要的最小 expand migration 入口；不得扩大到第二套聚合。
- `apps/platform/scripts/isolated-test-server.ts`：loopback 隔离服务基线，不是产品演示模式。

## 6. 固定排除与数据安全

- 不访问真实招聘来源、真实 AI、真实邮件、服务器、参与者或真实简历，不获取外部解析镜像。
- 不新增第二套数据库、BFF、Redis、向量库、消息总线、认证或 AI SDK，不移除 `VITE_CAREER_OS_V2`。
- 不读取、修改、暂存、覆盖、清理或提交 `.claude/`、`.data/`、密钥、令牌、真实简历原文、本地业务数据库、下载产物或截图。
- 测试数据库必须全新且匹配 `aijob_*_test_*`，只写合成数据；浏览器和服务只允许 loopback。
- Private Alpha Gate 只用于守门，不得从中生成当前任务。

## 7. 新任务接手检查表

1. 依次读取 `AGENTS.md`、`README.md`、路线图、本交接、计划索引、当前交付计划和 OS-4 证据。
2. 核对分支、HEAD、远端跟踪、tracked 工作树、最近提交、容器和 3000/5173/5174/5432；冲突先报告。
3. 不重复 UX-0 或 OS-1–OS-4，不从 OS-6、OS-7 或 Private Alpha 抢跑。只有 coco 明确继续后才开始 OS-5。
4. OS-5 仍按 `Contract → Database/Platform → Web → Integrated Gate → Evidence` 串行关闭，不能只迁页面或只扩后端。
5. 开始 OS-5 前重核 Review v1/v2 兼容、migration/rollback 顺序、旧 Tailoring 只读边界和真实 AI 关闭状态。
6. OS-1–OS-4 的 Shell、session、runtime parse、规范岗位/资料入口、完整集合看板、Case 固定版本、lazy load 与 flag 回退必须作为回归基线。
7. OS-5 五项状态全部通过并追加独立证据后，只作继续 OS-6、修改、回退或停止之一。
