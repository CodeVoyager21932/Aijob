# Aijob Career OS 前后端同步改进当前交付计划

- 状态：**Active / UX-0 与 OS-1–OS-6 五项 Gate 已关闭；OS-7 是下一候选系统总 Gate，尚未实施**
- 生效日期：2026-08-28
- 当前分支：`codex/career-os-ux-convergence`
- 当前切片：`OS-7 系统总 Gate（待 coco 指令开始）`
- 稳定契约：[Career OS 端到端体验与系统契约](../14-career-os-end-to-end-experience-contract.md)
- 追踪矩阵：[UX-0 页面—系统—证据追踪矩阵](career-os-ux-0-end-to-end-traceability-matrix.md)
- 上一切片关闭证据：[OS-6 投递、面试、复盘与数据控制验收](../evidence/product/career-os-v2/os-6-application-interview-debrief-data-control-acceptance-2026-08-28.md)
- 上游关闭证据：[OS-5 Resume Studio 与唯一 Review 写入验收](../evidence/product/career-os-v2/os-5-resume-studio-and-review-v2-acceptance-2026-08-16.md)
- 上游审计基线：[UX-0 端到端契约与基线审计](../evidence/product/career-os-v2/ux-0-end-to-end-contract-and-baseline-2026-08-13.md)
- 动态进度：[MVP 路线与当前决策面板](../06-mvp-roadmap.md)
- 工程入口：[当前项目交接](../handoffs/current.md)
- 上一轮归档：[M0–M4 与 PA-1 交付计划](archive/career-os-m0-m4-pa1-delivery-plan-2026-08-12.md)
- 后续守门：[Private Alpha 与上线就绪 Gate](private-alpha-readiness-gates.md)

## 1. 当前目标

把现有岗位、三轴匹配、推荐、JD 洞察、简历解析与确认、Case、Requirements、Resume V2、Review、旧 Tailoring、投递、面试、复盘、删除和离线身份能力，收敛为一个**数据语义连续、交互自然、视觉统一、可端到端验证**的 Career OS。

本计划不再把后端匹配视为前提。`750/750` 工程基线只证明 M4 候选覆盖过既有闭环，不证明目标信息架构、旧能力归宿、Case 关联、列表投影、路由恢复或最终交互已经端到端匹配。

已确认的纠正原则：

- “优先复用现有后端”是逐项审计后的结论，不是默认假设。
- UX-0 已把每个用户动作绑定到 Contract、Platform 模块、PostgreSQL 事实、权限/并发/删除语义和真实测试；没有绑定的页面不得先做。
- `UX-0` 保留为已关闭的审计名称与实施基线；后续实现统一使用 `OS-1–OS-7`，避免再把里程碑误读为前端 UX 独立优化。
- 每个 OS 切片都按**同切片契约先行**推进：先锁 Contract，再完成 Database/Platform，随即由 Web 消费，最后用真实隔离库联合验收；任何一层单独完成都不能宣称切片完成。
- 旧能力不能仅用“兼容说明还在”冒充“已自然融入”。只有用户能在规范 Career OS 路径中继续使用、刷新后能恢复、数据仍可追溯，才算融合完成。

三张 Career OS 概念图继续作为布局、信息层级和交互关系的高保真目标，不作为业务字段或事实来源。固定产品语义不变：不输出匹配百分比或“匹配良好/中/差”；证据状态只使用`已有证据 / 证据待补充 / 用户尚未确认`。

## 2. 固定系统架构

```mermaid
flowchart LR
    R["WorkspaceShell 与规范路由"] --> U["页面用例 / 查询与命令适配器"]
    U --> C["@aijob/contracts 运行时契约"]
    C --> P["Platform 模块化单体"]
    P --> D["PostgreSQL 唯一事实源"]
    P --> W["现有受控 worker"]
    P --> M["applications / catalog / profile / matching / insights / resume-documents / interviews"]
```

系统责任固定如下：

