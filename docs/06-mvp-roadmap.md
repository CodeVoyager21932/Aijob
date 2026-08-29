# MVP 路线与当前决策面板

> 本文是当前阶段、真实分母、Gate 状态和下一决定的唯一动态事实源。历史执行细节只由验收证据和归档保留，不得提供当前任务。

## 1. 最新决定（2026-08-28）

- M1–M4 的本地一岗闭环和工程/浏览器 Gate 已完成；PA-1 离线身份与解析隔离候选也已完成。
- coco 对当前系统进行了产品复核：现有功能闭环真实存在，但最终用户旅程与三张 Career OS 概念图在视觉保真、信息密度、整体成品感和旧能力自然融合方面仍有明显差距。
- 因此当前不继续服务器、真实邮件、真实来源、供给扩容或参与者工作，改为执行已批准的[Career OS 前后端同步改进计划](plans/career-os-current-delivery-plan.md)。
- 2026-08-13 coco 进一步明确：不得把纠正计划理解成前端独立优化，也不得默认后端已经匹配。每个用户结果必须同步核对 Contracts、Platform、PostgreSQL、Web 与真实隔离库证据，避免页面完成后再返修后端。
- 三张概念图作为布局、信息层级和交互关系的高保真目标。图中公司、岗位、日期、数量和建议不是事实；“匹配良好/中/差”等标签明确拒绝。
- `UX-0 端到端契约与基线` 已关闭：视觉/交互审计、六项结构性接缝的代码反证、Review v1/v2 expand/滚动部署/回滚边界与四视口实时运行基线均已完成。审计确认 Case、Requirements、Resume V2、Interview、Deletion 的主体后端语义较强，但看板列表投影、Case 固定旧版本匹配、Recommendation/Insights 规范入口，以及 Review 的岗位要求引用与受控 AI provenance 存在实质接缝。见[端到端契约](14-career-os-end-to-end-experience-contract.md)与[UX-0 审计证据](evidence/product/career-os-v2/ux-0-end-to-end-contract-and-baseline-2026-08-13.md)。
- UX-0 临时使用全新隔离 PostgreSQL、loopback Platform/Web 和合成数据完成运行反证；精确库与服务已清理，2026-08-13 当前 3000、5173、5432 均未监听。
- UX-0 四视口基线当时量化了失败而不是伪造通过：看板在 1536/1280/768 分别内部溢出约 293/361/513px，768 Resume Studio 静默裁剪约 127px，Peek/Requirement inspector 缺 dialog 语义、打开聚焦和 Escape。OS-1、OS-3 与 OS-5 已分别关闭各自归属缺口。
- `OS-1 系统外壳与运行契约` 已关闭五项状态：V2 访问、404/loading/route error 保留在唯一 `WorkspaceShell`，账号状态回接真实 session，统一 overlay/focus 覆盖 Peek、导航、命令菜单、Requirement inspector、私有 JD 与删除确认；触达响应使用共享 runtime schema 并脱敏失败。真实浏览器 Gate 同步复现并修复了 Requirements repeatable-read 的 PostgreSQL `40001` 并发读冲突，只对读取做有界重试，不重放 mutation。见 [OS-1 验收证据](evidence/product/career-os-v2/os-1-system-shell-and-runtime-contract-acceptance-2026-08-13.md)。
- OS-1 使用全新隔离 PostgreSQL、loopback Platform/Web 与合成数据完成 1536/1280/768/320 四视口 Gate；精确数据库、临时运行物和服务已清理。其后 OS-5 已关闭 Resume Studio 裁剪。
- `OS-2 资料准备与可信岗位入口` 已关闭五项状态：服务器按岗位筛选和当前确认资料冻结 RecommendationRun 候选/要求/新鲜度，规范 `/jobs*`、`/jobs/recommended*`、`/jobs/insights*` 与 `/resumes/import*` 已接入，岗位筛选、持久 Run、简历确认和 Case 创建可从 URL 刷新恢复。见 [OS-2 验收证据](evidence/product/career-os-v2/os-2-profile-and-trusted-job-entry-acceptance-2026-08-13.md)。
- OS-2 使用全新隔离 PostgreSQL、loopback Platform/Web、合成数据与真实本地 worker 完成 1536/1280/768/320 Gate；精确数据库、临时运行物、容器/网络和服务已清理，3000、5173、5174、5432 均未监听。
- `OS-3 申请看板与 Case 命令` 已关闭五项状态：Case list 支持完整集合的阶段/城市/排序/总数和 query-bound cursor；固定五列 board 在同一 repeatable-read 快照返回首批 items/total/cursor；看板、列表、Peek 与显式阶段命令统一覆盖 owner、404、revision 409、幂等和 session mutation 不重放。见 [OS-3 验收证据](evidence/product/career-os-v2/os-3-application-board-and-case-command-acceptance-2026-08-14.md)。
- OS-3 使用全新隔离 PostgreSQL、loopback Platform/Web 与 26 个合成 Case 完成 1536/1280/768/320 Gate；精确数据库、临时运行物、容器/网络和服务已清理，3000、5173、5174、5432 均未监听。性能反证没有支持新增索引或 migration。
- `OS-4 单 Case 决策与固定版本匹配` 已关闭五项状态：新增 Case-scoped match state/create 契约，Platform 由 Case 派生固定岗位版本、要求集和当前资料修订，现有 Worker 以受约束的 `case_pinned` 上下文在计算前后重验；Web 已接入三轴分离结果、岗位版本 diff/显式升级、Requirements 深链与 409 再确认。见 [OS-4 验收证据](evidence/product/career-os-v2/os-4-case-decision-and-pinned-match-acceptance-2026-08-14.md)。
- OS-4 使用全新隔离 PostgreSQL、loopback Platform/Web、合成公共/私有 Case 与真实本地 Worker 完成 1536/1280/768/320 Gate；没有新增 migration、服务或依赖。精确数据库、临时运行物和服务已清理，3000、5173、5174、5432 均未监听。
- `OS-5 Resume Studio 与唯一 Review 写入` 已关闭五项状态：Review Run v1/v2、固定 public/private Requirements 与引用、版本化 provenance/failure/fallback、双任务 handler 和 expand-only migration 033 已接入；Web 已形成三栏 Studio、窄屏三模式、草稿/409/session 不重放、逐建议决定、DOCX/打印与 runtime parse。旧 Tailoring 保持历史只读，真实/远程 AI 默认关闭。见 [OS-5 验收证据](evidence/product/career-os-v2/os-5-resume-studio-and-review-v2-acceptance-2026-08-16.md)。
- OS-5 使用全新隔离 PostgreSQL、loopback Platform/Web、合成 public/private Case、确定性模板和注入的 loopback provider 完成 1536/1280/768/320 Gate；没有访问真实招聘来源或真实 AI。精确数据库、临时运行物和服务已清理，3000、5173、5174、5432 均未监听。
- `OS-6 投递、面试、复盘与数据控制` 已关闭五项状态：`/today` 使用单一 Board read model；官方外链和显式投递分离；模板 Session、回答/反馈、复盘逐项决定与确认后回流从同一 Case 可恢复；首次确认同事务追加唯一 `debrief_confirmed` 事件。选择性删除、全量 owner 删除、签名回执、规范/兼容 URL 与删除后 session bootstrap 边界均已统一；旧 Tailoring 保持只读。见 [OS-6 验收证据](evidence/product/career-os-v2/os-6-application-interview-debrief-data-control-acceptance-2026-08-28.md)。
- OS-6 使用全新隔离 PostgreSQL、loopback Platform/Web、合成岗位/owner/简历/证据和确定性模板完成 1536/1280/768/320 Gate；没有访问真实招聘来源、真实 AI、邮件或服务器。精确测试库、临时运行内容和服务已清理，3000、5173、5174、5432 均未监听；Windows 执行策略拒绝删除 19 个已核验为空的临时目录壳，其中没有文件、数据或进程。
- `OS-7 系统总 Gate` 已完成五项状态：满态库 + 真实空库的 `os7-browser-gate.cjs` 8 个 step 全过并输出 `passed: true`，其中 step 7（空库空态）与 step 8（flag-off 与 manifest 数据库断言）为历史首次执行到并通过。Gate 修复了 4 项真实 Web 缺陷，包括旧 hero 标题上限规则因特异性不足**一直未生效**（旧 `.product-app .product-hero:not(...) h1` 在 1280px 为 58.88px）。全仓 808/808、lint 485 files、typecheck、build（主包 401.33 kB，上限 411.31 kB）、audit 与 diff check 通过。见 [OS-7 验收证据](evidence/product/career-os-v2/os-7-system-gate-acceptance-2026-08-28.md)。
- OS-7 过程中发现一处**预先存在**的 typecheck 缺陷（`apps/platform/src/resume-documents/routes.integration.test.ts`）。已用 `git diff e56ceae` 证明该文件与 `tsconfig.base.json` 与 OS-6 基线逐字节相同，因此 OS-6 记录的“typecheck 通过”对该文件并不成立；已修复并明确登记，不抹去该缺口。
- 当前决定为**OS-7 已完成，Career OS 前后端同步改进阶段收敛结束**；coco 于 2026-08-28 选择「供给准入扩容」为下一条轨道。执行按 [供给准入扩容轨道计划](plans/supply-admission-scaleup-track.md)，当前处于阶段 0（不触网）。
- SA Track 阶段 0 之后的任何触网评估（`source:probe` / `source:refresh-now --confirm-live`）须 coco 逐批 live 授权；不自动进入 Private Alpha，不启动服务器就绪或参与者工作。
- 本轮以本机只读审计确认真实瓶颈：34 个来源配置全部 `accessPolicyAccepted=fail`、0 个 `approved`、0 个 `publicationAllowed`；候选审计 capacity 就绪数为 0。瓶颈是准入证据补齐，不是缺候选企业。
- 原 M0–M4/PA-1 当前交付计划和交接已移入归档。历史 Phase 2、M2/M3/M4 审计、R2 和 G2 计划均不得生成当前任务。

