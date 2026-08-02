# G2 SME 批次 07-01 执行记录

- 执行日期：2026-07-30
- 授权依据：ADR-0022、ADR-0025
- 来源范围：卧安机器人、一清创新、三石园科技
- 执行边界：匿名只读、串行低频；未使用登录、验证码、Cookie、CSRF、动态签名、代理或浏览器快照
- 结论：3/3 来源通过，新增 8 条 `local_mvp` 岗位；公开 `/v1/jobs` 仍为 0

## 1. 候选与契约

固定 20 家候选的活动性、规模、申请链和访问边界见[候选核验记录](g2-sme-batch-07-candidate-assessment-2026-07-30.md)。本批只对其中同时满足四项硬门槛的三家建立配置：

| 来源 | 契约 | 规模证据 | 首批上限 |
| --- | --- | --- | --- |
| `onerobotics-internships` | 卧安官方北森租户；固定 `PortalId=8db50333-7ab7-4960-8f87-ddd9468f4766`、`Category=3`；1 个列表 POST | 港交所年报披露 644 名雇员，`medium` | 5 |
| `unity-drive-internships` | 三张冻结南开详情页；企业域名邮箱 `yangshuo@unity-drive.com` | 官网当前源码显示团队 180+，`small` | 3 |
| `triple-stone-internships` | 一张冻结南开详情页；企业域名邮箱 `HR1@triple-stone.com` | 官网显示员工 1400+，`medium` | 1 |

三个来源均为 `pending_review`、`local_mvp` only；`accessPolicyAccepted` 保持失败，不构成公开聚合授权。

## 2. 结构修复

首次探测显示南开通用适配器会把部分页面“职位描述”中的公司介绍、职责和任职要求合并到职责字段。执行方没有手工改写数据库，而是：

1. 将 `university-employment-detail-html` 升至 `0.1.1`；
2. 冻结“主要工作内容/岗位职责/实习职责”与“任职要求/针对对象”的确定性边界；
3. 增加一清、三石园正常解析和外域邮箱拒绝测试；
4. 依照不可变政策规则提升所有使用该共享适配器的配置政策版本；
5. 以新政策重新探测一清和三石园，生成可复现的新修订。

修复后，一清三条岗位的详细任职要求与职责分离；三石园职责只保留四项工作内容，任职条件保留对象、实习时间、专业和地点，联系方式不混入任职要求。

## 3. 真实首批与幂等

| 来源 | 最终 run | 政策/适配器 | 请求 | 发现/规范化/拒绝 | 重放 |
| --- | --- | --- | ---: | ---: | --- |
| 卧安机器人 | `121f8d9c-b171-4ce4-9e02-760b678fcc3f` | v1 / `0.1.2` | 1 | 4 / 4 / 0 | 同小时 `reused=true` |
| 一清创新 | `ec633cc1-7658-4853-a658-57c8bbe2a9d2` | v2 / `0.1.1` | 3 | 3 / 3 / 0 | 同小时 `reused=true` |
| 三石园科技 | `6b4c23c6-08e6-48f2-ae1d-132a5469b1e8` | v2 / `0.1.1` | 1 | 1 / 1 / 0 | 同小时 `reused=true` |

- 卧安当前接口只返回 4 条明确实习，因此 `--limit 5` 的完成态为 `partial`；没有扩大页面、请求或补齐伪岗位。
- 一清和三石园按冻结详情页数量完成，所有请求均低于 10 请求预算，间隔不少于 2 秒。
- 重放均返回原 `taskId/runId`，没有新请求或伪造新修订。

## 4. 物化结果

`pnpm catalog:materialize`：

```text
eligibleRevisions=196
createdVersions=8
createdRequirementSets=8
suspectedDuplicatePairs=0
quotaSelectedJobs=132
quotaSuppressedJobs=64
```

目录实际分母：

| 指标 | 批次前 | 批次后 |
| --- | ---: | ---: |
| 总供给 | 188 | 196 |
| 可见岗位 | 124 | 132 |
| 企业 | 19 | 22 |
| SME 企业 | 3/19（15.79%） | 6/22（27.27%） |
| SME 可见岗位 | 10/124（8.06%） | 18/132（13.64%） |
| 配额压缩 | 64 | 64 |
| 疑似重复 | 0 | 0 |
| 公开岗位 | 0 | 0 |

可见岗位职能分布为：`conflict 27`、`engineering 26`、`product 23`、`operations 19`、`data_ai 14`、`unknown 7`、`sales_business 6`、`design 2`、`marketing 2`、`research_consulting 2`，其余五个职能各 1。冲突和未知继续进入人工复核，不被强行归类。

## 5. 工程门

显式使用隔离数据库 `aijob_test`：

- `pnpm test`：401/401（platform 308、web 57、config 16、contracts 15、database 5）
- `pnpm typecheck`：通过
- `pnpm build`：通过
- `pnpm lint`：通过，279 文件；脚本修正为只执行 Biome lint，避免 Windows CRLF 被误当 lint 错误
- `git diff --check`：通过，仅有 Git 的 LF/CRLF 提示

## 6. 后续决定

固定 20 家队列已经核验完毕，仅本批三家通过。当前 132/300 可见、22/30 企业、SME 企业 27.27%/60%、SME 岗位 13.64%/50%，仍未达到 G2。下一批按 ADR-0025 从千家台账中依 `active_explicit → active_needs_recheck`、合格岗位数降序、截止日期升序、候选 ID 升序继续筛选；不降低规模和字段标准。
