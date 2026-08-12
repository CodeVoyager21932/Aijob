# Aijob Career OS 当前交付计划

- 状态：**Complete / M0–M4 与 PA-1 离线候选已完成**
- 生效日期：2026-08-09
- 决策者：coco
- 当前里程碑：`PA-1 离线身份与解析隔离候选` 已完成；下一项 Private Alpha 准备等待 coco 单独授权
- 动态进度：[MVP 路线与当前决策面板](../06-mvp-roadmap.md)
- 当前工程入口：[当前项目交接](../handoffs/current.md)
- 后续完整性检查：[Private Alpha 与上线就绪 Gate](private-alpha-readiness-gates.md)

本计划取代旧的“先铺完全部 Phase 2/3/4，再形成可用闭环”的执行顺序。旧计划中的真实性、安全、隐私和发布门槛继续有效，但不再决定当前任务。

## 1. 当前交付目标

Aijob 要先形成一个由 coco 在本地完整体验、能够判断产品流程是否成立的 Career OS 2.0 测试版本：

```text
可信岗位或 owner 私有 JD
→ 创建或重新打开岗位 Case
→ 核对 JD 要求与已确认经历证据
→ 形成并调整岗位专属简历
→ 导出并前往官方页面手动投递
→ 记录投递状态
→ 进行模板文字面试与复盘
→ 回到证据和简历继续改进
```

“本地可测试”不等于 Private Alpha 或公开上线。真实来源扩容、真实 AI、服务器、邮箱验证和参与者招募均由后续 Gate 单独授权。

## 2. 交付里程碑

| 里程碑 | 时间盒 | 用户可见结果 | 状态 |
|---|---:|---|---|
| M0 核心地基冻结 | 已完成 | Phase 1B 静态工作台，以及 Case、Requirement、Resume V2 的 owner-protected API | 已完成 |
| M1 真实 Case 工作台 | 2.5–3 日 | Case/要求读取与写入真实内部状态，岗位简历读取真实修订 | 已完成；[验收证据](../evidence/product/career-os-v2/m1-real-case-workspace-acceptance-2026-08-09.md) |
| M2 专业简历闭环 | 2–3 日 | 简历解析确认、结构编辑、章节调整、逐条建议、两模板和导出进入同一 OS | 已完成；[验收证据](../evidence/product/career-os-v2/m2-professional-resume-acceptance-2026-08-11.md) |
| M3 投递与持续改进 | 2–3 日 | 手动投递记录、模板文字面试、结构化反馈和复盘回流 | 已完成；[验收证据](../evidence/product/career-os-v2/m3-workflow-acceptance-2026-08-12.md) |
| M4 旧流程收口与测试候选 | 已完成 | 重复入口收口、删除和异常状态完整，一岗端到端可验收 | 已完成；[总验收证据](../evidence/product/career-os-v2/m4-engineering-browser-gate-acceptance-2026-08-12.md) |

M0–M4 已全部完成。M4-4 在隔离合成数据上通过最终工程与浏览器 Gate；本计划不再生成后续实现任务。Private Alpha 的真实供给、服务器、身份、安全和参与者准备必须由 coco 另行授权，并以 [Private Alpha 与上线就绪 Gate](private-alpha-readiness-gates.md) 守门。

M4 后 coco 单独授权的 PA-1 已形成[离线身份与解析隔离候选](../evidence/product/career-os-v2/pa-1-offline-identity-parser-candidate-acceptance-2026-08-12.md)。它不接真实邮件、不获取解析镜像、不部署服务器；这些条件仍由后续服务器 Gate 守门，本计划不自动生成下一切片。

### M1：真实 Case 工作台

状态：**已完成**。实现与 Gate 结果见 [M1 独立验收证据](../evidence/product/career-os-v2/m1-real-case-workspace-acceptance-2026-08-09.md)；本节保留稳定范围定义，不再生成下一任务。

用户任务：从离线岗位夹具或 owner 私有 JD 创建/重新打开 Case，刷新后继续核对要求并打开对应岗位简历。

