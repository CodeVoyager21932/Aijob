# 岗位方向订阅与每日摘要

入口保持在「发现机会」与「今日」。保存方向时可启用每日摘要，默认北京时间 09:00；首次汇总在后台准备。暂停订阅不会删除历史摘要，删除保存搜索会删除该搜索的摘要。资料全删沿用 owner epoch 与 saved_searches 删除链。

已有来源继续沿用既有准入、采集、PG 任务租约和刷新预算。电脑运行期间按计划执行，关机后启动补跑，不补发重复的历史每日任务。首次摘要是当前存量，之后区分新增、内容变化、恢复开放与确认关闭；失败或缺页不视作岗位关闭。源故障可能使摘要标为部分更新。

## 配置发现服务

在现有后端环境配置中设置 `OPPORTUNITY_DISCOVERY_ENABLED=true` 和 `TAVILY_API_KEY`，重启 web-api 与 collector-worker。不得将 Key 写入前端或提交到 Git。未配置时显示「新来源发现尚未配置」，已准入来源及摘要仍可使用。不要开启 Tavily pay-as-you-go；本系统不自动购买或切换付费方案。

`OPPORTUNITY_DIGEST_ENABLED=false` 可独立暂停摘要生成，默认 true；已存摘要继续可读。两个全局开关都不删除用户数据。

仅请求 Tavily `/search`，固定 basic、10 个结果，关闭 answer/raw content/images/auto parameters。按北京时间每天最多 20 次、每月最多 500 次，所有外发尝试与重试均占额度，失败不退额度。同一方向查询全用户共享 24 小时有效期。429/认证失败会暂停后续调用一小时。没有替代搜索供应商或额外队列。

搜索正文不入库，只保留 URL、标题、域名、发现时间及来源查询。结果 URL 不会自动访问；搜索不会产生岗位事实或变更来源准入状态。

## 处理新企业

打开已有本机供给工作台，读取「新企业线索」。核对企业名和官方招聘入口，生成禁用草案。草案的主体、政策和稳定性证据均为待核验，CSS 选择器也需根据实际样本填写。运营完成主体、公开访问政策、精确网络范围、采集方式核验后，继续使用既有「预览—审核 hash—安装」流程。扩大请求范围或首次启用仍需明确操作。

安装继续写入本地 `config/sources`，注册 PG 并由现有 collector 读取；不会自动提交 Git。搜索线索仅存 PG，不会自行写入可执行来源文件。已安装不等于获准公开，公开资格仍由现有合同判定。

## 关键接口与持久化

- 沿用 `/v1/saved-searches`；PATCH `/:id` 使用 expectedRevision 和幂等键调整订阅。
- GET `/v1/opportunity-digests`、PATCH `/:id` 已读；GET `/v1/opportunity-discovery/status` 只返回配置状态及额度计数。
- `source_discovery` 与 `opportunity_digest` 使用同一 PG task_queue，但 collector 与 owner worker 使用显式任务类型权限。
- 每日摘要保存岗位版本快照；目录缺失不表示关闭。版本变动及明确活动状态变动同时写入事实事件。不会仅凭自增事件水位跳过晚提交事务。

本轮测试仅使用搜索/招聘夹具与隔离 PostgreSQL，不证明真实来源稳定性或 Tavily 账户已连通。

## 2026-10-12 本机实现与证据

已接通保存/编辑/暂停求职方向、共享发现查询与硬额度、内部线索草案、岗位版本/活动事件、按方向每日摘要、摘要历史及已读状态。「今日」可继续最近简历，摘要进入岗位后复用或创建 Case，并直接进入岗位简历页。首次摘要列当前存量，后续才标新增；同内容刷新不伪造版本，来源故障不等于岗位关闭。

动态线索先留在 PostgreSQL，运营核验后沿用现有配置安装与来源注册流程；自动搜索不会启用来源。摘要总开关关闭时，订阅需求同步仍运行，暂停/删除方向不会因为摘要关闭而继续外部搜索。迁移 `068_opportunity_discovery` 与前向授权修复 `071_opportunity_digest_permissions` 已在隔离库应用。

本轮定向检查：

- `opportunities.test.ts` 4 项与 `sources/configured-web-adapter.test.ts` 4 项通过，覆盖 basic 请求、结果去重/仅元数据、共享方向、摘要分类、禁用来源草案及确定性解析边界。
- `opportunities.integration.test.ts` 3 项通过：并发额度与任务角色隔离、24 小时共享查询、摘要幂等/owner 隔离/删除及故障不关岗。摘要生成实际使用 `aijob_match_worker` 角色，权限修复后通过。
- 新增机会文件定向 lint 通过；全仓类型与构建由本次总升级统一收口，未为了此分支重复执行。
- `tools/resume-native/browser-opportunity-journey.mjs` 完整流程通过：固定复杂 `typst-sidebar.pdf` 导入 → 保存方向 → 基线与次日新增区分 → 岗位 → Case 独立原生稿 → 留存实际 PDF → 修改工作稿 → 基础稿不变 → 重开实际投递正文、下载文件逐字节不变；浏览器 `pageErrors=[]`。

浏览器证据位于本机 `.data/system-upgrade-20261012/opportunity-browser/`：`result.json`、`01-direction-changes.png`、`02-retained-submission.png`，以及 `exported.pdf`、`retained-before.pdf`、`retained-after.pdf`。三个 PDF 的 SHA-256 均为 `339a1512ef73f313aa7fb684db47b92a8344f6e8dfdb90280e755454df4f3d16`。固定输入 SHA-256 为 `b07805e4f7ee628b9f4ea786d0ed77e73671b42ab40131bf8ab1764b5f5f5931`。本机证据不提交 Git。

生命周期沿用完整列表覆盖、两次完整缺席且间隔一个刷新周期的既有关闭机制。明确空列表必须命中配置的 empty marker 且完整遍历，才进入原完整刷新流程；错误空页和普通失败不能触发此流程。既有 `refresh-automation.integration.test.ts` 和 `catalog/materialize.integration.test.ts` 提供该机制的历史检查，本轮未重复运行，不能当作本轮新增通过项。

当前真实环境只读探针显示采集总开关关闭，34 个来源中 26 个 `pending_review`、8 个 `paused`，配置了 7 个确定性来源；Tavily 尚未配置。本轮没有开启采集、真实搜索或真实 AI 请求，也未证明来源准入、稳定性或真实账户连通。

投递正文模态框的独立样式与容器高度修复后，仅复用既有 Case/投递材料做了一次局部视觉复查，未重建材料或重跑完整旅程。`browser-submission-modal-check.mts` 通过：paper 高度 650px（65vh），host 为 662×599.81px，首张 canvas 为 367.73×520.07px，完整位于 host 内，canvas 与文字层矩形一致，`pageErrors=[]`。修复后截图为 `03-retained-submission-modal-fixed.png`，尺寸证据为 `modal-dimensions.json`；目视确认整页居中且不裁切。
