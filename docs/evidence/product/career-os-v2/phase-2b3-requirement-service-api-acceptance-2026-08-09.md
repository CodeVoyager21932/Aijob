# Phase 2B-3 Requirement Service/API 验收

- 日期：2026-08-09
- 分支：`codex/career-os-phase-1`
- 实现前基线：`54e017a feat(platform): add case transitions and job version upgrades`
- 产品证据：仍为 `E0`
- 四选一决定：**继续**到 `Phase 2B-4A Resume Document Aggregate API`

## 1. 目标与范围

本切片只在 Phase 2B-1/2 的 owner-protected ApplicationCase 聚合上完成：

- `GET /v1/application-cases/:caseId/requirements`：读取 Case 固定的 public/private 要求定义、三态、证据链接和问题。
- `PUT /v1/application-cases/:caseId/requirements/:requirementId`：以 Case `expectedRevision` 更新三态与用户备注。
- `PUT /v1/application-cases/:caseId/requirements/:requirementId/evidence-links`：在指定的同 owner 已确认证据 revision 内原子替换期望 ID 集合。
- `POST /v1/application-cases/:caseId/questions`：幂等创建 Case 级或 requirement 级未知问题。
- `PUT /v1/application-cases/:caseId/questions/:questionId`：回答、改答、重新打开或忽略问题。

没有接前端，没有实现 Resume/Interview/Debrief/Knowledge 服务，没有访问真实 AI、真实招聘来源、邮件、服务器、真实 JD、真实简历或本地业务数据库。`.claude/`、`.data/`、密钥、令牌、本地数据库和下载产物均未读取或暂存。

## 2. 实现前冲突与决定

### 2.1 固定要求读取模型

旧 `ApplicationCaseRequirementsSchema` 只有 public `requirementSetId: UUID`，也没有要求定义，无法表达 private JD 或驱动统一 JD 工作区。现已改为：

- 顶层使用 `PublicRequirementContext | PrivateRequirementContext`。
- 返回固定版本的 strict `JobRequirement[]`，不从当前岗位指针或模型重新生成。
- 没有数据库 state 的要求返回 `persisted=false`、`state=unconfirmed`、空持久化元数据的确定性读模型；GET 不产生写入。

### 2.2 不可变事件格式

交接原先声明“不新增 migration”，但既有 `case-event-v1` 无法同时满足以下已冻结行为：

- 一次证据 PUT 同时新增和移除 ID，只递增一次 Case revision、只追加一条事件。
- 只修改 requirement 备注但三态不变。
- 问题保持 `answered` 但用户修改答案。

不修改已应用的 026/026B 历史迁移，也不拆出伪 revision。新增 forward-only migration `029_case_mutation_event_v2_forward_repair`：

- 保留 `legacy-case-event-v0` 与 `case-event-v1` 原样可读。
- 只扩展 `case-event-v2` 严格校验和允许值，不新增表或业务列。
- `requirement_state_changed` 记录 `noteChanged`，不保存备注正文。
- `requirement_evidence_changed` 在同一事件记录 `linkedEvidenceIds` 与 `removedEvidenceIds`，不保存证据正文。
- `question_updated` 记录 `answerChanged`，不保存问题或回答正文。
- 空变化、数组重复/交叠、同状态且正文未变等伪事件继续被 contract 与 PostgreSQL 双重拒绝。

该冲突决定为“修改”，修复后再继续；文档中“Phase 2B-3 不创建 migration”的旧假设不再成立。

## 3. 聚合、幂等与隐私证据

- public 从 Case 固定 `requirement_set_id` 读取；private 从固定 snapshot/content revision 读取 `requirement_set_revision`，不伪造公共 UUID。
- requirement ID 必须存在于当前固定上下文，否则返回 `422 REQUIREMENT_REFERENCE_INVALID`。
- 每次有效写入满足 `case.revision == event.sequence`；被修改或新建的 state/link/question 子行 revision 使用同一 Case revision。
- 真正无变化的 PUT 返回 `{caseRevision,event:null}`，不写 state、不递增 revision、不伪造事件；命令响应是不可变事件回执，最新完整状态由 GET 读取。
- PUT 使用 Case、资源 ID 和 `expectedRevision` 派生 owner-scoped 幂等键；POST question 使用显式 `Idempotency-Key`。同请求重放原事件，不同请求复用同键返回 `409 IDEMPOTENCY_KEY_REUSED`。
- 证据 revision 必须属于同 owner/epoch，并通过 `ResumeEvidenceRevisionSchema`；跨 owner、未知 ID、错误 revision 和 `confirmed=false` 均统一返回 `422 EVIDENCE_REFERENCE_INVALID`。
- 证据期望集合以请求中的 immutable `evidenceRevisionId` 为作用域；不会静默删除用户在其他已确认 revision 上的显式链接。移除只写 `removed_at`，重连只清空 `removed_at`，原始 `linked_at` 保留。
- requirement 级问题通过同一 state anchor 绑定固定上下文；岗位版本变化后，旧上下文问题不会通过当前接口被枚举或修改。
- 问题和回答只进入 owner 私有问题行，不改变三态，不写入岗位事实，也不进入 Case event 正文。
- 所有路由复用 owner session、Origin/CSRF、Problem Details、全局 `no-store` 和不可枚举 404；没有第二套认证、数据库、缓存、队列或 AI SDK。

