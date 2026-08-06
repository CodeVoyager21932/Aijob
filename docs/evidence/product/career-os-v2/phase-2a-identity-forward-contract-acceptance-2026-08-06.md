# Phase 2A Identity Forward Contract 验收证据

> 历史原型记录：后续正式注册与运行证据见 [Phase 2A-025 Identity Account/Email Expand 验收](phase-2a-025-identity-account-email-expand-acceptance-2026-08-06.md)。本文件中的“未注册 025F”只描述当时状态，不再代表当前迁移链。

- 日期：2026-08-06
- 分支：`codex/career-os-phase-1`
- 范围：长期 owner、Account、EmailIdentity、邮箱验证码 challenge、匿名 owner 认领边界与未注册 PostgreSQL 原型
- 决定：**继续**进入正式 migration 025；仍不发送真实邮件、不注册身份 HTTP API

## 交付内容

- 保留旧 `OwnerSchema` 和匿名 bootstrap 兼容，新增 `CareerOwner` 联合类型，明确 `anonymous_ttl` 与 `account_managed` 互斥；只有后者允许 `retentionExpiresAt=null`。
- 新增 strict `Account`、`EmailIdentity`、challenge 创建/完成和邮箱规范化 contracts。claim 必须提交 `expectedOwnerEpoch`，change-email 必须提交 `expectedAccountRevision`。
- 响应 contracts 不暴露完整邮箱、查找 hash、验证码 hash 或密文；未知敏感字段直接拒绝，不静默接受。
- 新增未注册 `025F` PostgreSQL 原型：旧 owner 默认映射为 `anonymous_ttl`；Account 与 owner 一对一；EmailIdentity 只存 lookup hash 和加密三元组；challenge 只存验证码 hash。
- 只有已存在 active Account 的 owner 才能切换 `account_managed` 并取消自动到期。collector 与 match-worker 无身份表权限，web-api 只获得受限列级 UPDATE。

## 验证结果

```text
Identity contracts                            PASS (5/5)
Identity isolated PostgreSQL prototype        PASS (5/5)
pnpm lint                                     PASS (373 files)
pnpm typecheck                                PASS
pnpm test                                     PASS (627/627)
  config                                      17
  contracts                                   42
  database                                    44
  web                                         91
  platform                                    433
pnpm build                                    PASS
pnpm audit:ci                                 PASS (1 high/1 moderate registered ignore)
```

数据库原型使用 loopback `aijob_test*` 临时库，测试后强制删除；`kysely_migration` 最新版本仍为 `024_resume_document_v2_expand`。没有读取 `.claude/`、`.data/`、密钥、令牌、真实邮箱、真实简历、本地业务数据库或下载产物。

## 数据库证据

- 历史 owner 保持非空到期时间和 `anonymous_ttl`；无 Account 时取消到期被 trigger 拒绝。
- active Account 建立后，owner 可切换为 `account_managed` 且不再进入匿名到期选择条件。
- `email_identities` 不存在 `email`/`normalized_email` 明文字段，一账号只允许一个 active identity，身份加密材料不可更新。
- claim challenge 固定 owner epoch；混入 account 上下文、未达到最大尝试次数却标记 locked 均被 CHECK 拒绝。
- collector/match-worker 实际 SELECT 返回 `42501`；web-api 可读，但更新验证码 hash 返回 `42501`。

## 已知边界

- 当前只是未注册 Schema 原型；`Database` 类型、`migrateToLatest`、session repository、retention service 和 deletion service 尚未接入新字段。
- 匿名 owner 仍按历史 30 天兼容；本切片没有自动把匿名数据变成长久账号，也没有合并或搬运跨 owner 数据。
- 没有真实邮件供应商、手机号、密码、OAuth、注册/登录 API、服务器或真实用户数据。

## 下一切片

正式 migration 025 只做 additive identity expand：

1. 将已验证 SQL 转为正式 migration 并注册到 `migrateToLatest`。
2. 更新 `Database` 类型，允许 `retention_expires_at` 对 account owner 为 NULL，并加入三张身份表。
3. 统一 owner active predicate：匿名 owner 校验期限，account owner 不以 session 到期删除职业资产；owner epoch/status 仍为硬门。
4. 用空库与 migration 024 fixture 验证兼容、角色、到期选择和前向回退；不注册 HTTP API、不发送邮件。
