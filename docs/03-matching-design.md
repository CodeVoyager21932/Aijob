# 简历解析与可解释匹配设计

## 1. 目标与原则

匹配系统帮助用户判断“是否值得投递”，不替企业筛人，也不把单一模型分数包装成录用概率。

所有判断只建立在版本化、可追溯的数据上：

- `PublishedJobVersion`：用户实际看到的岗位版本。
- `JobRequirementSet`：从该岗位版本提取的要求集合。
- `ProfileFact`：用户确认的客观资格与可用性事实。
- `JobPreference`：用户主动选择的方向和排除项。
- `ResumeEvidence`：用户确认的经历证据。
- `MatchRun`：固定全部输入版本的一次匹配运行。
- `RecommendationRun`：固定候选岗位、匹配运行与排序策略的一次推荐运行。
- `ResumeTailoringRun`：固定目标岗位、用户证据、提示词和模型的一次简历对照修改。
- `JobDecision`：用户对岗位作出的保存、准备、投递或放弃状态，不是系统推荐标签。

PostgreSQL 是这些对象的唯一持久化真源。工程 MVP 不部署向量数据库或独立搜索索引。

## 2. 用户侧三个对象

三个对象职责不同，不得把偏好当能力，也不得让同一资格事实存在两个来源冲突。

### 2.1 `ProfileFact`

`ProfileFact` 表示参与硬条件判断的客观事实：

| 字段 | 说明 |
|---|---|
| `profile_fact_id` | 唯一标识 |
| `owner_id` | 服务端从邀请会话确定的数据所有者 |
| `profile_revision` | 用户画像修订号 |
| `fact_type` | 学历、专业、毕业年份、所在地点、到岗时间、每周出勤、可持续时长、语言、证书等 |
| `normalized_value` | 规范值 |
| `source_type` | 用户直接填写或简历证据派生 |
| `evidence_ids` | 可选的支持证据 |
| `confidence` | 提取置信度，不代表事实正确 |
| `user_confirmed` | 是否经用户确认 |

硬条件只能使用用户确认的 `ProfileFact`。用户未提供或未确认时输出“需补充信息”，不能从学校、项目或文本暗示中猜测。

### 2.2 `JobPreference`

`JobPreference` 表示用户主动选择的求职方向：

- 期望城市、是否接受异地或远程。
- 目标职能、行业和招聘类型。
- 用户明确接受或排除的条件。
- 结果数量、排序等产品偏好。

学历、毕业年份、专业和实际出勤能力不是偏好，必须进入 `ProfileFact`。偏好只影响偏好轴和排序，不能改变资格轴。

每组偏好包含 `owner_id` 和不可变 `preference_revision`。修改时创建新修订，不覆盖已经被 `MatchRun` 引用的版本。

### 2.3 `ResumeEvidence`

每条经历证据包含：

| 字段 | 说明 |
|---|---|
| `evidence_id` | 唯一标识 |
| `owner_id` | 数据所有者 |
| `evidence_revision` | 所属证据集修订号 |
| `evidence_type` | 教育、实习、项目、校园、竞赛、志愿、技能、证书 |
| `statement` | 结构化事实描述 |
| `source_span` | 原始文本版本、起止位置和片段哈希 |
| `time_range` | 发生时间 |
| `skills` | 由该经历支持的技能候选 |
| `outcome_type` | 过程、产出、定性反馈、量化结果 |
| `confidence` | 解析置信度 |
| `user_confirmed` | 是否经过用户确认 |

模型不能把“参与”升级成“负责”，不能把过程升级成业务结果，也不能把课程或个人项目包装成正式工作经验。未经确认的证据可以展示给用户修改，但不能产生“有明确证据”的结果。

`source_span` 的原文片段只在证据确认阶段用于核对。确认并删除简历原文后，长期结构只保留原文版本标识、位置、片段哈希和用户确认后的 `statement`，不得为了后续结果展示复制保存另一份原文正文。

## 3. 岗位要求

### 3.1 `JobRequirementSet`

每个不可变要求集必须包含：

