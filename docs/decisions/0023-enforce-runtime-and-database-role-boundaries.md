# ADR-0023：执行运行时进程与数据库角色边界

- 状态：accepted
- 日期：2026-07-29
- 接受日期：2026-08-03
- 决策者：coco
- 关联：[ADR-0006](0006-modular-monolith-runtime-boundaries.md)、[R1 架构审视](../evidence/r1/architecture-review-2026-07-29.md)

## 背景

ADR-0006 已接受模块化单体代码库、`web-api`、`collector-worker`、`match-worker` 三个进程和 PostgreSQL 最小权限边界。R1 核对发现本地实现只有独立 Web 与 match worker 入口，采集主要通过 CLI 运行；各入口仍共享同一个 `DATABASE_URL`，任务 claim/complete 也由应用直接访问任务表。设计边界存在，但尚未成为可执行权限边界。

## 决策标准

- collector 不能读取 owner、简历或模型密钥。
- Web 与 match worker 不能读取原始来源响应正文。
- 进程只能 claim 和完成自己允许的任务类型。
- 本地开发仍保持单仓库、单构建物和可恢复的启动方式。
- 进入 Private Alpha 前能用自动化测试证明越权失败。

## 选项

### A：继续共享数据库角色，只靠代码约定

- 优点：零迁移、开发最简单。
- 缺点：无法执行 ADR-0006 的安全边界，误查询或注入可跨域访问。

### B：拆成多个微服务与独立数据库

- 优点：物理隔离最强。
- 缺点：当前规模没有证据支撑，会引入分布式一致性、部署和恢复成本。

### C：保留模块化单体，补齐独立入口、数据库角色与受限函数

- 优点：不改变领域模型和基础设施，同时把既有设计变成可验证边界。
- 缺点：需要迁移、部署配置、角色凭据和权限测试。

## 决定

选择 C，并按当前模块化单体边界落实：

1. 保持独立 `web-api`、`collector-worker`、`match-worker` 入口；本地组合启动器只能作为开发便利，不作为部署形态证据。
2. 建立 `aijob_web_api`、`aijob_collector_worker`、`aijob_match_worker`、`aijob_ops_cli`、`aijob_migrator` 五个 `NOLOGIN` 权限组。
3. Alpha/Production 必须分别提供五个运行 URL；进程启动时验证对应角色成员关系，不允许静默回退到共享 `DATABASE_URL`。
4. 当前任务表使用 PostgreSQL RLS 固定任务类型：collector 只能访问 `crawl`，Web 与 match worker 只能访问 owner 任务，ops/migrator 才能访问全部任务。当前规模不再额外引入数据库函数层；一旦任务类型或外部写入方增加，必须复审是否切换为受限 claim/heartbeat/finish/fail 函数。
5. collector 不得读取 owner、简历和匹配域；Web 与 match worker 不得读取原始抓取响应。match worker 仅获得完成 owner 删除所需的身份表列级更新、会话 owner 列读取和会话删除权限，不能读取会话令牌哈希或修改 owner epoch。
6. 登录角色、密码、轮换、备份和多进程部署演练属于服务器就绪 Gate；迁移只创建无登录权限组，不把凭据写入仓库。

## 实现证据

- 迁移 `021_runtime_database_roles` 建立五个角色、表权限与任务 RLS；
- 迁移 `022_match_worker_owner_deletion_privileges` 以前向修复补齐 owner 删除最小权限；
- PostgreSQL 集成测试证明任务类型隔离、collector 无 owner 读取权、Web/match 无原始快照读取权、match 可完成必要身份变更但不可读取会话密钥或修改 epoch；
- `WEB_API_DATABASE_URL`、`COLLECTOR_DATABASE_URL`、`MATCH_DATABASE_URL`、`OPS_DATABASE_URL`、`MIGRATOR_DATABASE_URL` 在 Alpha/Production 均为必填。

## 后果

- 正向：运行时边界可执行、可测试，设计与实现一致。
- 负向：部署配置和迁移复杂度增加；登录角色创建、凭据轮换与恢复演练仍需在服务器就绪 Gate 完成。
- 暂不做：不拆微服务、不增加数据库、不引入消息代理。

## 复审触发条件

- R2 后准备 Private Alpha。
- 任一进程需要新增跨域数据访问。
- 单 PostgreSQL 的锁竞争或容量数据证明需要重新分库。
