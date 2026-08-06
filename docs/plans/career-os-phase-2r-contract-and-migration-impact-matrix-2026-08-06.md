# Phase 2R 契约与迁移影响矩阵

- 日期：2026-08-06
- 状态：ready for implementation review
- 适用基线：Aijob OS 2.0 初版
- 上位决策：[ADR-0031](../decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md)
- 上位计划：[Private Alpha 严格开发总计划](career-os-v2-upgrade-plan-2026-08-04.md)
- 对应证据：[Phase 2R 架构对齐报告](../evidence/product/career-os-v2/phase-2r-architecture-realignment-2026-08-06.md)

本文是 Phase 2R 的实现前契约，不创建表、不改变 API、不代表 migration 023/024 已完成长期化修正。只有本矩阵和 Phase 2R 报告共同通过审查后，才允许进入 Phase 2A 的前向修复和 025–027 迁移。

## 1. 统一约束

| 约束 | 固定规则 | 验收证据 |
|---|---|---|
| 唯一业务真源 | `applications`/Case 工作台负责当前 Case 写入；旧页面不得拥有第二套业务状态 | 路由/服务写入调用图、兼容测试 |
| owner 隔离 | 所有个人聚合、修订、事件和任务使用 owner + epoch；跨 owner 资源不可枚举地返回 404 | 跨 owner PostgreSQL/API 测试 |
| 长期生命周期 | 用户创建或确认的职业资产默认长期保留；用户主动单项删除或全部删除 | 删除矩阵、恢复不复活测试 |
| 短期数据 | 原始 PDF/DOCX、临时抽取文本、解析工作目录和导出文件最长 24 小时；异常路径 fail-closed | 定时清理和异常路径测试 |
| 版本固定 | Case、Resume、Interview、Review 都固定输入版本；升级只能显式创建新版本或新修订 | 并发修订和版本差异测试 |
| 无正文任务 | 任务 payload 只允许 ID、版本、hash 和原因码，不传递简历正文、回答或提示词 | payload Schema 和日志脱敏测试 |
| AI 降级 | 模板能力可以独立完成；真实 AI、BYOK 和远程供应商不属于 Phase 2R | AI disabled/fallback 测试 |

## 2. Case 岗位上下文契约

### 2.1 联合类型

```text
PublicJobReference
  kind: "public"
  publishedJobId: UUID
  publishedJobVersionId: UUID
  requirementSetId: UUID
  officialUrl: HTTPS URL

PrivateJobSnapshot
  kind: "private"
  snapshotId: UUID
  ownerId: server-owned UUID
  title: 1..240 chars
  companyName: 1..240 chars or unknown
  sourceLabel: 1..120 chars
  officialUrl?: HTTPS URL
  contentRevision: positive integer
  requirementSetRevision: positive integer
  sourceProvided: boolean
```

服务端只能从当前 owner/session 推导 `ownerId`。客户端不能提交 owner、owner epoch、公共可见性、供给统计字段或推荐资格字段。

### 2.2 私有 JD 的业务边界

| 行为 | 允许 | 禁止 |
|---|---|---|
| 创建 Case | 用户粘贴或导入 JD；可没有官方 URL | 替用户推断官方来源或主体 |
| 可见性 | 当前 owner 的 Case、简历、面试和复盘 | 出现在其他 owner、公共 `/v1/jobs` 或公开搜索 |
| 推荐与统计 | 可用于当前 owner 的资格/证据核对 | 进入公共推荐、供给分母、来源容量或跨用户去重 |
| 版本变更 | 显式创建新 snapshot revision，并展示差异 | 静默覆盖 Case 已固定的 JD |
| 来源文案 | 无 URL 时显示“来源未提供，请自行核验” | 显示“官方”“已验证”等未有依据的标签 |
| 删除 | 用户可单项删除；Case 删除时询问是否删除派生资产 | 因公共岗位删除规则自动级联私有资产 |

### 2.3 唯一性

- 公共岗位：同一 owner + `publishedJobId` 只能有一个未结束、未删除 Case。
- 私有岗位：同一 owner + `snapshotId` 只能有一个未结束、未删除 Case；重新导入同一内容但产生新 `snapshotId` 时，必须由服务端以内容 hash 和用户确认决定是否复用，不能跨 owner 去重。
- 公共与私有上下文不互相合并，即使标题、公司和 URL 相同也必须保留来源类型和审计差异。

## 3. 长期资产与删除矩阵

