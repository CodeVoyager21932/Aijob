# M3 投递、文字面试与复盘集成边界

- 日期：2026-08-11
- 分支：`codex/career-os-phase-1`
- 审查基线：`8d125fd docs(evidence): accept m2 professional resume workflow`
- 状态：**M3-0 设计基线；M3-1 与 M3-2 已完成**
- 当前任务仍以 [MVP 路线](../06-mvp-roadmap.md) 与[当前交接](../handoffs/current.md)为准

## 1. 结论

M3 不需要新数据库、新领域总线或先铺完整未来后端。migration 023/026/028/029 已经提供严格的 Case event、Interview Session/Turn/Feedback、Debrief/Confirmation、owner epoch、固定岗位/证据版本、幂等字段、不可变历史、删除和角色权限边界。

当前真正缺少的是四条被界面直接消费的纵向能力：

```text
Case 显式投递命令与时间线
→ 确定性文字面试 Session/Turn
→ 结构化 Feedback/Debrief
→ 用户确认后回到既有 Requirements/Resume 编辑器
```

因此 M3 只补契约、模块化单体服务、owner-protected API 和对应 Case 标签页；不新增 migration，除非实现时出现可复现的数据库约束缺口。

## 2. 复用矩阵

| 用户能力 | 已有真源 | 当前缺口 | M3 决定 |
|---|---|---|---|
| 打开官方链接 | Case 固定 `jobContext` 与现有 Header 外链 | 新 Case 没有专用打开记录服务 | 外链始终直接交给用户；无论记录请求成功与否都不改变 Case 阶段 |
| 手动标记已投递 | `application_cases.stage`、`case_events`、`manual_application_recorded` 事件类型 | 没有命令、路由、时间线读模型与 UI | 新增 Case 真源命令；只允许 `interested/preparing → applied`，要求 revision 与幂等键 |
| 旧岗位决定兼容 | `decision.job_decisions` 与既有 legacy → Case 无损同步 | 新 Case → 旧决定没有投影 | 公共 Case 手动投递时事务内投影 `applied`；私有 JD 不创建 legacy decision；旧接口不成为 M3 UI 真源 |
| Case 时间线 | 追加式 `application.case_events` | 没有 owner-protected 列表 API | 新增按 sequence 倒序的游标读取；跨 owner、已删除 Case 统一 404 |
| 文字面试 | migration 028 与 Interview 合同 | 无服务、路由或界面 | 模板模式同步创建 active Session 和首题；回答追加 Turn，确定性选择下一题或完成 |
| 固定事实 | Session 固定 Case、岗位上下文、evidence revision，可选 Resume revision | 没有创建时选择规则 | 优先使用同 Case 派生简历固定的 evidence/content revision；缺前置资产时明确引导，不创建伪事实 |
| 面试反馈 | 追加式 `interview_feedback` 和严格 JSON | 无生成与读取 | Session 完成后同步生成模板反馈；引用同 Session 的 Turn/Requirement/Evidence ID |
| 复盘 | `debriefs`、`debrief_confirmations` 与确认投影 trigger | 无服务、路由或界面 | 每个 Case 一个活动复盘；保存表达问题、证据缺口和练习计划，显式确认后追加 Case event |
| 改进回流 | M1 Requirements 与 M2 Resume V2 编辑器 | 旧计划容易引入第三套事实/简历写入 | M3 不自动生成新经历或改写简历；确认后提供精确入口，由用户在既有编辑器亲自补证据或保存新 Resume revision |
| Knowledge | migration 028 已预留表 | 当前用户闭环不需要 | M3 完全排除，不创建服务或页面数据请求 |

## 3. 固定行为

### 3.1 投递

