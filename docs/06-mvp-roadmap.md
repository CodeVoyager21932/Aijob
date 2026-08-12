# MVP 路线与当前决策面板

> 本文是当前阶段、真实分母、Gate 状态和下一决定的唯一动态事实源。历史执行细节由独立验收证据和 Git 保留，不再堆叠在本面板。

## 1. 最新决定（2026-08-12）

- 旧的 G4-first 严格总计划继续保持废止和归档状态，不提供当前任务或工期基线；migrations 025–032 与历史 Phase 2B 工程成果只作为既有事实保留。
- `M1 真实 Case 工作台`、`M2 专业简历闭环` 与 `M3 投递与持续改进` 已全部通过独立工程验收。M3 总证据见[投递与持续改进总验收](evidence/product/career-os-v2/m3-workflow-acceptance-2026-08-12.md)。
- M3 完整合成链已经从显式投递、模板面试、反馈复盘运行到逐项确认和 Requirements/Resume 回流；最终全仓 725/725、1280/640/320、并发冲突、真实 404、焦点返回、旗标回退与包体检查通过。
- M3 Gate 修复了 Requirement 检查器关闭后仍保留深链参数、导致移动抽屉重新打开的当前闭环缺口；没有扩展 Knowledge、真实 AI、真实来源或未来服务。
- `M4-0 旧入口与一岗闭环差异审计` 已完成，证据见[旧入口与一岗闭环差异审计](plans/career-os-m4-legacy-entry-and-one-job-gap-audit-2026-08-12.md)。结论不是统一删除旧页：`/resume` 仍是唯一解析/确认入口，旧 Tailoring 必须保留只读历史；真正冲突是 V2 下仍可写旧 Match/Decision/Tailoring，以及数据保留和单项删除没有接入现有长期资产契约。
- `M4-1 兼容入口与写边界` 已通过[独立工程验收](evidence/product/career-os-v2/m4-1-legacy-write-boundary-acceptance-2026-08-12.md)：V2 岗位详情不再启用旧 Match/Decision/Tailoring/外链跟踪，Recommendation/Insight 为零请求兼容页，旧 Tailoring 只读，简历出口与数据 URL 已进入新 OS；旗标关闭的旧流程不变。
- `M4-2A 单项删除与选择性级联` 已通过[独立工程验收](evidence/product/career-os-v2/m4-2a-selective-deletion-acceptance-2026-08-12.md)：Case、Resume、Interview、Debrief 均具备 owner-protected 单项删除；Case 删除要求用户逐类选择删除或脱离，私有 JD 快照按最后活动引用决定保留或墓碑化；没有新增 migration。
- `M4-2B 数据真相与错误恢复` 已通过[独立工程验收](evidence/product/career-os-v2/m4-2b-data-truth-and-recovery-acceptance-2026-08-12.md)：数据设置读取真实 owner 保留模式与完整资产范围；脱离资产可发现/删除；简历确认成为单事务；读取可安全恢复一次而 mutation 不重放；占位导航和用户可见开发标签已收口。
- `M4-3 一岗本地测试候选` 已通过[独立工程验收](evidence/product/career-os-v2/m4-3-one-job-local-candidate-acceptance-2026-08-12.md)：同一合成公共岗位 Case 已从 API 创建/重开、固定岗位版本、Requirements/Evidence、Resume/Review、DOCX、外链无写入、显式投递、模板面试、复盘确认和回流运行到选择性删除与全部 owner 删除；公共合成岗位保持存在。
- `M4-4 工程与浏览器 Gate` 已通过[M4 工程与浏览器总验收](evidence/product/career-os-v2/m4-engineering-browser-gate-acceptance-2026-08-12.md)：1280/320、200% 等效视口、键盘/焦点、刷新/历史、404/409/API 恢复、旗标回退、DOCX/打印、零外联、懒加载、包体与全仓 750/750 均通过。
- M4 决定为 **完成并进入 Private Alpha 准备**。这不是启动真实 Alpha 的授权；下一实现切片必须由 coco 单独决定，且不得绕过供给、服务器、身份、安全、G0/G1 与 G4 Gate。
- 真实性、安全、隐私、供给和服务器要求继续由 [Private Alpha 与上线就绪 Gate](plans/private-alpha-readiness-gates.md) 守门，但该 Gate 不生成 M4 当前任务。

## 2. 当前快照

