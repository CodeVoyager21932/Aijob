# UX-0 端到端契约与基线审计

> 日期：2026-08-13
>
> 分支：`codex/career-os-ux-convergence`
>
> 起始 HEAD：`d23bdaa docs(plans): activate career os ux convergence`
>
> 当前决定：**修改 / 保持 UX-0。视觉/交互规则、端到端领域归属和六个结构性接缝的字段级静态草案已形成；逐项代码反证、Review migration 的 legacy/new-write 兼容断言和四视口运行基线仍未完成，不得进入 UX-1。**

稳定实施契约见 [Career OS 端到端体验与系统契约](../../../14-career-os-end-to-end-experience-contract.md)。

逐用例工作底稿见 [UX-0 页面—系统—证据追踪矩阵](../../../plans/career-os-ux-0-end-to-end-traceability-matrix.md)。

## 1. 本轮范围

UX-0 只建立后续实现必须遵守的可复核基线，没有重做页面、修改产品代码、添加后端能力、启动数据库或访问外部系统。2026-08-13 coco 明确要求不能把后端匹配当作前提，必须在页面实现前同步审计 Web、Contracts、Platform 与数据库语义；本证据因此由“视觉基线”纠正为“端到端契约与基线”。

完成的工作：

1. 核对 Git、远端跟踪、工作树、端口和 Docker 状态。
2. 按实际像素内容检查三张概念图，记录尺寸、哈希和误标差异。
3. 审计 V2/旧路由、Shell、lazy chunk、页面状态和旧能力当前归宿。
4. 只读核对 Application、Matching、Recommendation、Insights、Resume、Tailoring、Interview、Profile 与 Identity 的 Contracts、API 适配器和 Platform 路由。
5. 审计现有 CSS token、字体、密度、响应式、焦点和 overlay 行为。
6. 设计隔离合成满态与真实空态验收夹具，不建设产品演示模式。
7. 把 UX-1–UX-7 改为 Contract、Platform/DB、Web、真实隔离库浏览器验收同步完成的纵向切片。

未做的工作：

- 没有访问真实招聘来源、真实 AI、邮件、服务器、真实简历、参与者或本地业务数据库。
- 没有读取、修改或提交 `.claude/`、`.data/`、密钥、令牌、下载产物或截图。
- 没有添加或修改 Contracts、API、数据库、migration、Redis、向量库、队列、认证或 AI SDK。
- 没有修改 `apps/web/src` 产品代码，也没有偷跑 UX-1。

## 2. Git 与运行状态

核验开始时：

| 项目 | 实际结果 |
|---|---|
| 分支 | `codex/career-os-ux-convergence` |
| HEAD | `d23bdaa`，与 `origin/codex/career-os-ux-convergence` 一致 |
| tracked 工作树 | 干净 |
| 最近基线 | `d03219f` PA-1、`aa4cf75` M4-4、`6ea75fc` M4-3 均可追溯 |
| 3000 / 5173 / 5432 | 2026-08-13 均未监听 |
| Docker | Docker API 不可用；未发现可核验的运行中项目容器 |

这与 2026-08-12 当前交接中“服务正在运行”的时点记录不同。差异来自运行状态变化，不是代码或产品基线冲突；活动交接必须改为今天的实际状态。

本轮曾尝试只启动 Vite 读取无数据库的错误/空运行基线：

- 沙箱外 `127.0.0.1:5173` Vite 能正常就绪，并被生命周期助手自动停止。
- 捆绑 Playwright 元数据指向已不存在的浏览器；改用本机 Chrome 后，开发 HMR 使最初的 `networkidle` 等待不结束，任务被主动终止，端口随后确认停止。
- 修正为 `DOMContentLoaded + 固定稳定窗口` 后，沙箱外运行额度被系统拒绝；没有再次绕过或重试。
- 因此本证据不声称 2026-08-13 已重新完成浏览器四视口验收。

## 3. 概念图核验

### 3.1 文件标签差异

交接中的第 1 与第 3 个文字标签互换：