- React 负责路由、草稿、可见状态和用户确认，不在浏览器内拼接跨领域事实或补写后端没有的结论。
- `@aijob/contracts` 负责请求、响应、状态枚举和 Problem 语义；Web 对本轮改动过的核心响应必须做运行时 schema 校验，不能只用 TypeScript 泛型强转。
- Platform 继续是一个模块化单体。需要跨领域组合时在现有 Platform 应用层形成显式 read model / command adapter，不新增 BFF、第二套服务或第二套事实源。
- PostgreSQL 继续是唯一查询和任务真源。只有现有表无法持久表达必要关联时才提出最小 migration；必须先在当前切片记录原因、回退和测试，不能在页面实现中顺手添加。
- 正常成功路径只使用真实 Platform API、现有服务和隔离测试库。浏览器拦截只允许注入 loopback 延迟或失败，不能伪造成功业务数据。

## 3. UX-0 已确认的端到端差距

| 能力 | 当前后端事实 | 当前 V2 / Web 事实 | 判定与负责切片 |
|---|---|---|---|
| 身份、owner、CSRF、会话恢复 | 已有 owner 隔离、读请求一次恢复、mutation 不自动重放 | OS-1 已把访问 Gate、Utility Bar 与 session boundary 回接到唯一 Shell；各业务页草稿/冲突仍由所属切片处理 | **OS-1 触达范围已关闭**；OS-2–OS-6 随业务页回归，OS-7 总验 |
| 岗位检索与详情 | `/v1/jobs` 已有筛选、facet、cursor 和 unknown 语义 | OS-2 已完成筛选 URL、详情往返、刷新/深链、失败重试与四视口规范页面 | **OS-2 触达范围已关闭** |
| 公共/私有 Case 与固定岗位版本 | 已有幂等创建、owner 404、固定版本、diff/upgrade、删除资产处置 | OS-4 已接入版本状态、字段/Requirements diff、显式确认升级、409 保留对话框和刷新恢复 | **OS-4 已关闭；不静默切换目录版本** |
| 五阶段看板 | OS-3 已扩展 `stage / city / sort / total` 与 query-bound cursor，并增加同快照五列 board | 看板/列表/Peek 已消费服务端完整集合，支持逐列续页、URL 恢复和四视口 | **OS-3 已关闭；无 migration** |
| Requirements / 证据 / 问题 | 已有三证据状态、引用、问题、revision 409、owner 隔离 | OS-4 已关闭规范入口、长文本检查器、深链/刷新/历史恢复及其错误边界 | **OS-4 触达范围已关闭** |
| 三轴匹配 | OS-4 已在现有 MatchRun 与任务 union 上增加 Case-scoped state/create adapter 和 `case_pinned` 执行上下文；服务端派生全部固定输入，Worker 计算前后重验 | Case Overview 已显示 `not_run/current/stale/private/profile_incomplete/failed`，三轴分开且可刷新恢复 | **OS-4 已关闭；无 Case 外键、第二套 Run 或 migration** |
| 推荐 | recommendation run 可基于候选岗位和资料修订生成；OS-2 新增服务器筛选、冻结和带岗位投影 view adapter | `/jobs/recommended*` 已接入，旧 V2 路径重定向；Run 可刷新/深链且不再由浏览器提交候选 IDs | **OS-2 已自然融入规范岗位旅程；OS-4 已关闭 Case 固定版本匹配** |
| JD 洞察 | insights 服务继续按 scope 生成持久确定性聚合，不进入单 Case | `/jobs/insights*` 已接入，scope URL 与 Run 深链可恢复；Case Requirements 保持分离 | **OS-2 已关闭归位与接入** |
| 简历导入与确认 | 解析、原文保留边界、profile/evidence 确认均已存在 | `/resumes/import*` 已承接文本/PDF/DOCX 与一次性确认，旧 V2 `/resume*` 重定向 | **OS-2 已关闭规范入口与 runtime 契约** |
| Resume V2 / Review / DOCX | OS-5 已以 migration 033 扩展 Review v1/v2、固定 public/private Requirements、requirement 引用和 provenance/failure/fallback；旧 v1 不伪造历史 | 三栏 Studio、窄屏三模式、草稿/409/session、逐建议决定、DOCX/打印与 runtime parse 已接入 | **OS-5 已关闭；Review 为唯一新写入** |
| 旧 Tailoring / 受控 AI | Review v2 已复用低层 provider、去标识化和结构化校验；双任务 handler 与写入开关保持滚动部署 fail-closed | 旧 Tailoring 继续历史只读；controlled AI 逐次同意，公开/远程默认关闭，离线 Gate 使用模拟 provider/模板降级 | **OS-5 已关闭；没有复活旧写入流程** |
| 投递、面试、复盘 | 显式投递、模板面试、反馈、复盘确认/回流和选择性删除沿用现有聚合；确认同事务追加 Case event | OS-6 已分离 application/interview/debrief 页面，关闭 revision 409 保稿、session 不重放、确认后唯一回流和刷新/深链 | **OS-6 已关闭；无新 migration** |
| 数据范围与全量删除 | owner 数据范围、选择性删除、全量删除、签名回执和不可读语义继续由现有 Platform/PostgreSQL 承担 | OS-6 已关闭删除后不 bootstrap 新 session、回执 TTL 内可刷新、规范/兼容 URL 和错误恢复 | **OS-6 已关闭**；OS-7 总验 |
| Web API 边界 | Platform 路由会解析请求，服务/测试大量使用 schema | OS-1 建立 parser-aware `apiRequest`；OS-2–OS-5 扩展岗位/Case/Resume，OS-6 扩展 timeline/application/interview/debrief/data scope/legacy/export/deletion 响应 | **OS-1–OS-6 触达范围已关闭**；OS-7 扫描余量 |
| 浏览器证据 | Platform 集成测试覆盖大量 404/409/幂等/删除语义 | OS-6 已用真实 API 四视口 Gate 覆盖投递、面试冲突、复盘事件/回流、旧 Tailoring、选择性/全部删除、回执刷新、lazy load 与 flag 回退 | **OS-6 触达范围已关闭**；OS-7 总验 |

