# ADR-0023：执行运行时进程与数据库角色边界

- 状态：proposed
- 日期：2026-07-29
- 决策者：待 coco 在对应阶段确认
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

## 提议决定

建议选择 C：

1. 增加独立 `collector-worker` 入口；本地组合启动器只能作为开发便利，不作为部署形态证据。
2. 建立 `web_api`、`collector_worker`、`match_worker`、`ops_cli`、`migrator` 数据库角色。
3. 通过按角色固定任务类型的受限 claim/heartbeat/finish/fail 函数访问任务队列，撤销 worker 对任务基表的任意访问。
4. collector 只拥有来源、采集、岗位规范化和快照引用所需权限；match worker 只拥有 owner 任务及对应业务表权限。
5. 增加权限矩阵集成测试和一次本地多进程启动演练，再把 ADR 状态改为 accepted。

## 后果

- 正向：运行时边界可执行、可测试，设计与实现一致。
- 负向：本地配置和迁移复杂度增加；凭据轮换和部署文档需要同步。
- 暂不做：不拆微服务、不增加数据库、不引入消息代理。

## 复审触发条件

- R2 后准备 Private Alpha。
- 任一进程需要新增跨域数据访问。
- 单 PostgreSQL 的锁竞争或容量数据证明需要重新分库。
