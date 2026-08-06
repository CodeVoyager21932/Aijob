# Phase 2A-026B Private Requirement Context Forward Repair 验收

- 日期：2026-08-06
- 分支：`codex/career-os-phase-1`
- 基线：`92fbd33 feat(database): add long-lived application cases`
- 迁移：`026b_private_requirement_context_forward_repair`
- 产品证据：仍为 `E0`
- 四选一决定：**继续**到 `Phase 2A-027 Resume/Review Forward Repair`

## 1. 目标与范围

本切片只修复 migration 026 暴露的私有 requirement context 缺口：公共岗位继续固定 `requirement_set_id`，私有岗位固定 Case snapshot 的 `requirement_set_revision`；要求状态成为 evidence link 与 question 的稳定 owner-scoped 引用节点。没有注册业务 API，没有读取真实 JD/简历，没有调用真实 AI、真实招聘来源、邮件或服务器。

明确排除 `.claude/`、`.data/`、密钥、令牌、本地数据库文件、下载产物和真实个人材料。

## 2. 实现证据

### Contracts

- 新增严格的 `PublicRequirementContext | PrivateRequirementContext` 联合类型。
- requirement state、evidence link 与 question 使用同一 requirement context 读模型；question 的 state/context/requirement ID 必须同时存在或同时为空。
- 026 已有 public `case-event-v1` payload 保持原样可读；private state/evidence event 使用精确的 `requirementContextKind=private + requirementSetRevision`，额外正文或公共 UUID 会被拒绝。

### PostgreSQL

- `case_requirement_states` 新增 public/private 分支、私有 revision、部分唯一索引与 Case 固定上下文守卫；上下文身份和 `requirement_id` 创建后不可变。
- evidence link 与 question 通过 `(owner_id, owner_epoch, case_id, requirement_state_id)` FK 连接 state；private 行不伪造公共 requirement-set UUID。
- 026 public 历史 state/link/question 确定性回填 state ID，不改变状态、备注、revision 或时间。
- strict event validator 兼容 026 public 事件并增加 private 精确 payload；旧事件继续不可更新，新 legacy 写入继续拒绝。
- collector 继续不可读；match-worker 既有 owner 删除顺序可删除 public/private requirement 图；`down` 为非破坏性 no-op。

## 3. 自动化结果

| 检查 | 结果 |
|---|---|
| ApplicationCase contracts | 13/13，通过 |
| contracts 全包 | 45/45，通过 |
| 026B/Phase 2A 隔离 PostgreSQL | 10/10，通过 |
| database 全包（隔离 PostgreSQL） | 48/48，通过 |
| owner 删除/retention 回归 | 2/2，通过 |
| 全仓测试 | config 17 + contracts 45 + database 48 + web 91 + platform 434 = 635/635，通过 |
| `pnpm lint` | 376 files，通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过；Web 主包 531.59 kB，仅有既有 chunk warning |
| `pnpm audit:ci` | 按仓库策略通过；1 high ignored / 1 moderate 已登记 advisory |
| `git diff --check` | 通过 |

隔离 PostgreSQL 覆盖空库 `001 -> 026B`、含 public requirement 图的 026 前置 fixture、private state/link/question、无要求 question、错误 revision、上下文错配、跨 owner、public/private strict event、legacy 事件、collector 拒绝、match-worker 删除和非破坏回退。测试数据库均使用唯一 `aijob_test*` 名称并在结束后删除。

## 4. 人工与视觉检查

本切片没有前端交互或样式变化，不重复宣称新的浏览器价值证据；Phase 1B 的响应式结果仍是现有 UI 基线。构建主包从上一证据的 530.73 kB 变为 531.59 kB，增量约 0.16%，未触发 10% 拆包门。

## 5. 风险与后续边界

- 本迁移固定 requirement context 和引用完整性，但私有 `requirement_id` 是否真实存在于 snapshot requirements 仍须由后续 Case service 在写入前验证；本切片没有业务 API。
- Resume V2 的长期 lifecycle、private Case 派生引用、strict Content/Layout、Review 聚合与 owner 删除仍未正式注册，不能因 024F 原型存在而宣称完成。
- 产品证据仍为 `E0`，可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS；公共与 Alpha 岗位均为 0。

## 6. 决定

决定：**继续**。

唯一下一目标为 `Phase 2A-027 Resume/Review Forward Repair`：审查并正式化 024F 的长期 Resume、public/private Case 派生引用、strict semantic Content/Layout、Review Run/Finding/Suggestion/Decision、owner 全量删除与非破坏回退。仍不注册业务 API，不调用真实 AI，不访问真实招聘来源或真实简历。
