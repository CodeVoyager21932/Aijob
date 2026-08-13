# 当前项目交接：UX-0 已关闭，OS-1 系统外壳与运行契约待开始

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

上一切片关闭证据：[UX-0 端到端契约与基线审计](../evidence/product/career-os-v2/ux-0-end-to-end-contract-and-baseline-2026-08-13.md)

上一轮交接：[PA-1 离线候选完成交接](archive/career-os-pa1-complete-2026-08-12.md)

## 1. 当前决定

coco 已确认现有系统与三张 Career OS 概念图存在明显视觉与整合差距，并进一步要求不能做前端独立优化、不能默认后端匹配，必须以系统架构方式同步收敛 Contracts、Platform/DB、Web 与端到端证据。

**UX-0 端到端契约与基线已经关闭：视觉/交互审计、六个结构性接缝的代码反证、Review v1/v2 expand/滚动部署/回滚边界，以及 1536、1280、320、200% 等效 768 的实时运行基线均已完成。决定为“完成 UX-0，继续 OS-1 准备”。当前唯一后续目标是 OS-1 系统外壳与运行契约，但尚未修改任何 OS-1 产品代码，等待 coco 明确继续执行。**

不得继续从 PA-1、旧 M4、历史 Phase 2、旧 R2、供给扩容或 Private Alpha Gate 自动选择任务。

## 2. 可信工程与产品基线

- M1–M4 已完成，一岗合成闭环与工程/浏览器 Gate 已通过。
- PA-1 离线身份与解析隔离候选已完成；最终全仓 Config 20、Contracts 79、Database 54、Platform 461、Web 142，共 756/756。
- `pnpm lint` 451 files、typecheck、build、audit、隔离 PostgreSQL 和 diff check 已通过。
- Web main 566.69 kB；Resume Editor 29.23 kB、Interview 23.51 kB、数据设置 12.05 kB，重工作区保持 lazy load。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- 工程闭环、合成满态和视觉验收均不得冒充用户价值、真实供给或 Private Alpha 就绪。

### 当前本机运行状态（2026-08-13 UX-0 清理后核验）

- `127.0.0.1:3000`、`127.0.0.1:5173`、`127.0.0.1:5432` 当前均未监听。
- UX-0 曾临时启动项目 PostgreSQL、test-config Platform 与 V2 Web，使用精确数据库 `aijob_ux0_test_20260813_f057` 和合成数据完成四视口核验；数据库、临时 runner 和服务均已精确清理。
- 四视口基线已完成，但当前目标布局没有通过：1536/1280/768 看板内部溢出约 293/361/513px，768 Resume Studio 静默裁掉约 127px；Peek/Requirement inspector 缺 dialog 语义、打开聚焦和 Escape。
- 浏览器没有 console/HTTP/非导航请求异常或外部请求；未生成截图。上述缺口已分别分配给 OS-1、OS-3、OS-5，不能冒充当前页面已经通过体验 Gate。
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

## 4. UX-0 关闭结果与 OS-1 入口

UX-0 关闭结果：

1. **已完成审计 Gate**：全部用户路由、页面状态和旧能力处置；Matching、Recommendation、Insights、Tailoring 的规范归属与唯一写入已决定，尚未实现。
2. **已完成**：三张概念图的采用项、拒绝项、实际文件身份和响应式规则；第 1/第 3 张交接标签曾互换，以文件哈希为准。
3. **已完成**：视觉 token、信息密度、焦点、抽屉、检查器和局部横滚契约。
4. **已完成代码反证**：Case、Requirements、Resume V2、Interview、Deletion 主体语义较强；看板列表投影与旧能力融入存在结构性接缝，不能宣称后端已匹配。
5. **已完成 UX-0 系统矩阵**：页面—用户动作—Contracts—Platform/DB—测试矩阵和隔离满态/空态夹具；看板、Matching、Recommendation、Insights、Tailoring/Review 与 runtime parse 已有 schema/Problem/断言。
6. **已确认后端新增差距**：Matching 创建/Worker 当前只接受目录 current pointer；Review Worker 只做 template 且不读固定 Requirements，Finding/Suggestion 没有 requirement IDs，Run 没有可信 generation provenance/failure。
7. **已锁定 Review 兼容边界**：expand-only/no-op down；新 reader/Worker 双读双 handler 后才开 v2 写；legacy 不伪造 provenance；一旦存在 v2 Run，禁止回滚 pre-v2 应用代码，只能前向修复。
8. **已完成四视口实时基线**：量化结果见 UX-0 证据；“基线完成”不等于当前布局通过。
9. **当前决定**：完成 UX-0，下一切片为 OS-1；OS-1 尚未实施。