| 项目 | 当前事实 |
|---|---|
| 更新日期 | 2026-08-12 |
| 当前阶段 | Career OS 2.0 M1–M4 已完成；等待 coco 授权 Private Alpha 准备的具体切片 |
| 当前唯一目标 | 暂无自动执行任务；保持 M4 通过基线，等待 coco 从 Private Alpha 就绪 Gate 中明确授权下一项准备工作 |
| 工程基线 | M1–M4 已完成；M4 最终全仓回归 Config 17、Contracts 79、Database 54、Platform 459、Web 141，共 750/750；lint 445 files、typecheck、build、audit、全新隔离 PostgreSQL 与 diff check 通过 |
| 前端基线 | `/settings/data` 已展示真实保留模式、完整资产范围与脱离资产管理；简历确认已原子化，会话边界不自动重放写入，未实现顶层入口已隐藏。主包 564.42 kB，数据设置 9.15 kB、面试 23.51 kB、简历编辑器 29.23 kB，重工作区仍为独立 lazy chunk |
| 当前产品证据 | E0：没有可复核目标用户行为证据 |
| 可信供给 | 22 岗 / 3 家企业 / 3 个官方 ATS；公共与 Alpha 岗位均为 0 |
| 当前 AI | 公开和远程环境关闭；M4 沿用确定性模板，不调用真实 AI |
| 参与者验证 | 未开始；G0 为 0/2，G1 未开始 |
| 当前下一决定 | 等待 coco 明确选择并授权 Private Alpha 准备的具体切片；不得因 M4 工程通过而自动访问真实来源、启动服务器或招募参与者 |
| 时间盒 | M1–M4 已完成；后续时间盒尚未授权 |

岗位数量、工程测试、页面完成或 AI 调用都不能把产品证据从 E0 自动提升。

## 3. 当前交付路线

~~~mermaid
flowchart LR
    M0["M0 核心地基<br/>已完成"] --> M1["M1 真实 Case 工作台<br/>已完成"]
    M1 --> M2["M2 专业简历闭环<br/>已完成"]
    M2 --> M3["M3 投递与持续改进<br/>已完成"]
    M3 --> M4["M4 本地测试候选<br/>已完成"]
    M4 --> A["Private Alpha 准备<br/>待授权：100/1000 + 服务器"]
    A --> V["G0/G1 用户验证"]
    V --> G4["G4 Private Alpha"]
    G4 --> L["推广上线准备<br/>至少 10000 岗"]
~~~

| 里程碑 | 用户可见结果 | 状态 |
|---|---|---|
| M0 核心地基 | 静态统一工作台，以及 owner-protected Case、Requirement、Resume V2 API | 已完成 |
| M1 真实 Case 工作台 | Case/要求读取与写入真实内部状态，岗位简历读取真实修订 | 已完成；[验收证据](evidence/product/career-os-v2/m1-real-case-workspace-acceptance-2026-08-09.md) |
| M2 专业简历闭环 | 解析确认、结构编辑、章节调整、逐条建议、两模板和导出统一 | 已完成；[验收证据](evidence/product/career-os-v2/m2-professional-resume-acceptance-2026-08-11.md) |
| M3 投递与持续改进 | 手动投递、模板文字面试、反馈和复盘回流 | 已完成；[验收证据](evidence/product/career-os-v2/m3-workflow-acceptance-2026-08-12.md) |
| M4 本地测试候选 | 重复入口收口、删除/异常完整、一岗端到端通过 | 已完成；[总验收证据](evidence/product/career-os-v2/m4-engineering-browser-gate-acceptance-2026-08-12.md) |

## 4. M4 已完成边界

### 已验收用户任务

用户从一个清晰入口进入同一 Career OS，能够完成一岗闭环、理解旧内容去向、处理错误并主动删除数据；旧页面不再与新 OS 竞争写入真源。

### 已完成串行切片