固定交付：

- `/applications` 使用现有 Case 列表和创建接口，不再把静态 Case 当业务真源。
- `/applications/:caseId/*` 从 Case 详情恢复公共或私有 JobContext、阶段和固定岗位版本。
- `requirements` 读取并修改三态、备注、证据关联和未知问题，保留 URL 检查器状态。
- `resume` 读取对应的 Case 派生 Resume Document 及当前内容/布局修订；编辑和优化留到 M2。
- 加载、空、非法 Case、404、409、过期会话和重试有明确界面。
- 现有静态数据只保留为测试/回退夹具，不在正常会话伪装业务持久化。

退出条件：创建与幂等重开、刷新/前进/后退、要求写入、简历读取、owner 隔离、1280/320、键盘和功能旗标回退均通过。

### M2：专业简历闭环

状态：**已完成**。实现与 Gate 结果见 [M2 独立验收证据](../evidence/product/career-os-v2/m2-professional-resume-acceptance-2026-08-11.md)；本节保留稳定范围定义，不再生成下一任务。

- 复用旧简历解析、事实确认、tailoring 和 DOCX 能力，不建设第二套解析器。
- `/resumes` 成为基础简历资产入口；Case `resume` 成为岗位派生编辑器。
- 支持章节增删、上下移动、内容删减与增强表达；首轮不用通用富文本和拖拽作为唯一操作。
- 建议只能逐条接受、编辑后采用或拒绝，并保留原修订和证据引用。
- 首个测试候选只使用确定性模板或模拟 provider；真实国产模型接入不阻塞 M2。

### M3：投递与持续改进

状态：**已完成**。实现与 Gate 结果见 [M3 独立总验收证据](../evidence/product/career-os-v2/m3-workflow-acceptance-2026-08-12.md)；本节保留稳定范围定义，不再生成下一任务。

- 打开官方链接不自动标记已投递，投递状态必须由用户明确写入。
- 按界面实际需要实现最小 Interview Session/Turn、模板反馈与 Debrief API。
- 问题、反馈和复盘只能引用固定岗位版本和用户已确认事实，不创造经历。
- Knowledge、真实 AI 任务和跨 Case 智能生成不进入 M3。

固定串行切片：

1. `M3-0`（已完成）：复核既有 decisions、Case events、Interview/Debrief 契约和占位界面，形成[最小复用矩阵与 focused 基线](career-os-m3-application-interview-integration-boundary-2026-08-11.md)。
2. `M3-1`（已完成）：完成用户显式投递记录与 Case 时间线；打开官方链接永不自动写入。见 [M3-1 独立验收证据](../evidence/product/career-os-v2/m3-1-explicit-application-acceptance-2026-08-11.md)。
3. `M3-2`（已完成）：完成固定岗位版本、固定 Resume/证据修订的确定性文字面试 Session/Turn；不接真实 AI，不提前实现反馈与复盘。见 [M3-2 独立验收证据](../evidence/product/career-os-v2/m3-2-deterministic-interview-acceptance-2026-08-11.md)。
4. `M3-3`（已完成）：完成用户显式生成的结构化反馈与复盘，只输出表达问题、证据缺口和练习计划。见 [M3-3 独立验收证据](../evidence/product/career-os-v2/m3-3-feedback-debrief-acceptance-2026-08-11.md)。
5. `M3-4`（已完成）：由用户逐项采用、编辑、拒绝或稍后处理后明确确认复盘，再通过受控入口去补证据或修改岗位简历；确认本身不创造或覆盖经历。见 [M3-4 独立验收证据](../evidence/product/career-os-v2/m3-4-user-confirmed-backflow-acceptance-2026-08-11.md)。
6. `M3-5`（已完成）：全仓与浏览器总 Gate 通过，决定继续 M4。

### M4：旧流程收口与测试候选

状态：**已完成**。M4-0 审计与修正后的固定串行执行如下；详细矩阵见 [M4-0 旧入口与一岗闭环差异审计](career-os-m4-legacy-entry-and-one-job-gap-audit-2026-08-12.md)：

