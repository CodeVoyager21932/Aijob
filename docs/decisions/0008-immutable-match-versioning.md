# ADR-0008：使用不可变版本、三轴结果和用户决策契约

- 状态：accepted
- 日期：2026-07-15
- 决策者：项目维护者
- 关联：来源与采集设计、匹配设计、验证与质量策略

## 背景

岗位、简历事实、偏好、规则、解释模板和提示词都会变化。如果只保存当前值或让模型直接输出总分，就无法解释用户当时看到了什么、为什么得到结论，也无法可靠回归或回滚。

## 决策标准

- 每个匹配结果可以按原始输入和版本复现。
- 资格、证据和偏好不会相互覆盖。
- 用户能回到岗位原文和自己确认的事实/证据。
- 更新产生新结果，不静默改写历史。

## 选项

### 选项 A：可变当前记录和单一匹配分

- 优点：Schema 简单。
- 缺点：历史不可复现，硬条件和主观排序混在一起。

### 选项 B：只保存模型输入输出文本

- 优点：能回看调用。
- 缺点：缺少稳定业务契约，包含敏感数据且难以验证引用。

### 选项 C：不可变领域版本、三轴结果与独立用户决策

- 优点：可追溯、可回归、可失效和可模板降级。
- 缺点：需要更多版本键、活动指针和清理逻辑。

## 决定

选择选项 C：

- 岗位使用 `PublishedJobVersion` 与 `JobRequirementSet`。
- 用户数据拆为 `ProfileFact`、`JobPreference` 和 `ResumeEvidence` 的不可变修订。
- 每个 `MatchRun` 必须不可变地引用 `published_job_version_id`、`job_requirement_set_id`、事实/偏好/证据修订、`rule_version`、`dictionary_version` 和 `template_version`。`template_version` 在 AI 关闭或降级时仍为必填，用来复现当时展示的模板解释。
- 只有 AI 实际参与时才额外记录 `prompt_version`、`model_provider` 和 `model_version`；这些字段为空不得改变三轴计算和模板链路的可复现性。
- `MatchRun` 分别保存资格轴 `no_explicit_conflict/explicit_conflict/needs_information`、证据轴 `clear_evidence/partial_evidence/not_shown_in_resume/insufficient_information`、偏好轴 `fit/not_fit/not_set`。
- 不生成“优先考虑”“有条件考虑”“不建议”等全局推荐标签，也不合成匹配度百分比。
- `JobDecision` 只保存用户主动选择的 `undecided/saved/preparing/applied/abandoned` 五态、原因和独立隐藏状态；模型和匹配规则不能替用户修改。
- 任一输入改变时创建新运行，旧结果保持不可变并标记 `stale`。
- 存在明确资格冲突的岗位不永久隐藏，必须展示冲突依据并允许用户纠正事实。

## 后果

- 正向：三轴结果及其模板解释可重放、测试和审计，模型不能覆盖硬规则。
- 负向：数据量增加，需要明确 30 天用户数据保留和版本清理。
- 后续：建立版本外键、枚举 Schema、失效规则和固定回归集。

## 复审触发条件

- 评估证明某个轴需要新增稳定状态。
- 30 天窗口内的版本量对 PostgreSQL 形成已测得压力。
- 新模型方法能在保持版本和解释契约的前提下改善质量。
