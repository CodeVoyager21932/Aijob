# Phase 2A-026 ApplicationCase Long-Lived Forward Repair 验收

- 日期：2026-08-06
- 状态：migration accepted；Phase 2A decision = modify
- 迁移：`026_application_case_long_lived_forward_repair`
- 产品证据：仍为 `E0`
- 可信供给：仍为 22 岗 / 3 家企业 / 3 个官方 ATS

## 1. 本切片完成内容

- 正式注册 migration 026，复用已验收的 023F SQL，避免原型与生产迁移出现两份 SQL 真源；`down` 保持非破坏性空操作。
- 新增 owner-only `private_job_snapshots` 和不可变 revision；Case 使用 `public | private` 判别上下文，私有 JD 不进入公共 catalog。
- 历史 public Case 保持可读，历史 `expires_at` 保留为 nullable 兼容字段；新 Case 可以长期保留并由用户主动删除。
- 历史事件标记为只读 `legacy-case-event-v0`；新事件只接受 strict `case-event-v1`，拒绝额外正文、错误类型和显式 legacy 写入。
- Kysely 类型已覆盖公共/私有 Case、nullable legacy expiry、event schema 和私有 JD 表。
- owner 删除服务按 Case 子表、Case、私有 JD 快照顺序清理 ApplicationCase 图；`match-worker` 获得相应最小删除权限，collector 继续无法读取私有 JD。

## 2. 验证结果

- migration 026 隔离 PostgreSQL：9/9，通过空库 `001 -> 026`、025 fixture、长期 account owner、legacy public Case/event、私有 JD、跨 owner、strict event、角色、删除和前向回退。
- migration 025 回归：6/6。
- owner retention/deletion：2/2；长期 account owner 不被 TTL 队列误删，匿名 owner 删除会清除私有 Case、event、snapshot 和 revision，另一个 owner 保持不变。
- 串行全仓测试：config 17、contracts 42、database 47、web 91、platform 434，共 631/631。
- `pnpm lint`：375 files；`pnpm typecheck`、`pnpm build` 均通过。
- web 主包仍为 530.73 kB；只有既有大 chunk warning，本切片没有前端变化。
- `pnpm audit:ci` 按仓库策略通过：1 high ignored、1 moderate，均为既有登记项。
- `git diff --check` 通过，仅有既有 LF/CRLF 提示；临时 `aijob_test_phase2a_*` 数据库无残留。

## 3. 复核发现的契约缺口

026 已让私有 JD 成为合法 Case 上下文，但既有要求子表和事件仍只表达公共要求集：

- `application.case_requirement_states.requirement_set_id` 仍为 `NOT NULL uuid`。
- 该列仍外键引用 `catalog.job_requirement_sets(id)`，没有私有 `requirement_set_revision` 分支。
- `requirement_state_changed` 和 `requirement_evidence_changed` strict event 仍只接受公共 `requirementSetId`。
- 在 026 Schema 上用 `requirementSetRevision` 构造私有要求事件，`application.is_valid_case_event_data(...)` 返回 `false`。

因此，私有 Case 目前能保存岗位快照并固定版本，但还不能完成 JD 能力三态、证据连接和问题闭环。该缺口不影响 migration 026 的 additive 兼容性，却阻止 Phase 2A 宣称公共/私有 Case 业务对等。

## 4. 决定

四选一决定为 **修改**。

保留 migration 026，不回退已通过的长期 Case、私有快照和 strict event 基础；下一唯一切片改为 `Phase 2A-026B Private Requirement Context Forward Repair`，先补公共/私有要求上下文联合类型、子表约束、strict event、owner 隔离与删除测试。026B 通过后才进入 migration 027 Resume Document/Review Long-Lived Forward Repair。

Resume V2/Review 的 owner 全量删除覆盖仍未完成，不得用本记录宣称全部职业资产删除已通过。

## 5. 排除项

本切片未注册 Case HTTP API，未访问真实 JD、真实招聘来源、真实 AI、真实邮件、真实简历、服务器或云资源；未读取、暂存或提交 `.claude/`、`.data/`、密钥、本地数据库和下载产物。
