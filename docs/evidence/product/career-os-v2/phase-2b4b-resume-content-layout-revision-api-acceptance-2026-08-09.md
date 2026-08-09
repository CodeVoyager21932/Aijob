# Phase 2B-4B Resume Content/Layout Revision API 验收

- 日期：2026-08-09
- 分支：`codex/career-os-phase-1`
- 实现前基线：`c0cc1f6 feat(platform): add resume document aggregate API`
- 产品证据：仍为 `E0`
- 四选一决定：**继续**到 `Phase 2B-4C Interview/Debrief/Knowledge Service Boundary`

## 1. 目标与范围

本切片只在 2B-4A 的真实 Resume Document 聚合上开放 V1 只读转换、第一次编辑，以及不可变正文/布局历史：

- `GET /v1/resume-documents/legacy-source/:legacySourceRevisionId`
- `GET/POST /v1/resume-documents/:documentId/revisions`
- `GET/POST /v1/resume-documents/:documentId/layout-revisions`

本切片没有实现 Resume Review/Tailoring、DOCX、Interview、Debrief、Knowledge、前端或真实 AI；没有访问真实招聘来源、邮件、服务器、真实 JD、真实简历或本地业务数据库。`.claude/`、`.data/`、密钥、令牌、本地数据库和下载产物均未读取或暂存。

## 2. 实现结果

### 2.1 V1 只读转换与旧入口兼容

- 转换 endpoint 只接受当前 owner、当前 epoch 的最新 `resume-document-v1` 且 `document_id IS NULL` 来源；跨 owner、旧 epoch、非最新或非 V1 统一不可枚举为有效来源。
- GET 只转换 DTO，不插入、不回填、不推进 pointer；转换前后数据库行数、ID、section/block ID 和文本保持不变，也不生成新事实。
- 旧 `/v1/profile/document` 同样只读取当前 owner/epoch 的 V1 行；V2 写入后不会误把 `resume-content-v1` 当成旧页面当前文档。
- 旧 V1 后续写入仍可工作：owner 全局 `revision` 避开 V2 行保持唯一，旧 `base_revision` 只指向上一条 V1，不把 V2 插入旧链。

### 2.2 第一次编辑与唯一基础真源

- 2B-4A 已允许先创建空 base 聚合，因此 2B-4B 初始化已有聚合，不从 legacy 隐式创建第二个 Resume Document。
- base 首次编辑使用 `expectedRevision=0 + legacySourceRevisionId`；`0` 是“聚合尚无正文”的显式哨兵。服务同时验证聚合仍为初始 base、真实聚合 revision 为 1、content/layout pointer 均为空。
- 同一事务创建 `resume-content-v1` content revision 1 与默认 `resume-layout-v2` layout revision 1，推进两个 current pointer，并把聚合 revision 推进到 2。
- migration 030 的 owner/legacy 部分唯一索引和同 owner/epoch/V1 触发器阻止一个 legacy 来源初始化两个仍存续的 V2 基础真源。
- Case-derived 首次正文必须从聚合已固定的基础 content revision开始，使用真实聚合 `expectedRevision`，并保持完全相同的 section/block ID 集。

### 2.3 不可变正文与布局修订

- 正文只接受 strict `resume-content-v1`；文档内 `documentRevision` 严格递增，后续 `baseDocumentRevisionId` 必须指向同 owner、同文档上一正文修订。
- 新正文兼容旧 owner 全局 `revision`，但 `base_revision` 固定为 NULL；真实链只使用 `base_document_revision_id`，避免不同文档通过旧全局链互相阻塞单项删除。
- base 文档 evidence ID 必须存在于同 owner 当前已确认事实；Case-derived 只允许其固定 evidence revision 中的证据。跨 owner、未确认、未知或越过固定 revision 均 fail closed。
- 正文结构增删会自动基于稳定 section ID 重排布局：保留当前模板与 settings，删除不存在 ID，并按正文顺序补入新 ID。
- 直接布局更新只接受当前正文完整且不重复的 section ID 集；可在两种白名单中文模板间切换并修改受控 token，不接收正文或 evidence。
- 正文和布局历史均使用整数 revision keyset 分页，游标按同一文档稳定恢复；数据库 no-update trigger 继续禁止原地改写修订。

### 2.4 幂等、并发与错误语义

