# 岗位方向订阅与每日摘要

更新：2026-10-13。本文说明当前机会链路与兼容范围；日常启动和配置只使用[网页版运行说明](runbooks/system-upgrade-local.md)。搜索选择与权限以 [ADR-0043](decisions/0043-local-opportunity-productization.md) 为准。

入口保持在「发现机会」与「今日」。保存方向时可启用每日摘要，默认北京时间 09:00；首次汇总在后台准备。暂停订阅不会删除历史摘要，删除保存搜索会删除该搜索的摘要。资料全删沿用 owner epoch 与 saved_searches 删除链。

已有来源继续沿用既有准入、采集、PG 任务租约和刷新预算。电脑运行期间按计划执行，关机后启动补跑，不补发重复的历史每日任务。首次摘要是当前存量，之后区分新增、内容变化、恢复开放与确认关闭；失败或缺页不视作岗位关闭。源故障可能使摘要标为部分更新。

## 选择搜索方式

普通用户在 Web「连接与运行」的「新网站搜索方式」三选一，不强制配置两份 Key：

- **只刷新已接入网站**：无需搜索 Key；已明确启用的官网仍按周期刷新，方向与摘要继续可用。
- **复用我的 AI 连接**：使用已保存的个人地址、Key、模型检查搜索能力。只有实际工具执行和可追溯来源元数据符合适配器要求才标为可用；HTTP 成功、正文有链接或模型自称联网都不够。
- **使用独立搜索**：配置 Tavily 并检查；旧本机配置可以显式沿用，检查成功后结束对应方向的旧全局调度。

不会因检查失败自动切换供应商。更换地址、模型或连接修订后需重新检查能力；普通生成可用不代表该连接具备搜索。没有搜索连接不妨碍已有岗位、简历编辑和导出。Key 仅填设置页并加密保存，不写入前端构建或 Git。

### 个人作用域与旧路径兼容

个人设置、能力状态、查询缓存、额度和任务结果绑定 owner/epoch 与配置修订，密钥使用 owner 派生加密。个人查询缓存有效期为 24 小时，不跨用户共享；仅公开规范 URL 线索可全局去重。`user_source_discovery` 在既有 PG 队列中由 match-worker 执行；collector 无个人凭据读取权限。配置或用户状态变化后，旧任务结果不能覆盖新配置或复活已删除资料。

每个 owner 按北京时间限制每日 20 次、每月 500 次网络尝试，失败和重试计入。AI 搜索同时受个人 AI 调用及 Token 预算控制；Tavily 同时受既有全局额度桶约束。命中有效缓存不新增网络尝试；临时网络、认证或限流失败按状态反馈并退避，不凭空补造供应商 usage，也不自动开启超额付费。只发送方向、城市和公开岗位词，不发送简历。

旧 ownerless `source_discovery` 仍由 collector 执行：本机 `.data/opportunity-discovery.local.json` 优先，无文件时读取 `OPPORTUNITY_DISCOVERY_ENABLED` / `TAVILY_API_KEY`。旧路径保留全局 24 小时查询缓存、20 次/日及 500 次/月预算，供尚未显式切换的旧订阅使用；它不是新个人搜索的配置入口。个人删除或选择只用已有网站不会重新启用旧计费路径。

Tavily 适配器请求 `/search`，使用 basic、最多 10 个结果，关闭 answer/raw content/images/auto parameters。搜索摘要正文不入库，只保留公开 URL、标题、域名、发现时间及来源查询。结果 URL 不会因搜索自动抓取；搜索不会产生岗位事实、安装配置或改变公开准入状态。

`OPPORTUNITY_DIGEST_ENABLED=false` 可独立暂停摘要生成，默认 true；已存摘要继续可读，订阅暂停/删除仍同步到搜索需求。搜索、官网刷新和摘要互相区分，关闭新任务不删除历史或其他用户资料。

## 处理新企业

此步骤由维护者在既有受限本机供给工作台完成；普通 Web 不取得内部管理写权限。读取「新企业线索」，核对企业名和官方招聘入口，生成禁用草案。草案的主体、政策和稳定性证据仍需核验；北森租户复用已支持的 Portal/类别识别与有界实际试采，其他来源按一次实际尝试决定使用现有 HTTP、浏览器或人工快照路径，不假定其他 ATS 已有通用能力。继续使用既有「预览—审核 hash—安装—注册—明确启用」流程，扩大范围、首次启用和恢复暂停均保留明确操作。

安装继续写入本地 `config/sources`，注册 PG 并由现有 collector 读取；不会自动提交 Git。搜索线索仅存 PG，不会自行写入可执行来源文件。已安装不等于获准公开，公开资格仍由现有合同判定。

## 关键接口与持久化

