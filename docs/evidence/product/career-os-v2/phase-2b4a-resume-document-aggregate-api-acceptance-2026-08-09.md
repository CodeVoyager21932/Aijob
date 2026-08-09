# Phase 2B-4A Resume Document Aggregate API 验收

- 日期：2026-08-09
- 分支：`codex/career-os-phase-1`
- 实现前基线：`f10fb74 feat(platform): add application case requirement API`
- 产品证据：仍为 `E0`
- 四选一决定：**继续**到 `Phase 2B-4B Resume Content/Layout Revision API`

## 1. 目标与范围

本切片只把 migrations 024/027 已存在的 Resume Document V2 聚合接入既有 owner-protected 模块化单体：

- `GET /v1/resume-documents`：稳定 keyset 列表，并明确返回当前 owner 的最新只读 V1 来源摘要。
- `POST /v1/resume-documents`：以 `Idempotency-Key` 幂等创建 base 或 Case-derived 聚合。
- `GET /v1/resume-documents/:documentId`：读取同 owner、同 epoch、未删除的 V2 聚合详情。

本切片没有正文/布局编辑、Review/Tailoring、DOCX、Interview、Knowledge 或前端变化；没有访问真实招聘来源、真实 AI、邮件、服务器、真实 JD、真实简历或本地业务数据库。`.claude/`、`.data/`、密钥、令牌、本地数据库和下载产物均未读取或暂存。

## 2. 实现结果

### 2.1 V1 发现与 V2 聚合边界

- 列表 `items` 只包含真实 `resume_documents` V2 聚合，不用旧 revision ID 伪造文档 ID、聚合 revision 或 current pointer。
- 最新 legacy V1 以顶层 `legacySource` 返回，固定 `legacySourceRevisionId/schemaVersion/revision/owner/epoch/confirmedAt/readOnly=true`。
- GET 只读，不回填、不插入、不修改 V1。正文虚拟转换和第一次编辑创建 V2 仍由 2B-4B 完成。
- 合同测试明确拒绝把 V1 revision 结构塞进 V2 `items`；已有用户不会无提示消失，调用方也不会误把只读来源当成已创建的 V2 聚合。

### 2.2 列表、详情与长期保留

- V2 列表只读取当前 owner、当前 owner epoch、`deleted_at IS NULL`，按 `updated_at DESC,id DESC` 排序。
- 游标包含版本、查询签名和 `(updatedAt,id)`，无效或不匹配游标返回 `400 INVALID_RESUME_DOCUMENT_CURSOR`。
- base 聚合的 Case、JobContext、基础修订与证据引用保持全空；case-derived 聚合按 strict public/private `JobContext` 映射。
- 新建 base 初始 `revision=1`，content/layout pointer 为空，`expires_at=NULL`，默认长期保留并由用户主动删除。
- 详情对不存在、墓碑和跨 owner 统一返回 `404 RESUME_DOCUMENT_NOT_FOUND`，不枚举归属。

### 2.3 幂等创建与固定引用

- 同 owner、同请求编号和相同 canonical request 并发创建只产生一个聚合，并重放原创建结果；同键不同请求返回 `409 IDEMPOTENCY_KEY_REUSED`。
- 已由同一请求编号创建但后来删除的文档返回 `410 RESUME_DOCUMENT_DELETED`，不会静默复活或改写墓碑。
- Case-derived 创建在同一事务锁定 Case，重新验证 owner/epoch/墓碑，并用 Case ID 的 owner-scoped advisory lock 串行化同 Case 并发。
- 基础修订必须来自同 owner、同 epoch、未删除 base 文档的 strict `resume-content-v1`；legacy、派生、跨 owner、未知或无效内容统一 fail closed。
- 服务端选择同 owner 当前可 strict 解析且非空的已确认证据 revision；调用方不能提交或替换 evidence revision。
- 派生聚合固定 Case 当时的 public/private JobContext、基础文档及其内容修订、证据 revision。测试中的公共目录已经指向 V2，但固定在 V1 的 Case 派生文档仍保持 V1，证明没有偷偷读取当前目录指针。
- 同一未删除 Case 最多一个派生文档；不同命令并发时一个成功、一个稳定返回 `409 RESUME_DOCUMENT_FOR_CASE_EXISTS`。

### 2.4 安全与模块边界