- migration 030 为正文/布局不可变行增加 nullable mutation key、request hash 和当次 result document revision；旧行保持 NULL、值不变。
- 同 owner/document/key 的同请求并发只产生一条修订；进程无关重放返回当时的 content/layout revision 与聚合 revision，不伪装成当前 pointer。
- 同键不同请求返回 `409 IDEMPOTENCY_KEY_REUSED`；不同键但 stale `expectedRevision` 返回 `409 RESUME_DOCUMENT_REVISION_CONFLICT`。
- 正文或布局完全相同但使用新命令时返回稳定 no-op 结果，不伪造新修订；幂等重放优先于当前 revision 检查。
- 跨 owner、墓碑和不存在文档统一 `404 RESUME_DOCUMENT_NOT_FOUND`；写请求继续要求 Origin/CSRF 和 `Idempotency-Key`，所有响应继续 `no-store`。

## 3. 实现中发现并收口的冲突

实现前确认既有 Schema 无法在进程重启后恢复一次正文/布局命令的原始结果，也无法阻止同一 legacy 来源初始化多个空 base。该冲突先记录为“修改”，再由 additive、forward-only migration 030 最小收口；详见 [Resume Revision 幂等 Schema 冲突记录](phase-2b4b-resume-revision-schema-conflict-2026-08-09.md)。

全数据库回归还暴露了旧 forward-contract 测试使用 JavaScript 毫秒时间完成刚由 PostgreSQL 微秒时间创建的 Interview/Review 行。处理方式是让测试更新使用数据库 `GREATEST(..., clock_timestamp())`，没有放宽任何时间顺序或状态约束。

动态路线此前把 2B-4B 后续写成 Resume Review/Tailoring，但稳定主计划已明确 Phase 2B-4C 为 Interview/Debrief/Knowledge Service Boundary。本次按事实源优先级纠正动态路线，不借机扩展 2B-4B。

## 4. 自动化结果

| 检查 | 结果 |
|---|---|
| Resume contracts focused | 14/14，通过 |
| migration 030 PostgreSQL | 3/3，通过；覆盖旧行兼容、完整回执、legacy 唯一真源、不可变和非法部分回执 |
| Resume Document PostgreSQL/HTTP | 3/3，通过；覆盖转换零写、首次编辑、历史分页、幂等/并发/no-op、base/derived、public/private、owner、CSRF、墓碑与 V1 兼容 |
| Resume + retention + local-owner focused | 6/6，通过 |
| database 全包（隔离 PostgreSQL） | 54/54，通过 |
| platform 全包（隔离 PostgreSQL） | 442/442，通过 |
| 串行全仓统一退出码 | config 17 + contracts 60 + database 54 + platform 442 + web 91 = 664/664 |
| `pnpm lint` | 390 files，通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过；Web 主包 542.26 kB，只保留既有 chunk warning |
| `pnpm audit:ci` | 退出码 0；1 high ignored |
| `git diff --check` | 通过 |

所有 PostgreSQL 轮次均使用随机命名隔离父库和测试子库，结束后删除；开发库、Alpha 库和本地业务数据未读取或修改。

### 依赖审计

- 没有新增或升级依赖。
- 审计继续保留已登记的 Vite/PostCSS 开发链 `nanoid` high ignored；它不在生产业务路径，不能宣称漏洞已修复，既有移除条件不变。

## 5. 人工与视觉检查

本切片没有前端交互、样式、页面路由或包加载策略变化，不重复伪造浏览器产品证据。Phase 1B 的 1920/1280/768/320、200% 缩放、键盘和功能旗标结果继续作为 UI 基线；构建只保留既有 chunk warning。

## 6. 风险与后续边界

- 当前只证明 Resume Content/Layout owner-protected API 和数据库边界稳定，不代表用户已能在前端编辑、审查、导出简历，也不提高产品证据；仍为 `E0`。
- migration 030 是 forward-only expand。应用回退保留新列、回执与不可变修订；G4 前不做 contract migration。
- 2B-4C 只建立 Interview/Debrief/Knowledge 聚合服务与既有 PostgreSQL 任务引用，不实现完整生成器、前端或真实 AI。
- Resume Review/Tailoring、DOCX 与两个中文模板的可用 PoC 仍按主计划留在后续 Resume V2 PoC，不在 2B-4C 偷跑。
- 可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0；Phase 4 前不恢复真实来源。

## 7. 决定

决定：**继续**。

下一唯一目标为 `Phase 2B-4C Interview/Debrief/Knowledge Service Boundary`：只建立后续 PoC 所需的 owner-protected 聚合服务、严格接口与既有 PostgreSQL 任务引用；不实现完整生成器、前端、真实 AI、真实招聘来源、邮件或服务器。
