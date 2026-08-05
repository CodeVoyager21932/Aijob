# 当前项目交接：Aijob 求职 OS 2.0

> 交接日期：2026-08-04
>
> 当前分支：`codex/career-os-phase-1`
>
> 当前提交：`a8ddb65 docs: record Private Alpha correction baseline`
>
> 工作树基线：Career OS 2.0 的 ADR、计划、概念图、Phase 1A 实现与验收记录仍在当前工作树中；另有未跟踪 `.claude/`，不得读取、提交或覆盖
>
> 动态事实源：[MVP 路线与当前决策面板](../06-mvp-roadmap.md)
>
> 完整升级计划：[Aijob 求职 OS 2.0 升级计划](../plans/career-os-v2-upgrade-plan-2026-08-04.md)
>
> 上一阶段完整交接归档：[Private Alpha 岗位可信度纠偏](archive/private-alpha-trust-correction-2026-08-03.md)

## 1. 当前唯一目标

coco 已接受 [ADR-0030](../decisions/0030-adopt-job-centric-career-os-and-interaction-first-integration.md)：Aijob 从“官方岗位投递决策助手”升级为**可信官方岗位驱动的完整求职 OS**。

Phase 1A 已按[工作台壳层验收记录](../evidence/product/career-os-v2/phase-1a-workspace-shell-acceptance-2026-08-04.md)通过。当前唯一工程目标是 **Phase 1B：在同一静态 Case 和统一壳层内完成 JD 能力与岗位定制简历可交互原型**：

```text
Phase 1A 功能旗标、WorkspaceShell、静态看板、URL 侧览与路由骨架（已通过）
  -> Phase 1B JD 能力静态工作区
  -> Phase 1B 岗位定制简历静态工作区
  -> Phase 1B 共享 Case、证据语义、焦点与响应式 Gate
  -> ApplicationCase、简历 V2 和文字面试 PoC
  -> 完成一岗全闭环
  -> 最后恢复 100/1000 官方岗位扩容
```

Phase 1B 继续使用 Phase 1A 的静态 Case，不新增业务表或接口；功能旗标关闭时旧页面必须继续可用。只实现概念 02、03 的交互信息架构，不接完整编辑器，不直接移植开源项目，不扩大来源，不创建数据库迁移，也不调用真实 AI。

## 2. 已确认产品决定

- 产品目标：完整求职 OS，而不是岗位信息流、简历生成器或传统管理后台。
- 首个闭环：可信岗位→JD 能力拆解→证据选择→岗位定制简历→导出→投递记录→文字模拟面试→复盘→删除。
- 交互方式：一套全局侧栏、顶部工具栏、主画布和可收起右侧检查器；不保留双重主导航。
- 单岗位标签：`概览 / JD能力 / 定制简历 / 投递 / 面试 / 复盘`。
- 迁移方式：功能旗标渐进替换，旧页面在新闭环通过前继续可用。
- 开源政策：MIT/Apache 纯组件可在审计后选择性移植；AGPL、许可证不明、框架冲突和完整后端只作行为参考；不整仓 Fork、不使用 Git 子模块。
- 经验内容：引用式知识库，只保存 URL、短摘要、适用场景和用户笔记。
- 不做：语音、视频、OCR、自动投递、浏览器代填、社区、向量库、Redis、消息总线和公共管理后台。
- 手机端：本阶段不做专属页面，但路由、语义顺序、抽屉和响应式容器必须允许以后实现。

## 3. 当前可信工程基线

