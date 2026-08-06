# 当前项目交接：Aijob 求职 OS 2.0 Phase 2A migration 026

> 交接日期：2026-08-06
>
> 当前分支：`codex/career-os-phase-1`
>
> 当前 HEAD：`852eadd feat(database): add Resume Document V2 schema`。前序提交为 `8581111 feat(database): add ApplicationCase core schema`。
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

## 1. 当前唯一目标

OS 2.0 初版已完成 Phase 1A/1B，并有 migration 023/024 的历史实现与验收记录。Phase 2R、023F/024F、Identity Forward Contract 与正式 migration 025 已完成；025 四选一决定为“继续”。当前唯一工程切片是 **Phase 2A-026 ApplicationCase Long-Lived Forward Repair：把已验证的 023F 候选正式化，并补齐长期 Case 与主动删除语义**。

```text
Phase 2R contracts（已通过）
-> 023F/024F 未注册隔离原型（7/7，决定修改）
-> Identity contracts / 隔离原型（5/5 + 5/5，决定继续）
-> migration 025 Identity Account/Email Expand（6/6，决定继续）
-> migration 026 ApplicationCase Long-Lived Forward Repair
-> 空库 / 025 fixture / public-private context / strict event / 删除 / 角色 / 回退
-> 四选一决定
-> 继续 / 修改 / 回退 / 停止
```

本切片只正式化 ApplicationCase 前向修复并覆盖删除路径，不注册 Case HTTP API，不导入真实 JD，不发送真实邮件，不接真实 AI，不访问真实招聘来源或真实简历，也不创建 Resume/Interview 后续迁移。

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
- 最新串行全仓工程门：config 17、contracts 42、database 45、web 91、platform 434，共 629 项测试通过。lint 374 文件、TypeScript、build 和 `audit:ci` 通过；audit 保留 1 high ignored/1 moderate 已登记 advisory，web 主包 530.73 kB。本轮最终 `git diff --check` 仍须在文档收口后复跑。

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

## 4. Phase 2A-026 固定范围

下一切片只把已验证的 023F ApplicationCase 候选正式化为 additive migration：

- 新建 migration 026，以 023F 为候选唯一 SQL 真源；`down` 不删除私有 JD 或 Case 历史，只允许前向修复。
- 新增 owner-only `private_job_snapshots` 与不可变 revisions；Case 使用 `public | private` 判别上下文，私有 JD 不进入岗位目录或其他 owner。
- 历史 public Case 逐列保持，`expires_at` 只作为 legacy nullable 字段；新 Case 默认长期保留并由用户主动删除。
- 新 Case event 只接受 `case-event-v1` strict payload；历史 `legacy-case-event-v0` 保持只读。
- 删除服务必须按 FK 顺序删除 Case 子表、私有 JD revisions/snapshot 和 Case；不得只删除身份或旧 profile 表后留下职业数据。
- 隔离 PostgreSQL 覆盖空库 `001 -> 026`、025 fixture、public/private owner 隔离、legacy event、strict event、角色、删除与前向回退。

非目标：Case HTTP API、真实私有 JD、真实邮件供应商、手机号短信、密码登录、OAuth、Interview UI、真实 AI、真实招聘来源、真实简历、服务器和云资源、Resume/Interview 后续迁移。

## 5. 实现时必须保持的决定

- 不创建第二张 `resume_document_revisions`；只新建聚合与 layout 表，并 additive 扩展既有内容修订表。
- V1 行不回填 `document_id`，不修改 schema、sections、hash、owner revision 或时间；旧 `/v1/profile/document` 后续仍只读 V1 且旗标关闭时不误读 V2。
- V2 内容仍存结构化 sections JSONB；不引入通用富文本编辑器、Tiptap 或第二套事实库。
- 模板和章节顺序属于 layout revision；语义正文、section/block/evidence ID 属于 content revision，换模板不得改变内容。
- `case_derived` 的 Case、基础内容、岗位版本、要求集与 evidence revision 全部固定且同 owner；base 文档全部为空。
- 顶层文档历史约束为 `expires_at <= created_at + 30 days`；Phase 2R 将其改为用户主动删除模型，不能继续向新迁移复制。
- 新外键列必须有索引；列表使用 `(owner_id, updated_at DESC, id DESC)` keyset，不使用深 OFFSET。
- migration 024 `down` 不得破坏 V1 或新增不可变个人历史。

## 6. 已知冲突与风险

- `profile.resume_document_revisions` 由 migration 011 创建，migration 013 的 `resume_document_revisions_schema_version` 当前只允许 V1；024 必须替换为 V1/V2 配对约束，不能叠加一个互相冲突的 V2 CHECK。
- 既有 `profile.resume_document_revisions` 已有 `(owner_id, revision)`、`(owner_id, id)`、同 owner base FK、owner-created index 和 immutable trigger；024 必须复用，不能重复建语义相同索引/触发器。
- 既有 `resume_evidence_revisions.document_revision_id`、recommendation/tailoring 的 document revision FK 都引用旧内容修订；024 不能改变这些旧引用的语义或删除行为。
- migration 023 已授予 application 表权限，但 migration 021 的历史 `ALL TABLES` 不会覆盖 024 新表；新 profile 对象必须显式授权。
- ADR-0005 要求 session Cookie SameSite=Strict，当前代码为 session Lax/CSRF Strict；属于服务器就绪前身份安全债，不混入 024。
- 023F 原型是在 migration 024 上验证的；正式 026 必须改为以 025 fixture 为升级基线，证明 account-managed owner 不被 legacy expiry 误删。
- 现有删除服务尚未删除 `application.*` 和 Resume V2 新表；026 只能声明 ApplicationCase 删除覆盖，Resume V2 删除覆盖必须在后续 Resume Forward Repair 完成。
- 023F 给 `private_job_snapshot_revisions.content_text` 预留最多 200000 字；正式化前必须复核它是用户主动保存的岗位快照而非公共抓取入口，并保持 owner-only、无共享、可主动删除。

## 7. 首轮代码入口

按顺序只读检查：

1. `packages/database/src/forward-contract/023f_application_case_long_lived.ts` 与 `phase-2a-forward-contract.integration.test.ts`。
2. `packages/database/src/migrations/023_application_case_core_expand.ts`、`025_identity_account_email_expand.ts`、`migrate.ts` 与 `types.ts`。
3. `packages/contracts/src/application-cases.ts` 与 tests，确认 public/private union 和 strict event 已冻结。
4. `apps/platform/src/profile/deletion-service.ts`、retention integration tests 与 migration 023/025 权限 tests；本切片不注册新服务路由。

## 8. Gate 与排除项

至少运行：

```text
git diff --check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit:ci
隔离 PostgreSQL：空库迁移、025 fixture 升级、public/private/legacy event、删除、约束与权限测试
```

不得读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机快照；不得访问真实招聘来源、真实 AI 或服务器。已有改动属于 coco；冲突必须记录并复现，不能静默覆盖。
