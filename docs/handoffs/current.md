# 当前项目交接：Aijob 求职 OS 2.0 Phase 2A-026B

> 交接日期：2026-08-06
>
> 当前分支：`codex/career-os-phase-1`
>
> 最近已推送基线：`3c92ba9 feat(career-os): add long-lived identity foundation`。本交接包含随后完成的 migration 026 代码与证据。
>
> 工作树预期：提交后只剩未跟踪 `.claude/`；不得读取、提交、覆盖或清理它。仍须用 `git status --short` 复核。
>
> 动态事实源：[MVP 路线](../06-mvp-roadmap.md)
>
> 稳定主计划：[Private Alpha 严格开发总计划](../plans/career-os-v2-upgrade-plan-2026-08-04.md)
>
> Phase 2 设计：[领域契约与迁移设计](../plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md)
>
> 本轮架构决定：[ADR-0031](../decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md)
>
> Phase 2R 证据：[架构对齐报告](../evidence/product/career-os-v2/phase-2r-architecture-realignment-2026-08-06.md)
>
> Phase 2R 契约：[契约与迁移影响矩阵](../plans/career-os-phase-2r-contract-and-migration-impact-matrix-2026-08-06.md)
>
> 前向修复设计：[Phase 2A 前向修复契约与隔离 PostgreSQL 测试设计](../plans/career-os-phase-2a-forward-contract-and-isolated-db-test-design-2026-08-06.md)
>
> Forward Contract 证据：[离线契约子切片验收](../evidence/product/career-os-v2/phase-2a-forward-contract-acceptance-2026-08-06.md)
>
> Identity Forward Contract 证据：[长期 owner 与邮箱身份验收](../evidence/product/career-os-v2/phase-2a-identity-forward-contract-acceptance-2026-08-06.md)
>
> Migration 025 证据：[Identity Account/Email Expand 验收](../evidence/product/career-os-v2/phase-2a-025-identity-account-email-expand-acceptance-2026-08-06.md)

> Migration 026 证据：[ApplicationCase Long-Lived Forward Repair 验收](../evidence/product/career-os-v2/phase-2a-026-application-case-long-lived-forward-repair-acceptance-2026-08-06.md)

## 1. 当前唯一目标

OS 2.0 初版已完成 Phase 1A/1B，并有 migration 023/024 的历史实现与验收记录。Phase 2R、Identity Forward Contract 与正式 migrations 025/026 已完成；026 已通过迁移、角色和删除工程门，但复核证明私有 Case 的要求子表与 strict event 仍只能表达公共 requirement set，四选一决定为“修改”。当前唯一工程切片是 **Phase 2A-026B Private Requirement Context Forward Repair：让要求状态、证据连接、问题和事件同时支持公共与私有岗位上下文**。

```text
Phase 2R contracts（已通过）
-> 023F/024F 未注册隔离原型（7/7，决定修改）
-> Identity contracts / 隔离原型（5/5 + 5/5，决定继续）
-> migration 025 Identity Account/Email Expand（6/6，决定继续）
-> migration 026 ApplicationCase Long-Lived Forward Repair（9/9，决定修改）
-> Phase 2A-026B Private Requirement Context Forward Repair
-> 公共/私有 requirement context / strict event / owner 隔离 / legacy / 删除
-> 通过后进入 migration 027 Resume/Review Forward Repair
```

本切片只修复私有要求上下文，不注册 Case HTTP API，不导入真实 JD，不发送真实邮件，不接真实 AI，不访问真实招聘来源或真实简历，也不创建 Resume/Interview 后续迁移。

## 2. 已通过基线