- 沿用 `/v1/saved-searches`；PATCH `/:id` 使用 expectedRevision 和幂等键调整订阅。
- GET `/v1/opportunity-digests`、PATCH `/:id` 已读；GET `/v1/opportunity-discovery/status` 保留旧全局状态及额度查询。
- GET/PUT/DELETE `/v1/settings/discovery` 与 POST `/v1/settings/discovery/test` 维护当前 owner 的配置、修订及能力检查，不回传明文 Key。
- `source_discovery`、`user_source_discovery` 与 `opportunity_digest` 使用既有 PG task_queue；前者由 collector 执行，后两者由 match-worker 按显式任务类型权限处理。
- 每日摘要保存岗位版本快照；目录缺失不表示关闭。版本变动及明确活动状态变动同时写入事实事件。不会仅凭自增事件水位跳过晚提交事务。

真实连接和持续稳定性分别报告。2026-10-13 已完成上海/杭州产品实习方向一次 Tavily 实搜、哈啰计划刷新与当日摘要；这不是多日来源稳定性已通过的证据。先临三维与哈啰的已启用范围各按 24 小时周期，摘要北京时间 09:00；关机或 worker 停止期间暂停。当天摘要 10 个新增候选中只有 2 个已确认上海产品实习，杭州本次未新增，未说明职能不补造为符合。哈啰福利段混入要求的问题已修复。详情见[10 月 13 日交付记录](evidence/local-productization-2026-10-13.md)，实时运行状态须现场检查。

## 历史记录：2026-10-12 首轮实现与证据

本节保留当日工程、运行及失败修复证据；共享查询、未配置状态与旧调度范围均限于该时点，不覆盖上面的 ADR-0043 当前行为，也不要求重新执行已通过检查。

已接通保存/编辑/暂停求职方向、共享发现查询与硬额度、内部线索草案、岗位版本/活动事件、按方向每日摘要、摘要历史及已读状态。「今日」可继续最近简历，摘要进入岗位后复用或创建 Case，并直接进入岗位简历页。首次摘要列当前存量，后续才标新增；同内容刷新不伪造版本，来源故障不等于岗位关闭。

动态线索先留在 PostgreSQL，运营核验后沿用现有配置安装与来源注册流程；自动搜索不会启用来源。摘要总开关关闭时，订阅需求同步仍运行，暂停/删除方向不会因为摘要关闭而继续外部搜索。迁移 `068_opportunity_discovery` 与前向授权修复 `071_opportunity_digest_permissions` 已在隔离库应用。

本轮定向检查：

- `opportunities.test.ts` 4 项与 `sources/configured-web-adapter.test.ts` 4 项通过，覆盖 basic 请求、结果去重/仅元数据、共享方向、摘要分类、禁用来源草案及确定性解析边界。
- `opportunities.integration.test.ts` 3 项通过：并发额度与任务角色隔离、24 小时共享查询、摘要幂等/owner 隔离/删除及故障不关岗。摘要生成实际使用 `aijob_match_worker` 角色，权限修复后通过。
- 新增机会文件定向 lint 通过；全仓类型与构建由本次总升级统一收口，未为了此分支重复执行。
- `tools/resume-native/browser-opportunity-journey.mjs` 完整流程通过：固定复杂 `typst-sidebar.pdf` 导入 → 保存方向 → 基线与次日新增区分 → 岗位 → Case 独立原生稿 → 留存实际 PDF → 修改工作稿 → 基础稿不变 → 重开实际投递正文、下载文件逐字节不变；浏览器 `pageErrors=[]`。

浏览器证据位于本机 `.data/system-upgrade-20261012/opportunity-browser/`：`result.json`、`01-direction-changes.png`、`02-retained-submission.png`，以及 `exported.pdf`、`retained-before.pdf`、`retained-after.pdf`。三个 PDF 的 SHA-256 均为 `339a1512ef73f313aa7fb684db47b92a8344f6e8dfdb90280e755454df4f3d16`。固定输入 SHA-256 为 `b07805e4f7ee628b9f4ea786d0ed77e73671b42ab40131bf8ab1764b5f5f5931`。本机证据不提交 Git。

生命周期沿用完整列表覆盖、两次完整缺席且间隔一个刷新周期的既有关闭机制。明确空列表必须命中配置的 empty marker 且完整遍历，才进入原完整刷新流程；错误空页和普通失败不能触发此流程。既有 `refresh-automation.integration.test.ts` 和 `catalog/materialize.integration.test.ts` 提供该机制的历史检查，本轮未重复运行，不能当作本轮新增通过项。

10 月 12 日首轮只读探针显示采集总开关关闭，34 个来源中 26 个 `pending_review`、8 个 `paused`，配置了 7 个确定性来源；当时 Tavily 尚未配置。该首轮检查没有开启采集、真实搜索或真实 AI 请求，也未证明来源准入、稳定性或真实账户连通。后续真实联调结果以上面的 10 月 13 日记录为准。

投递正文模态框的独立样式与容器高度修复后，仅复用既有 Case/投递材料做了一次局部视觉复查，未重建材料或重跑完整旅程。`browser-submission-modal-check.mts` 通过：paper 高度 650px（65vh），host 为 662×599.81px，首张 canvas 为 367.73×520.07px，完整位于 host 内，canvas 与文字层矩形一致，`pageErrors=[]`。修复后截图为 `03-retained-submission-modal-fixed.png`，尺寸证据为 `modal-dimensions.json`；目视确认整页居中且不裁切。