- `exec-fbfc5aa0...png` 实际是**简历工作室**，不是申请看板。
- `exec-da0cb770...png` 实际是**JD 能力工作区**，与标签一致。
- `exec-73a133e8...png` 实际是**申请看板与 Peek**，不是简历工作室。

后续实现以图片实际画面和[稳定契约中的哈希表](../../../14-career-os-end-to-end-experience-contract.md#41-文件身份)为准，不按旧序号猜测。

### 3.2 采用结论

| 画面 | 采用 | 拒绝 / 替换 |
|---|---|---|
| 看板 + Peek | 统一 Shell、五阶段、紧凑卡片、列表/看板、筛选、Peek、显式打开 Case | 匹配等级、示例公司/数量/任务、拖拽直接写阶段 |
| JD 能力 | Case Header、六标签、阶段进度、固定版本、要求分组、右侧检查器 | “已验证”改为“已有证据”；AI 式总建议改为确定性下一步 |
| Resume Studio | 结构 / A4 文稿 / 建议三栏、打印、DOCX、逐建议决策 | 独立 AI 品牌、自动写入、未经确认事实、移动端压缩三栏 |

合法证据状态保持：`已有证据 / 证据待补充 / 用户尚未确认`。

## 4. 路由与旧能力基线

### 4.1 已有正确基础

- `VITE_CAREER_OS_V2=true` 时，`/today`、`/applications*`、`/resumes*`、`/settings/data*` 和旧岗位/简历兼容路由已置于 `WorkspaceShell` 的父路由下，见 `apps/web/src/App.tsx`。
- Case 六标签固定为概览、JD能力、定制简历、投递、面试、复盘，见 `apps/web/src/career-os/workspace-model.ts`。
- Workspace、Applications、Case、Resume Assets、数据设置和兼容页已经 lazy load；Case 的 Requirements、Resume、Application、Interview 继续二级 lazy load。
- `/recommendations` 与 `/insights` 当前是零请求兼容说明；旧 Tailoring 在 V2 中只读；这证明旧入口没有发起新写入，但**不证明能力已经自然融入 Career OS**。
- `apps/web/src/career-os/runtime-boundary.test.ts` 明确禁止旧静态 Case fixture 进入正常 V2 运行图。

### 4.2 已确认接缝

| 接缝 | 当前事实 | 后续归属 |
|---|---|---|
| V2 404 | 通配路由仍使用 `ProductShell`，甚至返回内部预览链接 | UX-1 |
| 路由异常 | 只有 Suspense，没有 Shell 内路由 Error Boundary | UX-1 |
| 简历规范路由 | 计划要求 `/resumes/import*`，代码仍只有 `/resume*`；`/resumes/import` 当前会被当成 document ID | UX-5 |
| 岗位筛选 | 仍保存在组件 state，刷新或从详情返回会丢 | UX-5 |
| Matching / Recommendation / Insights | V2 禁用岗位详情旧匹配动作，并把推荐/洞察降为兼容说明；规范入口与系统归属现已锁定但未实现 | UX-3、UX-5 实施 |
| 旧 Tailoring | V2 只读；现已锁定 Resume Review 为唯一新写入，旧 run 继续历史只读 | UX-4 实施并验证迁移兼容 |
| Interview / Debrief | 两个 tab 渲染同一组件，`/debrief` 不直接聚焦复盘 | UX-6 |
| SPA 草稿 | Resume Editor 保护浏览器 unload，但站内导航/后退仍可能丢未保存草稿 | UX-4 |
| session UI | API 能恢复读请求并禁止 mutation 自动重放；访问 Gate 和页面级恢复仍有接缝 | UX-1、UX-7 |
| 主包 | 多个旧页面在 `App.tsx` eager import，继续占用 566.69 kB 主包 | UX-5、UX-6、UX-7 |

完整最终路由处置见[稳定契约第 5 节](../../../14-career-os-end-to-end-experience-contract.md#5-信息架构与旧能力处置)。路由 URL 的去留只能在能力、事实源和恢复语义同时明确后通过；本轮不再把“已有兼容页”计为融合完成。

## 5. Contracts、Platform 与数据语义审计

### 5.1 已确认可复用的主体能力

- `applications` 已提供 owner 隔离的 Case 创建/读取/删除、显式投递、stage transition、固定岗位版本 diff/upgrade、Requirements/Evidence/Questions 与 revision 语义。
- `resume-documents` 已提供基础/岗位文档、不可变内容与布局修订、**模板** Review、逐建议决策、DOCX 和删除；`controlled_ai` 只存在于 mode 枚举/表约束，创建请求、Worker 和 provenance 尚未实现。
- `interviews` 已提供模板面试、回答、反馈、复盘准备/确认、回流和选择性删除。
- `profile` 与 `identity` 已提供长期 owner、事实/偏好/已确认经历证据、data scope、全量删除、CSRF、session boundary 与 mutation 不自动重放。

这些是“主体能力存在”的证据，不代表最终页面和跨领域关系已经匹配。

### 5.2 已确认的结构性接缝

| 接缝 | 代码事实 | 为什么会导致后续返工 |
|---|---|---|
| 看板集合不完整 | `ListApplicationCasesQuerySchema` 只有 `cursor / limit / stage`；Web `ListApplicationCasesInput` 连 `stage` 都没有，页面对已加载 pages 做 city/sort | 视觉先完成后才会发现筛选、列计数和排序只对部分数据成立 |
| Platform 命令未进入 V2 | 后端已有 `/transitions`、`job-version-diff`、`job-version-upgrades`；`apps/web/src/api/career-os.ts` 没有对应适配器 | 页面会被迫重复业务判断或在后期补命令流程 |
| 三轴匹配没有 Case 执行上下文 | `MatchRun` 绑定岗位版本和资料修订，但 `requirementSetForVersion` 与 Worker 都要求岗位仍是 current/public pointer；Case 按 ADR-0030 固定的旧版本无法直接运行 | 只加页面入口会在岗位版本变化后失败，必须同步扩展 Case-pinned task/Worker 语义 |
| 推荐没有规范入口 | recommendation run 存在；V2 `/recommendations` 只渲染兼容说明 | “旧功能代码还在”不等于用户在目标系统中可用 |
| Insights 语义不同 | `CreateJobInsightRunRequest` 按 scope 聚合，Run 保存候选岗位/要求集合；它不是单 Case 官方 Requirements | 若直接塞进概念图 JD 面板，会把市场聚合与单岗位事实混为一谈 |
| Review 并非岗位定制 | `processResumeReview` 只加载 content/evidence 并调用 `createTemplateReviewDrafts`；没有加载 Run 已固定的 public/private Requirements，Finding/Suggestion 也没有 `requirementIds` | 视觉上称为“岗位简历审阅”会掩盖后端语义并未成立，后续 AI 接入还会再次改表和 Contract |
| 两套简历写入历史 | Tailoring run/逐段决策/导出存在；V2 只读；Resume V2 又有独立 Review/修订/DOCX | 不先决定唯一新写入所有者，会长期保留两套语义并再次返工 |
| Web 响应只做类型断言 | 通用 `apiRequest<T>` 对多数业务响应直接 `as T` 返回，只有部分 identity 路径显式 schema parse | Contracts 与实际响应漂移可能直到页面运行才暴露 |

### 5.3 当前不能下的结论

- 不能说“后端都是匹配的”。更准确的结论是：Case、Requirements、Resume V2、Interview、Deletion 的主体语义较强；列表投影和旧 Matching/Recommendation/Insights/Tailoring 的 V2 归属存在实质接缝。
- 不能笼统断言“后端不用 migration”。看板、Case matching 和 Recommendation 可在现有表上扩展；但岗位定制 Review 的 requirement 引用与受控 AI provenance/failure 无法由现有表可靠表达，已经证明需要一项 v1/v2 兼容的最小 expand migration。
- 不能保留原 9–12 日总估算。该估算没有覆盖固定旧版本匹配、岗位要求引用、迁移兼容和真实浏览器夹具；须在 UX-0 全部 Gate 通过后重估。

### 5.4 已选择但未实施的架构处置

| 接缝 | 选择 | migration 判定 |
|---|---|---|
| 看板完整集合 | Case list 增加 city/sort/total，新增同快照五列 board read model；客户端不再对分页子集计算全局结果 | 当前不需要；索引只凭 `EXPLAIN`/延迟证据 |
| MatchRun 的 Case 恢复 | Case-scoped adapter 用固定公共岗位/requirement 版本和当前资料修订创建/查回 run；服务端派生输入进入幂等 hash；新增 `case_pinned` task payload，Worker 处理前与写回前重验 Case | 不需要 Case 外键或表 migration，但需要 Contract/Platform/Worker 扩展 |
| Insights | 归入 `/jobs/insights*` 市场洞察；从单 Case JD 面板明确排除 | 不需要 |
| Recommendation | 归入 `/jobs/recommended*`；在现有 RecommendationRun 资源下由 Platform 从规范筛选冻结候选并返回岗位显示投影 | 不需要，不创建第二种 Run |
| Tailoring / Review | Resume V2 Review 是模板与受控 AI 的唯一新写入；template/AI 都读取固定 Requirements，旧 Tailoring 历史只读；v2 使用同一队列的新任务类型，使旧 Worker 不领取 | **需要最小 expand migration**：Run v2 provenance/failure/fallback；Finding/Suggestion v2 requirement IDs；versioned task type；legacy v1 不回填臆造 provenance |
| Web response | parser-aware `apiRequest`，触达端点使用共享 schema | 不需要 |

选择依据来自 ADR-0030 的“单 Case 共同上下文”、ADR-0031 的“applications/Case 为新业务真源、旧路由只作兼容/历史”、ADR-0013 的受控 AI 降级/审计边界和现有代码可表达性。字段级 schema、Problem、回退与核心断言已经写入[追踪矩阵](../../../plans/career-os-ux-0-end-to-end-traceability-matrix.md)，但尚未实现或运行验证，因此它们是实施约束，不是功能完成声明。

## 6. 页面状态基线

### 6.1 当前覆盖摘要

| 页面族 | 当前较完整的状态 | 当前主要缺口 |
|---|---|---|
| 今日 | 满态、真实空态、Loading、错误 | 错误无显式重试，局部状态不进 URL |
| 我的求职 | 满态、真实空态、筛选空态、Loading、错误重试、URL Peek | Peek 404 静默关闭，创建冲突只有通用错误 |
| Case 父页 | Loading、Case 404、删除后跳回列表 | 非 404 无重试；非法 tab 静默回 overview |
| Requirements | 满/空/Loading/Error/Retry、404、409 草稿保留 | 未保存草稿刷新会丢，overlay 语义不完整 |
| Resume Case | 前置空态、编辑满态、Loading/Error/Retry、409 | SPA 导航草稿风险、响应式裁剪风险 |
| Application | 时间线满/空/Loading/Error/Retry、409 | 局部选择不进 URL |
| Interview / Debrief | 练习、反馈、复盘满/空/Loading/Error/Retry、404、部分 409 | 两路由没有各自焦点；完整 UI 冲突验收不足 |
| Resume Assets | 资产满/空、Loading/Error/Retry、编辑与删除 | 详情把所有错误写成“不存在”；删除冲突语义不完整 |
| Jobs / Job Detail | 列表状态较完整 | 详情 404 不区分；筛选与返回状态丢失 |
| 导入 / 确认 | 输入、解析、扫描件、确认和部分错误 | 仍是旧 URL；404/409/草稿恢复不统一 |
| 数据设置 / 全量删除 | 数据摘要、删除入口、删除进度和重试 | 顶层错误、单项冲突和 session 回接不统一 |
| 兼容 / 历史只读 | 零请求或只读边界正确 | 读取失败与 404 无统一恢复 |

### 6.2 全局 session 基线

`apps/web/src/api/client.ts` 与相应测试已经证明：

- 读请求跨 session boundary 最多自动恢复一次。
- mutation 不自动重放；恢复后返回 `SESSION_RECOVERED_RETRY_REQUIRED` 409，要求用户重新确认。
- owner 边界清理查询缓存和本地 journey。

但页面层尚未统一处理会话中途失效、全量删除后重新进入访问 Gate，以及恢复后草稿和 URL 是否保持；这些继续作为后续 Gate，不能因底层单测存在就写成已完成。

## 7. 视觉实现基线

### 7.1 token 失控是主要根因

`apps/web/src/career-os/career-os.css` 约 6391 个物理行。根层只定义 17 个颜色/几何变量，没有字体、字号、行高、间距、控件高度、圆角、阴影或层级 token。

静态字面量审计发现：

- 205 种 hex 写法、29 种 rgba。
- 63 种字号、14 种字重。
- 116 种 padding 表达式、23 种圆角、22 种阴影、13 个 z-index 值。

这解释了为什么单个页面看似“已经有样式”，整体仍显得拼接：当前是逐组件调参，不是可持续设计系统。

### 7.2 字体、密度与对比

- UI 使用 `Inter` 开头的本机字体栈，但没有 `@font-face`；跨电脑字宽和换行不可复现。
- 页面存在 35–55px 大宋体标题与约 9.4–12px 微型正文并存的双峰密度。
- 现有 focus outline 是 28% 透明蓝，白底合成对比约 1.49:1。
- 绿色/琥珀/未确认小字状态对比约 4.15/3.20/3.85:1；后两类在小字号下不足 4.5:1。
- `career-os.css` 与 `styles.css` 的旧 R2 米白/群青/大 Hero 语言同时存在；旧页面被嵌入 WorkspaceShell 后视觉仍明显割裂。

稳定契约因此固定了最小 12px、标准字重、有限圆角/阴影、可访问状态色与不透明焦点环。

### 7.3 overlay 与键盘

当前正向基础：

- Skip link、main landmark、路由后 main 聚焦。
- Peek URL 化、关闭后尝试返回 Case trigger。
- ResizablePane 具有 separator 语义和方向键。
- 全局搜索支持 Ctrl/Cmd+K、Escape、初始焦点与普通返焦。
- 删除对话框支持初始焦点、Escape 与返焦。

当前系统性缺口：

- 所有 `aria-modal=true` surface 都没有完整 Tab/Shift+Tab 圈闭与背景 inert。
- 移动 Sidebar、Peek、Requirement inspector 缺统一 dialog 语义、打开聚焦和 Escape。
- 搜索 modal 位于顶栏 stacking context 内，可能被更高层侧栏覆盖。
- Desktop Requirement inspector 的关闭动作没有真正收起。
- 返焦失败缺少 `h1 → main` 的统一降级策略。

这些必须由 UX-1 的统一 overlay/focus primitive 解决，不能继续散落在各页面。

## 8. 四视口代码派生基线

以下是从当前 CSS、组件几何和历史 M4 浏览器证据推导的**风险基线**，不是 2026-08-13 新浏览器通过声明。

| 视口 | 当前代码事实 | 风险 / 结论 |
|---|---|---|
| 1536 CSS px | 248px sidebar + 默认 360px Peek 后，main 内容约 860px；五列最低约 1138px | 五列 + Peek 必然使用内部横滚，达不到概念图同屏密度 |
| 1280 CSS px | 1439 断点强制 76px rail；无 Peek 内容宽度已贴近看板最低宽度；最大 Peek 后列表轨道可能超过画布 | 容易局部横滚或被父级 `overflow:hidden` 裁剪 |
| 320 CSS px | sidebar 转抽屉，main padding 14px，看板单列，Peek/inspector 全宽 | 历史 M4 曾实测页面无水平滚动；本轮仍须验证“没有内容被裁掉”而不只看 scrollWidth |
| 200% / 640 CSS px | 会进入当前移动断点 | 大部分重排路径存在，但 modal 键盘约束未完成 |
| 200% / 768 CSS px | 比 `max-width:767px` 高 1px，仍处 tablet 双栏；Resume editor 最小轨道约 454px，而右侧可用约 384px | 存在约 70px 静默裁剪风险，是必须补验的边界 |

当前 main 使用 `overflow-x:hidden`，所以“没有出现滚动条”不能自动证明布局通过。稳定契约把页面级横向滚动禁止，并只为看板、tabs、步骤和历史轨道保留明确白名单。

## 9. 验收夹具设计

### 9.1 现有可复用基础

- `apps/web/scripts/m1-browser-gate.cjs`：可复用公共合成岗位与基础简历 seed，但只有一岗一简历。
- `apps/web/scripts/m4-browser-fixture.cjs`：已有 loopback + `aijob_*_test_*` fail-closed 保护，但只有 `seed-job` 与 `seed-resume`。
- Application、Resume、Interview 的 Platform integration tests 已覆盖完整生命周期语义，但 builder 内嵌在大型测试中，尚不能直接作为浏览器 manifest。
- Web 没有 MSW、JSDOM 或纳入 CI 的 Playwright 状态测试；历史浏览器 runner 不是当前可重复 UX fixture。

### 9.2 已锁定方案

使用两套全新数据库：

1. `aijob_ux_full_test_<uuid>`：五阶段 Case、三证据状态、基础/岗位/脱离简历、Review、投递、面试、反馈、复盘和删除目标。
2. `aijob_ux_empty_test_<uuid>`：只迁移和建立匿名 owner，不写业务数据，用真实 API 验证空态。

成功业务响应必须来自真实 Platform API 与隔离 PostgreSQL；浏览器拦截只用于 loopback 延迟、一次失败或断网，不能伪造成功。404、409、session 和删除都走真实后端语义。

夹具必须输出 schema 校验过的 machine-readable manifest，使用 `.example.test` 和“合成·…”命名，并在结束后按精确库名清理。它不得进入 `apps/web/src` 或形成产品演示模式。

完整 manifest 与安全规则见[稳定契约第 11 节](../../../14-career-os-end-to-end-experience-contract.md#11-隔离验收夹具契约)。夹具本轮只设计、未实现；它还必须覆盖 matching、recommendation、insights 和历史 Tailoring 的规范归属，不能只 seed 一岗一简历后声明全系统融合。

## 10. UX-0 Gate 判定

| Gate | 结果 |
|---|---|
| 路由与旧能力处置矩阵 | **静态通过**；matching/recommendation/insights/Tailoring 的规范归属、兼容入口和唯一写入已锁定，尚未实现 |
| 页面—动作—Contract—Platform—DB—测试矩阵 | **部分通过**；逐用例与字段级草案、Problem 和核心断言已形成；代码反证、migration legacy/new-write 兼容和运行验证待完成 |
| 概念图采用/拒绝/响应式规则 | 通过，并纠正两张图片的标签互换 |
| 视觉 token、密度、焦点和 overlay 契约 | 通过，已经固定 |
| 满态与真实空态夹具设计 | 通过；设计完成，未实现 |
| 1536 / 1280 / 320 / 200% 当前运行基线 | **未通过**；只有静态风险推导和历史 M4 证据，本轮浏览器未完成 |
| 产品代码边界 | 通过；没有修改产品代码或扩建后端，仅做只读审计和文档纠正 |
| 离线与数据安全 | 通过；没有访问外部系统或禁区 |

最终决定是 **修改**：保持 `UX-0`，不进入 UX-1。下一动作是逐项用现有 Contract、SQL、Platform 路由/Worker 和测试反证字段草案，完成 Review v1/v2 migration 的前向/回退条件检查，并补齐四视口实时浏览器基线；任一项未完成都不能开始页面实现。若核验与当前文档冲突，先修改契约，不静默选择前端或后端一方。

产品证据继续为 E0；本轮设计审计不代表用户价值、真实供给或 Private Alpha 就绪。