- Phase 1A：`7bb2140`，统一壳层、静态看板、Case 路由、功能旗标与响应式 Gate。
- 依赖安全修复：`5da2390`，`fast-uri` advisory 已清除。
- Phase 1B：`24368f5`，JD 三态与 Resume 静态建议四态、URL/焦点/旗标/浏览器 Gate。
- Phase 2 设计：`baf3276`，冻结复用矩阵、领域表、状态机、API、删除顺序、任务、权限、023–027 迁移和测试矩阵。
- Phase 2A-1：ApplicationCase strict contracts、application core 五表、复合岗位/owner 约束、30 天 TTL、不可变事件、索引和角色权限已落地；该 30 天约束现由 ADR-0031 标记为待复核历史实现。证据见 [Phase 2A-1 验收](../evidence/product/career-os-v2/phase-2a1-application-case-core-acceptance-2026-08-05.md)。
- Phase 2A-2：Resume V2 contracts、`resume_documents`、`resume_layout_revisions` 和既有 revision additive 扩展已落地；其 30 天约束和正文建议建模现由 Phase 2R 复核。证据见 [Phase 2A-2 验收](../evidence/product/career-os-v2/phase-2a2-resume-document-v2-acceptance-2026-08-05.md)。
- Forward Contract 与隔离原型：新增公共/私有 JobContext、strict Case event、Resume semantic content、strict layout 与 Review 聚合；contracts 37 项、023F/024F 隔离 PostgreSQL 7/7 通过。原型位于 `packages/database/src/forward-contract/` 且未加入 `migrateToLatest`；证据见 [Forward Contract 与隔离原型验收](../evidence/product/career-os-v2/phase-2a-forward-contract-acceptance-2026-08-06.md)。
- Identity Forward Contract：长期 owner、Account、EmailIdentity、验证码 challenge 和匿名 owner 认领 contracts/隔离原型分别 5/5 通过；历史记录见 [长期 owner 与邮箱身份验收](../evidence/product/career-os-v2/phase-2a-identity-forward-contract-acceptance-2026-08-06.md)。
- Migration 025：正式注册 Account/EmailIdentity/challenge 与长期 owner；统一 session、业务、任务 owner active predicate，retention 只处理匿名 owner，身份删除受 deletion epoch 保护。迁移 6/6 通过，证据见 [Migration 025 验收](../evidence/product/career-os-v2/phase-2a-025-identity-account-email-expand-acceptance-2026-08-06.md)。
- Migration 026：正式注册 owner-only 私有 JD snapshot/revision、公共/私有 Case、长期生命周期与 strict event，并补 ApplicationCase owner 删除覆盖。迁移 9/9、owner 删除/retention 2/2 通过；因私有 requirement context 缺口，决定为“修改”。证据见 [Migration 026 验收](../evidence/product/career-os-v2/phase-2a-026-application-case-long-lived-forward-repair-acceptance-2026-08-06.md)。
- 最新串行全仓工程门：config 17、contracts 42、database 47、web 91、platform 434，共 631 项测试通过。lint 375 文件、TypeScript、build 和 `audit:ci` 通过；audit 保留 1 high ignored/1 moderate 已登记 advisory，web 主包 530.73 kB。本轮最终 `git diff --check` 仍须在文档收口后复跑。

产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。Phase 4 前不恢复真实供给扩容。

## 3. Phase 2A-2 已完成：migration 024

### Contracts

新增并从 `packages/contracts/src/index.ts` 导出：

- `ResumeDocumentKind = base | case_derived`
- `ResumeTemplateKey = cn_classic_single_column | cn_compact_technical`
- Resume V2 section/block/content DTO；section 与 block ID 必须稳定且唯一。
- Resume document、content revision、layout revision DTO 与 strict create/update contracts。
- virtual legacy V1 DTO 与 V2 DTO 必须可判别；V1 update 只能提交 `legacySourceRevisionId + expectedRevision=0` 进入首次转换命令。
- 请求不能接受客户端 owner、owner epoch、TTL、当前修订指针或派生文档的服务端固定字段。

### Migration 024

新建 `profile.resume_documents`：

- owner/epoch、`base/case_derived`、title、可选同 owner ApplicationCase。
- 派生文档固定 source content revision、job version、requirement set 和 evidence revision；base 文档这些引用全部为空。
- current content/layout 指针、aggregate revision、owner 内创建幂等、历史 30 天 TTL（Phase 2R 待前向修复）、deleted/created/updated 时间。
- 同一未删除 Case 首轮最多一个派生文档；列表、到期、Case 和 FK 索引齐全。

additive 扩展既有 `profile.resume_document_revisions`：

- 新增 nullable `document_id`、`document_revision`、`base_document_revision`。
- V1：`resume-document-v1` 且三个新列全部为空；旧行逐列不变。
- V2：`resume-document-v2` 且 document/document revision 非空，base 只指向同 owner、同 document 的旧内容修订。
- 保留既有 owner 全局 `revision/base_revision`，内容修订继续禁止 UPDATE。

新建 `profile.resume_layout_revisions`：

- owner/document/layout revision、同文档 base、固定 template key、`section_order` 和无正文 settings、content hash、created time。
- 布局修订禁止 UPDATE；换模板和排序不创建内容修订，不改变 section/block/evidence ID。

所有新表显式 GRANT/REVOKE；collector 不得获得 profile 新表权限。migration 024 只 expand，`down` 使用前向修复。

### Tests

