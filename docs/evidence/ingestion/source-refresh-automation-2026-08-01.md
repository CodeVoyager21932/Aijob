# 本机自动来源刷新验收记录

> 日期：2026-08-01
>
> 状态：基础设施、三来源真实灰度、竞态加固与 21 个确定性来源分散排期均通过；进入首轮扩展运行观察

## 1. 范围与边界

- 本轮落实 [ADR-0026](../../decisions/0026-local-automatic-source-refresh.md)：只允许本机 `APP_ENV=local`、配置显式授权且本地总开关开启的来源执行 `scheduled` 刷新。
- CI、测试、构建、Alpha 和 Production 不访问真实招聘站；本轮工程门只使用离线夹具与隔离 PostgreSQL `aijob_test`。
- 新岗位和合格变化只能进入 `local_mvp`；公开 `/v1/jobs` 仍受 `approved + published` Gate 约束。
- `.data/source-refresh.local.json` 缺失时默认关闭；主库迁移 017 已执行，本机总开关已显式开启。收口核对时未运行 Worker 或 `pnpm dev`，只执行了只读状态命令。

## 2. 已实现能力

- 独立 `collector-worker` 随 `pnpm dev` 启动，每分钟扫描 PostgreSQL `next_due_at`，按到期时间和 `sourceKey` 稳定排序。
- PostgreSQL advisory lock 保证多个 Worker 仍为全局单并发；每小时最多启动 3 个不同来源，3 个互不相关来源发生传输层错误后全局熔断 1 小时。
- 计划任务沿用 `crawl` 队列、幂等键、租约、心跳、fencing token 和有限重试。配置或数据库政策失配、主体、申请链、结构、重定向、TLS 或数量硬冲突均 fail-closed 暂停单一来源。
- 接受批次只有在目录物化成功后才推进下一到期时间；进程中断后可只补做物化，不重复触网。计划修订缺少来源证据时不能进入内部目录。
- `full_scope` 才允许两次完整未见后关闭无截止岗位；`partial`、失败和 `tracked_records` 不累计缺失。冻结详情页本次返回 404/410 时保存响应证据并关闭对应记录，再次出现可恢复。
- 截止日期按上海自然日投影：截止当天可见、次日关闭。目录、配额、匹配、推荐和洞察统一排除有效状态为 `closed` 的岗位，历史修订与岗位版本保留。
- `manual_snapshot` 只生成提醒，不触网；成功零网络导入新快照后清除提醒并更新 `next_due_at`。
- 运维入口为 `source:refresh-enable/disable/status/now`；`source:refresh-enable --stagger-hours 24` 可将当前到期的确定性来源按稳定 SHA-256 哈希分散到 24 小时内。
- 启用流程先把本地 Gate 写为关闭并等待 collector advisory lock 空闲，再完成全部政策登记和分散排期，全部成功后才重新开启；任一步失败时保持关闭。禁用命令先关闭 Gate，再等待当前 collector cycle 释放同一锁，命令返回后不会有旧周期继续触网。
- 已耗尽重试的幂等任务会把来源标记为 `stale` 并退到下一刷新周期，不再永久占据最早到期队首；配置缺失或政策失配等硬错误仍只暂停对应来源。

## 3. 最终配置矩阵

| 分组 | 来源 | 配置结果 |
|---|---|---|
| 确定性灰度 | `shining3d-internships@v3`、`onerobotics-internships@v2`、`supvan-info-internships@v5` | 分别覆盖北森官方 ATS、北森公共 API/ATS 与冻结高校详情页；三家真实灰度通过后保持启用 |
| 扩展确定性来源 | 其余 18 个活动来源 | 各提升一个政策版本，保持原 `tracked_records` 覆盖、24/168 小时间隔和请求预算，按稳定哈希分散到 24 小时窗口 |
| 人工快照提醒 | `bytedance-campus-manual@v3`、`spirit-ai-feishu-manual@v4` | 168 小时到期提醒；自动网络请求为 0 |
| 暂停来源 | `allwinner-gdut-internships@v6`、`dtl-quant-internships@v5`、`galasports-internships@v3`、`kunlunxin-internships@v5` | `crawlInterval.enabled=false` 且 `localProbe.enabled=false` |