- 干净验收库 `aijob_alpha`：22 条可信活动岗位、3 家企业、3 个官方 ATS；SME 2 家/14 岗；人工、Alpha、公共岗位均为 0。
- 纠偏前 231/149/29、152/30 和开发库 14/2 都只保留为历史事实。
- ADR-0029 已落实：企业官网和官网确认的官方 ATS 是用户目录唯一岗位真源；高校、政府、公众号和二手页面为 `discovery_only`。
- 100 家/1000 岗仍是外部 Private Alpha 硬门槛，110/1100 是运营缓冲；本计划只调整执行顺序，不降低标准。
- 产品证据为 `E0`，G0/G1 未开始；外部用户测试继续暂停。
- PostgreSQL 是唯一任务和查询真源；保持模块化单体与 `web-api / collector-worker / match-worker` 权限边界。
- 当前 Web 为 React 19 + Vite + React Router + TanStack Query；无 Tailwind、shadcn、Tiptap、dnd-kit 或全局状态库。
- `VITE_CAREER_OS_V2` 关闭时继续使用原 `/jobs`、`/insights`、`/resume`、`/recommendations`、`/resume-tailorings/:runId`、`/data-control` 与 `ProductShell`；开启时懒加载 `WorkspaceShell` 和 Career OS 路由。
- Phase 1A 已建立唯一全局侧栏、顶部工具栏、主画布、URL 侧览、六个共享 Case 路由和本机 UI 偏好；前端 85 测试、生产构建及 1920/1280/320 浏览器验收通过。

## 4. Phase 1 交付边界

Phase 1 总体只实现交互壳层和静态数据原型：

- `WorkspaceShell`
- `GlobalSidebar`
- `UtilityBar`
- `MainCanvas`
- `ContextInspector`
- `CaseHeader`
- `CaseTabs`
- `ResizablePane`
- `ViewToolbar`
- `EvidenceState`
- `StageBadge`

首批路由骨架：

```text
/today
/jobs
/applications
/applications/:caseId/overview
/applications/:caseId/requirements
/applications/:caseId/resume
/applications/:caseId/application
/applications/:caseId/interview
/applications/:caseId/debrief
/resumes
/interviews
/knowledge
/settings/data
```

Phase 1 必须使用功能旗标；旧页面不删除。视图、筛选、排序和侧览对象进入 URL，推荐使用 `?peek=<caseId>`；侧栏和面板宽度只保存本机 UI 偏好。

Phase 1A 已交付并通过：

- 明确的 Career OS 功能旗标和旧页面回退。
- 统一 `WorkspaceShell`、全局侧栏、顶部工具栏、主画布和可收起检查器。
- `/applications` 静态列表/看板、筛选、排序及 `?peek=<caseId>` 侧览。
- 六个岗位子路由共享的静态 `CaseHeader / CaseTabs` 骨架；JD 能力和定制简历的完整静态工作区留到 Phase 1B。
- Gate：单一主导航；刷新、前进、后退恢复 URL 上下文；关闭侧览后焦点回到触发项且列表位置不丢；1280/320 无整页横向溢出；键盘可达。

当前 Phase 1B 只交付：

- `/applications/:caseId/requirements` 的静态 JD 能力工作区：硬条件、职责能力、未知待确认和官方原文引用分开。
- `/applications/:caseId/resume` 的静态岗位定制简历工作区：简历结构、A4 主预览、当前区块建议和明确的接受/编辑后采用/拒绝交互。
- 两个工作区复用既有 `WorkspaceShell / CaseHeader / CaseTabs / ContextInspector`、同一静态 Case、视觉 token 和焦点规则。
- Gate：不存在独立简历品牌、第二套主导航、匹配等级、自动接受或未确认事实写入；1280/320 继续无整页横向溢出。

Phase 1 不得：

- 新增 ApplicationCase 数据库表。
- 移植完整简历编辑器。
- 调用真实 AI 或真实招聘来源。
- 改变公共 `/v1/jobs`、岗位配额、来源资格门或匹配逻辑。
- 实现匹配百分比、适合度等级或自动劝退。

## 5. 概念图事实源

三张 PNG 只提供视觉与布局参考，所有文字和状态解释以[概念图解释契约](../evidence/product/career-os-v2/README.md)为准。

- [概念 01：我的求职看板与岗位侧览](../evidence/product/career-os-v2/concept-01-application-board.png)：只采用壳层、看板和侧览；图中“匹配良好/中/差”无效。
- [概念 02：单岗位 JD 能力工作区](../evidence/product/career-os-v2/concept-02-job-workspace.png)：岗位工作区主基准。
- [概念 03：岗位定制简历工作室](../evidence/product/career-os-v2/concept-03-resume-studio.png)：简历工作区主基准。

