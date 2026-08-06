# Phase 2A 前向修复契约与隔离 PostgreSQL 测试设计

- 日期：2026-08-06
- 状态：contracts and isolated prototype passed; decision = modify
- 当前后续切片：`Phase 2A-Identity-Forward-Contract`
- 上位决策：[ADR-0031](../decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md)
- 前置矩阵：[Phase 2R 契约与迁移影响矩阵](career-os-phase-2r-contract-and-migration-impact-matrix-2026-08-06.md)
- 实现基线：[migration 023](../../packages/database/src/migrations/023_application_case_core_expand.ts)、[migration 024](../../packages/database/src/migrations/024_resume_document_v2_expand.ts)

本文最初只冻结前向修复和测试设计。当前 `023F`、`024F` 已实现为未注册的隔离证明原型，并通过临时 PostgreSQL 验证；它们仍不是生产 migration，也未改变任何运行数据库。原型不注册 API，不访问真实招聘来源、真实 AI 或真实简历。

## 1. 目标与禁止事项

### 目标

1. 让新建职业资产默认长期保留，保留原始文件/临时抽取/导出物的 24 小时短期清理。
2. 让 Case 同时表达公共岗位和 owner-only 私有 JD。
3. 让 Resume Content、Layout、Review 三层模型可以并存，旧 V1 行继续只读可用。
4. 让旧路由、旧 JobDecision、旧 tailoring 数据不产生第二套写入真源。
5. 用隔离 PostgreSQL 证明旧行不变、跨 owner 拒绝、权限 fail-closed、删除不复活和迟到任务拒绝。

### 禁止事项

- 不对已经产生的 023/024 个人历史执行 destructive down。
- 不批量把旧 `undecided` 决定转换成 Case。
- 不把私有 JD 写入 `catalog`、公共 `/v1/jobs`、推荐候选或供给统计。
- 不把 Review suggestion 自动写入 Resume 正文。
- 不在本切片创建 `025–027`，不接真实 AI，不切换认证。

## 2. 前向修复工作包

### 2.1 `023F` ApplicationCase 前向修复

#### A. 岗位上下文

在保留旧公共列可读性的前提下增加版本化来源层：

```text
job_context_kind: public | private
private_job_snapshot_id: nullable UUID
job_context_revision: positive integer
```

规则：

- 历史 `published_job_id` 非空的行迁移为 `job_context_kind=public`，不修改其岗位版本、要求集或事件 hash。
- 新公共 Case 仍校验 `published_job_id + published_job_version_id + requirement_set_id` 的固定关系。
- 新私有 Case 使用 owner 复合外键指向私有 JD 快照；公共列全部为 NULL，不创建伪造的 `published_job_id`。
- `job_context_kind` 与列配对使用 CHECK；未知值、半公共半私有值和跨 owner 快照一律拒绝。
- 公共和私有 Case 的唯一活动索引按 `(owner_id, job_context_kind, stable_context_id)` 设计；旧公共唯一索引保留到兼容完成，不允许产生双写冲突。

#### B. 生命周期

- 旧 023 `expires_at <= created_at + 30 days` 约束只作为历史兼容事实，不继续用于新 Case。
- 新职业 Case 使用 `deleted_at`、owner epoch 和主动删除流程；短期清理字段单独用于 raw upload/export/task artifact。
- 现有过期清理任务必须区分 `asset_kind=career_asset` 与 `asset_kind=short_lived_artifact`，不能按旧 Case `expires_at` 删除长期 Case。
- 历史行在兼容期内可以保留旧 `expires_at`，但读取 DTO 不把它显示为用户必须接受的自动删除倒计时。

#### C. 事件 Schema

- 为 `case_events` 增加 `schema_version` 或等价的事件版本映射。
- 旧事件保持只读；读取时通过事件类型转换为 strict DTO，未知字段不回写。
- 新事件只允许 ID、版本、阶段、原因码和 hash，不允许岗位正文、简历正文、面试回答或模型输入。
- 事件不可 UPDATE；纠错通过新事件追加完成。

### 2.2 `024F` Resume 前向修复

#### A. 文档生命周期

- 新建文档不再强制创建后 30 天过期；保留 `deleted_at` 和主动删除服务。
- 旧文档行继续可读；旧 `expires_at` 不自动触发长期职业资产删除。
- `resume_documents_expiry_idx` 只服务短期导出/临时资产；长期文档列表使用 owner + updated keyset。

#### B. 私有 Case 引用

- `case_derived` Resume 引用 Case 的 `job_context_kind` 和 `job_context_revision`。
- 公共 Case 保留现有岗位版本外键；私有 Case 只引用同 owner 私有快照，不使用公共目录外键。
- Resume 派生文档固定创建时的 Case/JD/evidence/content 输入版本，Case 后续升级不得静默改写。

#### C. Review 聚合

增加逻辑聚合（实际表名在后续 migration 设计中冻结）：

```text
resume_review_runs
resume_review_findings
resume_review_suggestions
resume_review_decisions
```

- Review 固定 owner、Case、Resume document/content revision、JD context revision 和 evidence revision。
- suggestion 的 `pending/accepted/edited/rejected` 不再作为正文 block 的业务真源。
- accepted/edited 通过新 Content revision 写入；rejected 只改变 Review 状态。
- Review 删除不自动删除 Resume 正文；Case 删除时由用户选择是否级联 Review。

#### D. Layout strict Schema