## 2. 当前快照

| 项目 | 当前事实 |
|---|---|
| 更新日期 | 2026-08-29 |
| 当前阶段 | 供给准入扩容轨道（SA Track）**Phase A 已完成**（零触网标准与机制，A1–A10）；上一轨道 UX-0 与 OS-1–OS-7 已关闭 |
| 当前唯一目标 | [ADR-0032](decisions/0032-reachability-first-supply-admission.md)、[ADR-0033](decisions/0033-access-policy-basis-and-minimal-body-scope.md)、[ADR-0034](decisions/0034-two-layer-source-admission-and-reconciled-publication.md) 已 `accepted`，ADR-0034 §一+§二+§四 已落地（零触网，公开供给的结构性死锁已解除）。下一步是 Phase B 的触网部分：恢复周期刷新 7 天 → 抓 robots 与核 ToS → 翻转 `stableIdentityAndFields` → 提 `approved` + `alpha`。**须 coco 逐批 live 授权** |
| 当前分支 | `codex/career-os-ux-convergence`；精确 HEAD 与工作树以 Git 为准 |
| 工程基线 | 可信完成基线为 OS-7：Config 20、Contracts 86、Database 54、Platform 466、Web 182，共 **808/808**，一次跑通无 flake；lint 485 files、typecheck、build、audit 与 diff check 通过。上一绿色基线 OS-6 为 801/801（`e56ceae`） |
| 前端基线 | OS-7 Web main **401.33 kB（gzip 117.04 kB）**，相对 OS-6 的 401.31 kB 增加 0.02 kB，低于 411.31 kB 上限；旧 PA-1 的 566.69 kB 只是历史时点，不再作为守门上限。重工作区继续独立 lazy load |
| 当前产品证据 | E0：没有可复核目标用户行为证据 |
| 可信供给 | 22 岗 / 3 家企业 / 3 个官方 ATS；公共与 Alpha 岗位均为 0 |
| 当前 AI | 公开和远程环境关闭；本地 Review v2 只允许确定性模板或显式同意后的受控 provider，验收只用模拟 provider/`AI_DISABLED` 降级 |
| 当前外部边界 | 不接真实招聘来源、真实 AI、邮件、服务器、解析镜像或参与者 |
| 当前下一决定 | 是否对 Phase B 首批授予 live 触网授权。A10 实测：候选池 42（高校族 26 / Moka 族 15 / 未分类 1），`capacity` 与可达就绪均为 0。**公开 `/v1/jobs` 恒为 0 的根因已查明并修复**：`publication_state = 'published'` 既在资格视图里、也散布在 6 处生产读取路径，构成结构性死锁而非严格门槛；现已全部改由 `public_version_id` 表达并由双向对账驱动。公开供给现在只差「有来源被准入」这一件事 |
| 时间盒 | 原 9–12 日前端偏重总估算已撤回。OS-7 实际耗用 7 次双库 runner 运行，其中 6 次为失败反证；下一条轨道启动时单独估时 |

