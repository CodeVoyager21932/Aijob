# 自动刷新首轮扩展运行观察

> 日期：2026-08-02
>
> 观察时点：2026-08-02 14:58（Asia/Shanghai）
>
> 状态：首轮扩展已通过 6 个来源，其余确定性来源继续按既有预算和每小时上限排期；不构成完整首轮、G2 或 G3 通过

## 1. 范围与边界

- 本记录追加于 2026-08-01 的[自动刷新基础设施与灰度验收](source-refresh-automation-2026-08-01.md)，不改写其 `200/136/23`、压缩 64 条的历史收口事实。
- 运行仅发生在本机 `APP_ENV=local`、总开关已显式开启、配置与数据库政策版本一致的确定性来源；CI、测试、构建、Alpha 和 Production 未访问真实招聘站。
- 两个 `manual_snapshot` 来源只保留提醒，自动网络请求为 0；四个 `paused` 来源保持关闭。
- 所有接受变化只进入 `local_mvp`。数据库 `public_version_id` 指针为 0；公共模式 `/v1/jobs` 为空，本机启用 `local_mvp` 时同一路由返回内部预览。

## 2. 计划运行结果

| 来源 | run / task | 请求与结果 | 完成语义 | 接受结果 |
|---|---|---|---|---|
| 神谷文化 | run `69d59376-70cc-4e94-90d3-a37708de84e5` / task `a2d821aa-06f6-4c67-8c54-b8eb50e28794` | 1 请求，1/1/0 | `partial`，`tracked_records` | `accepted` |
| 帆软 | run `febe1ca3-d61f-44e4-a4cc-19e34a444f13` / task `6595ad4f-8617-4ba4-8c13-5180e2e07fa5` | 2 请求，12/12/0 | `partial`，`tracked_records` | `accepted` |
| 普渡机器人 | run `e89f1644-471f-46f2-b60c-9706e36e42e2` / task `781a2471-257f-4810-b716-f4777c810b26` | 1 请求，30/30/0 | `partial`，`tracked_records` | `accepted` |
| 寒序科技 | run `4b1bd0cb-1733-4d9a-8015-cb4446d90abb` / task `f7cd90f4-09c9-478f-9eb2-13c378d3eaa8` | 2 请求，2/2/0 | `partial`，`tracked_records` | `accepted` |
| 鲸驰寰宇 | run `3557acde-92c5-48aa-be46-33a03ca06d06` / task `dd07eeef-e9fe-48c0-8aff-085cacd919b9` | 1 请求，1/1/0 | `partial`，`tracked_records` | `accepted` |
| 慧策 | run `74866f40-01e9-4c9e-8d27-cea47a2e350e` / task `c3d33521-064c-4183-ad09-e0f940554cf6` | 2 请求，30/30/0 | `partial`，`tracked_records` | `accepted` |

- 六次运行发生于 2026-08-02 13:53–14:57（Asia/Shanghai），合计 9 个网络请求、76 发现、76 规范化、0 拒绝。
- `partial` 是 `tracked_records` 的覆盖语义，不表示运行失败；六者均无错误、无自动暂停，全局熔断保持关闭。
- 本时点没有排队或运行中的 `scheduled` 任务；第二个每小时 3 来源滚动额度已经用完，后续来源等待窗口恢复。

## 3. 目录变化

| 指标 | 2026-08-01 灰度收口 | 本次观察 | 变化 |
|---|---:|---:|---:|
| 有效总供给 | 200 | 202 | +2 |
| 可见岗位 | 136 | 136 | 0 |
| 企业数 | 23 | 23 | 0 |
| SME 企业 | 7/23 | 7/23 | 0 |
| SME 可见岗位 | 22/136 | 22/136 | 0 |
| 配额压缩 | 64 | 66 | +2 |
| 公共版本指针 | 0 | 0 | 0 |
| 疑似重复复核项 | 0 | 0 | 0 |

- 普渡供给由 30 增至 32；其规模仍为 `unknown`、配额仍为 10，因此新增 2 条进入压缩缺口，不改变可见分母。
- 当前配额缺口为普渡 22、慧策 20、千寻 12、帆软 8、腾讯 4，合计 66。
- 数据库保留 1 条望尘关闭历史岗位；上表的有效总供给与配额分母均不包含该岗位。

## 4. 普渡版本专项核验

- 本轮普渡新增 2 个岗位，并为 27 个既有岗位创建新目录版本。
- 27/27 的真实业务变化是把北森哨兵截止日期 `known: 2222-02-02` 修正为 `unknown: source_not_stated`；其中 UI 设计师和 UE 设计师 2 条还纠正了此前误复用的职责与要求正文。
- 27 条的 `job_family` 与 `locations` 原始 JSON 因新修订证据引用而不同，但移除 `evidenceRefs` 后业务值变化均为 0。`semanticRevisionValue()` 会递归排除证据引用，目录 `contentHash` 使用处理后的语义对象，因此动态 UUID 不是版本创建原因。
- 帆软本轮产生新的来源修订但没有创建语义相同的目录版本，进一步验证语义幂等门仍生效。

## 5. 当前排期与未完成项

- 21 个确定性来源中，本时点 9 个为 `fresh`、12 个为 `due`；2 个浏览器来源为 `manual_snapshot_required`，4 个政策暂停来源关闭。
- 首轮仍未完成，不能据此宣称连续运行、新鲜度或 G3 达标。单个来源失败继续隔离；三个互不相关来源一小时内发生传输层错误时仍按 ADR-0026 打开全局熔断。
- 队列另有 4 个 2026-07-30 遗留 `probe` 排队任务；它们不属于 `scheduled` 队列、不影响本轮调度，但应在后续运维收口中清理。
- 完成剩余首轮后，更新运行统计与空库恢复清单，再按冻结候选排序执行批次 07-04；G0/G1、公开 AI 与服务器自动刷新继续关闭。

## 6. 合并前工程门

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

工程门使用隔离 PostgreSQL `aijob_test` 和离线夹具；运行期间没有由测试、类型、构建或 lint 访问真实招聘来源。