| 资产 | 默认生命周期 | 单项删除 | 删除 Case 时 | 全部删除 | 恢复/迟到任务 |
|---|---|---|---|---|---|
| Profile facts/preferences/evidence | 长期，用户主动删除 | 删除指定修订或事实；引用它的建议变为不可用 | 不因 Case 删除自动删除 | 按 owner 顺序物理删除 | epoch 递增，旧任务拒绝 |
| ApplicationCase/JD snapshot | 长期，用户主动删除 | 软删后物理清理 Case 子表 | 私有 JD 随 Case；派生资产由用户选择 | 随 owner 删除 | 不得由备份恢复复活 |
| Resume content/layout | 长期，用户主动删除 | 删除文档或指定修订；历史引用显示已删除 | Case 派生简历由用户选择 | 按引用顺序删除 | 旧导出任务不得写入新修订 |
| Resume Review | 长期，用户主动删除 | 删除 Review Run 或单条 suggestion | 默认随 Case 选择性处理 | 随 owner 删除 | 迟到模型结果不得恢复 suggestion |
| Interview session/turn/feedback | 长期，用户主动删除 | 删除 Session 聚合及 turns/feedback | 由用户选择是否级联 | 随 owner 删除 | 迟到 turn/feedback 拒绝 |
| Debrief | 长期，用户主动删除 | 删除复盘 | 由用户选择是否级联 | 随 owner 删除 | 不得创建未经确认的经历事实 |
| Knowledge clip | 长期，用户主动删除 | 可单项删除或解除 Case 关联 | 解除关联不等于删除 clip | 随 owner 删除 | 不自动抓全文或刷新 |
| 原始上传/临时抽取 | 最长 24 小时 | 立即删除 | 不进入 Case 长期资产 | 随 owner 删除 | 异常路径最长 24 小时 |
| Export artifact | 最长 24 小时 | 立即删除 | 不因 Case 长期保存 | 随 owner 删除 | 下载后不允许任务重建旧正文 |

删除流程必须先标记 owner/case epoch 和删除墓碑，再终止 queued/running 用户任务，最后按引用顺序清除数据。删除墓碑只保留无正文标识、时间和 hash，不得恢复个人正文。

## 4. Resume V2 与 Review 契约

### 4.1 三层模型

| 层 | 保存内容 | 不保存 |
|---|---|---|
| Content revision | 结构化 section/block、稳定 ID、用户确认文本、evidence ID | 模板 token、Review 决策状态 |
| Layout revision | 模板 key、section 顺序、受控布局 token、content hash | 正文、回答、模型输入 |
| Review aggregate | 固定 document/content/case/JD/evidence revision、findings、suggestions、decision history | 未确认事实、ATS 分数、自动投递结果 |

### 4.2 Review 状态机

```text
pending -> accepted
pending -> edited -> accepted
pending -> rejected
accepted/edited/rejected -> superseded (新 Review Run)
```

- `accepted`：用 suggestion 生成新的 Content revision，旧正文和 suggestion 保留。
- `edited`：保存用户确认后的编辑结果，并生成新的 Content revision；不能覆盖原 suggestion。
- `rejected`：隐藏当前 suggestion，但保留原正文和拒绝原因。
- 任何决定都要求 `expectedRevision` 和幂等键；建议失败只影响 Review，不使正文不可读。

### 4.3 优化边界

允许：章节重排、删减重复、拆分/合并区块、增强表达、补充已确认证据引用、改善中文 HR/ATS 可解析性。

禁止：虚构经历、补写未确认数字、改变资格判断、伪造 ATS 分数、承诺“破解 ATS”、自动覆盖用户正文。

## 5. Strict Schema 契约

所有下列对象使用版本化 strict Schema，拒绝未知字段、客户端 owner 字段和正文输入：

| 对象 | 允许字段 | 禁止字段/内容 |
|---|---|---|
| `CaseEventData` | `schemaVersion`、事件类型对应的 ID、旧/新阶段、版本 ID、原因码 | JD 正文、简历正文、回答、模型输入 |
| `LayoutSettings` | `schemaVersion`、字号/间距/颜色 token、分页策略枚举 | HTML、CSS、正文、任意 provider 配置 |
| `ReviewFinding` | `schemaVersion`、category、severity、sourceBlockId、evidenceIds、reasonCode | 未确认事实、ATS 分数、长模型原文 |
| `ReviewSuggestion` | `schemaVersion`、findingId、suggestedText、changeType、evidenceIds | 没有 evidence 的新事实、自动写入命令 |
| `TaskPayload` | `schemaVersion`、owner epoch、aggregate IDs、revision、request hash | 简历/回答/JD 正文、密钥、提示词 |