以上主体差距来自 UX-0 代码与运行反证；OS-1 的身份/Shell、OS-2 的岗位与资料入口/推荐/洞察、OS-3 的申请集合/Peek/阶段命令、OS-4 的单 Case Requirements/固定版本/三轴匹配、OS-5 的 Resume Studio/Review 唯一写入，以及 OS-6 的投递/面试/复盘/数据控制与对应 runtime parse、浏览器 Gate 均已实现并通过。OS-7 不因此自动完成。详细逐用例事实和字段级契约见[追踪矩阵](career-os-ux-0-end-to-end-traceability-matrix.md)。

### 3.1 已选择的防返工架构

以下 1–7 项均已随 OS-1–OS-6 触达范围实施；它们继续作为后续回归架构边界：

1. **看板集合：`E`，OS-3 已实现且无语义 migration。** Case list 已增加 `city / sort / total` 和 query-bound cursor；`GET /v1/application-cases/board` 在同一 repeatable-read 快照返回五阶段首批 items、逐列 total 与 cursor。后续单列加载复用 stage list；浏览器不再对分页子集计算全局筛选、排序或计数。隔离库 `EXPLAIN ANALYZE` 未证明需要新索引。
2. **三轴匹配：`E`，OS-4 已实现且不新增 Case 外键。** Case-scoped match adapter 由服务端从 Case 派生固定公共岗位版本、固定 requirement set 和当前已确认资料修订，返回 `not_applicable_private / profile_incomplete / not_run / queued / processing / current / stale / failed`。现有 MatchRun 和同一 Worker 保留；新任务使用严格 schema 的 `case_pinned` 上下文，计算前和写回前都重验 owner、epoch、Case revision、删除状态与固定上下文。幂等 hash 包含请求和全部服务端派生 revisions。结果不复制进 Case；目录 `stale/closed` 与运行输入 stale 分开表达。
3. **市场洞察：`A`，OS-2 已实现。** 规范入口为 `/jobs/insights` 与 `/jobs/insights/:runId`；Run ID 是已持久化结果的深链。Case Requirements 只显示单岗官方/私有要求。V2 的旧 `/insights` 跳转规范入口，V2=false 仍保留旧页。
4. **推荐：`E`，OS-2 已实现且未创建第二种 Run。** 规范页面为 `/jobs/recommended` 与 `/jobs/recommended/:runId`。Platform 已在现有 `/v1/recommendation-runs` 资源下增加“按岗位筛选创建”和“带岗位投影读取”adapter，根据规范筛选和当前确认资料在服务器事务内冻结候选集；浏览器不再先拉取最多 1100 个岗位后提交 ID，也不逐项 N+1。旧 `/recommendations` 在 V2 中跳转新入口。
5. **简历优化：`E + M`，OS-5 已实现且只保留一个新写入所有者。** Resume V2 Review 是模板与受控 AI 的唯一新写入聚合；旧 Tailoring 历史只读。migration 033 以 expand-only 方式加入 Run v2 provenance/failure/fallback、Finding/Suggestion `requirementIds` 与 `resume_review_v2` 任务类型；reader/Worker 双读双 handler，旧 Worker 不领取 v2。public/private 固定 Requirements 在 Platform 和数据库 guard 同时验证。AI 关闭或 provider/schema/引用失败明确模板降级并记录原因；离线验收只用注入的 loopback provider，真实 AI、公开/远程启用仍受原 Gate 约束。一旦存在 v2 Run，pre-v2 应用回滚禁止，只能前向修复。
6. **Web 响应契约：`A`，OS-1–OS-6 触达范围已实现。** `apiRequest` 接受运行时 parser，session/identity/Case、岗位、推荐、洞察、简历/资料、Case list/board/transition/match-state/job-version、Resume 文档/Review/建议决定，以及 timeline/application/interview/debrief/data scope/legacy/export/deletion 响应使用共享 schema；解析失败统一为 Shell 内可重试且不泄露 payload 的 `INVALID_API_RESPONSE`。OS-7 仍需扫描余量，不能再把 `apiRequest<T>` 泛型断言当作契约验证。
7. **投递到删除：`A`，OS-6 已实现且无新 migration。** `/today` 使用单一 Board read model；官方外链与显式投递命令分离；模板 Session、回答/反馈和复盘使用现有 `interviews` 聚合，首次确认在同一事务增加 Case revision 与唯一 `debrief_confirmed` 事件。选择性删除成功后先重读范围再提示；全量 owner 删除后禁止隐式创建新 session，签名回执在既有 24 小时 TTL 内可刷新，只有用户明确开始新身份才恢复 bootstrap。旧 Tailoring 保持只读，旧数据控制 URL 只做兼容归位。