UX-0 没有重做页面、修改产品代码、新增后端能力或访问外部系统。

## 5. 主要代码入口

- `apps/web/src/App.tsx`：V2/旧路由、Shell 与兼容边界。
- `apps/web/src/career-os/WorkspaceShell.tsx`：统一 V2 外壳、导航与 Peek。
- `apps/web/src/career-os/career-os.css`：当前视觉 token 和页面样式基线。
- `apps/web/src/career-os/pages/ApplicationsPage.tsx`：申请看板与私有 JD 入口。
- `apps/web/src/career-os/pages/CaseWorkspacePage.tsx`：Case Header、标签和工作区路由。
- `apps/web/src/career-os/pages/CaseRequirementsWorkspace.tsx`：JD 能力与要求检查器。
- `apps/web/src/career-os/pages/CaseResumeWorkspace.tsx` 与 `components/ResumeDocumentEditor.tsx`：岗位简历与三栏工作室。
- `apps/web/src/pages/JobListPage.tsx`、`JobDetailPage.tsx`、`ResumePage.tsx`、`ResumeConfirmPage.tsx`：需要自然嵌入新 OS 的旧用户能力。
- `apps/web/src/api/client.ts`、`career-os.ts`、`product.ts`：session、runtime response、V2 与旧能力 API 适配边界。
- `packages/contracts/src/application-cases.ts`、`matching.ts`、`insights.ts`、`resume-documents.ts`、`tailoring.ts`、`interview-debrief-knowledge.ts`：端到端状态与请求/响应事实。
- `apps/platform/src/applications`、`matching`、`insights`、`resume-documents`、`tailoring`、`interviews`、`profile`、`identity`：现有模块化单体的领域实现与集成测试入口。
- `apps/platform/src/workers/owner-task-worker.ts`、`resume-documents/review-service.ts`、`matching/service.ts`：Case-pinned 匹配任务、岗位定制 Review、受控 AI 降级和迟到任务反证的关键入口。
- `packages/database/src/migrations` 与类型：只用于核对现有数据可表达性；UX-0 不修改。

## 6. 固定排除与数据安全

- 不访问真实招聘来源、真实 AI、真实邮件、服务器、参与者或真实简历，不获取外部解析镜像。
- 不新增第二套数据库、BFF、Redis、向量库、消息总线、第二套认证或 AI SDK，不移除 `VITE_CAREER_OS_V2`。
- UX-0 不实施 migration。审计已证明 OS-5 需要一项 Review v1/v2 最小 expand migration（generation provenance/failure 与 requirement 引用）；看板、Case matching 和 Recommendation 当前不需要表 migration。legacy/new-write、滚动部署和回滚 guard 已写入追踪矩阵；不得为了视觉便利或绕过契约追加其他迁移。
- 不读取、修改、暂存、覆盖、清理或提交 `.claude/`、`.data/`、密钥、令牌、真实简历原文、本地业务数据库、下载产物或截图。
- 测试数据库必须全新且匹配 `aijob_*_test_*`，只写合成数据，结束后精确清理。
- Private Alpha Gate 只用于守门，不得从中生成当前任务。

## 7. 新任务接手检查

1. 依次阅读 `AGENTS.md`、README、路线图、本交接、计划索引和当前前后端同步交付计划。
2. 核对实际分支、HEAD、远端跟踪、工作树、最近提交、容器和 3000/5173/5432 端口；冲突先报告。
3. 不重复 UX-0，也不从 OS-2/OS-3/OS-5 的已知缺口抢跑。coco 明确继续后，只执行 OS-1：WorkspaceShell、规范路由/错误边界、统一 overlay/focus、身份/session 回接和触达响应 runtime schema。
4. OS-1 按 `Contract → Database/Platform → Web → Integrated Gate → Evidence` 串行关闭；主体数据表预计不变，若代码反证不成立先更新契约并报告。
5. 需要运行时，只允许全新 `aijob_*_test_*`、合成数据、V2 Web 与必要的 loopback 隔离环境；不读取本地业务库，不得访问外部来源。
6. 四视口、键盘、焦点、console、loopback network、session、404/错误恢复和 V2 flag 回退必须用真实 API 验证；不生成或提交截图。
7. OS-1 五项状态全部通过并追加独立证据后，只作继续 OS-2、修改、回退或停止之一。