- `requirement_set_id`。
- `published_job_version_id`。
- `job_parser_version`、词典版本和创建时间。
- 输入岗位内容哈希。
- 人工复核状态和当前是否可用于匹配。

同一岗位版本可以因解析器升级产生多个要求集，但已经完成的 `MatchRun` 始终引用当时的固定集合，不随当前活动版本变化。

### 3.2 `JobRequirement`

| 字段 | 说明 |
|---|---|
| `requirement_id` | 在要求集内唯一 |
| `requirement_type` | 工作城市/地点、到岗时间、每周出勤、持续月数、毕业年份、招聘批次、学历、专业、经验、技能、职责、语言、证书等 |
| `text` | 岗位原文 |
| `necessity` | `required/preferred/optional/unknown` |
| `normalized_value` | 规范值 |
| `confidence` | 提取置信度 |
| `source_span` | 岗位版本中的原文位置 |

“熟悉”“优先”“具备”“必须”等措辞不能统一处理。只有明确、可确定且必要性为 `required` 的条件才能产生硬冲突；无法判断时保持未知。

列表筛选所用的毕业年份、学历等字段由活动 `JobRequirementSet` 派生，并保留对应 `requirement_id`，避免维护第二套资格事实。

## 4. 三个独立判断轴

内部匹配不使用一个总分代替不同性质的判断。

### 4.1 资格轴 `eligibility_status`

- `no_explicit_conflict`：未发现明确冲突。只表示当前已确认信息中没有硬条件冲突，不等于企业认可或必然录用。
- `explicit_conflict`：存在明确冲突。必须引用岗位原文、用户确认事实和具体冲突。
- `needs_information`：需补充信息。必须区分缺少岗位信息、用户信息或两者。

资格轴只由确定性规则产生。语义相似度、偏好和 AI 都不能覆盖 `explicit_conflict`，也不能把 `needs_information` 当作未发现冲突。

### 4.2 证据轴 `evidence_status`

- `clear_evidence`：有明确证据。至少一条用户确认经历直接支持对应要求。
- `partial_evidence`：部分证据。只支持要求的一部分，或可迁移关系有限。
- `not_shown_in_resume`：简历暂未体现。当前已确认经历中没有找到支持，但不等于用户不具备能力。
- `insufficient_information`：信息不足。岗位要求或用户经历信息不足，无法判断是否有证据。

证据召回顺序是规范词典、同义词/可迁移能力规则和 PostgreSQL 内可审计的文本召回。MVP 不引入向量库；后续语义模型必须通过单独评估与 ADR。

### 4.3 偏好轴 `preference_status`

- `fit`：符合用户已设置的相关偏好。
- `not_fit`：不符合至少一项已设置偏好，必须指出具体偏好。
- `not_set`：用户尚未表达相关偏好，不作正负判断。

偏好不是能力。`not_fit` 不能被描述为资格冲突。

前台按资格、证据、偏好的顺序分别展示三个轴及依据。禁止把三个轴合成匹配度百分比，也禁止生成“优先考虑”“有条件考虑”“不建议”等全局推荐标签。存在资格冲突的岗位不得自动隐藏，只有用户可以主动隐藏。

## 5. `MatchRun` 不可变契约

一次运行固定以下输入：

- `match_run_id`、`owner_id` 和创建时间。
- 候选 `published_job_version_id[]` 与对应 `requirement_set_id[]`。
- `profile_revision`、`preference_revision`、`evidence_revision`。
- `rule_version`、`dictionary_version` 和 `template_version`。
- 如启用 AI：`prompt_version`、供应商别名、模型版本和参数版本。
- 输入哈希、运行状态、错误码、成本和耗时。

修改岗位、要求、用户事实、偏好、证据、规则、词典、模板、提示词或模型时创建新的 `MatchRun`。旧运行保持可复现并标记 `stale`，不能原地重算后覆盖。

每个岗位结果归属于一个 `MatchRun` 和一个岗位版本，保存三个轴、支持关系、缺口、未知项、规则命中和解释版本。它只陈述系统依据，不代表用户已经作出决定。

### 5.1 `RecommendationRun`

一次推荐运行固定：

