# 当前项目交接：Aijob 求职 OS 2.0 Phase 2A-3

> 交接日期：2026-08-05
>
> 当前分支：`codex/career-os-phase-1`
>
> 当前 HEAD：本交接所在 Phase 2A-2 实现提交；用 `git log -1 --oneline` 获取哈希。前序提交为 `8581111 feat(database): add ApplicationCase core schema`。
>
> 工作树预期：提交后只剩未跟踪 `.claude/`；不得读取、提交、覆盖或清理它。仍须用 `git status --short` 复核。
>
> 动态事实源：[MVP 路线](../06-mvp-roadmap.md)
>
> 稳定主计划：[Private Alpha 严格开发总计划](../plans/career-os-v2-upgrade-plan-2026-08-04.md)
>
> Phase 2 设计：[领域契约与迁移设计](../plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md)

## 1. 当前唯一目标

Phase 1A/1B、Phase 2 领域设计、Phase 2A-1 migration 023 与 Phase 2A-2 migration 024 Gate 已通过。当前唯一目标是 **Phase 2A-3：Interview/Debrief/Knowledge contracts + migrations 025-027**。

```text
Interview session / turn / feedback contracts
-> Debrief 聚合与用户确认边界
-> Knowledge Clip 引用式保存与 Case 关联
-> migrations 025-027 additive schema
-> owner/epoch/TTL/删除墓碑/迟到任务约束
-> template fallback 与 controlled_ai 兼容契约
-> 离线夹具和隔离 PostgreSQL 验证
-> 继续 / 修改 / 回退 / 停止
```

本切片不注册 HTTP API，不接真实 AI，不访问真实招聘来源或真实简历；只实现 Interview/Debrief/Knowledge 的 contracts、additive schema 和隔离测试。没有隔离 PostgreSQL 实际结果不能通过 migrations 025-027 Gate。

## 2. 已通过基线

- Phase 1A：`7bb2140`，统一壳层、静态看板、Case 路由、功能旗标与响应式 Gate。
- 依赖安全修复：`5da2390`，`fast-uri` advisory 已清除。
- Phase 1B：`24368f5`，JD 三态与 Resume 静态建议四态、URL/焦点/旗标/浏览器 Gate。
- Phase 2 设计：`baf3276`，冻结复用矩阵、领域表、状态机、API、删除顺序、任务、权限、023–027 迁移和测试矩阵。
- Phase 2A-1：ApplicationCase strict contracts、application core 五表、复合岗位/owner 约束、30 天 TTL、不可变事件、索引和角色权限已落地；空库与 022 fixture 升级通过。证据见 [Phase 2A-1 验收](../evidence/product/career-os-v2/phase-2a1-application-case-core-acceptance-2026-08-05.md)。
- Phase 2A-2：Resume V2 contracts、`resume_documents`、`resume_layout_revisions` 和既有 revision additive 扩展已落地；空库 `001 -> 024`、V1 逐列兼容、同 owner/document 修订链、布局不可变、Case/TTL/模板/角色约束通过。证据见 [Phase 2A-2 验收](../evidence/product/career-os-v2/phase-2a2-resume-document-v2-acceptance-2026-08-05.md)。
- 最新全仓工程门：config 17、contracts 28、database 32、web 91、platform 433，共 601 项测试通过；024 专属集成测试 4/4。lint 367 文件、TypeScript、build 和 `git diff --check` 通过；`audit:ci` 按仓库策略通过，保留 1 high/1 moderate 已登记忽略 advisory，web 主包 517.87 kB。

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
- current content/layout 指针、aggregate revision、owner 内创建幂等、30 天 TTL、deleted/created/updated 时间。
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
- base/derived 字段配对、跨 owner Case/evidence/document FK、文档内修订序列/base owner、布局不可变、30 天 TTL、活动 Case 唯一派生文档、索引和五角色权限。
- PostgreSQL 地址继续通过 loopback + `aijob_test*` 隔离守卫；临时数据库必须在测试后删除。

## 4. Phase 2A-3 固定范围

下一切片只实现三组领域 contracts 与 additive migrations：