岗位数量、合成数据、页面完成、工程测试或视觉验收都不能自动把产品证据从 E0 提升。

## 3. 当前交付路线

~~~mermaid
flowchart LR
    B["M0–M4 + PA-1<br/>工程基线已完成"] --> U0["UX-0 端到端契约与基线<br/>已完成"]
    U0 --> O1["OS-1 系统外壳与运行契约<br/>已完成"]
    O1 --> O2["OS-2 资料准备与可信岗位入口<br/>已完成"]
    O2 --> O3["OS-3 申请看板与 Case 命令<br/>已完成"]
    O3 --> O4["OS-4 单 Case 决策与固定版本匹配<br/>已完成"]
    O4 --> O5["OS-5 Resume Studio 与唯一 Review 写入<br/>已完成"]
    O5 --> O6["OS-6 投递、面试、复盘与数据控制<br/>已完成"]
    O6 --> O7["OS-7 系统总 Gate<br/>已完成"]
    O7 --> SAA["SA Track Phase A<br/>标准与机制·已完成"]
    SAA --> SAB["SA Track Phase B<br/>待 ADR 审定；首步零触网"]
    SAB --> P["Private Alpha 准备<br/>仍需单独授权"]
~~~

SA Track 是 OS-7 之后的当前轨道，分阶段 40 → 70 → 100 家推进供给准入；详见 [供给准入扩容轨道计划](plans/supply-admission-scaleup-track.md)。下表 UX-0/OS-1–OS-7 为已关闭的上一轨道历史基线。

