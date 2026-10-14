# 当前网页版本机运行说明

更新：2026-10-13。本文件是 C 盘现有网页版的日常启动与配置入口。功能及真实联调边界见 [10 月 13 日交付记录](../evidence/local-productization-2026-10-13.md)，前一阶段见 [10 月 12 日交付记录](../evidence/system-upgrade-2026-10-12.md)。旧恢复、方向工作室、S0–S4、K4/K5 手册保留版本历史，不再提供当前启动指令；不重做业务恢复或 OS-7。

桌面专属适配、同步、构建、安装验收和业务资料迁入已暂停，待 coco 确认终版后恢复；[安装版手册](local-desktop-productization.md)只供查阅已有候选。

## 启动

使用 `C:/Users/72998/Projects/Aijob`、原 `.env` 和原加密密钥。先检查 `http://127.0.0.1:3000/health/ready`、5173 监听及 worker 进程，正常服务直接复用。业务库是 `aijob-recovered-postgres` / `127.0.0.1:55439/aijob`；55443 是隔离测试环境，不能替代业务库。不要执行 bootstrap、业务恢复或旧 5432 Compose 启动指令。

运行状态是时点信息：10 月 13 日真实联调时服务运行；同日后续审计发现 8 个 Docker 容器全部停止，且未见 3000/5173/8091/55439 等相关监听。接手时重新检查，不把任一记录当作当前进程状态。本次文档归一没有启动服务或查询业务数据。

入口 `http://127.0.0.1:5173/`：今日查看变化/继续准备；岗位发现顶部「自动找岗位」设置方向、城市、关键词及启停；我的简历导入、纠错和编辑；投递管理选择实际使用文件。简历编辑器保留导入、更换模板、助手和PDF下载；历史版本、DOCX及排版在右上「•••」，自动保存状态在标题下方。

当前工作区已有构建；仅在依赖、相关源码或构建产物发生变化时重建。数据库停止时，先启动既有 Docker Desktop，再启动既有业务容器；数据库已运行则跳过：

```powershell
docker start aijob-recovered-postgres
```

前后端和两个 worker **均已停止**时，在原工作区终端执行：

```powershell
Set-Location C:\Users\72998\Projects\Aijob
$env:VITE_CAREER_OS_V2='1'
$env:WEB_API_ORIGIN='http://127.0.0.1:3000'
pnpm dev
```

根 `pnpm dev` 并行启动 Web 与平台；平台 `src/dev.ts` 已包含 API、match-worker、collector-worker，不要再叠加启动第二份 worker。match-worker 处理导入、个人搜索及摘要，collector-worker 处理已启用官网刷新及旧全局搜索。停止开发进程前应保存编辑；停止这些进程不会删除数据库。全部应用进程退出后，如需停止数据库，可执行 `docker stop aijob-recovered-postgres`，持久卷保留。

如果只有部分进程停止，仅在独立终端补启缺少的进程，不同时执行上面的 `pnpm dev`：

```powershell
Set-Location C:\Users\72998\Projects\Aijob
pnpm --filter @aijob/platform exec tsx src/server.ts
pnpm --filter @aijob/platform exec tsx src/match-worker.ts
pnpm --filter @aijob/platform exec tsx src/collector-worker.ts
```

以上三条后端命令分别运行，不在同一阻塞终端依次粘贴。Web 缺少时另开终端：

```powershell
Set-Location C:\Users\72998\Projects\Aijob
$env:VITE_CAREER_OS_V2='1'
$env:WEB_API_ORIGIN='http://127.0.0.1:3000'
pnpm --filter @aijob/web dev --host 127.0.0.1 --port 5173
```

仅维护者需要管理来源或旧全局配置时，才另开终端执行 `pnpm --filter @aijob/platform cli source-console`，默认本机 8091；旧 `/discovery-setup` 保留兼容用途。普通用户在 Web「连接与运行」配置个人搜索，不需要打开维护台，Web 不因此取得来源管理写权限。

Windows 后台启动使用隐藏窗口并保留 PID/日志。本网页版不是开机自启服务；关机暂停，重启后按预算处理到期任务并合并变化。Cookie 不按端口隔离，隔离测试使用独立浏览器上下文，不能在同一配置混用业务 5173 与测试 5194，也不要修改稿件 owner。

## 搜索、来源与个人 AI