这些选择保持一个 Platform 模块化单体和一个 PostgreSQL 事实源。OS-1 关闭 Requirements 并发一致性读；OS-2 关闭首次并发 session 多 owner 风险并对推荐创建做有界事务重试；OS-3 关闭申请完整集合快照与阶段 mutation 的冲突/不重放语义；OS-4 关闭 Case 固定版本与资料 revisions 的服务端派生、Worker 前后重验和显式升级冲突语义；OS-5 关闭 Review expand-only、双读/双 handler、v2 写入开关、唯一写入和 Resume Studio 视口/草稿缺口；OS-6 关闭投递、面试、复盘确认事件、数据删除、回执和删除后 session 边界。OS-7 不因此自动完成。

## 4. 串行纵向里程碑

| 切片 | 同步交付范围 | 通过条件 | 状态 |
|---|---|---|---|
| UX-0 端到端契约与基线 | 路由、用户动作、领域归属、API/DB/错误/删除矩阵；视觉 token；满态/空态夹具；四视口当前基线 | 核心路径无未归属能力；每行有复用/适配/扩展决定；浏览器基线完成 | **已完成审计 Gate；不等于功能实现** |
| OS-1 系统外壳与运行契约 | WorkspaceShell、访问/会话、路由错误、统一 overlay/focus；必要的响应 schema 适配 | 规范路由不掉回旧 Shell；真实 session/404/error/deep-link 端到端通过 | **已完成五项 Gate；见独立证据** |
| OS-2 资料准备与可信岗位入口 | 岗位目录/详情、推荐/洞察归位、简历导入确认、Case 创建与 URL 恢复 | 用户从可信岗位和已确认资料进入 Case；公开/空目录和 unknown 语义不退化 | **已完成五项 Gate；见独立证据** |
| OS-3 申请看板与 Case 命令 | 看板/列表/Peek；列表 read model、分页、筛选、计数、阶段命令和固定版本入口 | 不依赖“已加载子集”得出完整结果；owner/409/幂等/刷新真实通过 | **已完成五项 Gate；见独立证据** |
| OS-4 单 Case 决策与固定版本匹配 | Case Header、Requirements/Evidence、问题、岗位版本与三轴匹配 | 同一固定岗位版本与资料修订可追溯；无匹配总分；刷新后结果可恢复 | **已完成五项 Gate；见独立证据** |
| OS-5 Resume Studio 与唯一 Review 写入 | 基础/岗位简历、修订、Review、DOCX；旧 Tailoring 历史承接 | 不存在两套可写简历流程；草稿/409/证据引用/删除/DOCX 真实通过 | **已完成五项 Gate；见独立证据** |
| OS-6 投递、面试、复盘与数据控制 | 今日、显式投递、面试、复盘、设置、访问、历史只读和兼容 URL | 同一 Case 贯通投递到回流；删除和兼容行为端到端通过 | **已完成五项 Gate；见独立证据** |
| OS-7 系统总 Gate | 全前台视觉、功能、Contracts、Platform、数据库语义、可访问性、性能、离线与回退 | 全新隔离库、全仓质量、四视口、网络/控制台、删除与 flag 回退全部通过 | **下一候选切片；尚未实施，等待 coco 指令** |