| 切片 | 用户可见结果 | 状态 |
|---|---|---|
| UX-0 | 视觉契约、领域归属、端到端契约矩阵、满/空态夹具和四视口基线 | **已完成审计 Gate；不等于 OS 功能已实现** |
| OS-1 | Shell/路由/overlay 与身份、session、错误和运行时响应契约同步收敛 | **已完成五项 Gate；不等于全站视觉或后续能力完成** |
| OS-2 | 资料准备、岗位发现/详情、推荐/洞察、Case 创建、简历导入确认和 URL 恢复同步收敛 | **已完成五项 Gate；不等于后续 Case/Review 能力完成** |
| OS-3 | 看板/Peek 与列表 read model、分页筛选、阶段命令、owner/409/幂等同步收敛 | **已完成五项 Gate；见独立证据** |
| OS-4 | Case/Requirements 与固定岗位版本、三轴匹配同步收敛 | **已完成五项 Gate；见独立证据** |
| OS-5 | Resume V2/Review/DOCX 与旧 Tailoring 历史承接、新写入唯一所有权同步收敛 | **已完成五项 Gate；见独立证据** |
| OS-6 | 今日、投递、面试、复盘、设置、访问、历史与兼容 URL 端到端统一 | **已完成五项 Gate；见独立证据** |
| OS-7 | 整体视觉、Contracts、Platform、数据库语义、功能、可访问性、性能和离线总 Gate | **已完成五项 Gate；见独立证据** |

