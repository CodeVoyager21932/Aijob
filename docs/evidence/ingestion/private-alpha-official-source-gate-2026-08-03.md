# Private Alpha 官方来源资格硬门证据（2026-08-03）

## 结论

- [ADR-0029](../../decisions/0029-official-source-catalog-trust-boundary.md) 已落实为数据库级统一资格投影，而不是依赖各页面或调用方自行判断。
- 企业官网和经企业官网确认的官方 ATS 才可标记为 `catalogRole=canonical`；高校、政府、公众号及其他二手页面统一为 `discovery_only`，只保留发现与历史证据，不再进入用户岗位目录。
- 测试来源必须使用 `runtimeScope=test`，并被本地目录和 Alpha 目录同时拒绝。
- 新硬门首次启用时开发库为 **0 条本地合格岗位、0 条 Alpha 合格岗位**；随后仅通过真实官方计划刷新恢复先临三维 9 条、卧安机器人 5 条。独立干净验收库进一步恢复灵明光子 8 条，当前验收分母为 **22 条岗位、3 家企业、3 个官方 ATS 来源**，Alpha 仍为 0。开发库 14/2 只保留为历史运行事实。
- 公共版本指针保持 0，公开 `/v1/jobs` 不受本次本地纠偏影响。

## 统一资格投影

迁移 `019_official_source_catalog_eligibility` 新增：

- `catalog.current_job_eligibility`：当前修订的本地与 Alpha 资格；
- `catalog.job_version_eligibility`：不可变岗位版本的本地与 Alpha 资格；
- `source_control.source_policy_versions.catalog_role`；
- `source_control.source_policy_versions.runtime_scope`。

迁移 `020_registered_source_and_job_freshness` 继续收紧：

- 当前来源政策必须由 Git 中的精确配置登记，历史或测试来源不能通过启发式回填冒充合法来源；
- 每条岗位必须在当前来源刷新周期内由官网/官方 ATS 再次看见，不能以一次部分刷新把同来源的陈旧岗位整体“洗新”；
- 新增硬阻塞 `SOURCE_CONFIG_NOT_REGISTERED` 与 `JOB_NOT_RECENTLY_VERIFIED`。

本地资格要求同时满足：

1. 来源为 `canonical`；
2. 运行范围为 `local`；
3. 来源政策为 `pending_review` 或 `approved`；
4. 修订已验证、发布状态允许内部复核；
5. 岗位有效状态为 `active`；
6. 来源新鲜度为 `fresh`；
7. 职责、任职要求与精确申请入口完整；
8. 不存在主体冲突、结构缺失、角色级职责缺失、目标范围待复核或人工快照待复核等硬阻塞项。

此外，当前政策必须是已登记的 Git 配置，且具体岗位记录的 `last_seen_at` 必须落在该来源的当前刷新周期内。

Alpha 资格在此基础上还要求来源政策为 `approved`、岗位为 `published`，且运行范围为 `alpha` 或 `production`。

迁移 `021_runtime_database_roles` 与 `022_match_worker_owner_deletion_privileges` 同步建立运行边界：

- `web-api`、`collector-worker`、`match-worker`、`ops-cli`、`migrator` 使用五个独立 `NOLOGIN` 权限组；Alpha/Production 必须提供各自数据库 URL；
- task queue 通过 RLS 隔离 `crawl` 与 owner 任务；collector 不能读取 owner，Web/match 不能读取原始抓取响应；
- match worker 只拥有完成 owner 删除所需的 owner 列级更新和 session 删除权，不能读取会话令牌哈希或修改 owner epoch。

## 代码路径覆盖

以下路径均改为读取统一资格投影：

- 正式目录及旧内部预览列表/详情；
- 匹配候选、匹配 Worker 与确定性推荐；
- JD 洞察；
- 简历受控优化的入队与 Worker 执行时复核；
- 批次规划器、恢复统计和供给报告；
- 自动刷新调度、立即刷新与 Collector Worker。

历史岗位修订、岗位版本、旧推荐和旧优化稿仍保留，只是不再作为当前可用目录参与新的决策。

## 开发库复核