- 打开官方链接不会自动标记已投递，也不会隐式调用阶段变更。
- “我已完成投递”必须是单独按钮和确认动作；同一 revision 只允许一个 Case 写入 pending。
- `manual_application_recorded` 只接受 `interested` 或 `preparing`，拒绝 `applied` 重复写入以及 `interviewing/resolved` 回退。
- 公共 Case 的 legacy 投影只为功能旗标回退兼容；Case 与 event 仍是新 OS 真源。
- 时间线不显示自由拼接的系统推断，只翻译严格 event type 与固定数据。

### 3.2 文字面试

- M3 只支持 `template`，不创建真实 AI 任务、不读取 provider 配置。
- 创建 Session 时固定 Case、岗位版本或私有快照修订、requirement set、evidence revision，以及存在时的 Case-derived Resume content revision。
- 问题来源为固定要求和通用行为题模板；未知要求保持未知，不把用户未确认事实写进题干。
- 回答正文是用户主动输入，最多 20,000 字符；Turn 追加保存，不原地修改。
- 每次回答后只做确定性下一题或完成；M3 不做开放式模型追问。

### 3.3 反馈与复盘

- 反馈只评价相关性、结构、证据和清晰度；不输出 ATS 分数、录用概率或虚构事实。
- 没有证据引用时明确标为证据缺口，不推断用户没有提供的经历。
- Debrief confirmation 只表示用户确认这份复盘，不等于用户同意系统自动修改职业资产。
- 回流动作固定为“去补证据”“去修改岗位简历”“暂不处理”；真正写入继续走 M1/M2 已验收的 revision 与用户确认路径。

## 4. 最小 API 面

M3-1：

- `GET /v1/application-cases/:caseId/events`
- `POST /v1/application-cases/:caseId/manual-applications`

M3-2：

- `GET /v1/application-cases/:caseId/interview-sessions`
- `POST /v1/application-cases/:caseId/interview-sessions`
- `GET /v1/application-cases/:caseId/interview-sessions/:sessionId`
- `POST /v1/application-cases/:caseId/interview-sessions/:sessionId/answers`

M3-3/4：

- `GET /v1/application-cases/:caseId/debrief`
- `PUT /v1/application-cases/:caseId/debrief`
- `POST /v1/application-cases/:caseId/debrief/confirmations`

所有读取使用 `no-store`；所有写入要求 CSRF、稳定幂等键和 owner epoch。跨 owner、已删除或已 detach 的当前 Case 统一不可枚举 404；revision 冲突使用标准 Problem Details，不自动重放用户正文。

## 5. 不需要的架构变化

- 不新增 migration、表、数据库、Redis、队列、认证、AI SDK、向量库或搜索服务。
- 不把 Interview 或 Debrief 塞进 ApplicationCase 主表；继续使用已有聚合并通过 Case event 连接。
- 不复用 legacy `job_decisions` 作为新 UI 查询源。
- 不让 match-worker 参与模板 Session 的同步用户交互；已有权限只保留未来受控任务和删除用途。
- 不实现 Knowledge、跨 Case 智能生成、语音/音视频、自动投递或站外通知。

## 6. M3-0 基线证据

| 检查 | 结果 |
|---|---|
| Interview/Debrief + Case contracts | 27/27，通过 |
| Web 当前基线 | 114/114，通过 |
| migrations 026B–031 forward contract | 13/13，通过；含 028 证据/owner/权限/不可变约束 |
| legacy decision + Case focused platform | 9/9，通过 |
| 数据环境 | 随机 `aijob_m3_baseline_test_*` 隔离库；结束后已删除 |
| 服务状态 | 前后端未启动；PostgreSQL 容器与 Docker Desktop 验证后再次停止 |

M3-0 没有修改业务代码、Schema 或依赖；该结论随后由 M3-1 和 M3-2 的纵向实现验证。M3-2 复用了 migration 028，没有新增 migration、依赖、队列或 AI provider；验收见 [M3-2 确定性文字面试](../evidence/product/career-os-v2/m3-2-deterministic-interview-acceptance-2026-08-11.md)。当前唯一切片由路线图规定为 `M3-3 反馈与复盘`，本设计记录不再生成下一任务。
