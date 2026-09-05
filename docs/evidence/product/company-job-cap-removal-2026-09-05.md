# 取消单家公司岗位上限验收

日期：2026-09-05。需求来自coco本轮明确指示，记录为ADR-0036。主目录为 `C:\Users\72998\Projects\Aijob`。

## 变更

- 取消公司规模与数量对目录、Case创建/升级、匹配状态和洞察的配额过滤。旧selected=false不能继续隐藏岗位。
- 批次容量使用完整已核验数量，quota=null表示无上限；统计从岗位事实读取，不依赖历史配额表。
- 保留历史表兼容性，物化投影全部选中；没有修改岗位版本、要求集或真实业务库。移除Web配额旁注。
- 更新ADR、路线图和交接，修正README残留旧范围与硬门槛、计划索引旧指向。

## 验证

专项14/14通过：单家35条目录可检索、旧false投影不隐藏、关闭岗位继续撤下且不伪造版本；单家85条容量不压缩。

`pnpm check`退出0：Config20、Contracts105、Database76、Platform564、Web184，共949/949、163个测试文件全部通过，无跳过；lint与五包类型检查通过，仅有3条原有any警告。`pnpm build`退出0，主包403.58kB。`git diff --check`通过。本轮Web仅移除旧提示，未重复执行浏览器总Gate。日志位于 `C:\Users\72998\Projects\Aijob-backups\20260905-job-takeover\company-cap-check.log` 与 `company-cap-build.log`。

## 范围

仅使用专属loopback临时PostgreSQL和合成数据，不访问真实招聘来源或业务数据库。取消公司上限不取消逐来源准入、逐岗位资格、去重、活动状态、分页或请求预算；没有改变排序来惩罚招聘大户。本轮不重新执行历史OS-7开发流程。

测试后已核验专属容器无挂载业务卷、数据仅在tmpfs，并移除 `aijob-no-company-cap-test`。没有迁移或重算业务库，没有推送远端。