- contracts：V1/V2 判别、strict object、固定模板、稳定/唯一 ID、base/derived 配对与长度边界。
- 空库 `001 -> 024`。
- 含 Resume V1、Resume Evidence V1、ApplicationCase 和旧 task/decision 的 023 fixture 升级到 024；比较 V1 行所有旧列。
- base/derived 字段配对、跨 owner Case/evidence/document FK、文档内修订序列/base owner、布局不可变、历史 30 天 TTL 复核、活动 Case 唯一派生文档、索引和五角色权限。
- PostgreSQL 地址继续通过 loopback + `aijob_test*` 隔离守卫；临时数据库必须在测试后删除。

## 4. Phase 2A-026B 固定范围

下一切片只修复 migration 026 暴露的私有要求上下文缺口：

- 先在 contracts 中冻结 `PublicRequirementContext | PrivateRequirementContext`，不得让客户端提交 owner 或跨 Case snapshot。
- additive migration 名称固定为 `026b_private_requirement_context_forward_repair`；历史 public 行逐列兼容，`down` 不删除要求状态、证据连接、问题或事件。
- `case_requirement_states` 同时表达公共 `requirement_set_id` 与私有 `requirement_set_revision`，并由数据库约束保证分支与 Case JobContext 一致。
- evidence link 和 question 通过 owner-scoped requirement-state 引用复用同一要求；不能继续依赖只适用于公共 UUID 的复合外键。
- requirement state/evidence strict event 必须接受精确的公共或私有 payload，同时继续读取 026 已产生的合法 public `case-event-v1`。
- 服务端后续必须验证私有 `requirement_id` 存在于 Case 固定的 snapshot revision；本切片先冻结数据库与 contract，不注册业务 API。
- owner 全量删除、collector 拒绝、match-worker 删除、跨 owner、legacy public row 和 rollback 必须用隔离 PostgreSQL 证明。

非目标：Case HTTP API、真实私有 JD、Resume/Review migration 027、Interview、真实邮件供应商、手机号短信、密码登录、OAuth、真实 AI、真实招聘来源、真实简历、服务器和云资源。

## 5. 实现时必须保持的决定

- migration 026 已正式注册，只允许 additive 026B；不得重写 026 或破坏已存在 public/private Case。
- 不能把 private requirements 写入 `catalog.job_requirement_sets`，也不能给私有 JD 伪造公共 UUID。
- 公共要求继续固定 `requirement_set_id`；私有要求固定 Case snapshot 的 `requirement_set_revision`，两者必须是严格联合类型。
- evidence link 和 question 的 owner/Case/requirement-state 引用必须可由 FK 验证；仅靠应用层字符串拼接不够。
- 事件不得复制 JD 正文、简历正文或用户证据正文，只保存上下文类型、修订、要求 ID、证据引用和原因码。
- 新外键列必须有索引；历史 public 数据只允许确定性 backfill，不改变 revision、时间、状态或用户备注。
- Resume V2/Review 的长期生命周期和删除覆盖仍由 migration 027 负责，不能混入 026B。

## 6. 已知冲突与风险

- Phase 2R 的公共/私有 JobContext 允许私有 JD 做资格/证据核对，但原 5.3 要求子表仍只写公共 `requirement_set_id`；026 实测确认该冲突，026B 必须显式修正。
- `case_requirement_evidence_links` 与 `case_questions` 当前通过公共 requirement-set 复合键引用 state；直接把 UUID 改 nullable 会破坏 FK 和唯一性，必须先设计 owner-scoped state 引用与兼容 backfill。
- migration 026 的 strict validator 已允许 public `case-event-v1`；026B 扩展 private payload 时必须保留这些历史事件可读且不可更新。
- Resume V2 新表仍未进入 owner 全量删除服务；只能在 migration 027 后宣称 Resume 删除覆盖。
- ADR-0005 要求 session Cookie SameSite=Strict，当前代码为 session Lax/CSRF Strict；属于服务器就绪前身份安全债，不混入 026B。

## 7. 首轮代码入口

按顺序只读检查：

1. `packages/contracts/src/application-cases.ts` 中 requirement state/evidence/question 与 event schemas，以及对应 tests。
2. `packages/database/src/migrations/023_application_case_core_expand.ts` 的三个要求子表与 `026_application_case_long_lived_forward_repair.ts`。
3. `packages/database/src/forward-contract/023f_application_case_long_lived.ts` 中 strict event validator、角色权限和 026 隔离测试。
4. `packages/database/src/types.ts`、`apps/platform/src/profile/deletion-service.ts` 与 retention integration tests；本切片不注册新服务路由。

## 8. Gate 与排除项

至少运行：

```text
git diff --check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit:ci
隔离 PostgreSQL：空库 001 -> 026B、026 fixture、public/private requirement context、legacy event、跨 owner、删除、角色与前向回退
```

不得读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机快照；不得访问真实招聘来源、真实 AI 或服务器。已有改动属于 coco；冲突必须记录并复现，不能静默覆盖。
