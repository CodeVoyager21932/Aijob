# 项目模板

这些模板用于 Phase 0 产品发现、MVP-0 工程交付和首批数据验证，不是生产数据库导出格式。当前阶段、两个最高风险假设和 Gate 状态以 [MVP 路线与当前决策面板](../06-mvp-roadmap.md) 为唯一动态事实源。

## 产品发现与交付

- [用户访谈记录](user-interview.md)：记录近期真实行为、现有流程基线、材料证据、反例和术语理解。
- [假设登记表](assumption-register.csv)：只预置当前两个最高风险假设 `H-PROBLEM-001` 与 `H-VALUE-001`，记录阶段、Gate、证据等级和决定。
- [实验卡](experiment-card.md)：实验开始前写明方法、通过 / 失败条件、守护指标和决定规则。
- [功能规格](feature-spec.md)：把已经验证的问题转成可验收范围，并明确三轴、五态、AI 降级与删除路径。
- [ADR](adr.md)：记录跨模块、敏感或难以逆转的重要决定。

固定研究协议先完成 2 人校准，再进行 6 人正式实验；实时样本进度只在决策面板更新。AI 默认关闭；模板与规则先独立成立，AI 只作为最后一层受控对照。

## 来源登记表

使用 [source-registry.csv](source-registry.csv) 记录企业官网、经企业确认的官方 ATS、高校就业网站和企业公开招聘页面。表中一行代表一个经过审核的“采集目标 + 申请目标”组合；同一来源有多个目标时使用不同 `registry_row_id` 并重复来源级字段，不能用一个宽泛主机白名单代替。

`policy_version` 标识该行属于哪个不可变策略版本；准入、网络范围、频率或规则变化时递增版本，不用新鲜度变化制造策略版本。`freshness_state`、`last_complete_run_at` 是运行投影，可以随完整采集运行更新。

四个维度必须分开：

- `provenance_level`：`organization_owned / verified_ats_tenant / university_published / official_account_link / unverified`。
- `policy_status`：`pending_review / approved / paused / blocked / retired`。
- `acquisition_mode`：`public_api / json_ld / deterministic_html / browser_required`；MVP 不启用 `browser_required`。
- `freshness_state`：`fresh / due / stale / unknown`，只表达来源复查状态，不证明单条岗位仍有效。

`fetch_target_*` 和 `apply_target_*` 都必须精确记录协议、主机、端口和路径前缀。共享 ATS 必须限定到已核验企业租户；申请目标是独立展示边界，不能继承采集权限。只有 `policy_status=approved`、无需登录 / 验证码且不依赖浏览器自动化的来源才可进入 MVP 自动化切片。

`absence_min_complete_runs` 和 `absence_min_observation_hours` 共同定义“连续未见”门槛；无论配置值如何，首个完整运行未见只能进入 `uncertain` 待复查，后续另一完整运行或人工官方证据才允许关闭。`partial/failed` 不累计。

政策证据、robots / 条款检查、展示字段、速率和退出纠错说明写入对应字段或证据链接。敏感令牌、Cookie、认证头和个人数据不得进入 CSV。

## 岗位样本表

使用 [job-samples.csv](job-samples.csv) 人工记录 Phase 0 的 20-30 条产品 / 运营实习岗位；先录入 5 条校准字段，再扩充完整样本。每条至少保留来源、原始链接、官方申请链接、最后核验时间和当前活动状态。

MVP-0 人工样本填写 `import_mode=manual` 和稳定 `import_batch_id`；自动数据切片使用 `import_mode=collector`。人工记录的原始字段与最小职责/要求摘录构成字段级证据，不得填写或伪造 Bucket 快照键。

以下六个资格重点字段必须填写原文值，来源未说明时统一写 `unknown`，不能留空或猜测：

1. `city_raw`：城市。
2. `arrival_time_raw`：到岗时间。
3. `internship_days_per_week_raw`：每周出勤。
4. `internship_months_raw`：持续月数。
5. `graduation_year_raw`：毕业年份。
6. `recruitment_batch_raw`：招聘批次。

`function_track` 允许 `product / operations / conflict`。`conflict` 仅用于官方标题或正文同时指向产品与运营、且人工尚不能诚实收敛到单一方向的记录；必须在 `unknown_or_conflict_notes` 保留原文依据，不能为了分类方便强行改写。岗位状态使用三个独立轴：`ingestion_state` 为 `discovered / parsed / validated / rejected`，`publication_state` 为 `draft / review / published / suppressed / archived`，`activity_state` 为 `active / uncertain / closed`。样本中的未知值和冲突是诚实数据，不等于不符合。

`manual_review_result` 在复核前写 `pending`；人工打开官方页面并完成逐字段检查后，只允许写 `confirmed / replace / needs_second_review`。`pending` 候选不计入人工样本进度，也不得进入研究目录。

## 假设登记表

[assumption-register.csv](assumption-register.csv) 中：

- `is_current_top_risk` 只对当前决策面板中的最高风险假设写 `true`。
- `evidence_level` 初始为 `E0`；只有链接到原始观察、实验或运行记录后才能提升。
- `next_gate` 表示下一次允许继续的程序 Gate，`value_gate` 表示能对该假设作出产品决定的 Gate；G0 只证明协议可用，不等于产品价值已验证。
- `pass_signal`、`fail_signal` 和 `guardrail_signal` 必须在实验前填写；任一守护事件不能被平均成功率抵消。
- `decision` 只写 `continue / iterate / rollback / stop / pending`；`pending` 仅表示尚未评审，当前两项均为 `pending`。

## CSV 录入规则

- 文件使用 UTF-8、逗号分隔和单行表头。
- 含逗号、换行或双引号的字段必须使用标准 CSV 双引号转义。
- 时间使用带时区的 ISO 8601，日期使用 `YYYY-MM-DD`，布尔值使用小写 `true/false`。
- 必填但来源未知的岗位字段写 `unknown`；尚未执行或不适用的管理字段可以留空。
- 不得把手机号、邮箱、身份证号、简历原文、邀请链接、会话标识或其他用户数据写入任何模板。
