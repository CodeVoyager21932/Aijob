# 安信基金 SUSTech 详情页预检（2026-08-03）

## 结论

- 通过预检，登记为 `anxin-fund-internships`，保持 `pending_review` / `local_mvp`。
- 采用 SUSTech `bysjy` 详情页确定性适配器；不访问第三方实习平台投递链接。
- 页面明确提供企业域名邮箱 `hr@essencefund.com`，因此申请链采用企业邮箱。
- 规模证据保持 `unknown`；高校页面或招聘平台人数不写入正式规模证据。

## 冻结页面

`https://career.sustech.edu.cn/detail/online?id=3529493`

页面标题为“安信基金2027届实习生（可留用）校园招聘简章”，发布日期为 2026-06-29。

| 岗位 | 地点 | 原文完整性 |
|---|---|---|
| 行业研究员实习生 | 深圳 / 上海 | 职责、任职要求、实习标记完整 |
| 量化研究员实习生 | 上海 | 职责、任职要求、实习标记完整 |

页面正文出现 `hr@essencefund.com`，并明确说明通过该邮箱投递。正文另有 `shixiseng.com` 链接；该链接属于禁止聚合的综合招聘平台，不进入申请链，也未被访问。

## 访问边界

- 只读取上述一张公开详情页；未登录、未提交表单、未使用 Cookie/CSRF/动态签名。
- 首批预算为 1 页、最多 2 条岗位、2 次 GET、请求间隔至少 2 秒。
- 结构或主体变化时暂停该来源，不影响其他来源。

## 真实首批与幂等重放

2026-08-03 11:00（Asia/Shanghai）在本地隔离边界外的开发 PostgreSQL `aijob` 库执行了唯一一次真实首批：

- `runId=be6d4dc4-cc78-4531-88cf-daf6fe8b44b4`，`taskId=30fa4726-8bdd-4fb3-8275-571fe4caaf5e`。
- `request_count=1`、`discovered=2`、`normalized=2`、`rejected=0`；只读取冻结详情页，未超出 2 次 GET 预算。
- 运行结果为 `partial`，原因是单详情页范围没有声明为完整列表范围；这不表示字段解析失败。
- 同小时再次执行返回同一个 `taskId/runId` 与 `reused=true`，新增岗位版本为 0，要求集为 0，疑似重复为 0。

首批后本地物化输出为 `eligibleRevisions=234`、`quotaSelectedJobs=153`、`quotaSuppressedJobs=82`、`suspectedDuplicatePairs=0`；安信来源新增 2 条内部岗位，公开版本指针仍为 0，岗位只进入 `pending_review` / `local_mvp`。

当前开发库另有历史测试来源 `bytedance-manual-test` 与 `official-account-test` 共 3 条测试岗位、1 家测试企业；它们未由本次导入产生，也未计入安信供给。后续正式统计应使用配置来源集合或一次性清理测试数据，不能直接把上述原始物化分母当作 Private Alpha 供给证明。
