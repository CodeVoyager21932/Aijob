# R1 架构与组件系统性审视记录

> 日期：2026-07-29  
> 范围：模块边界、数据模型、HTTP 契约、任务队列、来源网络策略、适配器扩展性、测试隔离与配置边界  
> 结论：R1 完成；未改变产品边界，未进入 R2，未运行真实来源，产品证据仍为 `E0`

## 1. 审视方法与基线

- 由三个独立只读审查视角分别检查运行时/契约、数据库/任务队列、采集/来源安全，主执行方交叉复核并统一分级。
- 开始前工作区除 coco 的未跟踪 `.claude/` 外无改动；该目录未读取、未修改、未暂存。
- 隔离数据库基线为总供给 177、可见 113、15 家企业，公开 `/v1/jobs` 为 0。
- 变更前全量 359 项测试、TypeScript、生产构建与 264 文件 lint 通过。
- 审视和回归测试只使用离线夹具与隔离 PostgreSQL；没有执行 `source:probe`，没有访问真实招聘来源。

## 2. 已直接修复

### P1：任务租约与删除一致性

- owner task claim 改为显式任务类型白名单，不再使用 `task_type != crawl` 的隐式扩张。
- 过期任务在 `attempt >= max_attempts` 时直接进入 `dead`，不会被再次领取成 `max_attempts + 1`。
- 心跳、成功和失败状态转换都要求租约尚未过期，并检查实际更新行数；旧 worker 无法续活、完成或重排已过期租约。
- 心跳失去租约时会中止当前处理；fencing token 与业务事务校验继续保留。
- 发起 owner 删除时，在写入删除任务、递增 epoch、撤销会话的同一事务内，将该 owner 的旧排队/运行任务标为 `dead` 并递增 fencing token。
- owner 业务提交与删除事务统一按 owner→task 顺序加锁，避免删除冻结旧任务时与 worker 形成锁顺序反转。

### P1：来源网络边界

- `browser_required` 现在对所有来源类型统一要求 `localProbe.enabled=false`；`runSourceProbe` 另有运行时拒绝，避免未来误配置触网。
- 特殊用途地址拒绝表补齐文档网段、协议转换网段、IPv6 文档/基准/本地/多播网段；依据 [IANA IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml) 与 [IANA IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml) 采用 fail-closed 策略。
- HTTPS 请求新增独立绝对截止时间，不再只依赖 socket inactivity timeout。
- 探测预算和最小间隔改为在每个物理 HTTPS attempt 前领取与执行；内部重试和允许的重定向跳转都计入 `request_count`，逻辑页面只计一次 `pages`。

### P1/P2：隐私与契约

- 删除状态回执有效期由 7 天收紧为 24 小时；首次返回成功终态时清除回执 Cookie。
- `ProfileDeletionSchema` 移除只存在于签名回执内部的 `ownerId`、`requestedOwnerEpoch`，与真实最小 wire payload 对齐。
- API Problem Details 统一返回 `application/problem+json`。
- identity 领域新增唯一 `OwnerScope`；matching、decisions、tailoring 不再互相复制或反向导入 owner 类型。

## 3. 保留问题与处置

| 等级 | 发现 | 本轮处置 |
|---|---|---|
| P1 / Private Alpha blocker | ADR-0006 要求 `web-api`、`collector-worker`、`match-worker` 独立进程和数据库最小权限；当前没有独立 collector 入口，所有进程仍共享 `DATABASE_URL`，数据库角色/受限 claim 函数尚未落地 | 形成 [ADR-0023 提案](../../decisions/0023-enforce-runtime-and-database-role-boundaries.md)，R2 不得把设计文档中的隔离误写成已实现 |
| P1 / Private Alpha blocker | `DELETE /v1/profile` 与“官方链接已打开”创建型 POST 的幂等键契约未完整落地；owner task 仍对永久错误统一重试并使用硬编码退避 | 继续受 ADR-0007 约束，进入 Private Alpha 前完成端点幂等与 retryable/permanent 错误分类；本轮不在缺少完整错误清单时仓促改语义 |
| P1 | 人工浏览器导入的契约枚举已有 `manual`，但 `crawl_runs` 迁移仍只接受 `probe/scheduled`，实现因此写 `probe` | 与适配器注册、幂等版本一起形成 [ADR-0024 提案](../../decisions/0024-unify-source-adapter-descriptors-and-run-modes.md)，需要迁移与历史兼容方案 |
| P2 | 手工快照幂等键未包含 normalizer/pipeline 版本；同快照在 normalizer 升级后可能永久复用旧结果 | 纳入 ADR-0024 的兼容键方案；当前无 normalizer 升级事件，不改写历史 run |
| P2 | 适配器版本、probe 分派、manual 白名单和来源专属事实分散在多个文件；新增来源容易漏注册或漂移 | 纳入 ADR-0024 的 descriptor 设计；不在 R1 拆分 `probe.ts` 巨型文件 |
| P2 | 已有 organization slug 命中时没有严格校验名称与官方域名漂移 | 后续安全小修：默认 strict equality，改名/换域走显式证据与版本决策 |
| P2 | 部分 PostgreSQL 集成测试依赖同包其他测试先迁移；定向空库运行不完全自足 | 后续统一测试 migration helper；本轮新增集成测试均自行迁移 |
| P2 | 文档声称实现前生成 OpenAPI，但仓库没有 OpenAPI artifact 或 route coverage | R2 先决定生成 artifact 还是改为契约/路由覆盖，不继续保留无法证明的完成表述 |
| P2 | `probe.ts`、matching/tailoring service 文件过大，导航 URL 纯校验寄居 ingestion | 记录为可维护性债务；只在有行为测试保护的切片中拆分，不为“整洁”重写 |

## 4. 验证证据

- 采集定向：来源配置、IP/URL 策略、物理请求预算测试 41/41 通过。
- owner/删除/HTTP 定向：过期租约、最大尝试、删除事务冻结、24 小时回执、Problem Details 与本地 owner 全流程 19/19 通过。
- 新增回归明确覆盖：重试/重定向物理请求计数、IPv4/IPv6 特殊用途地址、任意类型 browser-only 来源误探测、过期租约三种状态转换、最终尝试死亡、删除时旧任务冻结、删除 wire 最小字段。
- 最终隔离库全量 365 项测试通过（platform 273、web 56、config 16、contracts 15、database 5）；TypeScript、生产构建、266 文件 biome lint 与 `git diff --check` 通过。

## 5. R1 结论

1. 当前模块化单体的领域组织可以继续支持本地完整 MVP，不需要在 R1 引入微服务、Redis、消息总线、搜索或向量组件。
2. 本轮发现的可局部证明安全修复已经落地；大规模运行时隔离与适配器注册重构只形成提案，没有静默改架构。
3. 设计文档中“独立进程、数据库角色、受限函数、OpenAPI”仍有实现缺口，不能因为本地全量测试通过而视为 Private Alpha 已就绪。
4. 产品证据仍为 `E0`，G0/G1/G3 状态不变；R1 完成不代表 G2、来源准入或用户价值 Gate 通过。
5. 下一阶段标记为 R2 UI/UX 系统审视；需单独开始，不与后续来源批次并行。