2026-08-03 在本机 PostgreSQL `aijob` 执行迁移 019/020、重新登记 34 个 Git 来源配置并重物化后，硬门首次启用的只读快照如下：

| 指标 | 实际值 |
|---|---:|
| 当前岗位修订 | 235 |
| 原始企业名 | 31 |
| 原始来源 | 32 |
| 本地资格通过 | 0 |
| Alpha 资格通过 | 0 |
| 高校来源岗位 | 39 |
| 高校来源 | 18 |
| 测试岗位 | 3 |
| 空职责岗位 | 7 |
| 缺精确申请入口岗位 | 23 |
| 公共版本指针 | 0 |

当前阻塞原因按岗位计数如下；同一岗位可同时命中多个原因：

| 阻塞原因 | 数量 |
|---|---:|
| `SOURCE_NOT_FRESH` | 223 |
| `JOB_NOT_RECENTLY_VERIFIED` | 110 |
| `BLOCKING_REVIEW_OPEN` | 88 |
| `NON_CANONICAL_SOURCE` | 41 |
| `EXACT_APPLICATION_NOT_AVAILABLE` | 23 |
| `RESPONSIBILITIES_MISSING` | 7 |
| `SOURCE_CONFIG_NOT_REGISTERED` | 3 |
| `TEST_RUNTIME_SCOPE` | 3 |
| `JOB_NOT_ACTIVE` | 1 |
| `SOURCE_POLICY_NOT_LOCAL_ALLOWED` | 1 |

旧物化命令输出中的 `eligibleRevisions` 实际表示“参与历史物化的已验证修订”，并不等于当前目录资格。代码已将该字段更名为 `materializedRevisions`；历史执行记录保留原始字段名，不改写当时事实。

随后使用真实 `scheduled` 队列恢复三个官方来源：

| 来源 | 结果 | 当前可信岗位 | 处置 |
|---|---|---:|---|
| 先临三维 | 9 发现 / 9 规范化 / 0 拒绝 | 9 | 完整计划刷新通过 |
| 卧安机器人 | 5 / 5 / 0 | 5 | 完整计划刷新通过；同小时重放 `reused=true` 且未触网 |
| 百度 | 0 / 0 / 0，`BAIDU_INITIAL_DATA_INVALID_JSON` | 0 | fail-closed 暂停，政策提升至 v4，不再排期 |

慧策 29/30 条命中 `SOURCE_KIND_CONFLICT`，腾讯存在 14 条结构字段缺失及 9 条目标范围待复核；两者也分别提升至暂停政策 v4/v7。开发库只读真值为本地可信岗位 14 条、企业 2 家、来源 2 个，Alpha 资格 0。历史 231/149/29 不再作为供给成绩。

## 干净验收库复核

独立 PostgreSQL 数据库 `aijob_alpha` 已升级至迁移 022，并仅以 Git 登记配置和已授权官方计划刷新恢复目录：

| 来源 | 规模档 | 可信岗位 | 当前作用域 |
|---|---|---:|---|
| 先临三维 | `medium` | 9 | `pending_review/local_mvp` |
| 卧安机器人 | `medium` | 5 | `pending_review/local_mvp` |
| 灵明光子 | `unknown` | 8 | `pending_review/local_mvp` |

只读总计：供给 22、配额可见 22、企业 3、SME 企业 2、SME 可见岗位 14、人工来源 0、Alpha 0、公共版本 0。高校、测试、孤立来源均未进入该可信集合。

Git 忽略的 `.data/local-bootstrap.json` 已从旧 178/114/16 清单校准为三个来源与精确期望 22/22/3/0；`local:bootstrap` 和 `source:probe` 对任何非测试真实访问都要求显式 `--confirm-live`，并在运行前拒绝 `discovery_only`、暂停、未登记或采集方式不匹配的来源。

## 配置与调度结果