## 4. 自动化结果

| 检查 | 结果 |
|---|---|
| ApplicationCase contracts | 17/17，通过；contracts 全包 57/57 |
| migration 026B–029 focused | 13/13，通过；覆盖 v1 兼容、v2 严格校验、删除和运行角色 |
| ApplicationCase PostgreSQL/HTTP | 3/3，通过；新增主矩阵覆盖 public/private、state、evidence、question、并发、幂等、CSRF、owner 和 `no-store` |
| database 全包（隔离 PostgreSQL） | 51/51，通过 |
| platform 全包（隔离 PostgreSQL） | 439/439，通过 |
| web 全包 | 91/91，通过 |
| 隔离 PostgreSQL 串行全仓 | config 17 + contracts 57 + database 51 + platform 439 + web 91 = 655/655 |
| `pnpm lint` | 384 files，通过；配置继续排除 `.claude/.data` |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过；Web 主包 541.15 kB，只保留既有 chunk warning |
| `pnpm audit:ci` | 退出码 0；1 high ignored |
| `git diff --check` | 通过；只有工作区 LF/CRLF 提示 |

### 测试环境异常收口

- 第一轮全仓串行测试中，未修改的 `resume plaintext minimization` 在本机负载下触发既有 15 秒超时；该轮其余 platform 438/439、新增 ApplicationCase 3/3、database 51/51 均通过。
- 未修改测试超时。换用全新隔离库单独复跑该文件 2/2 通过，核心用例约 5.7 秒；再换另一套全新隔离库执行 platform 全包 439/439 通过。
- 格式化与文档收口后，又换用第三套全新随机隔离库执行 `pnpm --workspace-concurrency=1 -r test`，完整串行全仓 655/655 直接通过，原超时未复现。
- 所有测试库均使用本阶段随机命名的隔离数据库并在退出后删除；开发库、Alpha 库和本地业务数据未读取或修改。

### 依赖审计

- 没有新增或升级依赖。
- 审计继续保留 Phase 2B-1 已登记的 1 个 Vite/PostCSS 开发链 `nanoid` high ignored；它不在生产业务路径，不能宣称漏洞已修复，移除条件保持不变。

## 5. 人工与视觉检查

本切片没有前端交互、样式、页面路由或包加载策略变化，不重复伪造浏览器价值证据。Phase 1B 的 1920/1280/768/320、200% 缩放、键盘和功能旗标结果继续作为 UI 基线；构建只保留既有 chunk warning。

## 6. 风险与后续边界

- 当前是 owner-protected 服务证据，不是用户已能完成 JD 核对的产品证据；产品证据仍为 `E0`。
- 命令返回不可变事件回执而不是复制完整读模型；前端接入时必须在成功后读取/更新统一 requirements query cache，不能把 event 当成第二份业务状态。
- evidence 集合目前按 evidence revision 分域；Phase 3B 若要求跨 revision 一次替换，必须先形成新契约，不能复用单 revision 事件做含糊审计。
- migration 029 是 forward-only；应用回退继续读取 v1/v2 历史，不删除新事件，无法安全回滚时采用前向修复。
- 可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0；本阶段没有提升任何供给或产品价值 Gate。

## 7. 决定

决定：**继续**。

下一唯一目标为 `Phase 2B-4A Resume Document Aggregate API`：只做 owner-protected Resume Document V2 聚合的稳定列表、幂等 base/case-derived 创建和同 owner 详情，固定 Case、基础简历修订、证据 revision 与岗位上下文；不实现正文/布局编辑、Review/Tailoring、DOCX、Interview、Knowledge、前端或真实 AI。通过后再决定 2B-4B、修改、回退或停止。
