# 当前项目交接：OS-1 已关闭，OS-2 资料准备与可信岗位入口待开始

> 交接日期：2026-08-13
>
> 当前分支：`codex/career-os-ux-convergence`
>
> 分支起点：`d03219f feat(identity): add pa1 offline access candidate`
>
> 精确 HEAD 与工作树以 `git log -1`、`git status` 为准。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

当前执行计划：[Career OS 前后端同步改进计划](../plans/career-os-current-delivery-plan.md)

稳定实施契约：[Career OS 端到端体验与系统契约](../14-career-os-end-to-end-experience-contract.md)

当前追踪矩阵：[UX-0 页面—系统—证据追踪矩阵](../plans/career-os-ux-0-end-to-end-traceability-matrix.md)

上一切片关闭证据：[OS-1 系统外壳与运行契约验收](../evidence/product/career-os-v2/os-1-system-shell-and-runtime-contract-acceptance-2026-08-13.md)

上游审计基线：[UX-0 端到端契约与基线审计](../evidence/product/career-os-v2/ux-0-end-to-end-contract-and-baseline-2026-08-13.md)

上一轮交接：[PA-1 离线候选完成交接](archive/career-os-pa1-complete-2026-08-12.md)

## 1. 当前决定

coco 已确认现有系统与三张 Career OS 概念图存在明显视觉与整合差距，并进一步要求不能做前端独立优化、不能默认后端匹配，必须以系统架构方式同步收敛 Contracts、Platform/DB、Web 与端到端证据。

**OS-1 系统外壳与运行契约已经按 Contract、Database/Platform、Web、Integrated Gate、Evidence 五项关闭。V2 访问、404/loading/route error 现在保留在唯一 WorkspaceShell，账号状态使用真实 session，overlay/focus 已统一；触达响应使用 runtime schema。真实隔离库 Gate 还复现并修复了 Requirements 并发读 `40001`，证明本轮不是前端独立优化。当前决定为“完成 OS-1，进入 OS-2 准备”；OS-2 尚未实施，等待 coco 明确指令。**

不得继续从 PA-1、旧 M4、历史 Phase 2、旧 R2、供给扩容或 Private Alpha Gate 自动选择任务。

## 2. 可信工程与产品基线

- M1–M4 已完成，一岗合成闭环与工程/浏览器 Gate 已通过。
- PA-1 离线身份与解析隔离候选、UX-0 审计和 OS-1 均已完成；OS-1 最终全仓 Config 20、Contracts 79、Database 54、Platform 461、Web 145，共 759/759。
- `pnpm lint` 457 files、typecheck、build、audit、全新隔离 PostgreSQL、四视口真实 API 浏览器 Gate 和 diff check 已通过。
- Web main 567.51 kB；Resume Editor 29.26 kB、Interview 23.54 kB、数据设置 12.08 kB，重工作区保持 lazy load；主包相对 PA-1 增加 0.82 kB，低于 10 kB 守门。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- 工程闭环、合成满态和视觉验收均不得冒充用户价值、真实供给或 Private Alpha 就绪。

### 当前本机运行状态（2026-08-13 OS-1 清理后核验）

- `127.0.0.1:3000`、`127.0.0.1:5173`、`127.0.0.1:5174`、`127.0.0.1:5432` 当前均未监听。
- OS-1 临时启动项目 PostgreSQL、test-config Platform、V2 Web 与 flag-off Web，使用精确数据库 `aijob_os1_test_20260813_f057`、`aijob_os1_verify_test_20260813_f057` 和合成数据完成 Gate；数据库、临时运行物和服务均已精确清理。
- 1536/1280 的 inline inspector/Peek 与 768/320 的 dialog overlay 已通过无页面级溢出、打开聚焦、焦点约束、Escape 和返焦。UX-0 量化的 OS-3 看板溢出与 OS-5 Resume Studio 裁剪仍未关闭，不能因 OS-1 通过而写成整体视觉完成。
- 浏览器成功路径没有 console warning/error、非刻意 HTTP 异常或外部请求；未生成截图。真实 API 的非法 Case 404、畸形响应脱敏错误和 V2 flag 回退均通过。
- 运行边界继续保持离线：不得访问真实招聘来源、真实 AI、真实邮件、真实简历或远程服务器；如运行配置或网络记录与此冲突，先停止相关动作并报告。