- 12 个企业官网/官方 ATS 来源明确标记为 `canonical/local`；其中 10 个为确定性来源、2 个为人工快照来源。
- 22 个高校来源明确标记为 `discovery_only/local`，全部关闭 `crawlInterval.enabled`。
- 非 `canonical/local` 来源不能启用自动刷新、立即刷新或进入 Collector Worker；现有数据库中不存在仍带到期时间或刷新周期的非官方当前政策。
- `source:batch-import` 是探测/导入工具，不会更新来源运行时新鲜度；维护路径固定为 `source:refresh-now <source-key> --wait --confirm-live`，并复用正式计划队列、租约、预算与幂等键。
- 立即刷新到期窗口按 UTC 小时稳定取整；同来源同小时重放不会重复触网，也不会占用新的“每小时不同来源”名额。
- `.data/source-refresh.local.json` 总开关保持关闭；单来源同步刷新只在命令执行期间临时打开并在结束后恢复。

## Private Alpha 身份与解析边界

- Alpha 只接受配置中的 SHA-256 邀请凭证哈希和精确 HTTPS Origin；失败按 IP 做 15 分钟窗口限流，日志和配置输出不含邀请码或哈希；
- 会话使用 Secure/HttpOnly Cookie 与独立 CSRF Cookie。除会话状态和带不可伪造回执的删除状态外，所有 Alpha 产品 API（包括岗位读取）都要求已认证会话，不能绕过前端门直接读取；
- PDF/DOCX 在固定 Node 子进程解析，具备 192 MiB 堆、10 秒超时、1 MiB 输出、30 页 PDF、250 个 ZIP 条目、20 MiB 解压总量及 200k 字符上限；子进程不继承数据库、AI、加密密钥或 `NODE_OPTIONS`，任务失效会终止进程。

## 千岗推荐完整性

- 后端候选上限固定为 1100，目录客户端完整遍历游标并拒绝重复岗位、停滞游标、缺失版本 ID 或超限结果；
- 100 家企业/1000 个官方来源合成岗位的 PostgreSQL 集成测试证明：两个并发相同请求复用同一 run，只产生一个 queued task，并完整冻结 1000 个候选版本、要求集和来源新鲜度；
- 前端保留完整推荐集合，只按 100 条递增加载 DOM，避免把渲染优化误写成业务截断。1000 条实际 Worker 处理时延仍属于服务器就绪 Gate 的 P1 容量验证，不以本次完整性测试代替。

## 剩余 P1（不回退本轮 P0 修复）

- 邀请失败计数当前为单进程内存状态；多实例部署前需要持久化限流、单人凭证、吊销与轮换流程；
- 解析器已获得进程/内存/超时/环境隔离，但尚不是操作系统沙箱；服务器 Gate 应使用非特权、无外网、只读文件系统和资源上限；
- 五个数据库权限组已迁移和验证，但实际登录角色、独立凭据、轮换、备份恢复及未来新表授权仍属于服务器就绪 Gate；
- 1000 候选完整性已证明，真实 1000 岗 Worker 处理耗时、队列等待和内存峰值尚未形成容量 SLO；
- 当前主 Web JS 构建产物为 508.70 kB（gzip 150.05 kB），是性能警告而非正确性失败，手机端专项前按路由拆包。

## 验证

- 来源配置契约：`69/69` 通过；
- 迁移集成测试：覆盖 canonical、discovery、test、未登记配置、来源陈旧、岗位陈旧与硬复核阻塞；
- 目录、旧内部预览、匹配、推荐、洞察、优化和 Worker 执行时复核的聚焦集成测试通过；
- 刷新调度、自动化集成、单来源同步刷新和 Collector Worker 聚焦测试通过；
- Alpha 后端读取绕过修复后的最终工程门为隔离 PostgreSQL 全仓 `557/557`；全仓 TypeScript、生产构建、331 文件 lint 与 `git diff --check` 全绿。

## 下一步

1. 冻结并提交本轮 P0/P1 纠偏，保持 `.claude/`、`.data/`、密钥和本地快照不进入 Git；
2. 以干净库 22/3 为唯一分母，按 ADR-0028 恢复容量优先的企业官网/官方 ATS 来源族扩容；
3. 只依据新的官网证据关闭复核项，不批量豁免主体、结构或申请链冲突；
4. 100/1000、结构比例和服务器就绪 Gate 通过前，继续暂停 G0/G1 与外部用户测试。
