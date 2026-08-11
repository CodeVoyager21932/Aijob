# MVP 路线与当前决策面板

> 本文是当前阶段、真实分母、Gate 状态和下一决定的唯一动态事实源。历史执行细节由独立验收证据和 Git 保留，不再堆叠在本面板。

## 1. 最新决定（2026-08-11）

- 旧的 G4-first 严格总计划已废止并归档，不再提供当前任务或工期基线。
- 当前采用 [Career OS 当前交付计划](plans/career-os-current-delivery-plan.md)：先完成 coco 可在本地完整体验的 OS 2.0 测试候选，再单独进入 Private Alpha 和推广上线 Gate。
- 已完成的 migrations 025–031、Phase 2B-1/2/3/4A/4B 全部保留；尚未开始的 Phase 2B-4C Interview/Debrief/Knowledge Service Boundary 停止作为下一任务。
- `M1 真实 Case 工作台` 与 `M2 专业简历闭环` 均已通过独立工程验收；M2 证据见[专业简历闭环验收](evidence/product/career-os-v2/m2-professional-resume-acceptance-2026-08-11.md)。
- `M3-1 显式投递记录` 已通过[独立工程验收](evidence/product/career-os-v2/m3-1-explicit-application-acceptance-2026-08-11.md)：打开链接不改阶段，只有用户二次确认后才写入 Case 时间线；该次决定为继续 M3-2。
- `M3-2 确定性文字面试` 已通过[独立工程验收](evidence/product/career-os-v2/m3-2-deterministic-interview-acceptance-2026-08-11.md)：Session 固定 Case、岗位、Resume 与证据修订，回答追加保存且刷新/深链可恢复；当前切片切换为 `M3-3 反馈与复盘`。
- 当前唯一里程碑切换为 **M3 投递与持续改进**。只实现用户显式投递记录、确定性文字面试、结构化反馈/复盘及回流，不从旧 Phase 2B 计划生成任务。
- 旧计划的真实性、安全、隐私、供给和服务器要求已提取为 [Private Alpha 与上线就绪 Gate](plans/private-alpha-readiness-gates.md)，标准不降低，但不再阻塞当前本地可测试闭环。

## 2. 当前快照

| 项目 | 当前事实 |
|---|---|
| 更新日期 | 2026-08-11 |
| 当前阶段 | Career OS 2.0 M3 投递与持续改进 |
| 当前唯一目标 | `M3-3 反馈与复盘`：基于同一已完成 Session 保存结构化反馈、表达问题、证据缺口和练习计划；不接真实 AI，不提前实现确认回流 |
| 工程基线 | M1、M2、M3-1、M3-2 已完成；M3-2 全仓串行回归 Config 17、Contracts 69、Database 54、Platform 456、Web 122，共 718/718；lint 428 files、typecheck、build、audit、隔离 PostgreSQL 与 1280 浏览器检查通过 |
| 前端基线 | `/resumes` 与 Case `resume` 复用同一 Resume V2 编辑器；Case `application` 和 `interview` 分别使用真实时间线与 Session/Turn；面试为 9.21 kB 独立 lazy chunk，主包 553.92 kB |
| 当前产品证据 | E0：没有可复核目标用户行为证据 |
| 可信供给 | 22 岗 / 3 家企业 / 3 个官方 ATS；公共与 Alpha 岗位均为 0 |
| 当前 AI | 公开和远程环境关闭；M3 只用确定性模板文字面试，不调用真实 AI |
| 参与者验证 | 未开始；G0 为 0/2，G1 未开始 |
| 当前下一决定 | 完成 M3-3 结构化反馈与复盘并通过 focused Gate 后，选择继续 M3-4、修改、回退或停止 |
| 时间盒 | M3 为 2–3 个有效开发日；M3–M4 剩余基线为 2–4 个有效开发日 |

岗位数量、工程测试、页面完成或 AI 调用都不能把产品证据从 E0 自动提升。