18 个扩展来源为：`adaps-photonics-internships`、`baidu-internships`、`citics-shanghai-summer-internship`、`dingwei-consulting-internships`、`fanruan-trainee-internships`、`hanxu-tech-internships`、`hr-soft-internships`、`huice-campus-internships`、`jcquant-internships`、`jd-campus-internships`、`meituan-official`、`nankai-tal-2027`、`pudutech-internships`、`sharecapital-internships`、`shengumedia-internships`、`tencent-campus`、`triple-stone-internships`、`unity-drive-internships`。

配置守门确认不存在 `paused + enabled`、关闭的人工快照提醒或计划外启用来源。共有 23 个 `crawlInterval.enabled` 配置，其中只有 21 个确定性来源具备计划网络能力，另外 2 个浏览器来源只提醒；4 个暂停来源保持关闭，数据库政策与配置版本一致。

## 4. 真实灰度与物化

| 来源 | 计划运行 | 请求与结果 | 接受与幂等 | 目录变化 |
|---|---|---|---|---|
| 卧安机器人 | run `959c48cc-8e36-4f6a-9a6c-3c49266207f0` / task `bbbe25ed-c6be-4896-9a3f-6cfdd2edb63f` | 1 请求，5/5/0，`complete` | `accepted`；同到期窗口重放 `reused=true`，不产生第二次网络运行 | 新增 1 个合格岗位版本 |
| 先临三维 | run `de9d0fb2-48b5-44fe-a71d-a00946f1ccc0` / task `11451f1f-2cbd-4445-a151-c2ac1dc06eb2` | 1 请求，9/9/0，`complete` | `accepted`；同到期窗口重放 `reused=true`，不产生第二次网络运行 | 新增 1 个合格岗位版本 |
| 硕方信息 | run `d07a7608-4633-48e1-9378-340dc9ab2395` / task `f85d15db-e427-44ed-837b-73e773a6dbdf` | 6 请求，6/6/0，`partial` | `accepted`；同到期窗口重放 `reused=true`，不产生第二次网络运行 | 语义未变化，0 个伪岗位版本 |

- 三家均为 0 硬冲突、0 自动暂停；卧安与先临推进到次日，硕方按原 168 小时间隔推进到下周。
- 两个浏览器来源只生成 `manual_snapshot_required`，自动网络请求为 0；收口状态中熔断为空、没有来源被自动暂停。
- 灰度物化后目录由 198/134/23 变为总供给 200、可见 136、23 家企业；SME 为 7/23 家与 22/136 岗位，配额压缩 64，疑似重复 0，公开 `/v1/jobs` 为 0。
- 三家通过后才执行 18 个扩展来源政策升版与 24 小时分散；原三家的既有下一到期时间未被移动，没有在扩展启用过程中启动 Worker。

## 5. 离线验证

```text
pnpm test        460/460
  platform       366
  web             57
  config          16
  contracts       15
  database         6
pnpm typecheck   passed
pnpm build       passed
pnpm lint        300 files passed
git diff --check passed
```

覆盖结果包括：上海截止边界、两次完整未见、`partial/failed/tracked_records` 不累计、浏览器来源零网络提醒、到期排序、每小时上限、全局锁、幂等、接受门、硬冲突自动暂停、目录物化补偿、404/410 关闭与恢复、`closed` 在目录和产品服务中的一致排除、语义不变零伪版本，以及公开目录继续为 0。新增竞态回归覆盖启用过程原子关闭、禁用返回屏障、执行前最终开关检查和 dead 队首退避。升级回填会从全部历史修订稳定选择最后一个 `validated + published` 版本；本地 `current_version_id` 推进到 review 后，公开目录、公开匹配、JD 洞察和空库恢复统计仍只读取 `public_version_id`，不会把待审变化提前公开或把既有公开岗位误下架。

工程门使用隔离 PostgreSQL 和离线夹具，不访问真实来源；真实网络只发生在上节三家明确授权灰度中。

## 6. 下一步

1. 观察 18 个扩展来源的首轮分散运行；单个来源失败继续隔离，命中一小时三来源传输错误时按现有规则全局熔断。
2. 使用 `pnpm source:refresh-status` 核对运行、失败、下一到期和两个人工快照待办；不为消除提醒自动访问浏览器来源。
3. 首轮扩展运行稳定后恢复批次 07-04，继续使用冻结候选排序、每批最多 5 家和来源级 fail-closed 边界。