当前轨道的范围、里程碑与验收只看[供给准入扩容轨道计划](plans/supply-admission-scaleup-track.md)；上一轨道 OS-1–OS-7 的接口边界见[Career OS 当前交付计划](plans/career-os-current-delivery-plan.md)（已收敛）。

## 4. 同步交付固定边界

- 高保真采用三张概念图的结构、密度和交互关系，但不采用示例业务数据、匹配标签或独立 AI 简历品牌；实际文件身份、系统归属、token 与响应式规则以[端到端契约](14-career-os-end-to-end-experience-contract.md)为准。
- 证据状态只允许`已有证据 / 证据待补充 / 用户尚未确认`。
- 按用户结果纵向交付；每个切片依次完成 Contract、Database/Platform、Web、Integrated Gate、Evidence，不能以“全站最后一起看”为理由跳过中间 Gate。
- 隔离合成满态和真实空态分别验收；不在产品内建设会冒充真实业务的演示模式。
- 旧能力只有从规范路径可用、可刷新恢复且事实可追溯时才算自然融入；兼容说明或历史只读本身不算完成。`VITE_CAREER_OS_V2=false` 回退保持可用。
- 保持一个 Platform 模块化单体和一个 PostgreSQL 事实源；复用、适配、扩展或最小 migration 必须逐用例定级，不新增未来服务或浏览器端第二套事实。

## 5. 后续 Gate

| Gate | 最低条件 | 当前状态 |
|---|---|---|
| Career OS 前后端同步交付 | UX-0 审计与 OS-1–OS-7 的 Contracts、Platform/DB、Web 与 coco 可见验收 | **已通过**：UX-0 与 OS-1–OS-7 全部关闭 |
| Private Alpha 产品闭环 | M1–M4 一岗闭环 | 已通过本地合成工程 Gate；不等于体验、供给、服务器或用户 Gate 通过 |
| 可信供给 | 100 家企业 / 1000 条活动可信实习岗位、**可达岗位 ≥50%**（ADR-0032）及既定分布 | 22 岗 / 3 家，未通过 |
| 来源持续性 | 至少 3 个已准入确定性来源连续 7 天按 12 小时周期运行 | 0/3，未开始 |
| 服务器就绪 | 真实邮件、解析镜像、HTTPS、备份恢复、监控和负载 | PA-1 仅离线候选，未通过 |
| G0/G1 | 2 人协议校准和 6 人正式价值验证 | 未开始 |
| G4 | 产品、体验、供给、服务器、G0/G1 和故障演练全部通过 | 未开始 |

[Private Alpha 与上线就绪 Gate](plans/private-alpha-readiness-gates.md)只守门，不提供当前任务。

## 6. 不可改变边界

- 只使用获准的企业官网和官方 ATS 作为用户岗位事实真源；不抓综合平台，不绕过登录、验证码或访问控制。
- 未说明字段保持 unknown；资格、证据和偏好分开；不输出匹配百分比或自动劝退。
- 私有 JD、简历和职业资产只对 owner 可见，不进入公共目录或跨用户共享。
- AI 只优化表达，不创造经历或修改已确认事实；模板能力必须可独立运行。
- 用户在官方页面自行投递；不自动填写、模拟登录或批量投递。
- PostgreSQL 是唯一查询和任务真源；不引入 Redis、向量库、独立搜索或消息总线。
- 原文件和临时解析最长 24 小时；职业资产按真实 owner 模式保留，用户可主动单项或全部删除。

## 7. 面板更新规则

- 当前目标只能有一个，且必须与当前交接和当前交付计划一致。
- 每个 OS 切片完成后同步更新本面板、当前交接和独立体验证据。
- 归档计划、历史验收中的“下一步”、提交名称和后续 Gate 均不能覆盖本面板。
- 没有目标用户证据时只能写工程或体验完成，不得写“价值已验证”“成熟”或“受到用户认可”。