## 3. 已锁定的端到端方向

- 三张概念图是布局、信息层级和交互关系的高保真目标。
- 交付方式为用户结果纵向切片：先锁 Contract/领域/数据语义，再做 Database/Platform、Web 与真实隔离库浏览器验收，不一次重写全站，也不先做视觉壳。
- `UX-0` 只保留为已关闭的审计名称与实施基线；后续实现统一使用 `OS-1–OS-7`。每个 OS 切片都维护 `Contract / Database/Platform / Web / Integrated Gate / Evidence` 五项状态，五项未全部通过时不得写成完成。
- 固定顺序为：OS-1 系统外壳与运行契约 → OS-2 资料准备与可信岗位入口 → OS-3 申请看板与 Case 命令 → OS-4 单 Case 决策与固定版本匹配 → OS-5 Resume Studio 与唯一 Review 写入 → OS-6 投递、面试、复盘与数据控制 → OS-7 系统总 Gate。
- 旧岗位、三轴匹配、推荐、JD 洞察、简历解析/确认和 Tailoring 只有从规范路径可用、刷新可恢复且事实可追溯时才算自然嵌入；兼容说明或历史只读本身不算完成。
- 现有 matching 创建与 Worker 读取路径只接受 current/public pointer，不能直接覆盖 Case 固定旧版本；现有 Resume Review 又没有读取固定 Requirements 或保存 requirement 引用。这两项必须作为后端语义缺口同步修正，不能留给页面兜底。
- 完成边界覆盖整个用户前台，包括今日、岗位、看板、Case、简历、投递、面试、复盘、设置和访问页。
- 隔离合成满态与真实空态分别验收；不内置可冒充真实业务的演示模式。
- 证据状态只允许`已有证据 / 证据待补充 / 用户尚未确认`；不显示匹配等级或百分比。

## 4. OS-1 关闭结果与 OS-2 入口

OS-1 关闭结果：

1. **Contract 通过**：parser-aware `apiRequest` 已实现；session、邮箱 challenge、owner claim 和 Case 读取使用共享 schema，畸形响应统一为脱敏 `INVALID_API_RESPONSE`。
2. **Database/Platform 通过**：没有 migration 或数据结构变化；Requirements repeatable-read 的真实 `40001` 只在读事务内做最多 3 次有界重试，耗尽返回稳定 503，mutation 不重放；12 路并发集成测试通过。
3. **Web 通过**：V2 访问 Gate、404、loading 与 route error 不再掉回旧 Shell；Utility Bar 使用真实 session；统一 `ModalSurface` 覆盖 Peek、移动导航、命令菜单、Requirement inspector、私有 JD 与删除确认。
4. **Integrated Gate 通过**：全新隔离 PostgreSQL、真实 Platform API、合成岗位/owner/Case 在 1536、1280、768、320 四视口通过；V2=false 旧 ProductShell 回退通过。
5. **Evidence 通过**：759/759、lint 457 files、typecheck、build、audit、diff check 通过；独立证据与动态文档同步。
6. **没有越界**：未实施 OS-2–OS-7，未新增 migration/服务/外部依赖，未访问真实招聘、AI、邮件、简历或服务器。
7. **当前决定**：完成 OS-1，下一切片为 OS-2；OS-2 尚未实施，等待 coco 指令。

## 5. 主要代码入口

