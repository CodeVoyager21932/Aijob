# 本机自动来源刷新基础设施验收记录

> 日期：2026-08-01
>
> 状态：离线基础设施通过；主库迁移、总开关启用与三来源真实灰度待执行

## 1. 范围与边界

- 本轮落实 [ADR-0026](../../decisions/0026-local-automatic-source-refresh.md)：只允许本机 `APP_ENV=local`、配置显式授权且本地总开关开启的来源执行 `scheduled` 刷新。
- CI、测试、构建、Alpha 和 Production 不访问真实招聘站；本轮工程门只使用离线夹具与隔离 PostgreSQL `aijob_test`。
- 新岗位和合格变化只能进入 `local_mvp`；公开 `/v1/jobs` 仍受 `approved + published` Gate 约束。
- `.data/source-refresh.local.json` 缺失时默认关闭；本记录生成时未启用总开关、未迁移主库、未执行真实灰度。

## 2. 已实现能力

- 独立 `collector-worker` 随 `pnpm dev` 启动，每分钟扫描 PostgreSQL `next_due_at`，按到期时间和 `sourceKey` 稳定排序。
- PostgreSQL advisory lock 保证多个 Worker 仍为全局单并发；每小时最多启动 3 个不同来源，3 个互不相关来源发生传输层错误后全局熔断 1 小时。
- 计划任务沿用 `crawl` 队列、幂等键、租约、心跳、fencing token 和有限重试。配置或数据库政策失配、主体、申请链、结构、重定向、TLS 或数量硬冲突均 fail-closed 暂停单一来源。
- 接受批次只有在目录物化成功后才推进下一到期时间；进程中断后可只补做物化，不重复触网。计划修订缺少来源证据时不能进入内部目录。
- `full_scope` 才允许两次完整未见后关闭无截止岗位；`partial`、失败和 `tracked_records` 不累计缺失。冻结详情页本次返回 404/410 时保存响应证据并关闭对应记录，再次出现可恢复。
- 截止日期按上海自然日投影：截止当天可见、次日关闭。目录、配额、匹配、推荐和洞察统一排除有效状态为 `closed` 的岗位，历史修订与岗位版本保留。
- `manual_snapshot` 只生成提醒，不触网；成功零网络导入新快照后清除提醒并更新 `next_due_at`。
- 运维入口为 `source:refresh-enable/disable/status/now`；`source:refresh-enable --stagger-hours 24` 可将当前到期的确定性来源按稳定 SHA-256 哈希分散到 24 小时内。

## 3. 灰度配置矩阵

| 分组 | 来源 | 配置结果 |
|---|---|---|
| 确定性灰度 | `shining3d-internships@v3`、`onerobotics-internships@v2`、`supvan-info-internships@v5` | 分别覆盖北森官方 ATS、北森公共 API/ATS 与冻结高校详情页；仅这 3 家启用自动网络刷新 |
| 人工快照提醒 | `bytedance-campus-manual@v3`、`spirit-ai-feishu-manual@v4` | 168 小时到期提醒；自动网络请求为 0 |
| 暂停来源 | `allwinner-gdut-internships@v6`、`dtl-quant-internships@v5`、`galasports-internships@v3`、`kunlunxin-internships@v5` | `crawlInterval.enabled=false` 且 `localProbe.enabled=false` |
| 待灰度后启用 | 其余 18 个活动确定性来源 | 当前全部 `tracked_records` 且 `crawlInterval.enabled=false` |

配置守门确认不存在 `paused + enabled`、关闭的人工快照提醒或计划外灰度来源。五个已启用配置均提升政策版本，没有数据库政策与配置版本混用。

## 4. 离线验证

```text
pnpm test        457/457
  platform       363
  web             57
  config          16
  contracts       15
  database         6
pnpm typecheck   passed
pnpm build       passed
pnpm lint        300 files passed
git diff --check passed
```

覆盖结果包括：上海截止边界、两次完整未见、`partial/failed/tracked_records` 不累计、浏览器来源零网络提醒、到期排序、每小时上限、全局锁、幂等、接受门、硬冲突自动暂停、目录物化补偿、404/410 关闭与恢复、`closed` 在目录和产品服务中的一致排除、语义不变零伪版本，以及公开目录继续为 0。升级回填会从全部历史修订稳定选择最后一个 `validated + published` 版本；本地 `current_version_id` 推进到 review 后，公开目录、公开匹配、JD 洞察和空库恢复统计仍只读取 `public_version_id`，不会把待审变化提前公开或把既有公开岗位误下架。

## 5. 下一步

1. 提交本轮基础设施后，对主库执行迁移 017。
2. 显式开启本地总开关，只运行先临三维、卧安机器人和硕方信息三来源灰度。
3. 核对计划运行、重启零重复触网、目录统计、来源硬冲突和公开 `/v1/jobs=0`。
4. 三家全部通过后，才提升其余 18 个活动确定性来源的政策版本并使用 24 小时分散启用；随后恢复批次 07-04。
