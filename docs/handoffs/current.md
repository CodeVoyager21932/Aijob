# 当前项目交接：Career OS 前台体验收敛已获批准

> 交接日期：2026-08-12
>
> 当前分支：`codex/career-os-ux-convergence`
>
> 分支起点：`d03219f feat(identity): add pa1 offline access candidate`
>
> 精确 HEAD 与工作树以 `git log -1`、`git status` 为准。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

当前执行计划：[Career OS 前台体验收敛计划](../plans/career-os-current-delivery-plan.md)

上一轮交接：[PA-1 离线候选完成交接](archive/career-os-pa1-complete-2026-08-12.md)

## 1. 当前决定

coco 已确认现有前端与三张 Career OS 概念图存在明显视觉与整合差距，并批准整个用户前台进行高保真体验收敛。

**当前唯一目标是按 UX-0 至 UX-7 串行完成 Career OS 用户前台体验收敛；第一切片为 UX-0 视觉契约与基线，产品代码尚未实施。**

不得继续从 PA-1、旧 M4、历史 Phase 2、旧 R2、供给扩容或 Private Alpha Gate 自动选择任务。

## 2. 可信工程与产品基线

- M1–M4 已完成，一岗合成闭环与工程/浏览器 Gate 已通过。
- PA-1 离线身份与解析隔离候选已完成；最终全仓 Config 20、Contracts 79、Database 54、Platform 461、Web 142，共 756/756。
- `pnpm lint` 451 files、typecheck、build、audit、隔离 PostgreSQL 和 diff check 已通过。
- Web main 566.69 kB；Resume Editor 29.23 kB、Interview 23.51 kB、数据设置 12.05 kB，重工作区保持 lazy load。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- 工程闭环、合成满态和视觉验收均不得冒充用户价值、真实供给或 Private Alpha 就绪。

### 当前本机运行状态（2026-08-12 核验）

- `127.0.0.1:3000`、`127.0.0.1:5173`、`127.0.0.1:5432` 当前均在监听。
- 项目容器 `aijob-local-postgres-1` 当前为 healthy，映射本机 5432。
- 前后端与 PostgreSQL 是 coco 此前明确开启的本地开发实例，不是远程服务器或 Private Alpha 环境。
- 运行边界继续保持离线：不得访问真实招聘来源、真实 AI、真实邮件、真实简历或远程服务器；如运行配置或网络记录与此冲突，先停止相关动作并报告。
- 本次文档归档不停止现有服务；后续 UX-0 可在不写业务数据的前提下用现有实例读取页面基线。

## 3. 已锁定的 UX 方向

- 三张概念图是布局、信息层级和交互关系的高保真目标。
- 交付方式为逐页可见验收，不一次重写全站。
- 旧岗位发现、简历解析/确认等能力自然嵌入新 OS；旧 URL 只作兼容或历史只读。
- 完成边界覆盖整个用户前台，包括今日、岗位、看板、Case、简历、投递、面试、复盘、设置和访问页。
- 隔离合成满态与真实空态分别验收；不内置可冒充真实业务的演示模式。
- 证据状态只允许`已有证据 / 证据待补充 / 用户尚未确认`；不显示匹配等级或百分比。

## 4. 当前切片 UX-0

UX-0 只形成后续实施所需的可复核基线：

1. 固定全部用户路由、页面状态和旧能力处置矩阵。
2. 将三张概念图拆成采用项、拒绝项和响应式规则。
3. 固定视觉 token、信息密度、焦点、抽屉和检查器契约。
4. 记录 1536、1280、320 和 200% 等效视口的现状基线。
5. 设计只使用隔离合成数据的满态验收夹具，并单独保留真实空态。
6. 形成 UX-0 证据后只作继续、修改、回退或停止之一，再决定 UX-1。

UX-0 不重做页面、不新增后端能力、不访问外部系统。

## 5. 主要代码入口

- `apps/web/src/App.tsx`：V2/旧路由、Shell 与兼容边界。
- `apps/web/src/career-os/WorkspaceShell.tsx`：统一 V2 外壳、导航与 Peek。
- `apps/web/src/career-os/career-os.css`：当前视觉 token 和页面样式基线。
- `apps/web/src/career-os/pages/ApplicationsPage.tsx`：申请看板与私有 JD 入口。
- `apps/web/src/career-os/pages/CaseWorkspacePage.tsx`：Case Header、标签和工作区路由。
- `apps/web/src/career-os/pages/CaseRequirementsWorkspace.tsx`：JD 能力与要求检查器。
- `apps/web/src/career-os/pages/CaseResumeWorkspace.tsx` 与 `components/ResumeDocumentEditor.tsx`：岗位简历与三栏工作室。
- `apps/web/src/pages/JobListPage.tsx`、`JobDetailPage.tsx`、`ResumePage.tsx`、`ResumeConfirmPage.tsx`：需要自然嵌入新 OS 的旧用户能力。

## 6. 固定排除与数据安全

- 不访问真实招聘来源、真实 AI、真实邮件、服务器、参与者或真实简历，不获取外部解析镜像。
- 不新增数据库/migration/Redis/向量库/队列/第二套认证/AI SDK，不移除 `VITE_CAREER_OS_V2`。
- 不读取、修改、暂存、覆盖、清理或提交 `.claude/`、`.data/`、密钥、令牌、真实简历原文、本地业务数据库、下载产物或截图。
- 测试数据库必须全新且匹配 `aijob_*_test_*`，只写合成数据，结束后精确清理。
- Private Alpha Gate 只用于守门，不得从中生成当前 UX 任务。

## 7. 新任务接手检查

1. 依次阅读 `AGENTS.md`、README、路线图、本交接、计划索引和当前 UX 交付计划。
2. 核对实际分支、HEAD、远端跟踪、工作树、最近提交、容器和 3000/5173/5432 端口；冲突先报告。
3. 确认当前只执行 UX-0；不得跳到 UX-1 或其他页面实现。
4. 若服务已经运行，只能在现有本地离线边界内用于只读基线；不得因此访问外部来源。
5. 每个切片完成后同步更新路线图、交接和独立体验证据。