1. `M4-0`（已完成）：确认 `/resume` 是新 OS 仍依赖的共享解析/确认入口，旧 Tailoring 必须保留只读；定位 V2 下旧并行写入、匿名 30 天兼容 TTL 与长期文案冲突、单项删除未接入和简历确认部分写。
2. `M4-1`（已完成）：V2 下 JobDetail 只保留岗位事实、外链和 Case 创建；Recommendation/Insight 为零请求兼容说明；旧 Tailoring 只读；`/resume` 出口与旧数据 URL 进入新 OS。验收见 [M4-1 兼容入口与写边界](../evidence/product/career-os-v2/m4-1-legacy-write-boundary-acceptance-2026-08-12.md)。
3. `M4-2A`（已完成）：复用现有 Schema 完成 Case、Resume、Interview、Debrief 单项删除和 Case 选择性级联/脱离，没有增加 migration。验收见 [M4-2A 单项删除与选择性级联](../evidence/product/career-os-v2/m4-2a-selective-deletion-acceptance-2026-08-12.md)。
4. `M4-2B`（已完成）：数据设置展示真实保留模式、完整范围和已脱离 Case 的资产；简历确认原子提交、会话失效恢复、开发阶段标签与未实现主导航均已收口。验收见 [M4-2B 数据真相与错误恢复](../evidence/product/career-os-v2/m4-2b-data-truth-and-recovery-acceptance-2026-08-12.md)。
5. `M4-3`（已完成）：同一合成公共 Case 已贯通要求、岗位简历、Review、DOCX、外链无副作用、显式投递、模板面试、复盘回流、选择性删除和全部个人数据删除。验收见 [M4-3 一岗本地测试候选](../evidence/product/career-os-v2/m4-3-one-job-local-candidate-acceptance-2026-08-12.md)。
6. `M4-4`（已完成）：全仓 750/750 与 1280/320、200% 等效、错误恢复、旗标回退、DOCX/打印、控制台/网络、懒加载和包体 Gate 通过。验收见 [M4 工程与浏览器总验收](../evidence/product/career-os-v2/m4-engineering-browser-gate-acceptance-2026-08-12.md)。

M4 决定为 **完成并进入 Private Alpha 准备**。这不是自动启动真实 Alpha 的授权；下一切片等待 coco 明确选择。

M4 不做 G4 前 contract migration，不删除无法证明已迁移的历史内容，不移除 `VITE_CAREER_OS_V2` 回退路径，也不实现 Knowledge、真实 AI、真实来源、邮箱、服务器或参与者能力。

## 3. 执行纪律

- 单人/单 Agent 同时只允许一个里程碑中的一个纵向切片 `in_progress`。
- 每个切片必须产生浏览器可见的用户进展；当前界面不调用的未来服务不得提前实现。
- Schema 无法表达当前行为时才做最小 additive forward repair；G4 前不做 contract migration。
- 小切片运行相关测试；每个 M1–M4 里程碑结束运行全仓 lint、typecheck、隔离 PostgreSQL 测试、build、audit 与浏览器 Gate。
- 每次只作“继续、修改、回退、停止”之一，并更新路线图、交接和独立验收证据。
- `VITE_CAREER_OS_V2` 继续作为紧急回退开关；回退不得删除新数据。

## 4. 不可降低的边界

- PostgreSQL 继续是唯一查询和任务真源；不新增数据库、Redis、向量库、消息总线或第二套认证。
- Case 固定岗位版本；要求、证据、偏好分开；AI 不得创造事实或自动劝退。
- 私有 JD、简历与职业资产只对 owner 可见，不进入公共目录或跨用户共享。
- 原文件和临时解析最长 24 小时；确认后的职业资产默认长期保留，并提供用户主动单项和全部删除。
- 用户始终回到官方页面手动投递；不自动填写、模拟登录或批量投递。
- 当前不访问真实招聘来源、真实 AI、邮件、服务器、参与者数据或真实简历。
