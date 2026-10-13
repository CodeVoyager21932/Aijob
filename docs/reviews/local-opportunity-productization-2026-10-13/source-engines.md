# Aijob 岗位发现产品化：来源发现、接入、采集与监控开源研究

研究日期：2026-10-12 至 2026-10-13（北京时间跨日）。任务是研究设计，不是实施。仅阅读官方仓库、官方文档与关键源文件；未安装或运行任何第三方项目，未改 Aijob 业务、配置、服务或数据库。以下“建议”是面向 Aijob 现有约束的设计推论，不能当作已实现或已验证的运行结果。

## 结论先行

最有价值的组合是 **Job Seek 的共享来源维护与 ATS 探测、RSSHub 的路由识别目录、Crawl4AI 的一次生成提取规则再复用、changedetection.io 的可信变化反馈**。这是四种机制，不是安装四套平台。

不建议用“接入万能爬虫/浏览器 Agent”解决开箱即用。用户首次拿到岗位，依赖的首先是产品预置的可用来源、能够自行启动恢复的后台，以及网站变更时的维护流程。模型 Key 只解决模型调用；不会附赠已接入的网站、搜索索引、可靠分页和来源准入。

**普通用户简单，必须由产品承担来源维护。** 建议把体验切成两层：用户保存求职方向即可使用已有岗位；新网站在维护层经历自动识别、试采、一次确认、持续刷新，失败交维护者，不把接口参数和 JSON 配置推给求职用户。若产品坚持所有组件均由个人电脑自托管，又没有持续维护者，则“任何网站都能自动接入”无法据本次研究作出可信承诺。

本次深入覆盖 9 个仓库，按 8 组比较：Job Seek、Crawlee、Scrapy、Crawl4AI、Firecrawl、Stagehand/browser-use、changedetection.io、RSSHub。没有用 star 数判断适配性。

## 核心候选与取舍

| 项目 | 与本次目的最相关的已核实能力 | 真正边界 | Aijob 建议 |
|---|---|---|---|
| Job Seek | 按成本尝试 ATS 探测，返回已识别租户参数；列表监控与正文抓取分离；来源注册表 | 新公司接入仍由运营 Codex/贡献者研究、验证、提交 PR；自托管需要多项运维服务 | **来源接入机制重点参考**，不搬其基础设施 |
| RSSHub | 每个路由声明参数、能力、维护者、网站识别规则；同路由缓存共享 | 仍需有人维护路由；订阅生成并不证明官网准入或岗位仍在招 | **连接器目录重点参考**，不搬整站路由 |
| Crawl4AI | CSS/XPath/正则确定性提取；用模型生成并试验 schema，再重复使用 | schema 成功提取不等于字段语义正确、分页完整或官方许可 | **提取配方生成方式参考**，暂不增加 Python 服务 |
| changedetection.io | URL 监控、选择器与 JSON 过滤、历史快照/差异、独立监控状态 | 文本变化不等于新增岗位；页面为空不等于全部下架 | **变化解释与状态 UX 参考**，保留 Aijob 岗位语义事件 |
| Crawlee | TS、HTTP/浏览器统一接口、请求重试/失败回调/并发控制 | requestHandler 仍要定义如何提取；默认有自己请求存储 | 不替换已正常的 collector；浏览器规模确有问题时再评估局部模块 |
| Scrapy | 确定性 Spider、去重、重试、磁盘 JOBDIR 恢复 | Python 框架，需要编写规则；其恢复不是 Aijob PG 租约/fencing 的替代 | 学任务边界与恢复语义，不新建第二采集栈 |
| Stagehand / browser-use | 自然语言浏览器动作和 schema 提取；可控步骤/失败终止 | 是浏览器自动化工具，不是任意招聘站自动接入服务；推理有成本与不确定性 | 只作为未来维护层的受限研究工具候选；不放每天刷新主路径 |
| Firecrawl | scrape/crawl/map/search API；当前实现包含缓存提取器和有限修复 | Cloud 与自托管功能有差异；默认栈含 Redis/RabbitMQ 等 | **不引入整套**；借鉴“失败显式传播、禁止伪装空数据” |

## 1. Job Seek：最接近 Aijob 本次真实瓶颈

