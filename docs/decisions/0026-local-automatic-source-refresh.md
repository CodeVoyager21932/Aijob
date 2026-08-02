# ADR-0026：允许显式配置的本机来源自动刷新

- 状态：accepted
- 日期：2026-08-01
- 决策者：coco
- 关联：[ADR-0007](0007-postgres-task-idempotency.md)、[ADR-0010](0010-ingestion-network-policy.md)、[ADR-0016](0016-manual-browser-assisted-source-import.md)、[ADR-0022](0022-plan-batch-preauthorization-and-delegated-spot-checks.md)、[ADR-0023 提案](0023-enforce-runtime-and-database-role-boundaries.md)、[ADR-0024 提案](0024-unify-source-adapter-descriptors-and-run-modes.md)
- 替代：替代“所有真实来源都只能由维护者逐次手工触发”的旧口径；不替代来源准入、访问政策、请求白名单或公开发布 Gate

## 背景

仓库已经具备来源配置、受限 `source:probe`、PostgreSQL 任务租约、不可变岗位修订和目录物化，但没有运行设计中的 `collector-worker`、到期调度、岗位失效投影和浏览器快照提醒。结果是已导入岗位仍需维护者反复检查，截止岗位和来源变化也无法在 Aijob 运行期间持续收敛。

coco 选择让 Aijob 在本机运行期间自动维护已明确授权的确定性来源。该选择只解决本地目录维护，不构成来源公开准入或产品价值证据。

## 决定

1. 只有当前来源配置同时满足 `crawlInterval.enabled=true`、确定性采集方式和有效本地探测契约时，才允许 `collector-worker` 在 `APP_ENV=local` 下执行真实 `scheduled` 刷新。
2. 本机总开关默认关闭。维护者首次运行 `pnpm source:refresh-enable` 后，Worker 才能创建新网络任务；`source:refresh-disable` 立即阻止后续网络任务。首次启用、扩大请求范围、恢复自动暂停来源和制作浏览器快照仍需人工明确操作。
3. CI、自动化测试、构建、Alpha 和 Production 永不访问真实招聘站。测试继续只使用离线夹具与隔离 PostgreSQL。
4. `collector-worker` 使用现有 PostgreSQL `crawl` 任务、幂等键、租约、心跳、fencing token、有限重试和来源级失败隔离，并以 PostgreSQL advisory lock 保证多个 Worker 之间仍为全局单并发。每小时最多启动三个不同来源；三个不同来源一小时内出现传输层错误时，全局熔断一小时。
5. 来源刷新契约分为：
   - `full_scope`：本次运行能证明完整范围；只有此模式可在间隔至少一个刷新周期的两次完整未见后关闭无截止岗位。
   - `tracked_records`：只复核冻结记录或受限子集；未见不得关闭岗位。
   - `manual_snapshot`：Worker 不访问来源，只生成 `manual_snapshot_required` 提醒；维护者导入新的零网络快照后清除提醒。
6. 截止日期按 `Asia/Shanghai` 自然日计算：截止当天仍可见，次日关闭。官方详情明确返回 404/410 时可凭本次保存的响应证据关闭对应冻结记录。关闭只改变有效活动投影；原始修订、岗位版本和历史决定保持不可变。`uncertain` 继续可见并明确提示。
7. 计划批次先经过接受门。主体、申请链、结构或数量硬冲突会拒绝本次批次并自动暂停该来源，上一可用目录继续生效；语义未变化只更新核验时间，不生成伪岗位版本。接受批次只有在目录物化成功后才推进 `next_due_at`；若进程在两者之间退出，重启后只补做物化，不重复触网。
8. 新岗位和合格变化只进入 `local_mvp`。公开 `/v1/jobs` 仍要求来源同时 `approved + published`，自动刷新不能绕过该 Gate。
9. 本决定只落实独立 `collector-worker` 入口与本机 `scheduled` 模式。ADR-0023 的数据库角色拆分和 ADR-0024 的完整 descriptor/run-mode 重构继续保持提案，不在本次顺带实施。

## 后果

### 正向

- 已导入的确定性来源可按证据和预算持续刷新，维护者不再逐家重复执行相同命令。
- 截止、连续未见、异常批次和浏览器快照待办都有可查询的 PostgreSQL 状态。
- 自动接受门和公开 Gate 分离，来源变化不会直接污染上一可用目录或意外公开岗位。

### 负向与成本

- 本机应用运行期间会产生真实低频网络请求，必须由维护者先显式开启。
- 计划刷新仍不能处理登录、验证码、动态签名或浏览器状态；这类来源只能提醒并人工制作快照。
- 当前 Worker 仍与其他进程共用数据库角色，不能把独立入口误写为 ADR-0023 已完成。

## 复审触发条件

- 自动刷新准备进入 Alpha 或 Production。
- 需要扩大任一来源的主机、路径、查询参数、页数、请求数或频率。
- 连续运行发现静默失效、错误关闭、重复触网或自动批次污染目录。
- ADR-0023 或 ADR-0024 被接受并开始实施。
