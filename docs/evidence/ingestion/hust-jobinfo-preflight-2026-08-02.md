# 华中科技大学就业网高校详情页首批核验（2026-08-02）

## 结论

- 两个来源均使用 `university-employment-detail-html` 的 `hust-jobinfo` 格式，仅读取冻结详情页，不遍历列表、不执行脚本、不访问申请系统。
- 来源保持 `pending_review`，岗位仅进入本机 `local_mvp`；公开 `/v1/jobs` 继续为 0。
- 光谷创投首批 2/2 规范化、0 拒绝；智联武汉首批在补齐页面展示名别名后 4/4 规范化、0 拒绝。
- 页面主体、实习标记、职责、任职要求和企业域名邮箱均通过；规模证据未完成，两个组织保持 `unknown`。

## 冻结入口

| 来源 | 详情页 | 页面岗位数 | 申请链 |
|---|---|---:|---|
| 武汉光谷创新投资有限公司 | `https://job.hust.edu.cn/zpinfo3/2406395.htm` | 2 | `ovvc.net` 企业域名邮箱 |
| 北京网聘信息技术有限公司武汉分公司 | `https://job.hust.edu.cn/zpinfo1/2406644.htm` | 4 | `zhaopin.com.cn` 企业域名邮箱 |

页面首批逐条确认了标题、主体、实习标记、职责、任职要求、发布时间/截止时间、地点和邮箱。智联页面展示主体为“智联招聘武汉分公司”，与法定主体不同但属于已核验页面别名；配置在策略版本 2 中补齐该别名，未改变主体匹配规则。

## 运行记录

| 来源 | 运行 | 结果 |
|---|---|---|
| 光谷创投 | `6999a0ab-8675-4cde-a773-6a9e34fea6f5` | `discovered=2, normalized=2, rejected=0, completion=partial` |
| 光谷创投 | 同一小时窗口重放 | 最终返回 `reused=true`，复用任务 `56ae5229-8af1-4d1c-a33a-e9b89c62b93c`，不新增版本 |
| 智联武汉 | 初始策略版本 1 | 4 条均因页面展示名未列入别名而 `UNIVERSITY_EMPLOYMENT_COMPANY_MISMATCH`，不导入 |
| 智联武汉 | `dc834976-1aed-4b4f-85e0-168d0911bc7c` | `discovered=4, normalized=4, rejected=0, completion=partial` |
| 智联武汉 | 同一小时窗口重放 | 返回 `reused=true`，复用任务 `b0af797e-3d62-45fc-9cd8-d6f4ca4fb8e6`，不新增版本 |

光谷首次重放恰好跨过 UTC 小时窗口，因此生成了新窗口任务；随后立即重放已返回 `reused=true`。这符合任务幂等键包含来源、策略、适配器、运行模式和小时窗口的设计。

## 物化统计

执行 `pnpm catalog:materialize`：

```text
eligibleRevisions=228
createdVersions=6
createdRequirementSets=6
suspectedDuplicatePairs=0
quotaSelectedJobs=147
quotaSuppressedJobs=82
```

当前可见目录为 147 条、28 家企业；其中 `small/medium` 为 8/28 家、24/147 条岗位；公开岗位为 0。新增岗位均为 `local_mvp`，没有修改公共 API、数据库表或配额算法。

## 边界与后续

- 未取得第三方长期复制与公开聚合授权，两个来源不进入公开准入。
- 页面主体、职责/要求结构、实习标记、邮箱域名或访问策略发生变化时，只暂停对应来源。
- 后续可在相同 `hust-jobinfo` 契约下逐页加入华中科技大学候选；动态签名、登录、验证码、Cookie/CSRF 页面仍转为浏览器快照提醒，不与自动来源并行。