- `recommendation_run_id`、`owner_id`、创建时间和输入哈希。
- 候选 `published_job_version_id[]` 及其对应 `match_run_id[]`。
- `profile_revision`、`preference_revision`、`evidence_revision`。
- `ranking_policy_version` 和稳定的 tie-break 规则。

排序使用确定性元组：资格状态、偏好满足情况、证据覆盖、新鲜度和稳定岗位 ID。数字只用于内部稳定排序，不展示为“匹配度”“推荐指数”或录用概率。每个结果必须分别列出支持理由、明确冲突、未知项、来源和核验时间；资格冲突岗位仍可查看和纠正。

任何候选岗位版本、匹配运行、用户修订或排序策略变化都创建新的 `RecommendationRun`。旧运行不原地重排。

## 6. `JobDecision` 用户决策队列

`JobDecision` 由用户主动改变，系统不能根据三轴结果代替用户写入：

| `decision_status` | 展示文案 | 含义 |
|---|---|---|
| `undecided` | 未决定 | 已查看但尚未形成行动决定 |
| `saved` | 已保存 | 希望稍后继续判断 |
| `preparing` | 准备投递 | 已决定投入时间准备或填写 |
| `applied` | 已投递 | 用户明确自报已在官方页面完成提交 |
| `abandoned` | 已放弃 | 用户决定本轮不投 |

每条记录包含 `owner_id`、稳定岗位 ID、`decision_revision`、状态、结构化原因、可选说明、最近查看的岗位版本、可选 `match_run_id` 和更新时间。用户主动隐藏使用独立 `hidden_at` 字段，不增加第六种决定状态。

状态变更采用乐观并发并保留事件历史。点击官方链接只记录 `official_apply_clicked`，不能自动把状态改成 `applied`。岗位版本更新或活动状态改变时保留用户决定，同时提示依据已变化。

## 7. 处理顺序

1. 用户通过匿名 owner 会话提交 PDF、DOCX 或文本和求职约束；文件按 ADR-0012 隔离解析。
2. 系统产生 `ProfileFact` 与 `ResumeEvidence` 候选。
3. 用户确认、修改或删除事实、偏好和证据，形成不可变修订。
4. 对 `JobRequirementSet` 运行确定性资格判断。
5. 用规则和词典建立 `requirement_id -> evidence_id[]` 的候选关系。
6. 计算资格、证据和偏好三个轴。
7. 创建不可变 `RecommendationRun`，使用确定性元组排序并展示理由与未知项。
8. 用户选择一个岗位后，可显式启用 AI 创建 `ResumeTailoringRun`；模型只生成有证据引用的修改候选。
9. 用户逐段接受、拒绝或编辑并可导出 DOCX。
10. 用户自行更新 `JobDecision`，前往官方申请页；点击与自报投递记录为不同事件。

## 8. AI 边界与模板降级

本地完整 MVP 必须实现一个 OpenAI-compatible 适配器，但只有环境配置允许且用户对当前简历优化任务显式选择后才调用。岗位浏览、三轴和推荐始终使用确定性解析、用户确认、规则和模板；公开或远程环境在供应商与增量价值 Gate 前保持关闭。

启用后遵守：

- 原文件不发送给模型；只发送完成目标岗位优化所需、经过 PII 过滤并由用户同意的最小片段。
- 输入只包含 `JobRequirement`、已确认 `ProfileFact`/`ResumeEvidence` 和三轴结果。
- 模型无网络工具、数据库、文件、采集或密钥权限。
- 输出使用固定 JSON Schema，引用真实 `requirement_id` 和 `evidence_id`。
- 输出不能修改三轴状态、虚构经历或生成可执行 HTML、URL、SQL、Shell。
- Schema、引用或安全校验失败时有限重试，随后降级到规则模板。
- 不跨用户共享含简历信息的缓存；MVP 可以完全关闭 AI 结果缓存。

### 8.1 `ResumeTailoringRun`

一次优化运行固定：

- `resume_tailoring_run_id`、`owner_id`、创建时间和输入哈希。
- 输入简历版本或确认后的段落集合、`evidence_revision`。
- 目标 `published_job_version_id`、`requirement_set_id` 和可选 `match_run_id`。
- `template_version`、`prompt_version`、供应商别名、模型版本、参数版本和安全策略版本。

