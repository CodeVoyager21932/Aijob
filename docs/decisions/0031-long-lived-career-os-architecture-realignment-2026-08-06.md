# ADR-0031：将 Career OS 2.0 修正为长期职业资产架构

- 状态：accepted
- 日期：2026-08-06
- 决策者：coco
- 上位决策：[ADR-0030](0030-adopt-job-centric-career-os-and-interaction-first-integration.md)
- 影响计划：[Career OS 2.0 严格开发总计划](../plans/career-os-v2-upgrade-plan-2026-08-04.md)

## 背景

OS 2.0 初版已经完成统一工作台、Case 视图和 Resume V2 的基础迁移，但 Phase 2 设计仍混用了短期邀请会话的 30 天保留策略。该策略不适合新的产品目标：Aijob 不只帮助用户找到岗位，而是围绕每次求职长期保存职业事实、证据、基础简历、岗位 Case、面试和复盘，持续陪伴用户迭代。

同时，初版契约把 Case 绑定到公共 `published_job_id`，把简历建议决策放在正文 block 中，并使用宽泛 JSON 承载事件和布局设置。这些做法会限制私有岗位导入、长期复用、审查追溯和后续 API 稳定性。

## 决定

### 1. 长期职业资产由用户控制生命周期

- `profile`、`application`、`matching` 中由用户创建或确认的职业资产默认长期保留，不再按 30 天自动过期。
- 用户可以删除单个 Case、简历、面试、复盘、知识引用或全部个人数据；删除入口必须清晰可用，不以到期倒计时推动用户删除。
- Case 删除时明确询问是否同时删除派生简历、面试和复盘；用户未选择的独立资产不被静默级联删除。
- 原始 PDF/DOCX、临时抽取文本、解析工作目录和短期导出文件仍按最小化原则处理：确认后立即删除，异常路径最长 24 小时。该临时保留不等于职业资产 TTL。
- 无正文的安全审计、删除墓碑和必要的合规记录按既有最长期限保留，不能恢复个人正文。

### 2. Case 同时支持公共岗位与私有 JD

Case 的岗位上下文统一为 `PublicJobReference | PrivateJobSnapshot`：

- 公共岗位引用固定 `published_job_id`、岗位版本和要求集，继续以官方目录为真源。
- 私有 JD 快照只对当前 owner 可见，可以没有官方 URL；界面必须显示“来源未提供，请自行核验”。
- 私有 JD 不进入公共 `/v1/jobs`、推荐、供给分母或跨用户去重，也不产生公共岗位版本。
- 两种来源都必须冻结 Case 创建时的 JD 语义版本；后续修改只能显式创建新快照/新版本并记录差异。

### 3. Resume V2 采用三层语义模型

- `ResumeContentRevision` 只保存结构化语义正文、稳定 section/block/evidence ID。
- `ResumeLayoutRevision` 只保存模板、章节顺序和受控布局 token；换模板不得改变语义内容。
- `ResumeReviewRun`、`Finding`、`Suggestion`、`Decision` 独立保存简历审查和优化过程；审查建议不得直接写入正文。
- `accepted`、`edited`、`rejected` 是审查建议的可追溯决定，不是正文 block 的属性。正文只能通过明确的内容修订写入。
- 优化能力面向 HR 审阅和国内 ATS 可解析性，允许重排、删减、拆分、合并和改写；禁止虚构事实、未确认数字、ATS 分数或“破解 ATS”承诺。

### 4. 身份与模型供应商按可替换边界规划

- Private Alpha 规划 `Account + EmailIdentity`，邮箱验证码为首选；手机号短信不进入当前阶段，单独评估成本和合规后再决定。
- 现有匿名本地 owner 保留兼容迁移路径，不在本 ADR 中强制切换认证。
- 模型只允许国产白名单供应商；内置 API 与 BYOK 均可用。BYOK 默认只保留当前会话，长期保存必须加密并由用户主动选择。
- 不在本阶段接真实 AI；模板模式必须独立可完成核心流程。

### 5. 领域契约收紧并保持单一真源

- `case_events.event_data`、layout `settings`、review findings/suggestions 使用受控 Schema，不接受任意 JSON。
- `applications`/Case 工作台是新的业务真源；旧 `/resume`、`/recommendations`、`/insights` 仅作为兼容入口或只读历史页。
- 不新增第二套认证、数据库、队列、岗位真源、事实库或通用富文本编辑器。

## 影响与代价

- migration 023/024 的 30 天约束不能直接作为 025–027 的前置事实，必须先做 additive 复核或前向修复设计。
- 长期保存提高存储和删除覆盖的要求；单项删除、选择性级联、恢复不复活和 owner 隔离需要更完整的集成测试。
- 私有 JD 增加来源类型和权限分支，但换来用户可以安全导入企业内推、朋友转发或未公开岗位。
- Resume Review 独立聚合增加表和 API 数量，但能避免建议状态污染正文、支持多轮审查和模型切换。

## 非目标

- 不因此开放真实招聘来源、公共岗位发布、自动投递、浏览器代填或真实 AI。
- 不把私有 JD 用于推荐训练、跨用户搜索、统计供给或公开页面。
- 不引入 OCR、语音面试、向量库、社区知识库或第二套编辑器。

## 复查条件

在 Phase 2R 退出前，必须有新的 ADR/证据确认：长期资产删除矩阵、公共/私有岗位契约、Account/EmailIdentity 迁移、Resume Review 聚合、受控 JSON Schema、旧路由唯一真源和迁移 023/024 的兼容策略。未完成前不得继续创建 025–027。