普通入口是 [连接与运行](http://127.0.0.1:5173/settings/ai)，「新网站搜索方式」三选一：

| 选择 | 用户配置与行为 |
| --- | --- |
| 只刷新已接入网站 | 不需要 Key；在维护者已明确启用的范围内刷新官网，仍可查看岗位和摘要。 |
| 复用我的 AI 连接 | 先保存个人 AI 地址、Key、模型，再检查搜索能力。只有当前连接修订返回真实工具与来源证据才启用新网站搜索；普通 Chat Completions 或模型自称联网不算通过。 |
| 使用独立搜索 | 保存 Tavily Key 并检查；已有本机旧配置可显式选择「沿用本机搜索配置」，不必重填。检查成功后，该方向退出旧全局搜索调度。 |

搜索连接不会自动切换付费供应商。检查会消耗一次实际请求；地址、模型或连接修订改变后，原能力结论不能直接复用。写作 AI 可独立使用；未配置 AI 仍能导入、纠错、套版、导出和记录投递。个人 AI 一次岗位准备最多起草、审阅各一轮，不自动采用。

个人搜索密钥按 owner 加密保存在 PG，缓存、预算与能力结果绑定 owner/epoch 及配置修订。match-worker 执行 `user_source_discovery`；collector 不读取个人凭据。个人查询缓存有效期 24 小时，不跨用户共享；个人网络尝试上限 20 次/日、500 次/月，失败与重试计入。复用 AI 同时占用个人 AI 预算；Tavily 还受既有全局额度桶约束。只发送方向、城市和公开岗位词，不发送简历；不保存搜索摘要正文。搜索给出线索，核验接入后才产生官网岗位，详见[机会说明](../opportunity-discovery.md)。

### 兼容配置与开关

| 配置 | 默认及影响 |
| --- | --- |
| 旧全局搜索配置 | `.data/opportunity-discovery.local.json` 及旧维护台供兼容使用，API 与 collector 每轮读取。旧 ownerless `source_discovery` 继续沿用既有全局 24 小时共享查询与预算；不能与新个人缓存混为同一作用域。 |
| `OPPORTUNITY_DISCOVERY_ENABLED` / `TAVILY_API_KEY` | 无本机旧配置文件时的旧全局后端回退，默认关闭；远程环境只读部署配置。它们不代替个人搜索选择。不要把 Key 放进前端或 Git，不自动开启账户超额付费。 |
| `OPPORTUNITY_DIGEST_ENABLED` | 默认true；false暂停新摘要任务，保留历史及用户数据。 |
| 来源刷新 | 与搜索、摘要独立。普通 Web 展示可用官网与运行状态，来源选择为只读；维护者经本机维护台或现有 CLI 明确启用范围。`pnpm source:refresh-status` 可只读检查。首次启用、范围扩大与恢复暂停保留明确操作。 |
| `ENABLE_NATIVE_STUDIO_TEMPLATES` | 默认true；false使新建稿回到旧默认，不改已有稿。 |
| `VITE_ENABLE_STUDIO_TEMPLATES` | 默认启用；false隐藏四类新模板入口，需要重启Web dev或重建Web；已有新模板稿仍能渲染。 |

### 已有本机配置的最后联调记录

2026-10-13 已显式沿用 Tavily，完成「产品实习 · 上海 / 杭州」真实搜索、哈啰计划刷新和当日摘要；用户中转的普通生成此前通过，但本次 Responses 搜索检查未观察到工具证据，不能推论整个 DeepSeek 服务都不支持搜索。已启用来源范围为先临三维、哈啰，各自 24 小时；摘要北京时间 09:00。哈啰当次 42 条中仅 2 条为已确认上海产品实习，杭州本次未新增；福利段混入要求的问题已修复。以上是带日期联调记录，不是实时运行保证；当前状态由页面、健康检查及刷新状态读取。

维护者核验来源后可用 `pnpm source:refresh-enable --source-keys shining3d-internships,hellobike-internships` 指定完整刷新范围（多个标识用逗号分隔），无此参数时保留已保存范围。范围保存在既有 `.data/source-refresh.local.json` 的可选 `sourceKeys`，旧文件无此字段仍保持原语义。维护台的旧配置页同时开启本机网络开关；CLI 沿用原运行环境的网络配置。关机或停止 worker 会暂停执行，重启进程后读取原配置；网页版未配置 Windows 开机自启。

## 文件与兼容

原件、正文、来源关联、历史修订及投递文件独立保留。删除原件不删正文，全部资料删除覆盖新增用户对象；非空稿再导入默认新建。

输入保存后生成服务端PDF，预览和下载同一产物；约900ms停止输入触发更新，旧纸张保留至新文件就绪。立即下载等待当前保存；DOCX继续保证可编辑内容，不承诺装饰与PDF完全一致。

自动预览不显示为手动版本；未保留文件24小时后由既有维护清理，正文/历史修订不删。下载/手动留版/投递提升为保留；实际投递另存加密文件副本，原稿删除后仍可读，留存材料删除时同步删除。

四类新模板只在服务端隔离包渲染，固定RRv6提交、Forme0.28.0及 `font-set-studio-v1.json` 本地字体。不要在线换字体或升级Web React。模板/字体/renderer版本进入缓存标识；旧40套保留原有渲染器。

## 迁移与故障

2026-10-13 交付记录确认业务库已前向应用至 078。10 月 12 日 068–071 前备份在 `.data/system-upgrade-20261012/business-upgrade/`，10 月 13 日 072–078 前备份在 `.data/local-productization-20261013/business-upgrade/`。这些是升级前时点，不代表最新全部资料备份。原加密密钥必须保留，不能重新生成；未来迁移前做一次配套备份，不覆盖已有恢复点。日常启动不重复迁移，本次文档整理不执行迁移或备份恢复。

关闭入口不删除内容。迁移只前向，不用旧程序/旧HEAD覆盖新数据；恢复旧库会舍弃升级后写入，仅用于另行明确批准的灾备。实际失败按文件/来源/操作记录，修复后只重查受影响行为，不因轻微留白启动全套矩阵。