官方入口：[仓库](https://github.com/colophon-group/jobseek)、[来源接入流程](https://github.com/colophon-group/jobseek/blob/main/docs/01-agent-workflow.md)、[监控器与提取器文档](https://github.com/colophon-group/jobseek/blob/main/docs/04-monitors-and-scrapers.md)。观察提交 `915d34ac84adbda9be528171cd0936660725bb6f`。

### 核实事实

- `MonitorType` 声明 `cost / can_handle / discover / rich / save_raw`，注册后按成本排序；`detect_monitor_type()` 按顺序调用探测器。便宜的已知 ATS 优先，不需要所有公司都先跑浏览器 Agent。`rich` 表示列表接口已经给出足够正文，可以跳过逐条正文请求。[注册与探测代码](https://github.com/colophon-group/jobseek/blob/915d34ac84adbda9be528171cd0936660725bb6f/apps/crawler/src/core/monitors/__init__.py)
- 列表监控负责识别哪些岗位存在；正文抓取负责详情。官方文档明确反思每小时重复抓 N 个详情的浪费，分别安排新条目和日常详情更新。[职责分离](https://github.com/colophon-group/jobseek/blob/915d34ac84adbda9be528171cd0936660725bb6f/docs/04-monitors-and-scrapers.md)
- 北森模块读取门户 bootstrap 获得 PortalId，检查返回形状和 Count，分页数量/去重异常可标 `truncated`，识别网站版本/租户身份变化；探测关闭盲猜 slug。它包含现代 API 与旧模板路线。[北森实现](https://github.com/colophon-group/jobseek/blob/915d34ac84adbda9be528171cd0936660725bb6f/apps/crawler/src/core/monitors/beisen.py)
- Moka 检测可识别共享域名和自定义域名；自定义域名不能只凭路径相似，需 bootstrap 信息与组织/站点参数一致。**这只是对方实现存在，Aijob 当前不能据此宣称已有 Moka 通用支持。**[Moka 实现](https://github.com/colophon-group/jobseek/blob/915d34ac84adbda9be528171cd0936660725bb6f/apps/crawler/src/core/monitors/mokahr.py)
- `api_sniffer` 观察页面 XHR/fetch，可推断列表、映射和分页；其回放失败会显式抛错，不把所有路径失败转换成空结果。[接口观察实现](https://github.com/colophon-group/jobseek/blob/915d34ac84adbda9be528171cd0936660725bb6f/apps/crawler/src/core/monitors/api_sniffer.py)
- JSON-LD 不是绝对可靠：其正文有时只是公司介绍，代码允许经过配置的可见正文选择器替换该字段。这直接对应 Aijob 当前“福利混入任职要求”的问题。[JSON-LD 提取实现](https://github.com/colophon-group/jobseek/blob/915d34ac84adbda9be528171cd0936660725bb6f/apps/crawler/src/core/scrapers/jsonld.py)

### 自动化边界与成本

README 明确自托管是 operator-managed；公司请求由托管 Codex runner/贡献者处理，流程包括实际探测、选择监控/提取器、校验、PR。它没有证明“用户填一个模型 Key 就可以无人维护接任意站”。运行依赖 Python、Node、两处 PG 数据边界、Redis、Typesense、S3-compatible 存储以及多进程，不符合 Aijob 本轮简化目标。[README 的接入与运行说明](https://github.com/colophon-group/jobseek#add-a-company)

代码是 [MIT](https://github.com/colophon-group/jobseek/blob/main/LICENSE)；岗位数据集另有 [CC BY-NC 4.0](https://github.com/colophon-group/jobseek/blob/main/LICENSE-JOB-DATA)，并说明该许可只涵盖其拥有的选择/编排等权利，不代替第三方权利人许可。不要因代码 MIT 就直接复制其全部岗位数据库。

### 对 Aijob 的建议

首先做**北森同模板新租户自动识别**：输入企业官网或官方招聘链接，自动读取已有模板所需参数，生成来源草案和试采证据，维护者一次启用。第二个 ATS 必须由中国在校生供给的真实覆盖收益决定；Moka 是候选，不是已经拍板接入。

保留 Aijob 现有配置安装、`reviewedHash`、PG 注册和权限边界。不要移植 Job Seek 的 GitHub issue 真源、CSV 主配置迁移、自动 worktree、Redis、Typesense、公开数据集；也不要把对方的代理、session 重放等能力全部照搬。只读取公开页面上正常呈现的信息；登录、验证码、访问禁止照现有规则终止。

## 2. RSSHub：维护者写一次，许多用户只填写简单参数

官方入口：[仓库](https://github.com/DIYgod/RSSHub)。观察提交 `c717e450b563f46384a78a031b38f05d4c974edb`。

核心不是 RSS 输出格式，而是“带元数据的连接器”。路由包含路径、参数、是否需要浏览器/配置、maintainers、radar 网站识别规则；Radar 由注册路由导出域名、路径到目标路由映射。缓存层对同一路由共享结果，并在支持原子 claim 的后端避免同时抓取。[路由实例](https://github.com/DIYgod/RSSHub/blob/c717e450b563f46384a78a031b38f05d4c974edb/lib/routes/hiring.cafe/jobs.tsx)、[Radar 聚合](https://github.com/DIYgod/RSSHub/blob/c717e450b563f46384a78a031b38f05d4c974edb/lib/api/radar/rules/utils.ts)、[缓存中间件](https://github.com/DIYgod/RSSHub/blob/c717e450b563f46384a78a031b38f05d4c974edb/lib/middleware/cache.ts)。

RSSHub 本身不会把未知网站自动变成可靠路由，也不提供 Aijob 的岗位生命周期规则。路由可用不等于来源获准；示例 hiring.cafe 属于聚合服务，不是本项目可直接采作岗位事实的企业官网。缓存支持多后端，不能简单声称 RSSHub 必须 Redis，但整套引入仍重复 Aijob 状态层。

**许可证必须纠正旧印象：当前 master LICENSE 为 AGPL-3.0，不是 MIT。** 本报告只借鉴机制，若复制路由代码需针对锁定版本核对许可。[实际 LICENSE](https://github.com/DIYgod/RSSHub/blob/c717e450b563f46384a78a031b38f05d4c974edb/LICENSE)

建议让 Aijob 连接器描述带 `识别规则、版本、支持能力、需要的租户参数、维护状态、最后通过时间、失败解释`。用户只见“企业官网已接入/等待接入/暂时失败”；内部维护者见详细参数。多个方向共享同一来源刷新，沿用 PG 幂等与锁，不复制 RSSHub 缓存系统。

## 3. Crawl4AI：最值得借的是模型只在规则生成时介入

官方入口：[仓库](https://github.com/unclecode/crawl4ai)、[LLM-free strategies](https://docs.crawl4ai.com/extraction/no-llm-strategies/)。观察提交 `aadd82bebf989f1c36e1b557b8bb2b7c9dae393f`。

它支持 CSS/XPath/正则提取与 LLM 提取两种路线。`generate_schema` 可用模型生成选择器，随后在真实 HTML 上验证并修正；成功后的 schema 可供确定性重复提取。模型生成本身可能多次调用，文档提供总 token 计量，不应按“一次按钮=一次低价调用”估计。[实现](https://github.com/unclecode/crawl4ai/blob/aadd82bebf989f1c36e1b557b8bb2b7c9dae393f/crawl4ai/extraction_strategy.py)

异步 dispatcher 提供内存/并发调度，浏览器 session 可复用连续交互状态；这不等同于 Aijob 业务任务已经持久化、跨进程幂等恢复。[dispatcher](https://github.com/unclecode/crawl4ai/blob/aadd82bebf989f1c36e1b557b8bb2b7c9dae393f/crawl4ai/async_dispatcher.py)、[session 文档](https://docs.crawl4ai.com/advanced/session-management/)

库为 Python/浏览器运行环境；云服务另算。LICENSE 是 Apache-2.0 文本加附加 Attribution Requirement，README 对推荐署名与要求的表述不完全一致，实施应以锁定版本 LICENSE 明文为核对对象，不只抄 GitHub 徽章。[LICENSE](https://github.com/unclecode/crawl4ai/blob/aadd82bebf989f1c36e1b557b8bb2b7c9dae393f/LICENSE)

建议 Aijob 借模式而暂不加依赖：对已获取的公开 HTML，让现有 OpenAI-compatible 接口提出**声明式**列表/字段选择器，固定预算，离线回放验证，保存规则与来源片段。不得让模型每次刷新重写岗位事实，也不要直接执行模型生成的任意 JS/Python。字段从原文选择、数字来自原文，无法对应就 unknown。验证 schema 能返回结果只是第一步，还要区分正文、福利、公司介绍及分页覆盖。

## 4. changedetection.io：用户应看到变化与原因，不是一个绿色运行灯

官方入口：[仓库](https://github.com/dgtlmoon/changedetection.io)、[API 文档](https://changedetection.io/docs/api_v1/)。观察提交 `bbe02bb58de177f4c6afd61fa418921f2ff3164a`，许可证 [Apache-2.0](https://github.com/dgtlmoon/changedetection.io/blob/master/LICENSE)。

支持 HTTP 或浏览器监控、CSS/XPath/JSON 过滤和快照差异。当前 processor 先应用忽略规则再计算 checksum；过滤设置变化会影响配置签名；正文异常为空可抛错，而不是默认为变化成功。这些是实用的失败语义。[processor](https://github.com/dgtlmoon/changedetection.io/blob/bbe02bb58de177f4c6afd61fa418921f2ff3164a/changedetectionio/processors/text_json_diff/processor.py)

Watch 模型把最后查看与新快照区分，还区分实际抓取的 API URL 和给用户打开的页面 URL；当前模型明确仍与文件 JSON 存储耦合，不应当作现成 PG 监控服务嵌入。[Watch 实现](https://github.com/dgtlmoon/changedetection.io/blob/bbe02bb58de177f4c6afd61fa418921f2ff3164a/changedetectionio/model/Watch.py)

建议借其显示方式：每个来源显示上次成功、下次尝试、最近错误与重试状态；每条岗位展示变更字段和可回官方的链接。实际变化仍由 Aijob 稳定岗位 ID/语义版本来判定；导航栏、福利广告变化不应报新岗位。列表获取失败不能关闭岗位，选择器失效不能算官方零条。不要再运行一套独立 Watch 调度/快照数据库。

## 5. Crawlee 与 Scrapy：成熟执行器，不负责消除网站知识

### Crawlee

观察提交 `04ffaba30fb1cb2997e775454f150dd63a0878d8`，许可证 [Apache-2.0](https://github.com/apify/crawlee/blob/master/LICENSE.md)。当前 README 要求 Node 22.13+，浏览器模式额外依赖 Playwright/Puppeteer；HTTP 模式不需要为每个请求启动浏览器。[仓库](https://github.com/apify/crawlee)

其 `requestHandler` 仍由开发者定义提取逻辑；源码有有限重试、单次请求错误回调、最终失败回调、同域间隔和运行请求上限。默认请求存储为本地 memory-storage 的磁盘落盘；默认存储存在启动清空语义，恢复需显式配置。[BasicCrawler 实现](https://github.com/apify/crawlee/blob/04ffaba30fb1cb2997e775454f150dd63a0878d8/packages/basic-crawler/src/internals/basic-crawler.ts)、[请求存储文档](https://crawlee.dev/js/docs/guides/request-storage)

Aijob 已有 PG 队列、租约和 collector，无证据表明执行器吞吐是当前瓶颈；增加 Crawlee 无法自动得到 PortalId 或理解何处是职位正文。暂不迁移，仅保留作为浏览器池达到实际瓶颈后的候选。即便未来使用，PG 仍是任务真源，库内队列只限一项已授权任务内部，不能拥有独立业务调度；其反封禁卖点也不作为本项目采用理由。

### Scrapy

观察提交 `be7bdc4cd16644018fa56ef3503dce86744fa6d5`，许可证 [BSD-3-Clause](https://github.com/scrapy/scrapy/blob/master/LICENSE)。它是 Python 确定性抓取框架，Spider 的页面规则仍需维护。[仓库](https://github.com/scrapy/scrapy)

`JOBDIR` 保存单次 crawl 状态，文档明确正常停止后恢复、不同任务不能共用目录；scheduler 负责去重及内存/磁盘请求队列。RetryMiddleware 根据指定失败类型有限重试。[暂停恢复](https://docs.scrapy.org/en/latest/topics/jobs.html)、[scheduler](https://github.com/scrapy/scrapy/blob/be7bdc4cd16644018fa56ef3503dce86744fa6d5/scrapy/core/scheduler.py)、[retry](https://github.com/scrapy/scrapy/blob/be7bdc4cd16644018fa56ef3503dce86744fa6d5/scrapy/downloadermiddlewares/retry.py)

值得学习“请求成功不等于业务成功”和可恢复任务的明确边界；不建议在现有 TS collector 外增加 Python/Twisted 第二栈，更不应该把 JOBDIR 当作数据库级 fencing/事务语义。

## 6. Stagehand 与 browser-use：可作为来源维护工具，但不应主导每日刷新

Stagehand 观察提交 `f261c38b4dc50c39485f924e8599c1d3c6e37dc7`；browser-use 为 `c75e8476e26d18b7617643bc2ae082fae8eae431`。两者当前根许可证分别是 [MIT](https://github.com/browserbase/stagehand/blob/main/LICENSE)、[MIT](https://github.com/browser-use/browser-use/blob/main/LICENSE)；商用云浏览器另有服务条件，不能合并说“都免费”。

Stagehand 当前已进入 v4 文档/SDK，提供 `act/observe/extract`，本地 Chrome 可使用自带模型接口，schema 输出进行 Zod 校验。[本地 quickstart](https://github.com/browserbase/stagehand/blob/f261c38b4dc50c39485f924e8599c1d3c6e37dc7/packages/docs/v4/first-steps/quickstart.mdx)、[SDK 实现](https://github.com/browserbase/stagehand/blob/f261c38b4dc50c39485f924e8599c1d3c6e37dc7/packages/sdk-ts/src/stagehand.ts)。

一个容易误传的点：当前 `cacheService` 的该缓存路径是 Browserbase API 的服务端缓存，要 API key+session，缓存故障回到正常执行；不能据旧文章承诺“本地免费缓存自动解决所有模型费用”。[缓存实现](https://github.com/browserbase/stagehand/blob/f261c38b4dc50c39485f924e8599c1d3c6e37dc7/packages/extension/services/cacheService.ts)

browser-use 有最大步骤、连续失败停止和结构化输出能力；URL 安全 watchdog 支持域名范围，但未配置 allowed/prohibited domains 时允许全部 URL。这比 Aijob 的精确协议/主机/端口/路径/参数白名单宽，不能直接继承默认值。[Agent 主循环](https://github.com/browser-use/browser-use/blob/c75e8476e26d18b7617643bc2ae082fae8eae431/browser_use/agent/service.py)、[URL watchdog](https://github.com/browser-use/browser-use/blob/c75e8476e26d18b7617643bc2ae082fae8eae431/browser_use/browser/watchdogs/security_watchdog.py)

建议只借 `observe→候选动作→验证→固定配方` 的界面研究模式：首次遇到复杂公开招聘站时帮助维护者观察分页/接口，停止于登录、验证码或禁止访问；产出声明式规则后，后续由确定性 collector 刷新。不要把 agent 的 `done/success` 自述当作全量抓取证明，也不要每天从首页开始推理几十个动作。两项目“自动浏览器”能力本身并不提供企业归属证明、列表完备性、岗位关闭与来源公开准入。

## 7. Firecrawl：API 体验可借，整套运行成本不合当前目标

观察提交 `94ba4a3eb1ef71aae28f0635b453eef75f416001`。代码根 [AGPL-3.0](https://github.com/firecrawl/firecrawl/blob/main/LICENSE)，已核实 JavaScript SDK 单独 [MIT](https://github.com/firecrawl/firecrawl/blob/main/apps/js-sdk/LICENSE)。SDK 的许可不能替代自托管服务代码许可。[仓库](https://github.com/firecrawl/firecrawl)

现行自托管文档说明基础 scrape/crawl/map/search 可运行；高级 Fire-engine 不在默认栈；默认 fetch/Playwright 路径不支持其 screenshots/page actions，相关能力需额外服务。不要把官网 Cloud 的所有能力当成 clone 后即可用。[自托管支持矩阵](https://docs.firecrawl.dev/contributing/self-host)

实际 Compose 有 API、Playwright、Redis、RabbitMQ、PG，并包含实验 FoundationDB 路线；文档中的资源限额不是已验证的最低硬件需求。[部署文件](https://github.com/firecrawl/firecrawl/blob/94ba4a3eb1ef71aae28f0635b453eef75f416001/docker-compose.yaml)。这直接违背 Aijob 不新增 Redis/消息总线的本轮边界，用户配置只会更重。

值得参考的局部实现是确定性 JSON 提取：以 schema/prompt/model/version 等生成缓存标识，生成提取器后复用，运行失败尝试一次重新生成，再失败明确抛出；源码注释指出返回空形状会掩盖抓取失败。[deterministicJson](https://github.com/firecrawl/firecrawl/blob/94ba4a3eb1ef71aae28f0635b453eef75f416001/apps/api/src/lib/deterministicJson/extract.ts)。Aijob 可采用配方版本和显式错误思想，但无需采用对方动态生成代码执行机制；这里“确定性”也不能被理解成绝不再调用 LLM，源码仍支持 `askLlm`。

## 建议落成的 Aijob 来源产品设计

### 用户侧：配置方向后先获得已有供给

1. 第一次启动，选择“产品实习，上海/杭州”，看到已接入来源的当前岗位，以及清楚的来源覆盖说明。
2. “扩大机会来源”是独立可选能力，配置 Tavily 等搜索接口后发现新企业；模型配置用于辅助理解/配方研究，不能被包装为搜索 Key 的同义替代。
3. 列表把“岗位结果”和“正在接入的招聘网站”分开。用户不需要理解 PortalId、CSS selector、JSONPath、collector 或 reviewedHash。
4. 每日展示真实新增与重要变化；无结果时分清本方向暂无岗位、来源等待接入、服务未运行、搜索额度已用完。系统失败不能伪装成无机会。

### 维护侧：自动化承担重复工，人工承担首次启用

流程建议：`发现企业/官网线索 → 官网到招聘入口的可复核关联 → 识别已有 ATS/通用结构 → 实际试采 → 提取字段与覆盖结果 → 一次启用 → 正常自动刷新`。

| 站点类型 | 自动完成 | 维护者只需处理 | 不能宣称 |
|---|---|---|---|
| 已登记企业来源 | 直接按原周期刷新 | 异常后处理 | 所有新站也已支持 |
| 已支持 ATS 的新租户 | 从官方链接和 bootstrap 识别租户参数、填草案、有限试采 | 核对归属/政策/范围，明确首次启用 | 识别 ATS=已获公开资格 |
| 公开 RSS/JSON-LD/内嵌 JSON | 识别标准格式，提取候选字段，展示正文对照 | 正文不全或归属不明时纠正 | JSON-LD=字段一定准确 |
| 普通公开页面 | 固定成本观察 DOM/公开接口；模型辅助生成声明式配方；回放检验 | 分页/字段语义等具体失败 | 任意网站都能无人值守接入 |
| 登录/验证码/明确禁止 | 停止并记录具体状态，继续处理其他来源 | 必要时移除候选或等待政策变化 | 自动绕过、转截图规避 |

### 增量工程边界

- **复用现有源配置和安装服务**，在其上增加识别器与草案生成；不改成 GitHub/CSV 真源，不重做队列。
- 连接器模板由开发/维护者维护，租户实例只填已观察参数。模板带版本；一个厂商改版可以一次修复多个租户。范围扩大仍走原确认流程。
- 对模型建议保存输入材料摘要/定位、配方版本、原文取值位置、验证诊断与预算。模型生成可被拒绝；正文值只从官方材料提取。
- “试采成功”应表示有可解释的结果与覆盖状态：`complete / partial / explicit_empty / failed`。partial 不参与关闭判定，failed 不转换 empty；保持已有两次完整缺席规则。
- 任务仍在 PG 中持久化，交 collector 执行；match-worker 继续处理匹配/摘要。失败一个来源不阻塞另一个，重启后从已保存任务与预算恢复。
- 每日刷新不用 LLM；新配方生成与修复才受限调用。自动修复限次数，失败留上次成功结果并进入维护清单，不无限循环花钱。

### 最小有意义的检验

不做框架跑分和海量网站矩阵。选择一条已经支持的北森新租户，验证**全程无需 Codex 手写文件/临时脚本**，内部界面可完成识别、试采、确认、首刷；再用一份结构变化夹具和一份明确零结果夹具确认不同状态。用户侧正常 UI 完成首次启动、方向配置、读取岗位；重启后下一轮刷新恢复且不重复报新。未知网站的失败要解释清楚，不能为了演示把所有失败都归为“待人工”。

以上是建议验收方法，未在本次研究执行；也不表示可以取消 Aijob 已批准的来源访问与首次启用边界。

## 研究限制

- 所有源链接为官方仓库/官方文档；关键实现附锁定提交链接。默认分支、文档和搜索缓存可能更新不一致，记录的 SHA 来自研究时 GitHub API，未把发布时间或 star 作为质量证明。
- 未运行第三方代码，没有性能/成功率/中国站点覆盖率的实测结论。
- Job Seek 的 Moka、北森代码是实现参考；在 Aijob 中需经过自身网络策略、正文模型和实例试采，不能直接宣称兼容。
- 本次没有导入任何第三方岗位数据或路由，未改变现有岗位事实、准入、刷新或定时任务。