- `section_order` 转换为稳定 section ID 数组 DTO。
- `settings` 只允许版本、字号、间距、颜色 token、分页策略等白名单字段。
- 旧布局只读转换；未知 settings 字段不得渲染为 HTML/CSS 或写回新 layout revision。

## 3. Contract 变更设计

### 3.1 ApplicationCase

旧 `ApplicationCaseSchema` 仅接受 `publishedJobId/publishedJobVersionId`。前向契约新增：

```text
jobContext: PublicJobReference | PrivateJobSnapshot
```

旧公共响应可通过兼容 DTO 继续返回旧字段；新工作台只消费联合类型。创建请求必须 strict，不能同时提交旧字段和 `jobContext`，避免两套真源。

### 3.2 CaseEvent

将 `eventData: z.record(z.string(), z.unknown())` 替换为按 `eventType` discriminated union 的 strict Schema。兼容读取允许旧事件进入 `LegacyCaseEventData`，但新写入只接受新 Schema。

### 3.3 Resume

V1 `ResumeDocumentRevisionSchema` 继续只读；V2 新 DTO 明确 `contentRevisionId`、`layoutRevisionId` 和 `reviewRunId` 的可选引用关系。V1 首次编辑必须走转换命令，不能直接接受任意 V2 body。

### 3.4 删除与错误

- 跨 owner、不存在、已删除资源统一不可枚举 404。
- owner 证明有效但短期资源已清理，返回 `410 OWNER_RESOURCE_EXPIRED`；长期职业资产不因默认 TTL 返回 410。
- 删除冲突、Case 选择性级联冲突和 revision 过期使用 Problem Details + 稳定 code。

## 4. 隔离 PostgreSQL 测试设计

所有测试使用 loopback、`aijob_test*` 数据库名和测试后强制删除；不连接 `aijob_alpha`，不读取 `.data/`。

### 4.1 迁移/兼容

1. 空库 `001 -> 024`：历史 migration 可重放，前向修复设计不改变已登记版本。
2. 022 fixture -> 024：V1 文档、旧 JobDecision、旧任务逐列 hash 保持不变。
3. 历史公共 Case：自动映射为 public context，岗位版本和要求集不变。
4. 私有 Case：无公共岗位外键时可创建，跨 owner snapshot 失败。
5. 新长期 Case/Resume：创建不要求 30 天 expiry；短期 artifact 仍按 24 小时清理规则测试。

### 4.2 约束与权限

- 公共/私有 context 半配对、未知 kind、重复活动 Case、跨 owner 复合 FK 均失败。
- 旧事件可读，新事件未知字段和正文字段均失败。
- `aijob_collector_worker` 无 application/profile 新表 USAGE 或 SELECT。
- `aijob_web_api` 可按 owner 路由读写和单项删除；不可更新不可变事件/修订。
- `aijob_match_worker` 只能执行任务所需读取和受限删除，不能创建用户 Case/Review。

### 4.3 删除/恢复/迟到任务

- 单项 Case 删除后，Case 子表消失；未选择级联的 Resume/Review/Interview 保留且脱离 Case 显示明确状态。
- 全部 owner 删除后，刷新、重新建会话、恢复前置 fixture 都不能复活个人正文。
- owner epoch、revision、lease/fencing 任一变化时，迟到 task 不得写入 Case、Resume 或 Review。
- 备份恢复演练只恢复无正文墓碑/审计，不能恢复已删除正文。

### 4.4 旧路由真源

- 旧 `/resume`、`/recommendations`、`/insights` 的写入调用必须为空或只调用 Case 服务。
- 旧 JobDecision 可无损映射的状态与 Case 事务内兼容；不可映射状态返回稳定 409。
- 旧 tailoring run 归属不明时保持只读，不自动猜测 Case。

## 5. 实施顺序与退出条件

1. 先补 contracts 和离线 fixtures，不改数据库。
2. 运行 contract tests，确认旧 V1 DTO 与新联合类型可区分。
3. 设计前向 migration 草案和 PostgreSQL SQL 片段，仍不注册到 `migrate.ts`。
4. 运行隔离 PostgreSQL 测试，证明兼容、权限、删除和迟到任务规则。
5. 单独形成 `023F/024F` 证据包，作“继续、修改、回退、停止”决定。
6. 只有“继续”决定完成后，才允许创建正式 forward migration；再独立评审是否批准 025–027。

退出 Gate：contract tests、隔离 PostgreSQL 设计/结果、旧路由写入调用图、删除恢复证据和回退方案齐全；不提高产品证据等级，仍为 `E0`。

## 6. 2026-08-06 实施复核决定

- contracts 37/37、023F/024F 隔离 PostgreSQL 7/7 和串行全仓 617/617 测试通过；原型保持在 `packages/database/src/forward-contract/`，未加入 `migrateToLatest`。
- 已证明旧 023/024 行兼容、私有 JD owner 复合外键、长期 Case/Resume 可空 expiry、strict Case event/layout、独立 Resume Review、选择性 Case 删除和角色权限。
- 发现阻断：现有匿名 `identity.owners.retention_expires_at`、session 校验和 retention worker 仍会在 30 天后拒绝 owner 并删除全部 owner 数据。只注册 023F/024F 不能兑现 ADR-0031 的长期职业资产。
- 四选一决定为 **修改**：保留原型结论，先完成 `Account + EmailIdentity / 长期 owner` 前向契约与隔离测试，再把身份、ApplicationCase 和 Resume Review 按依赖顺序重排为正式 additive migrations。