- Interview：`interview_sessions`、追加式 `interview_turns`、`interview_feedback`；固定 Case、岗位版本、要求集和已确认 evidence revision，Private Alpha 默认 `template`，controlled AI 只保留兼容契约和模拟端点，不调用真实 AI。
- Debrief：每个未删除 Case 最多一个复盘聚合；只保存表达问题、证据缺口、练习计划和用户确认状态，不能直接写入新的经历事实。
- Knowledge：`knowledge_clips` 与 Case 关联；只保存 HTTPS URL、标题、短摘要、场景和用户笔记，不抓全文、不做社区、不自动刷新。
- 所有实体继续带 owner/epoch、最长 30 天 TTL、删除墓碑、迟到任务拒绝和显式角色权限；migrations 025-027 只 expand，先补离线夹具再做隔离 PostgreSQL 验证。

非目标：HTTP API、Interview UI、真实 AI、真实招聘来源、真实简历、服务器和云资源。

## 5. 实现时必须保持的决定

- 不创建第二张 `resume_document_revisions`；只新建聚合与 layout 表，并 additive 扩展既有内容修订表。
- V1 行不回填 `document_id`，不修改 schema、sections、hash、owner revision 或时间；旧 `/v1/profile/document` 后续仍只读 V1 且旗标关闭时不误读 V2。
- V2 内容仍存结构化 sections JSONB；不引入通用富文本编辑器、Tiptap 或第二套事实库。
- 模板和章节顺序属于 layout revision；语义正文、section/block/evidence ID 属于 content revision，换模板不得改变内容。
- `case_derived` 的 Case、基础内容、岗位版本、要求集与 evidence revision 全部固定且同 owner；base 文档全部为空。
- 顶层文档 `expires_at <= created_at + 30 days`，服务未来还须取 owner expiry 的更早值。
- 新外键列必须有索引；列表使用 `(owner_id, updated_at DESC, id DESC)` keyset，不使用深 OFFSET。
- migration 024 `down` 不得破坏 V1 或新增不可变个人历史。

## 6. 已知冲突与风险

- `profile.resume_document_revisions` 由 migration 011 创建，migration 013 的 `resume_document_revisions_schema_version` 当前只允许 V1；024 必须替换为 V1/V2 配对约束，不能叠加一个互相冲突的 V2 CHECK。
- 既有 `profile.resume_document_revisions` 已有 `(owner_id, revision)`、`(owner_id, id)`、同 owner base FK、owner-created index 和 immutable trigger；024 必须复用，不能重复建语义相同索引/触发器。
- 既有 `resume_evidence_revisions.document_revision_id`、recommendation/tailoring 的 document revision FK 都引用旧内容修订；024 不能改变这些旧引用的语义或删除行为。
- migration 023 已授予 application 表权限，但 migration 021 的历史 `ALL TABLES` 不会覆盖 024 新表；新 profile 对象必须显式授权。
- ADR-0005 要求 session Cookie SameSite=Strict，当前代码为 session Lax/CSRF Strict；属于服务器就绪前身份安全债，不混入 024。

## 7. 首轮代码入口

按顺序只读检查：

1. `packages/contracts/src/profile.ts`、`application-cases.ts`、`common.ts`、`enums.ts`、`index.ts` 与 contract tests。
2. `packages/database/src/migrations/011_g2_correctness_foundations.ts`、`013_enforce_correctness_projection_ownership.ts`、`023_application_case_core_expand.ts`、`migrate.ts`、`types.ts`。
3. `apps/platform/src/resume/repository.ts`、`resume/routes.ts`、`tailoring/service.ts` 和旧 V1 integration tests，只用于冻结兼容与转换边界；本切片不改服务。
4. [Phase 2 设计](../plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md)第 4、6、10–13 节。

## 8. Gate 与排除项

至少运行：

```text
git diff --check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit:ci
隔离 PostgreSQL：空库迁移、023 fixture 升级、V1 逐列兼容、约束/权限测试
```

不得读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机快照；不得访问真实招聘来源、真实 AI 或服务器。已有改动属于 coco；冲突必须记录并复现，不能静默覆盖。