- 新模块位于 `apps/platform/src/resume-documents/`，没有混入旧 `/v1/resume-analyses` 上传解析路由。
- 所有 endpoint 复用现有安全 Cookie owner、Origin/CSRF、Problem Details、PostgreSQL 和运行角色，并纳入全局 `no-store` 前缀。
- 请求不能提交 owner、epoch、JobContext、evidence revision、生命周期、revision 或数据库时间。
- 没有新增 migration、数据库、缓存、队列、认证、AI SDK 或依赖。

## 3. 执行中发现并修复的稳定性冲突

第一轮 Platform 全包出现一个既有 ApplicationCase 要求写入失败。可复现根因是应用使用 JavaScript 毫秒级 `new Date()` 覆盖 PostgreSQL 微秒级 `created_at`；在创建后立即变更时，偶发生成 `updated_at < created_at`，正确的数据库约束因此拒绝写入。

处理决定为“修改”，但不放宽数据库约束：

- Case 聚合、requirement state 和 question 的更新时间改用 PostgreSQL `GREATEST(updated_at, clock_timestamp())`。
- Case 结束时间使用 `GREATEST(created_at, clock_timestamp())`。
- evidence link 移除时间使用 `GREATEST(linked_at, clock_timestamp())`；首次链接恢复数据库默认时间。
- 局部 ApplicationCase + Resume Document 回归 5/5、第二轮 Platform 全包 441/441、最终全仓 659/659 均通过。

该修复没有改变状态机、revision、事件或生命周期语义，只消除跨时钟精度竞态。

## 4. 自动化结果

| 检查 | 结果 |
|---|---|
| Resume Document contracts | focused 13/13；contracts 全包 59/59，通过 |
| Resume Document PostgreSQL/HTTP | 2/2，通过；覆盖 V1/V2 边界、游标、base/derived、public/private、固定引用、并发、幂等、owner、CSRF、`no-store` 与墓碑 |
| ApplicationCase + Resume focused | 5/5，通过；验证数据库单调时间修复 |
| database 全包（隔离 PostgreSQL） | 51/51，通过 |
| platform 全包（隔离 PostgreSQL） | 441/441，通过 |
| web 全包 | 91/91，通过 |
| 隔离 PostgreSQL 串行全仓 | config 17 + contracts 59 + database 51 + platform 441 + web 91 = 659/659 |
| `pnpm lint` | 387 files，通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过；Web 主包 541.53 kB，只保留既有 chunk warning |
| `pnpm audit:ci` | 退出码 0；1 high ignored |
| `git diff --check` | 通过；只有工作区 LF/CRLF 提示 |

所有 PostgreSQL 轮次均创建随机命名的临时数据库和临时角色，结束后删除；开发库、Alpha 库和本地业务数据未读取或修改。

### 依赖审计

- 没有新增或升级依赖。
- 审计继续保留 Phase 2B-1 已登记的 Vite/PostCSS 开发链 `nanoid` high ignored；它不在生产业务路径，不能宣称漏洞已修复，移除条件保持不变。

## 5. 人工与视觉检查

本切片没有前端交互、样式、页面路由或包加载策略变化，不重复伪造浏览器产品证据。Phase 1B 的 1920/1280/768/320、200% 缩放、键盘和功能旗标结果继续作为 UI 基线；构建只保留既有 chunk warning。

## 6. 风险与后续边界

- 当前只证明 Resume Document 聚合服务可用，不代表用户已经能编辑、排版或导出 Resume V2；产品证据仍为 `E0`。
- `legacySource` 是发现和首次编辑输入，不是 V2 聚合。2B-4B 必须保留 V1 section/block ID，且不能在 GET 中做隐式迁移。
- base/derived 创建后的 content/layout pointer 可以为空；2B-4B 必须以不可变修订和文档 `expectedRevision` 原子推进 pointer，不能原地改写正文或布局。
- 派生文档只固定创建时的 Case、JobContext、基础修订和证据 revision；Case、基础简历或证据后续变化不级联。
- 可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0；本阶段没有提升供给或产品价值 Gate。

## 7. 决定

决定：**继续**。

下一唯一目标为 `Phase 2B-4B Resume Content/Layout Revision API`：实现 V1 只读正文转换、第一次编辑原子创建 V2、同文档不可变内容/布局修订、`expectedRevision` 并发和稳定 ID；不实现 Review/Tailoring、DOCX、Interview、Knowledge、前端或真实 AI。通过后再决定 2B-4C、修改、回退或停止。
