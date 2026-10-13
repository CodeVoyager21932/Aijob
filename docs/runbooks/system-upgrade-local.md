# 系统升级本机运行说明

功能与实测边界见[交付记录](../evidence/system-upgrade-2026-10-12.md)。本文件替代旧K4/K5手册中与新预览和机会任务冲突的内容。

## 启动

使用 `C:/Users/72998/Projects/Aijob`、原 `.env` 和原加密密钥。先检查 `http://127.0.0.1:3000/health/ready`、5173监听及worker进程，正常服务直接复用。业务库仍为 `aijob-recovered-postgres` /55439；测试55443不可替代业务库，不执行bootstrap或恢复。

入口 `http://127.0.0.1:5173/`：今日查看变化/继续准备；岗位发现顶部「自动找岗位」设置方向、城市、关键词及启停；我的简历导入、纠错和编辑；投递管理选择实际使用文件。简历编辑器保留导入、更换模板、助手和PDF下载；历史版本、DOCX及排版在右上「•••」，自动保存状态在标题下方。

所需构建已完成，只有依赖或源码变化才重新构建。停止的进程可以分别在独立终端启动：

```powershell
Set-Location C:\Users\72998\Projects\Aijob
pnpm --filter @aijob/platform exec tsx src/server.ts
pnpm --filter @aijob/platform exec tsx src/match-worker.ts
pnpm --filter @aijob/platform exec tsx src/collector-worker.ts
```

以上三条后端命令分别运行，不在同一阻塞终端依次粘贴。需要配置自动找岗位时，复用既有本机来源工作台，另开终端运行 `pnpm --filter @aijob/platform cli source-console`，默认8091。岗位发现顶部的「配置自动找岗位」打开 `http://127.0.0.1:8091/discovery-setup`；该服务只监听本机，不放进公开Web权限。若连接被拒绝，先启动此命令。Web另开终端：

```powershell
Set-Location C:\Users\72998\Projects\Aijob
$env:VITE_CAREER_OS_V2='1'
$env:WEB_API_ORIGIN='http://127.0.0.1:3000'
pnpm --filter @aijob/web dev --host 127.0.0.1 --port 5173
```

Windows后台启动使用隐藏窗口并保留PID/日志。这不是开机自启服务；关机暂停，重启后按预算处理到期任务并合并变化。Cookie不按端口隔离，隔离测试使用独立浏览器上下文，不能在同一配置混用业务5173与测试5194，也不要修改稿件owner。

## 开关及配置

| 配置 | 默认及影响 |
| --- | --- |
| 搜索连接 | 本机优先使用「配置自动找岗位」填写Tavily API Key并勾选开启；加密保存到 `.data/opportunity-discovery.local.json`，页面不回传密钥。API与collector每轮读取，保存后不必重启。首次搜索成功前只显示等待状态，不计作连接已验证。 |
| `OPPORTUNITY_DISCOVERY_ENABLED` / `TAVILY_API_KEY` | 无本机配置文件时仍读取原后端环境，默认关闭；远程环境只读取部署配置。不要把Key放进前端构建或Git，不开启账户pay-as-you-go。 |
| `OPPORTUNITY_DIGEST_ENABLED` | 默认true；false暂停新摘要任务，保留历史及用户数据。 |
| 来源刷新 | 与搜索、摘要独立。配置页「启用已接入来源刷新」启用当前维护范围，显示范围数量和下次计划；暂停/重开保留选定范围，后台不会调度范围外来源。`pnpm source:refresh-status` 可只读检查。首次来源及范围变化仍走维护流程。 |
| `ENABLE_NATIVE_STUDIO_TEMPLATES` | 默认true；false使新建稿回到旧默认，不改已有稿。 |
| `VITE_ENABLE_STUDIO_TEMPLATES` | 默认启用；false隐藏四类新模板入口，需要重启Web dev或重建Web；已有新模板稿仍能渲染。 |
| 个人AI | 通过既有「资料与设置」配置当前用户连接。无连接仍能导入、纠错、套版、导出与投递；一次准备最多起草/审阅各一轮，不自动采用。 |

搜索只发送方向、城市和公开岗位词，不发送简历。最多20次/日500次/月网络尝试，同查询24小时共享；不足只暂停新搜索。线索、首次来源准入及安装见[机会说明](../opportunity-discovery.md)。

个人AI的OpenAI兼容连接负责分析/写作，不会因模型名称是DeepSeek而自动获得网页搜索。当前新入口搜索使用Tavily；已接官网刷新无需搜索Key。2026-10-12已完成首次Tavily真实搜索，方向为「产品实习 · 上海 / 杭州」，每日搜索和09:00摘要已开启。官网刷新现启用先临三维与哈啰，均为24小时；哈啰首轮42条中有2条明确上海产品实习，杭州产品实习本次未新增。其他历史来源没有批量恢复，新搜索线索仍需核验后明确接入。

维护者核验来源后可用 `pnpm source:refresh-enable --source-keys shining3d-internships,hellobike-internships` 指定完整刷新范围（多个标识用逗号分隔），无此参数时保留已保存范围。范围保存在既有 `.data/source-refresh.local.json` 的可选 `sourceKeys`，旧文件无此字段仍保持原语义。配置页同时开启本机网络开关；CLI沿用原运行环境的网络配置。关机或停止worker会暂停执行，重启进程后读取原配置，未配置Windows开机自启。

## 文件与兼容

原件、正文、来源关联、历史修订及投递文件独立保留。删除原件不删正文，全部资料删除覆盖新增用户对象；非空稿再导入默认新建。

输入保存后生成服务端PDF，预览和下载同一产物；约900ms停止输入触发更新，旧纸张保留至新文件就绪。立即下载等待当前保存；DOCX继续保证可编辑内容，不承诺装饰与PDF完全一致。

自动预览不显示为手动版本；未保留文件24小时后由既有维护清理，正文/历史修订不删。下载/手动留版/投递提升为保留；实际投递另存加密文件副本，原稿删除后仍可读，留存材料删除时同步删除。

四类新模板只在服务端隔离包渲染，固定RRv6提交、Forme0.28.0及 `font-set-studio-v1.json` 本地字体。不要在线换字体或升级Web React。模板/字体/renderer版本进入缓存标识；旧40套保留原有渲染器。

## 迁移与故障

业务库已升级068–071。升级前备份在 `.data/system-upgrade-20261012/business-upgrade/`，原加密密钥必须保留，不能重新生成。后续迁移前增量备份，不覆盖本次恢复点。

关闭入口不删除内容。迁移只前向，不用旧程序/旧HEAD覆盖新数据；恢复旧库会舍弃升级后写入，仅用于另行明确批准的灾备。实际失败按文件/来源/操作记录，修复后只重查受影响行为，不因轻微留白启动全套矩阵。
