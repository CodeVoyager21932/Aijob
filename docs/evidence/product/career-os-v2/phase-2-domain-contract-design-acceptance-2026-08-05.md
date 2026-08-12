# Career OS 2.0 Phase 2 领域契约设计验收

> 日期：2026-08-05
>
> 分支：`codex/career-os-phase-1`
>
> 结论：设计 Gate 通过，决定为“继续”；下一切片只允许 ApplicationCase core contracts 与 additive migration 023

## 1. 验收范围

本轮只审查既有 Schema、owner 生命周期、任务队列、Resume V1、旧决定和 HTTP 安全契约，并形成[历史 Phase 2 领域契约与迁移设计](../../../plans/archive/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md)。没有创建迁移、修改数据库或接入真实业务数据。

排除项：真实招聘来源、真实 AI、服务器、真实简历、`.claude/`、`.data/`、密钥、令牌、本地数据库和下载文件。

## 2. 可复现盘点

| 检查 | 代码事实 | 设计处理 |
|---|---|---|
| migration registry | `001`–`022` 由静态 provider 顺序注册，下一编号为 023 | 迁移顺序从 023 开始，不改历史迁移 |
| owner 生命周期 | owners 有 active/deletion_pending/deleted、epoch、30 天 retention 与 deleted_at | 复用全局 owner 墓碑；新聚合 TTL 不晚于 owner |
| owner 删除 | deletion task 在同一事务递增 epoch、撤销会话、杀死旧任务；清理后保留 90 天无正文墓碑/审计 | 新表加入明确删除顺序和恢复不复活测试 |
| 任务队列 | PostgreSQL、至少一次、SKIP LOCKED、lease/heartbeat/fencing、immutable context、任务 RLS | 新增三种 owner task；不建第二队列 |
| 岗位版本 | stable published job、immutable job version、requirement set 已存在 | Case 固定三者，升级只追加事件 |
| Resume V1 | `resume_document_revisions` 已存在且只允许 v1；owner 全局 revision | 新建 document 聚合，旧表 nullable 扩展为 V1/V2 双读，不回填旧行 |
| Tailoring/Export | 已有逐段四态、证据引用与 24 小时加密导出 | Resume V2 只增加固定引用，复用现有服务 |
| 旧决定 | 五态、owner epoch、expectedRevision、官方链接打开单独记录 | Case 新真源；可表示状态兼容，不可表示状态返回冲突 |
| API 安全 | Cookie owner、同源、CSRF、Problem Details；owner 路由前缀 no-store | 新路由加入 no-store；跨 owner 统一 404 |
| 数据库角色 | 五个 NOLOGIN 角色；migration 021 的 grants 只覆盖当时已有表 | 每条新迁移显式 grants/revokes 与权限测试 |

## 3. 设计 Gate

| Gate | 结果 |
|---|---|
| 现有表/列/索引/权限复用矩阵 | 通过；明确复用与禁止重复项 |
| 新表、索引、唯一约束和外键图 | 通过；application/profile 边界和复合 owner FK 已冻结 |
| owner/epoch/TTL/墓碑/删除顺序 | 通过；顶层聚合 30 天、导出 24 小时、无正文墓碑 90 天 |
| Case 状态机与显式岗位版本升级 | 通过；resolved 终态，官方链接不等于 applied |
| Resume V1 → V2 | 通过；V1 virtual read、首次编辑创建 V2、布局/内容分离 |
| API、幂等、expectedRevision、Problem Details | 通过；路径、请求语义和稳定错误码已冻结 |
| PostgreSQL 任务与迟到任务拒绝 | 通过；新增任务仍复用 owner lease/fencing |
| expand 迁移和旧应用兼容 | 通过；023–027 顺序固定，G4 前无 contract |
| 隔离 PostgreSQL 测试矩阵 | 设计通过；运行结果仍待下一迁移切片 |

## 4. 冲突处理

- Resume V2 不是第二张 `resume_document_revisions`；使用新聚合与旧表 additive 扩展。
- [系统架构](../../../05-system-architecture.md) 的过时“受限任务函数”描述已按 ADR-0023 和迁移 021 改为当前角色/RLS/直接表访问事实。
- 系统架构中不存在的 `job_decisions.match_run_id` 已移除，不给旧决定补隐式匹配归属。
- ADR-0005 的 session Cookie SameSite=Strict 与当前 `Lax` 实现差异登记为服务器就绪前身份安全债，不在本设计切片无测试改动登录导航。
- 本机无隔离 PostgreSQL；因此这里只通过设计 Gate，不声称 Phase 2 migration Gate 通过。

## 5. 检查记录

```text
git branch --show-current
  -> codex/career-os-phase-1

git status --short（开始时）
  -> ?? .claude/

git log -3 --oneline
  -> 24368f5 Phase 1B
  -> 5da2390 dependency security patch
  -> 7bb2140 Phase 1A

数据库迁移执行
  -> 未执行；本轮禁止写迁移，本机也没有隔离 PostgreSQL
```

```text
Markdown relative-link scan
  -> 7 个本轮文档的相对链接全部存在

git diff --check
  -> passed；只有工作区既有 LF/CRLF 提示

pnpm lint
  -> 359 files checked，0 errors

pnpm typecheck
  -> contracts / config / database / platform / web passed

pnpm test
  -> 528 项非数据库测试通过
  -> platform 38 + database 13 项 PostgreSQL 集成测试未执行

pnpm build
  -> passed；既有主包 510.96 kB warning 不变，Case workspace 仍为懒加载 24.61 kB

pnpm audit:ci
  -> exit 0；审计报告仍列 1 moderate 与 1 个已忽略 high advisory
```

本轮是文档设计切片，没有 UI 或生产代码变化，因此不重复计算 Phase 1B 浏览器 Gate；PostgreSQL 集成测试明确为“未执行”，不是“通过”。

## 6. 风险、回退与决定

- 风险：设计已冻结，但尚未由 PostgreSQL 实际证明复合外键、部分唯一索引、角色权限、旧 V1 兼容和删除覆盖。
- 回退：本轮只有文档；删除本设计引用不会触碰运行数据。后续 migration 只做 expand，若旧应用兼容失败使用前向修复。
- 产品证据：仍为 `E0`；没有参与者或价值证据。
- 决定：**继续**。当前唯一下一目标为 `Phase 2A-1 ApplicationCase core contracts + migration 023`；必须先获得隔离 PostgreSQL结果才能通过该迁移 Gate。
