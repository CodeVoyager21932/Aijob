# Phase 2A-025 Identity Account/Email Expand 验收证据

- 日期：2026-08-06
- 分支：`codex/career-os-phase-1`
- 范围：migration 025、长期 owner 身份 Schema、owner active predicate、匿名 retention、身份删除兼容与运行角色
- 决定：**继续**。migration 025 Gate 通过；下一唯一切片为 `Phase 2A-026 ApplicationCase Long-Lived Forward Repair`。

## 交付结果

`025_identity_account_email_expand` 已注册到正式迁移链，最新迁移由 024 推进到 025：

- `identity.owners` 新增 `retention_mode = anonymous_ttl | account_managed`；历史 owner 自动保持 `anonymous_ttl`，长期账户 owner 使用 `account_managed + retention_expires_at NULL`。
- 新增一对一 `identity.accounts`、加密 `identity.email_identities` 与仅保存 hash 的 `identity.email_verification_challenges`。
- active Account 与 `account_managed` owner 在事务提交时必须双向一致；active owner 的 Account 不能被直接删除或停用，只有 owner 已进入删除流程时才允许受控清除。
- 邮箱身份不保存明文或 normalized email；lookup hash、密文、nonce、auth tag 与密钥版本不可原地替换。
- challenge 固定 purpose/context、owner epoch、尝试上限、幂等 hash、请求 hash、到期与状态一致性。
- collector/match-worker 不能读取邮箱身份；web-api 只能按列更新状态字段。
- match-worker 仅能执行受 `deletion_pending + expected epoch` 约束的 `SECURITY DEFINER` 身份清除函数，不能直接读取或任意更新邮箱材料。
- migration `down` 为非破坏性空操作；新身份数据只能前向修复。

## 生命周期与删除

运行时 owner 有效性统一为：

```text
status = active
AND epoch = expected epoch
AND (
  retention_mode = account_managed
  OR (retention_mode = anonymous_ttl AND retention_expires_at > now)
)
```

该判定已用于 session 恢复、业务写入、简历读取、owner task lease 与 worker 存活检查。retention maintenance 只选择到期的 `anonymous_ttl` owner；账户 session 仍可独立到期或撤销，但不会因此删除职业资产。

用户主动删除时，身份清除函数先删除 owner 绑定的 claim challenge 与 Account，级联删除 EmailIdentity/change-email challenge；随后 owner 转为匿名删除墓碑。隔离测试证明长期账户可以正常恢复 session、持有任务租约、不进入自动 retention，并能由用户主动删除身份材料。

本 Gate **不代表全部职业资产删除已完成**：现有 migration 023/024 的 ApplicationCase 与 Resume V2 表尚未接业务 API，删除服务也尚未覆盖这些新表。ApplicationCase 删除覆盖属于 026，Resume V2 删除覆盖属于后续 Resume Forward Repair。

## 隔离 PostgreSQL 证据

`packages/database/src/migrations/025_identity_account_email_expand.integration.test.ts` 共 6 项：

1. 空库 `001 -> 025` 与含历史 owner 的 024 fixture 升级。
2. 历史 owner 保持 anonymous TTL；无 active Account 不能切换长期模式。
3. 邮箱材料只保存 hash/密文，单账户仅一个 active identity，材料不可变。
4. claim challenge 固定 owner epoch，拒绝混合上下文与非法锁定状态。
5. 实际 `SET ROLE` 验证身份表不可读、web-api 列级更新及 match-worker 受控删除函数。
6. forward-only `down` 不删除 Account。

数据库包全测为 11 files / 45 tests；平台 retention 新增 1 项长期账户集成测试，平台总计 73 files / 434 tests。

## 串行工程门

- `git diff --check`：通过；仅有工作区既有 LF/CRLF 提示。
- `pnpm lint`：374 files 通过。
- `pnpm typecheck`：通过。
- 使用隔离 PostgreSQL 的 `pnpm test`：config 17、contracts 42、database 45、web 91、platform 434，共 **629/629** 通过。
- `pnpm build`：通过；web 主包 530.73 kB，本轮无前端变化，保留既有 chunk warning。
- `pnpm audit:ci`：按仓库策略通过；保留 1 high ignored / 1 moderate 已登记 advisory。
- 临时 `aijob_test_phase2a_identity_*` 数据库：无残留。

## 决定与下一步

四选一决定为 **继续**：

- migration 025 保留并作为 026/027 的长期 owner 前置。
- 025F 保留为薄兼容入口，SQL 唯一真源已移动到正式 migration，避免原型与正式迁移分叉。
- 下一切片只正式化 ApplicationCase 的公共/私有 JobContext、长期生命周期、strict event 与删除覆盖。

本次没有发送真实验证码、接邮件供应商、注册认证 HTTP API、实现手机号/密码/OAuth、访问真实招聘来源、调用真实 AI、处理真实简历或部署服务器。产品证据仍为 `E0`，可信供给仍为 22 岗 / 3 家企业。