## 3. 当前交付路线

~~~mermaid
flowchart LR
    M0["M0 核心地基<br/>已完成"] --> M1["M1 真实 Case 工作台<br/>已完成"]
    M1 --> M2["M2 专业简历闭环<br/>已完成"]
    M2 --> M3["M3 投递与持续改进<br/>当前"]
    M3 --> M4["M4 本地测试候选"]
    M4 --> A["Private Alpha 准备<br/>100/1000 + 服务器"]
    A --> V["G0/G1 用户验证"]
    V --> G4["G4 Private Alpha"]
    G4 --> L["推广上线准备<br/>至少 10000 岗"]
~~~

| 里程碑 | 用户可见结果 | 状态 |
|---|---|---|
| M0 核心地基 | 静态统一工作台，以及 owner-protected Case、Requirement、Resume V2 API | 已完成 |
| M1 真实 Case 工作台 | Case/要求读取与写入真实内部状态，岗位简历读取真实修订 | 已完成；[验收证据](evidence/product/career-os-v2/m1-real-case-workspace-acceptance-2026-08-09.md) |
| M2 专业简历闭环 | 解析确认、结构编辑、章节调整、逐条建议、两模板和导出统一 | 已完成；[验收证据](evidence/product/career-os-v2/m2-professional-resume-acceptance-2026-08-11.md) |
| M3 投递与持续改进 | 手动投递、模板文字面试、反馈和复盘回流 | **当前唯一目标** |
| M4 本地测试候选 | 重复入口收口、删除/异常完整、一岗端到端通过 | 未开始 |

## 4. M3 当前执行边界

### 用户任务

用户导出岗位简历并前往官方页面手动投递后，显式记录结果；随后基于同一 Case、固定岗位版本和已确认事实完成确定性文字面试、结构化反馈与复盘，再由用户决定是否把改进带回证据或简历。

### 固定交付

- [x] 复核既有 decision、Case event 和 Interview/Debrief 代码边界，形成 [M3 最小复用矩阵](plans/career-os-m3-application-interview-integration-boundary-2026-08-11.md)；没有界面消费者的未来服务不提前实现。
- [x] 打开官方链接绝不自动改变阶段；用户二次确认后才记录已投递并写入真实 Case 时间线。见 [M3-1 验收](evidence/product/career-os-v2/m3-1-explicit-application-acceptance-2026-08-11.md)。
- [x] 建立最小确定性文字面试 Session/Turn，问题只引用固定岗位版本与同 owner 已确认事实。见 [M3-2 验收](evidence/product/career-os-v2/m3-2-deterministic-interview-acceptance-2026-08-11.md)。
- [ ] 生成结构化反馈与复盘：只指出表达问题、证据缺口和练习计划，不创造经历或修改事实。
- [ ] 复盘建议只有经用户确认后才能回到证据或简历；拒绝和暂不处理也要保留用户选择。
- [ ] 覆盖 owner、CSRF、幂等、revision conflict、删除、空/失败状态、1280/320、200% 等效视口、键盘、包体和旗标回退。
- [ ] 形成 M3 独立验收证据，并作继续 M4、修改、回退或停止决定。

### 明确排除

- 不实现 Knowledge、跨 Case 智能生成、语音/音视频面试、自动投递或站外通知。
- 不接真实招聘来源、真实 AI、真实简历、邮件、服务器或参与者数据；只使用合成 Case、岗位、简历和回答夹具。
- 不在 M3 迁移 `/resume`、`/recommendations`、`/insights` 等旧页面；重复入口收口属于 M4。
- 不因未来需求新增数据库、Redis、向量库、第二套队列、第二套认证或新的 AI SDK。

## 5. 后续 Gate

| Gate | 最低条件 | 当前状态 |
|---|---|---|
| Private Alpha 产品 | M1–M4 与完整一岗闭环通过 | M1、M2 已通过；M3、M4 未通过 |
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