- `apps/web/src/App.tsx`：V2/旧路由、Shell 与兼容边界。
- `apps/web/src/career-os/WorkspaceShell.tsx`、`components/WorkspaceRouteBoundary.tsx` 与 `pages/WorkspaceNotFoundPage.tsx`：统一 V2 外壳、访问/路由状态、导航与 Peek。
- `apps/web/src/career-os/components/ModalSurface.tsx` 与 `use-media-query.ts`：统一 dialog、inert、焦点约束、Escape、返焦和 inline/modal 响应式边界。
- `apps/web/src/career-os/career-os.css`：当前视觉 token 和页面样式基线。
- `apps/web/src/career-os/pages/ApplicationsPage.tsx`：申请看板与私有 JD 入口。
- `apps/web/src/career-os/pages/CaseWorkspacePage.tsx`：Case Header、标签和工作区路由。
- `apps/web/src/career-os/pages/CaseRequirementsWorkspace.tsx`：JD 能力与要求检查器。
- `apps/web/src/career-os/pages/CaseResumeWorkspace.tsx` 与 `components/ResumeDocumentEditor.tsx`：岗位简历与三栏工作室。
- `apps/web/src/pages/JobListPage.tsx`、`JobDetailPage.tsx`、`ResumePage.tsx`、`ResumeConfirmPage.tsx`：需要自然嵌入新 OS 的旧用户能力。
- `apps/web/src/api/client.ts`、`career-os.ts`、`product.ts`：session、runtime response schema、V2 与旧能力 API 适配边界。
- `packages/contracts/src/application-cases.ts`、`matching.ts`、`insights.ts`、`resume-documents.ts`、`tailoring.ts`、`interview-debrief-knowledge.ts`：端到端状态与请求/响应事实。
- `apps/platform/src/applications`、`matching`、`insights`、`resume-documents`、`tailoring`、`interviews`、`profile`、`identity`：现有模块化单体的领域实现与集成测试入口。
- `apps/platform/src/workers/owner-task-worker.ts`、`resume-documents/review-service.ts`、`matching/service.ts`：Case-pinned 匹配任务、岗位定制 Review、受控 AI 降级和迟到任务反证的关键入口。
- `apps/platform/src/applications/service.ts` 与 `routes.integration.test.ts`：OS-1 Requirements 并发一致性读及真实集成回归。
- `apps/platform/scripts/isolated-test-server.ts`、`apps/web/scripts/os1-browser-gate.cjs`：loopback、精确测试库和四视口 OS-1 Gate；不是产品演示模式。
- `packages/database/src/migrations` 与类型：只用于核对现有数据可表达性；OS-1 未修改。

## 6. 固定排除与数据安全

- 不访问真实招聘来源、真实 AI、真实邮件、服务器、参与者或真实简历，不获取外部解析镜像。
- 不新增第二套数据库、BFF、Redis、向量库、消息总线、第二套认证或 AI SDK，不移除 `VITE_CAREER_OS_V2`。
- OS-1 没有实施 migration。UX-0 审计已证明 OS-5 需要一项 Review v1/v2 最小 expand migration（generation provenance/failure 与 requirement 引用）；看板、Case matching 和 Recommendation 当前不需要表 migration。legacy/new-write、滚动部署和回滚 guard 已写入追踪矩阵；不得为了视觉便利或绕过契约追加其他迁移。
- 不读取、修改、暂存、覆盖、清理或提交 `.claude/`、`.data/`、密钥、令牌、真实简历原文、本地业务数据库、下载产物或截图。
- 测试数据库必须全新且匹配 `aijob_*_test_*`，只写合成数据，结束后精确清理。
- Private Alpha Gate 只用于守门，不得从中生成当前任务。

## 7. 新任务接手检查

1. 依次阅读 `AGENTS.md`、README、路线图、本交接、计划索引和当前前后端同步交付计划。
2. 核对实际分支、HEAD、远端跟踪、工作树、最近提交、容器和 3000/5173/5432 端口；冲突先报告。
3. 不重复 UX-0 或 OS-1，也不从 OS-3/OS-4/OS-5 或 Private Alpha 的已知缺口抢跑。只有 coco 明确继续后，才开始 OS-2 资料准备与可信岗位入口。
4. OS-2 按 `Contract → Database/Platform → Web → Integrated Gate → Evidence` 串行关闭，覆盖岗位目录/详情、Recommendation/Insights 规范归位、简历导入确认、Case 创建与 URL 恢复；不能只迁页面。
5. 需要运行时，只允许全新 `aijob_*_test_*`、合成数据、V2 Web 与必要的 loopback 隔离环境；不读取本地业务库，不得访问外部来源。
6. OS-1 已完成的唯一 Shell、runtime parse、session、overlay/focus 与 V2 flag 回退必须作为回归基线，不得被 OS-2 破坏。
7. OS-2 五项状态全部通过并追加独立证据后，只作继续 OS-3、修改、回退或停止之一。