合法证据状态只有：`已有证据 / 证据待补充 / 用户尚未确认`。

## 6. 开源参考速查

- **直接组件候选**：OpResume 的 A4 分页、章节排序和 React 编辑组件。
- **简历架构参考**：JadeAI 的模板注册、渲染、导出分层；JobPilot、LuJie 与 JadeAI 有谱系重叠，只审计共同上游一次。
- **中文视觉参考**：resume-design、JobPilot/LuJie 截图；Vue 页面不直接移植。
- **工作流参考**：LuJie CareerKit（一岗一档、逐段确认）、JobSync（看板、时间线、任务）、Career-Ops（STAR+Reflection、复盘）。
- **AI 安全参考**：OfferU 的操作注册、事实 Gate、确认与审计。
- **JD 映射参考**：Resume Matcher 的要求—证据覆盖；禁止匹配分数。
- **文字面试参考**：FaceTomato 的问答节奏和反馈；AGPL 代码不复制，不做语音。
- **工作台交互参考**：Plane（唯一侧栏和项目标签）、Twenty（侧览和可调面板）、Linear（Peek）、Attio（记录页和活动时间线）。
- **采集研究**：ever-jobs、job-pro、JobSync 的 ATS 契约；不得带入代理、Cookie、反爬绕过、聚合平台或自动投递。

完整链接、许可证边界和吸收矩阵见升级计划。

## 7. 后续领域模型摘要

Phase 1B 通过后再实施：

- `ApplicationCase`：同一 owner/岗位最多一个活动 Case，固定岗位版本。
- 阶段：`interested / preparing / applied / interviewing / resolved`；结果为 `offer / rejected / withdrawn / expired / unknown`。
- `JD Ability Map`：硬条件、职责能力、未知待确认，逐项引用官方原文。
- `Resume Document V2`：语义、证据与模板分离；V1 只读转换，首次编辑创建 V2 修订。
- `Interview Session`：文字问题、回答、追问、证据引用与反馈。
- `Debrief`：用户确认后才允许生成新的经历表达修订。
- `Knowledge Clip`：URL、短摘要、适用场景、核验时间和用户笔记。

这些实体必须纳入 owner 隔离、TTL、删除墓碑、owner epoch 和迟到任务拒绝；不得建立第二套认证、数据库、队列、AI SDK、岗位真源或用户事实库。

## 8. 工程边界

- 不抓 BOSS、实习僧、牛客等综合平台，不绕过登录、验证码、Cookie、CSRF 或动态签名。
- 未说明字段保持 `unknown`；资格、证据和偏好分开。
- AI 不修改岗位事实、不创造经历、不调用工具；原简历文件不发送给模型。
- 不自动填写、模拟登录、批量投递或替用户提交。
- `pending_review` 只能进入本机 `local_mvp`；公开 `/v1/jobs` 继续为 0。
- 不提交 `.claude/`、`.data/`、快照、密钥、简历原文、本地数据库或下载 DOCX。

## 9. 新任务启动检查

```text
[ ] 阅读 AGENTS.md、README.md、docs/06-mvp-roadmap.md、本交接和完整升级计划
[ ] 检查当前分支、git status、最近提交与本次交接改动
[ ] 确认新方向已由 ADR-0030 接受，旧“立即恢复来源扩容”目标已暂停
[ ] 确认可信供给分母仍为 22 岗/3 家，100/1000 目标没有取消
[ ] 确认 Phase 1A 已通过，当前唯一目标是 Phase 1B：同一 Case 中的 JD 能力与岗位定制简历静态原型
[ ] 先审查现有 CaseWorkspacePage、ContextInspector、概念 02/03 和解释契约，再提出最小静态交互切片
[ ] 不读取、打印或提交本机 AI 密钥与 .claude/
```

本次交接已完成 Phase 1A 代码和浏览器验收；没有运行真实来源、真实 AI 或数据库迁移，也没有读取或修改 `.claude/`、`.data/`、密钥或本地数据。