原“全部 UX 约 9–12 个有效开发日”估算建立在主要前端收敛假设上，现已撤回。UX-0 已暴露匹配固定版本、岗位定制 Review、列表投影和浏览器夹具的真实后端/运行成本；后续只在每个 OS 切片启动时按其五项状态单独估时，不恢复未经验证的全局总工期。

## 5. 每个切片的固定执行顺序

每个 `OS-*` 切片必须维护同一张五项状态账本：`Contract`、`Database/Platform`、`Web`、`Integrated Gate`、`Evidence`。状态只允许“未开始 / 进行中 / 通过 / 阻塞”；可以拆分提交，但五项全部通过且证据作出继续决定前，里程碑状态不得写成“完成”。

1. **用户结果与事实源**：定义这个页面允许用户完成什么，哪些字段来自哪个领域模块，哪些必须显示 unknown。
2. **契约先行**：固定规范路由、URL 状态、请求/响应 schema、错误码、owner/CSRF、幂等、revision、删除和恢复语义。
3. **数据可表达性**：证明现有表与关联能持久恢复该结果；不能表达时先记录最小 migration 方案与回退，不直接写 UI 绕过。
4. **Platform 实现与集成测试**：优先复用；必要时在现有模块化单体内增加 read model / adapter / query，禁止把跨领域 join 推给浏览器。
5. **Web 实现**：只消费已锁定契约，覆盖 Loading、空态、错误、404、409、session、删除、刷新和历史导航。
6. **真实纵向验收**：合成数据通过真实 Platform API 和全新隔离 PostgreSQL；验证四视口、键盘、console、network、lazy loading 和回退。
7. **证据与决定**：更新独立证据，只作“继续、修改、回退、停止”之一。上一切片未通过，不进入下一切片。

禁止先完成视觉页面、用临时静态数据或成功响应 mock 占位，再把后端关联留到以后补。

## 6. 关键交互约束

### 申请看板

- 桌面使用五阶段看板和右侧 Peek；移动端使用阶段切换、单列卡片和全屏 Peek。
- `view / stage / city / sort / peek` 必须 URL 可恢复；OS-3 已选择 Case list query + board 初始 read model 承载完整集合，后续不得退回对分页子集静默筛选。
- 卡片只显示 Case 列表 read model 已提供的真实字段；如果概念图需要跨领域进度，先设计无 N+1 的 Platform 投影。
- 不把拖拽作为阶段写入入口；阶段变化只走显式、有 revision 与幂等保护的命令。