- [x] `M4-0 旧入口与一岗闭环差异审计`（已完成）：确认 `/resume` 必须保留为共享解析/确认入口，旧 Tailoring 保留只读；定位 V2 下旧并行写入、匿名 30 天兼容 TTL 与长期文案冲突、单项删除未接 API/UI、简历确认部分写和用户可见开发标签。
- [x] `M4-1 兼容入口与写边界`（已完成）：V2 岗位详情停止旧 Match/Decision/Tailoring/外链跟踪，Recommendation/Insight 为零请求兼容说明，旧 Tailoring 只读，`/resume` 出口与旧数据 URL 已进入新 OS；Web 131/131 和旗标回退策略通过。
- [x] `M4-2A 单项删除与选择性级联`（已完成）：复用现有 `deleted_at`、detach guard 和 owner epoch，为 Case、Resume、Interview、Debrief 接 owner-protected 删除；Case 删除逐项选择删除或脱离派生资产。验收见 [M4-2A 独立工程证据](evidence/product/career-os-v2/m4-2a-selective-deletion-acceptance-2026-08-12.md)。
- [x] `M4-2B 数据真相与错误恢复`（已完成）：设置页展示真实 owner retention mode/expiry、完整数据范围与脱离 Case 的资产；简历确认原子提交、会话失效恢复、开发标签和未实现主导航均已收口。验收见 [M4-2B 独立工程证据](evidence/product/career-os-v2/m4-2b-data-truth-and-recovery-acceptance-2026-08-12.md)。
- [x] `M4-3 一岗本地测试候选`（已完成）：同一合成公共 Case 已贯通要求、岗位简历、Review、DOCX、外链无副作用、显式投递、模板面试、复盘回流、选择性删除和全部个人数据删除。验收见 [M4-3 独立工程证据](evidence/product/career-os-v2/m4-3-one-job-local-candidate-acceptance-2026-08-12.md)。
- [x] `M4-4 工程与浏览器 Gate`（已完成）：全仓、1280/320、200% 等效、键盘/焦点、刷新/历史、错误恢复、旗标回退、控制台、打印、懒加载和包体检查通过。验收见 [M4 总证据](evidence/product/career-os-v2/m4-engineering-browser-gate-acceptance-2026-08-12.md)。

### 明确排除

- 不在审计前假设 `/resume`、`/recommendations`、`/insights` 必须全部重定向或删除。
- 不做 G4 前的 contract migration，不删除无法证明已迁移的历史内容，不移除 `VITE_CAREER_OS_V2` 回退路径。
- 不实现 Knowledge、真实 AI、真实来源扩容、邮箱、服务器、参与者招募、语音面试、自动投递或站外通知。
- 不新增数据库、Redis、向量库、第二套队列、第二套认证或新的 AI SDK。

## 5. 后续 Gate

| Gate | 最低条件 | 当前状态 |
|---|---|---|
| Private Alpha 产品 | M1–M4 与完整一岗闭环通过 | **已通过本地合成工程 Gate**；不等于供给、服务器或用户 Gate 通过 |
| 可信供给 | 100 家企业 / 1000 条活动可信实习岗位及既定 SME、职能、城市、人工来源分布 | 22 岗 / 3 家，未通过 |
| 来源持续性 | 至少 3 个已准入确定性来源连续 7 天按 12 小时周期运行 | 0/3，未开始 |
| 服务器就绪 | 邀请、邮箱身份、安全、隔离解析、备份恢复、监控和负载通过 | 未授权、未开始 |
| G0/G1 | 2 人协议校准和 6 人正式价值验证 | 未开始 |
| G4 | 产品、供给、服务器、G0/G1、删除恢复和故障演练全部通过 | 未开始 |
| 推广上线 | 至少 10000 条可信可见岗位，并覆盖产品、运营、技术、销售和 AI | 未开始 |

Private Alpha 和上线完整条件以 [就绪 Gate](plans/private-alpha-readiness-gates.md) 为准；它不是当前任务队列。

## 6. 不可改变边界

- 只使用获准的企业官网和官方 ATS 作为用户岗位事实真源；不抓综合平台，不绕过登录、验证码或访问控制。
- 未说明字段保持 unknown；资格、证据和偏好分开；不输出匹配百分比或自动劝退。
- 私有 JD、简历和职业资产只对 owner 可见，不进入公共目录或跨用户共享。
- AI 只优化表达，不创造经历或修改已确认事实；模板能力必须可独立运行。
- 用户在官方页面自行投递；不自动填写、模拟登录或批量投递。
- PostgreSQL 是唯一查询和任务真源；不引入 Redis、向量库、独立搜索或消息总线。
- 原文件和临时解析最长 24 小时；职业资产默认长期保留，用户可主动单项或全部删除。

## 7. 面板更新规则

- 只保留当前快照、当前里程碑、Gate 变化和下一决定；历史细节写入验收证据。
- 当前目标只能有一个，且必须来自本面板与当前交接。
- 归档计划、历史验收中的“下一步”和提交名称均不能覆盖本面板。
- 没有目标用户证据时只能写工程完成，不得写“价值已验证”“成熟”或“受到用户认可”。