## 6. Account + EmailIdentity 规划

- `Account` 是长期身份聚合；`EmailIdentity` 是已验证邮箱，唯一约束按规范化邮箱值执行。
- 登录优先使用一次性邮箱验证码；验证码 hash、过期时间、失败计数和发送频率限制持久化保存。
- 匿名 owner 继续支持本地 MVP；绑定邮箱只能显式迁移 owner，不得自动合并多个 owner。
- 手机号短信、短信供应商、费用和合规评估不进入 Phase 2R；未来单独 ADR。
- BYOK 默认仅当前会话；长期保存必须显式同意、加密存储、可撤回和不可出现在日志中。

## 7. 旧路由唯一真源矩阵

| 旧入口 | Phase 2R 行为 | 写入权限 | 失败/不可映射 |
|---|---|---|---|
| `/resume` | 跳转 `/resumes` 或进入指定 Case 的 Resume 工作区 | 不新增旧模型写入 | 无唯一 Case 时只读展示 |
| `/recommendations` | 跳转 `/applications`，保留旧查询参数映射 | 只能通过 Case 创建/更新 | 无法映射返回明确引导 |
| `/insights` | 按岗位/Case 跳转 `/requirements` | 不写回匹配结果 | 无 Case 时只读旧洞察 |
| 旧 tailoring run | 只读；唯一可关联时显示在 Case 时间线 | 新 Review 通过新聚合写入 | 归属不明保持旧只读页 |
| `JobDecision` 旧接口 | 可无损状态事务内兼容 | Case 是新真源 | 无法表示的阶段返回 409 |

## 8. 023/024 迁移影响矩阵

| 现有实现 | 冲突 | Phase 2R 处理 | 允许的迁移动作 |
|---|---|---|---|
| 023 Case `published_job_id` 必填 | 无法表达私有 JD | 增加来源 discriminator 和私有 snapshot 关联；公共行保持可读 | additive 列/表、前向回填来源类型，不删除旧列 |
| 023 Case `expires_at <= created + 30d` | 职业资产不应自动删除 | 改为短期数据专用 expiry；职业资产不再复制该约束 | 前向修复约束/索引；不得 destructive down |
| 023 `event_data jsonb` | 任意 JSON 难以审计 | 加 `schema_version` 和 strict validator；旧事件只读转换 | additive validator/版本列，旧正文不回填 |
| 024 Resume document 30 天 TTL | 与长期简历资产冲突 | 新文档采用主动删除；旧行兼容读取 | 前向修复服务/约束，保留 V1 行 |
| 024 Resume block 内建议状态 | Review 与正文耦合 | 新增 Review 聚合，旧状态只读映射 | 转换器和兼容 DTO；不批量改写正文 |
| 024 layout `settings` 宽 JSON | 布局可能承载正文 | 版本化 strict LayoutSettings | additive Schema/校验，旧布局只读 |
| 023/024 旧 owner FK | 仅公共 owner 关系 | 私有快照和 Review 继续复用 owner/epoch | 复合 owner FK、索引和权限测试 |

## 9. Phase 2R 测试矩阵

| 测试组 | 必须证明 |
|---|---|
| Contract | 联合类型、strict unknown key 拒绝、Review 状态机、客户端服务端字段隔离 |
| PostgreSQL | 公共/私有 owner 隔离、唯一 Case、复合 FK、主动删除、选择性级联、墓碑和权限 |
| Compatibility | 023/024 旧行逐列可读、V1 转换不改 hash/ID、旧路由不产生第二套写入 |
| Task | epoch/revision/fencing/幂等、无正文 payload、迟到结果拒绝 |
| Security | 私有 JD 不出公共查询、404 不可枚举、日志无正文、BYOK 不落日志 |
| Browser | `/applications` 为唯一写入入口；旧 URL 跳转、刷新/前进/后退、320px 和键盘流程 |

## 10. Phase 2R 决定

本矩阵完成后，Phase 2R 满足“实现前契约齐全”条件。下一步允许进入 **Phase 2A 前向修复契约与隔离 PostgreSQL 测试设计**，但仍不创建 025–027，直到前向修复设计和测试结果独立通过。