### Case、JD 与匹配/洞察

- 单岗位官方 Requirements、用户证据状态、三轴 matching run 和跨岗位市场 insight 是四类不同事实，不得为了贴近概念图合并成“能力匹配分”。
- 所有结果绑定 Case 的固定岗位版本和实际使用的资料修订；岗位版本升级必须显式 diff/确认。
- 右侧检查器只提交后端已有的状态、备注、证据关联和问题；revision 409 保留草稿并要求再次确认。

### 简历工作室

- 左侧为结构、证据和版本；中间为 A4 文稿；右侧为要求、证据和审阅建议。
- 基础简历、岗位简历、模板 Review 与历史 Tailoring 必须形成一个明确的写入所有权；不得并存两套会继续产生不同事实的编辑流程。
- 建议只能接受、编辑后采用或拒绝；不得自动写入或引用未确认事实。
- 移动端使用“结构 / 文稿 / 建议”模式切换，不强行压缩三栏。

## 7. 实现边界

- 保持一个 `WorkspaceShell`、一个 Platform 模块化单体和一个 PostgreSQL 事实源；不新增第二套 Shell、BFF、数据库、Redis、向量库、消息总线、认证体系或 AI SDK。
- 不再写“禁止所有 migration”作为未经审计的结论；但任何 migration 都必须由不可表达的持久语义证明，并在实施前明确记录、测试和回退。纯视觉便利不能成为 migration 理由。
- 看板首屏不得为每张卡片产生 N+1 请求；跨领域摘要由 Platform read model 提供或从已证明完整的单一响应得出。
- Resume Editor、Interview 和数据设置继续独立 lazy load；旧 eager 页面逐切片拆出主包。
- 不引入第三方 UI 框架、外部字体、CDN 或新的远程运行依赖。

## 8. Gate 与验收

每个核心用例必须同时覆盖：正常满态、真实空态、Loading、API 失败/重试、跨 owner/非法 404、revision 409 草稿保留、session 恢复后 mutation 不重放、删除后不可读、刷新、深链和前进/后退。

浏览器固定验证：

- 1536 CSS px：与概念图逐项对照结构、密度和交互关系。
- 1280 CSS px：完整桌面主路径。
- 320 CSS px 与 200% 等效视口：无页面级水平滚动，内容正确重排。
- 键盘、可见焦点、抽屉/对话框焦点约束与关闭后焦点返回。
- 控制台无新增 warning/error，网络只访问 loopback。
- 看板和 Case 首屏不加载 Resume Editor/Interview，不发生卡片级 N+1。
- Web 主包相对 PA-1 的 566.69 kB 基线增长不超过 10 kB；超出必须拆包或回退。
- DOCX、打印、删除、离线会话和 `VITE_CAREER_OS_V2=false` 回退不得退化。

总 Gate 运行与改动相称的 focused tests，以及全仓 lint、typecheck、全新 `aijob_*_test_*` 隔离 PostgreSQL、全部测试、build、audit 和 diff check。

## 9. 固定排除与证据边界

- 不访问真实招聘来源、真实 AI、真实邮件、服务器、参与者或真实简历。
- 不获取外部解析镜像，不启动供给扩容或 Private Alpha 参与者工作。
- 不读取、修改、暂存、覆盖、清理或提交 `.claude/`、`.data/`、密钥、令牌、真实简历原文、本地业务数据库、下载产物或截图。
- 不把合成满态、工程通过、架构收敛或视觉完成计为真实岗位供给、用户价值或 Private Alpha 就绪。
- 产品证据在获得可复核目标用户行为前保持 E0。

Private Alpha 的供给、服务器、安全和参与者条件继续由[就绪 Gate](private-alpha-readiness-gates.md)守门；该 Gate 不得覆盖本计划的当前切片。