每个 `TailoringSegment` 包含原文、建议、原因、`requirement_id[]`、`evidence_id[]`、校验状态和用户状态 `pending/accepted/rejected/edited`。任何新增数字、公司、项目、技能或结果都必须能回指用户确认的证据；不能回指或 Schema/ID 校验失败的段落不得展示。

用户状态不修改 `ResumeEvidence` 或原运行输出。最终 DOCX 由接受段落与用户编辑段落确定性组装，使用统一单栏 ATS 友好模板；导出记录固定所用段落修订和模板版本，不承诺复刻原文件版式。

## 9. 输出契约

```json
{
  "match_run_id": "MR1",
  "published_job_version_id": "JV12",
  "requirement_set_id": "RS4",
  "profile_revision": 3,
  "preference_revision": 2,
  "evidence_revision": 5,
  "versions": {
    "rule": "rules-1",
    "dictionary": "dictionary-1",
    "template": "template-1",
    "prompt": null,
    "model": null
  },
  "axes": {
    "eligibility": "no_explicit_conflict",
    "evidence": "partial_evidence",
    "preference": "fit"
  },
  "supported_requirements": [
    {"requirement_id": "R1", "evidence_ids": ["E3"], "strength": "strong"}
  ],
  "gaps": [
    {"requirement_id": "R4", "gap_type": "missing_evidence"}
  ],
  "unknowns": ["每周出勤要求未写明"],
  "summary": "...",
  "next_actions": ["..."],
  "generated_by": "template"
}
```

前台必须允许用户展开岗位原句、用户事实和用户确认后的证据陈述；简历原文片段只在确认阶段可见，并随原文删除。`summary` 和 `next_actions` 是解释，不是新的事实源。

用户决策作为独立资源保存，例如：

```json
{
  "published_job_id": "J12",
  "decision_revision": 4,
  "decision_status": "saved",
  "reason_codes": ["needs_more_information"],
  "last_seen_job_version_id": "JV12",
  "match_run_id": "MR1",
  "hidden": false
}
```

## 10. 所有权、保留和删除

- 所有用户侧对象都带服务端确定的 `owner_id`，API 不接受客户端指定所有者。
- 原文件和原始文本在用户完成证据确认后立即删除；未完成确认、异常中断或用户离开的记录也必须在提交后 24 小时内删除。
- owner 建立时固定 `owner_expires_at`，最长不超过 30 天；`ProfileFact`、`JobPreference`、`ResumeEvidence`、`MatchRun`、`RecommendationRun`、`ResumeTailoringRun`、导出、`JobDecision` 和 owner 产品事件都不得晚于该时间。普通访问、新修订和再次确认均不能续期，用户可以提前删除。
- 删除请求立即撤销读取能力，并清理原文、结构化对象、任务载荷和缓存；审计记录只保留不含正文的结果。
- 安全审计记录保留 90 天，不保存简历正文、岗位全文、提示词或可复用邀请令牌。

## 11. 评估与回归

固定评估集至少覆盖：

- 明确符合、明确硬性不符和信息不足。
- 学历、毕业年份、到岗、出勤和实习时长的资格冲突，以及地点偏好不符。
- 硬条件误杀、同义技能和可迁移能力。
- 学生项目、课程、校园、竞赛和作品证据。
- 岗位描述中的提示注入及简历中的恶意文本。

发布门至少检查：

- 明确硬冲突漏检数为 0。
- 未确认事实参与确定判断的数量为 0。
- 展示证据引用精确率为 100%，虚构经历数量为 0。
- 资格缺失时输出 `needs_information`，证据缺失时正确区分 `not_shown_in_resume` 与 `insufficient_information`。
- 硬条件误杀逐例审查；被判冲突的岗位仍可由用户查看和纠正。
- AI、提示词、规则或词典变更在同一版本化数据集回归，安全指标不得退化。

用户反馈进入评估和人工复核，不直接修改当前岗位要求、用户事实或生产规则。
