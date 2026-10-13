# Aijob「简单配置后持续找岗位」：求职产品开源研究笔记

研究日期：2026-10-12 至 2026-10-13（北京时间跨日）。研究者：子任务 `research_job_products`。仅作设计参考，不修改 Aijob 业务代码，不安装或执行第三方项目，不访问用户 Key，不增加真实抓取。

## 一、最重要的判断

1. **需要产品化的是“来源接入和持续运行”，不是再接一个更强的模型。** 深读的项目都依赖提前维护的适配器、可配置的企业入口或某种固定外部目录。没有发现“普通用户只填任意 OpenAI 格式 Key，就能可信抓取任意中国招聘官网、覆盖翻页、判断关闭并长期自修复”的已证实方案。
2. **用户原来给的两个项目仍然有价值，而且 RecruitOps 当前版本比早期印象更贴近问题。** 它已经把开发者启动方式藏到 Windows 桌面入口后面，也把企业发现、入口识别、采集、JD 补全、评分、恢复拆开。ai-job-search 的价值是“求职意图→多种职位表达→确定工具执行→保留出处→岗位行动”的流程，不能把其 Claude Code 框架当成无需 Agent 的现成应用。
3. **最终建议不是拼接这些产品。** Aijob 保持当前 React/Vite、Fastify、PG 和三个服务权限边界；从三个来源各取一个明确能力：RecruitOps 的入口接入与断点责任，JobOps 的初次配置和来源目录，JobNavigator 的逐源状态表达。JobSpy、JobTrail、MR.Jobs主要用于确认边界和避免误判。
4. **“用户简单”与“来源必须有人维护”并不冲突。** 普通用户只需方向、城市、运行偏好；产品提供已维护来源。发现未知网站后，系统自动识别、试采、整理证据，少量未支持站点进入内部维护队列。不能把每家公司接口参数、robots判断或脚本修补交给求职用户。

## 二、检索范围与证据方法

从“本机求职产品”“官方企业招聘页监测”“多来源发现”“首次配置”“定时与重启恢复”“OpenAI 兼容接入”横向检索。候选不按 star 数排序，以是否解决 Aijob 当前人工介入点筛选。深读原指定 2 个项目，补充 5 个不同层次的项目，另外发现的 `colophon-group/jobseek` 已交由另一子任务做来源工程核对。`job-search-terminal`、`jobsearch-dashboard-ai`、`subraatakumar/job-search`只作检索候选，未深读的能力不列为已验证结论。

“确认”仅表示读到了对应源码、配置或官方说明；**不是本机运行、真实抓取成功或长期稳定性认证**。提交由 GitHub commits API 核对，下面均以固定 SHA 为快照。仓库 API 返回的许可只是辅助；JobOps 附加限制另读 LICENSE 原文。

| 项目 | 核对快照 | 定位 | 许可记录 |
|---|---|---|---|
| MadsLorentzen/ai-job-search | `a011214d60f943770e33f7d5f070e1a5f91e3822`，提交 2026-10-08 | Claude Code 求职工作流 + 门户 CLI | MIT |
| 849879772/recruitops-agent | `1584307eef66b7e3f839e55cd74dd7e12d7b876d`，提交 2026-10-07 | 中国校招桌面工作区 | MIT |
| DaKheera47/job-ops | `cb8803c0566a1d8ec789f1f1ecf121f58ac8b769`，提交 2026-10-06 | 自托管求职管线和工作区 | AGPLv3 **加 Commons Clause**；不能当作普通宽松许可库 |
| vesaias/JobNavigator | `cdc7273d4951fdda182a5c00598eb0995ec24708`，提交 2026-10-04 | 企业官网与招聘板发现、状态与准备工作区 | MIT |
| kaylaehman/jobtrail | `396a99d31a1bc09607b167ad3b4bdce7df2ad757`，提交 2026-06-16 | 手动发现、导入、申请跟踪 | MIT |
| humancto/mr-jobs | `8bd2ac4c01b2929c504dd5f25825cc9b33d1f60e`，提交 2026-04-03 | 自动发现/评分/填表的本机应用 | MIT |
| speedyapply/JobSpy | `b6eda4f35742a028685bec6a16ca47a6c5433605`，提交 2026-10-10 | 多综合招聘板 Python 抓取库 | MIT |

## 三、项目逐项分析

### 1. ai-job-search：借连续求职工作流，不能照搬运行形态

**实际用户流程。** 用户安装 Claude Code/Bun，复制仓库，通过 `/setup` 从资料或访谈建立个人背景和目标，再 `/scrape` 搜索，必要时 `/rank` 排序，最后 `/apply` 针对岗位准备材料。它没有等价于 Aijob 的常驻前后端服务；状态主要是文件、JSON 与 CSV。

**自动到了哪里。** `/scrape` 是给 Agent 的步骤规范：读取个人方向和历史，自动发现 `.agents/skills/*/SKILL.md`，调用已经安装的门户 CLI；缺 CLI 或运行失败时用 WebSearch；再获取详情、去重、记录首次看到时间及来源方式。现有 jobnet 的 TypeScript CLI 确实实现参数映射和固定 JSON 输出，说明不是全靠模型猜岗位。但这条流程需要外部 Agent 运行，未在所审文件中发现独立的长期调度守护程序。[scrape 工作流](https://github.com/MadsLorentzen/ai-job-search/blob/a011214d60f943770e33f7d5f070e1a5f91e3822/.claude/skills/job-scraper/SKILL.md)；[Jobnet 查询实现](https://github.com/MadsLorentzen/ai-job-search/blob/a011214d60f943770e33f7d5f070e1a5f91e3822/.agents/skills/jobnet-search/cli/src/commands/search.ts)。

**新网站不是自动拥有通用解析器。** `/add-portal` 引导 Agent 调查网站、找到 API/HTML 字段、生成新的技能及 CLI 文件，做一次真实搜索和详情读取，再注册。它把开发适配器的步骤写得很好，却仍要求 Agent 写代码；用它替代 Codex 临时辅助并没有消除维护需求。[add-portal](https://github.com/MadsLorentzen/ai-job-search/blob/a011214d60f943770e33f7d5f070e1a5f91e3822/.claude/commands/add-portal.md)。

**Key 与部署。** 主编排由 Claude Code 提供，CLI 本身多数直接读公开门户，不统一依赖 Tavily；WebSearch 属于客户端工具能力。不能推断换成任意 DeepSeek/OpenAI 兼容 Key 就可获得同样工具和权限。其 Python 检查脚本、Bun CLI、LaTeX 等依赖仍需要用户环境，不是直接安装即可使用的 Aijob 替代品。

**具体借鉴。** 方向应按职能组织多种同义岗位名称；来源失败不能中止其他来源；搜索索引线索和官网即时读取要分别留出处；first_seen 和 posted_date 分离；首轮不需要逐站额外健康探针，利用已经返回的数据观察字段缺失，疑似坏源才有限探测。[搜索策略](https://github.com/MadsLorentzen/ai-job-search/blob/a011214d60f943770e33f7d5f070e1a5f91e3822/.claude/skills/job-scraper/search-queries.md)。

**不借鉴。** 直接抓综合招聘板、自动语言/匹配门槛排除、任意新增脚本作为普通用户安装流程；其个人使用警告下继续处理部分访问限制的选择，也不能覆盖 Aijob 明确准入边界。

### 2. RecruitOps：中国官网接入与运行恢复最值得学习

**实际用户流程。** 当前 README 面向 Windows 普通用户提供桌面 ZIP，解压后运行唯一 EXE 入口，配置模型、个人简历关键词、行业，再触发全量抓取或定时任务。它包含 Electron 壳、FastAPI 与原生 Web UI、PostgreSQL、Playwright/Requests/BeautifulSoup。此处有打包与 supervisor 代码支持，不能仍描述为“只能启动多个开发服务”。但单入口不是单个无依赖文件；另一子任务核对 release 中 ZIP 约 739 MB，安装包/签名与干净机体验未在本次实测。[README](https://github.com/849879772/recruitops-agent/blob/1584307eef66b7e3f839e55cd74dd7e12d7b876d/README.md)；[打包入口](https://github.com/849879772/recruitops-agent/blob/1584307eef66b7e3f839e55cd74dd7e12d7b876d/apps/desktop/src/packaged-runtime.ts)。

**它实际怎样找企业。** 当前活跃企业目录发现只使用 OfferBiu，不是 DeepSeek 全网任意探索。`offerbiu_refresh.py` 有固定公共 API、分页、预算、Retry-After、断点、字段与总数一致性检查；代码里还固定了 2027 秋招范围。企业线索随后进入官方网站入口路由。[发现实现](https://github.com/849879772/recruitops-agent/blob/1584307eef66b7e3f839e55cd74dd7e12d7b876d/packages/discovery/offerbiu_refresh.py)。

**新网站接入自动化的实质。** `entry_crawl.py` 先诊断已有适配器，HTTP 读取门户真实链接，必要时浏览器渲染，只返回观察到且已有适配器支持的入口；不会凭空合成链接。对已知适配器变种失败、未知站待适配、需继续发现入口分别报错。官方明确总数为零且翻页完结才记 `activity_empty`。这是 Aijob 目前“哈啰 URL/PortalId 等参数靠人工补齐”的直接参考：已知 ATS 的识别、入口提取、模板实例化应成为产品代码。[入口发现与路由](https://github.com/849879772/recruitops-agent/blob/1584307eef66b7e3f839e55cd74dd7e12d7b876d/packages/recruitment_core/entry_crawl.py)。

**持续运行。** 文档明确 `crawl_only` 不调用模型，`score_only` 只用已有 JD，`resume` 恢复被冻结的公司范围和完成进度；评分失败不回退重抓 JD。API 启动把中断运行标为可恢复，不能一直转圈或假装成功。`LocalTaskScheduler` 有本机锁、有限重试和任务超时，`company_checkpoint.py` 对完整公司工作持久化收据。[流程与恢复契约](https://github.com/849879772/recruitops-agent/blob/1584307eef66b7e3f839e55cd74dd7e12d7b876d/docs/crawling_process.md)；[调度实现](https://github.com/849879772/recruitops-agent/blob/1584307eef66b7e3f839e55cd74dd7e12d7b876d/packages/scheduler/runner.py)。

**适配 Aijob 的取舍。** 借启动生命周期、逐公司进度、入口→列表→详情→模型分离、错误具体化、可恢复检查点。不搬 Electron 全壳、邮箱、自动填表、数十个适配器全家桶；不搬“默认排除实习”或固定毕业年份；不能照搬其只接受 DeepSeek 官方的模型限制。Aijob 仍需 OpenAI 兼容接口和真实实习方向。

**文档冲突。** `docs/LOCAL_CONFIGURATION.md` 仍有更早的可编辑基础地址及未制分发包叙述，与当前 README 有差异。运行/配置结论以现行实现和 release 为依据，不拼成一份不存在的理想功能集。

### 3. JobOps：最可借的是“可完成的配置向导”和可维护来源目录

**用户流程。** Docker Compose 启动一个容器，浏览器完成模型、个人偏好、简历的配置；之后选择搜索源和条件，管线执行发现→导入→评分→准备，用户自行投递。当前代码是 React 18/Vite + Express/TypeScript，SQLite/Drizzle，并非只凭仓库 topic 就称 Next.js。[实际依赖](https://github.com/DaKheera47/job-ops/blob/cb8803c0566a1d8ec789f1f1ecf121f58ac8b769/orchestrator/package.json)；[Compose](https://github.com/DaKheera47/job-ops/blob/cb8803c0566a1d8ec789f1f1ecf121f58ac8b769/docker-compose.yml)。

**配置不只是保存表单。** 后端 `onboarding-status.ts` 为每项返回 `ready/needs_action/invalid/checking_unavailable` 和下一操作；能区分未配置、无效和暂时连接不上，支持 OpenAI-compatible base URL/Key 等。前端保存成功后清空 Key 输入，并刷新配置状态。借这种“选供应商→测试该能力→保存→下一步”交互，Aijob 用户就不必理解 JSON 模式、协议细节和每任务参数。[后端状态](https://github.com/DaKheera47/job-ops/blob/cb8803c0566a1d8ec789f1f1ecf121f58ac8b769/orchestrator/src/server/services/onboarding-status.ts)；[向导前端](https://github.com/DaKheera47/job-ops/blob/cb8803c0566a1d8ec789f1f1ecf121f58ac8b769/orchestrator/src/client/pages/onboarding/useOnboardingFlow.ts)。

**来源与自动化边界。** Watchlist 让用户从维护好的企业目录选择，也可粘贴适配器支持的公共招聘页 URL；首次成功获取建立基线，后续才显示新岗位。保留 ignored 和已入工作区的状态，以原生岗位 ID 去重。官方说明明确“重新打开 Watchlist 时重新检查”不等于互联网后台监控；当前代码已将 Watchlist 接入 pipeline，但不能因此宣称所有 Watchlist 都在后台定时刷新。[Watchlist 说明](https://github.com/DaKheera47/job-ops/blob/cb8803c0566a1d8ec789f1f1ecf121f58ac8b769/docs-site/docs/features/watchlist.md)；[管线接入](https://github.com/DaKheera47/job-ops/blob/cb8803c0566a1d8ec789f1f1ecf121f58ac8b769/orchestrator/src/server/pipeline/steps/watchlist-jobs.ts)。

**发现的一处落差。** 文档仍写 Workday/BambooHR 两种，当前 registry 已列 Workday/BambooHR/Greenhouse 三种。因此写“实际代码注册三种”比照搬官网数字准确。通用来源是维护者发布 adapter manifest，不是用户填个地址就任何站都能读。[适配器 registry](https://github.com/DaKheera47/job-ops/blob/cb8803c0566a1d8ec789f1f1ecf121f58ac8b769/orchestrator/src/server/watchlist/adapters/index.ts)；[extractor registry](https://github.com/DaKheera47/job-ops/blob/cb8803c0566a1d8ec789f1f1ecf121f58ac8b769/orchestrator/src/server/extractors/registry.ts)。

**只借设计，不直接合入代码。** 已知来源目录、逐源能力标记、配置分步状态、首次基线、单源失败仍汇总其余成果均有价值。Aijob 不照搬首次找岗位必须先完成模型和简历的门槛，不搬综合招聘板、签证系统和所有设计功能。其 LICENSE 有 Commons Clause 商业限制，设计参考与拷贝复用必须区分。[许可原文](https://github.com/DaKheera47/job-ops/blob/cb8803c0566a1d8ec789f1f1ecf121f58ac8b769/LICENSE)。

### 4. JobNavigator：最贴近“粘贴企业官网→自动识别→知道哪里出错”

**用户流程和架构。** Docker 运行 PostgreSQL、FastAPI 后端、React/Vite 前端和 Caddy；用户配置 AI、简历、Company 或 Search，再运行与计划抓取。企业表单输入公共招聘页 URL 即显示 ATS 类型，不要求普通用户先挑 parser；代码 `detect_scrape_type` 只是 URL 规则判断，不应把标签当采集成功证据。[公司 UI](https://github.com/vesaias/JobNavigator/blob/cdc7273d4951fdda182a5c00598eb0995ec24708/frontend/src/screens/Companies.jsx)；[公司 API](https://github.com/vesaias/JobNavigator/blob/cdc7273d4951fdda182a5c00598eb0995ec24708/backend/api/routes_companies.py)。

**确认的采集实现。** `_dispatch_ats` 按来源选择 Workday、Lever、Ashby、Greenhouse、Oracle、Phenom 等具体模块；纯 API 源不用启动浏览器，未知页走 CSS 选择器通用浏览器路径。通用路径有分页与默认页数上限，不能把“有 fallback”解释成“任意官网完整覆盖”。每家公司独立入库、记 `ScrapeLog`，成功/警告/失败分别显示。[调度不同 ATS](https://github.com/vesaias/JobNavigator/blob/cdc7273d4951fdda182a5c00598eb0995ec24708/backend/scraper/sources/company_pages.py)；[generic fallback](https://github.com/vesaias/JobNavigator/blob/cdc7273d4951fdda182a5c00598eb0995ec24708/backend/scraper/ats/generic.py)。

**持续运行。** APScheduler 从数据库读取 interval/cron 设置，配置错误只禁用对应任务；运行监测有公司作用域，防重复点击，保存完成摘要。启动时会把旧 running 记录标失败，表示进程重启，**不是恢复到岗位游标继续**。由此可借“进度诚实可见”，但 Aijob 原有 PG 任务租约/检查点应保留，不退化为进程内调度。[调度](https://github.com/vesaias/JobNavigator/blob/cdc7273d4951fdda182a5c00598eb0995ec24708/backend/scheduler.py)；[运行状态](https://github.com/vesaias/JobNavigator/blob/cdc7273d4951fdda182a5c00598eb0995ec24708/backend/job_monitor.py)。

**借鉴与舍弃。** 借来源行上的最近成功、下一运行、具体失败、暂停状态和少量有效结果；借 API 优先、必要时才浏览器、单源隔离。其主要 ATS 是国外生态，不能声称覆盖中国北森/Moka等；其 LinkedIn 登录会话、自动填表、邮件及 iframe 绕过式预览不是 Aijob 本轮目标。AI 用来分析/准备，已适配源读取本身不应强制依赖 AI。

### 5. JobTrail：足够简单的发现→保存 UI，不是自动来源系统

React/Vite 前端、NestJS 后端、PostgreSQL/Prisma，加 FastAPI JobSpy sidecar。用户填写关键词/位置发起搜索，结果经短期 TTL 缓存，选择单条 Import 后才调用 `upsertFromSource` 保存为 saved；来源公司信息另外整理。**存在公司的定时 enrichment 不等于岗位自动发现调度**；所审发现链路是手动触发，没有确认持续订阅或官网生命周期。[发现页](https://github.com/kaylaehman/jobtrail/blob/396a99d31a1bc09607b167ad3b4bdce7df2ad757/frontend/src/pages/Discover.tsx)；[后端 search/import](https://github.com/kaylaehman/jobtrail/blob/396a99d31a1bc09607b167ad3b4bdce7df2ad757/backend/src/discover/discover.service.ts)；[JobSpy sidecar](https://github.com/kaylaehman/jobtrail/blob/396a99d31a1bc09607b167ad3b4bdce7df2ad757/jobspy-service/main.py)。

这条发现链不需模型或搜索 API Key，原因是直接抓已支持的综合招聘板，不是“模型免费联网”。可借搜索条件少、结果与已保存状态分离、点击导入幂等。不可借其 JobSpy 来源作为 Aijob 官方事实真源；页面失败提示让用户查看后端日志，也不符合 coco 的最终易用性目标。

### 6. MR.Jobs：有向导和定时，但宣传强于部分实现

浏览器向导写 `profile.yaml`；FastAPI/Jinja/静态 JS + SQLite，APScheduler 自动发现默认每 6 小时、评分默认每 30 分钟。`scheduled_discover` 调多源函数后去重写入，`scheduled_score` 再处理未评分记录，体现了获取与模型分析分开。[向导 API](https://github.com/humancto/mr-jobs/blob/8bd2ac4c01b2929c504dd5f25825cc9b33d1f60e/dashboard/server.py)；[scheduler](https://github.com/humancto/mr-jobs/blob/8bd2ac4c01b2929c504dd5f25825cc9b33d1f60e/scheduler.py)。

但有两个不能当成已实现优势的点：

- README 宣称多模型可替换，`utils/llm.py` 的 `_BACKENDS` 实际只有 `claude_cli`；未知配置会回退到 Claude CLI。不能据此宣称已经支持所有 OpenAI/Ollama 接口。[模型实际实现](https://github.com/humancto/mr-jobs/blob/8bd2ac4c01b2929c504dd5f25825cc9b33d1f60e/utils/llm.py)。
- “任意公司 career page”实际是 Playwright 抓页面链接，最多提取 100 个、送 50 个给 Claude，模型返回标题/URL/城市/公司，构造 Job 时 `description` 为空。没有在这一模块看到完整详情、可靠翻页和关闭监控。因此它可以是发现线索，不是 Aijob 可信岗位入库器。[任意官网实现](https://github.com/humancto/mr-jobs/blob/8bd2ac4c01b2929c504dd5f25825cc9b33d1f60e/utils/career_page_source.py)。

Greenhouse/Lever 固定公司 slug 路径是真 API；其他源含 JobSpy、RSS、Adzuna 等。可借“向导直接写正常运行配置”“发现和评分各自节奏”；不借每条都模型打百分比分数、任意官网猜测当事实、自动填表/投递。没有理由为这一点引入其整套 Python 栈。

### 7. JobSpy：采集库可研究，不能当求职产品底座

`scrape_jobs()` 把来源映射到不同 scraper，用 ThreadPoolExecutor 并发读取，再返回 pandas DataFrame。它没有应用数据库、首次配置向导、后台恢复、每日摘要或“新增/变化/关闭”的产品语义。参数可表达关键词、位置、岗位类型、时间和详情读取，但底层是 LinkedIn/Indeed/Glassdoor/ZipRecruiter 等综合招聘板。[核心函数](https://github.com/speedyapply/JobSpy/blob/b6eda4f35742a028685bec6a16ca47a6c5433605/jobspy/__init__.py)。

不需要 Tavily/LLM Key 是直接门户访问的结果，不是网页自动化天然稳定。项目 README 本身记录各源限制和 429，包含代理规避封锁建议；Aijob 不采用这些绕过方式。可借各来源统一输出、空字段保持空、语义正常化；直接引入这套 Python 库不解决中国官方企业范围和来源准入，故本轮不建议接入。[项目说明](https://github.com/speedyapply/JobSpy/blob/b6eda4f35742a028685bec6a16ca47a6c5433605/README.md)。

## 四、对 Aijob 的具体设计推导

以下是结合代码阅读提出的建议，不是上述项目的现成功能宣称。

### 普通用户只负责三件事

1. 设置目标：产品实习，上海/杭州；首次立即展示已经维护的来源里可用的当前岗位，不先要求填简历和模型 Key。
2. 选择后台节奏：默认每天；界面写清上次结果与下次执行。关机暂停，重启恢复；新网站搜索没配置只影响覆盖扩展，不能让现有来源刷新失效。
3. 按需开增强：一个页面里配置“找新网站”与“AI分析/写作”，名称和作用明确。推荐预设隐藏协议/JSON格式等低层项，兼容接口保留高级输入；验证失败说明下一步，不能只说去看日志。

### 系统维护者负责让来源成为可复用产品能力

来源状态应最少分为：发现线索 → 识别官网及招聘入口 → 已支持 ATS 自动填参并试采 → 需要维护/等待首次启用 → 正常刷新/暂时失败/暂停。用户首页看“已获得几条岗位、覆盖了哪些公司、哪些来源暂不可用”，内部台看 PortalId、配置hash、分页和政策证据。两者不是两个抓取系统，共用已有任务和来源记录。

已支持 ATS 需要的是有限、确定的 **URL识别与参数提取器**，不是每次让大模型重写 scraper。一次站点参数成功识别后注册成固定配置，以后无模型重复刷新。未知站点可由模型协助标出页面区块和候选接口，但不能直接写任意脚本进运行进程，也不能跳过事实完整性和首次准入。将人工修补结果沉淀到版本化适配器，才能真正减少下一位用户的配置成本。

来源维护队列必须有价值优先级：当前用户方向匹配、官方身份已确认、已有适配器可接、近期待抓岗位线索明确的企业优先。不要仅按搜索排名或“发现了多少网站”排队，也不要求用户逐家公司批准技术配置。

### 要落地的不是“更多抓取”，而是首用完成率

一次必要验收：在空用户配置中通过正常产品入口创建方向，从维护好的来源拿到当前岗位；有搜索 Key 时自动发现一条线索并说明其接入状态；暂停/恢复或应用重启后任务继续；一次来源失败不冒充零岗位或覆盖其他成功结果。验收不需要一口气适配几十站，也无需多天矩阵。

**Aijob 必须保持较现状更好的部分。** PG唯一真源、完整覆盖下的两次缺席关闭、配对岗位版本、用户收藏/投递历史、来源访问边界，不应因为某个开源项目“更简单”就删掉。借鉴的目的，是让用户不用知道这些实现细节，同时保留可靠结果。

## 五、建议采用 / 不采用的清单

| 决策 | 依据 | 对用户的实际收益 |
|---|---|---|
| 采用唯一启动入口与就绪提示 | RecruitOps supervisor/桌面入口 | 用户不用启动五六个服务 |
| 采用按能力判定的配置向导 | JobOps onboarding 状态 | 明确下一步，Key连接失败不阻断其他能力 |
| 采用维护好的官方来源目录 | JobOps curated watchlist；RecruitOps固定适配器 | 首次有真实岗位，不要求用户研究企业接口 |
| 采用已知ATS自动识别/配置 | RecruitOps entry routing；JobNavigator dispatch | 哈啰类接入不再依赖临时脚本 |
| 采用首次基线和逐源结果 | JobOps baseline；JobNavigator ScrapeLog | “当前机会”和“新增”准确，失败原因可理解 |
| 保留 Aijob 原PG任务和准入边界 | 本项目现有契约更合适 | 不因引入框架造成权限和状态退步 |
| 不接 JobSpy 作为核心源 | 综合招聘板与 Aijob 事实源边界不符 | 避免数据来源不可信和范围漂移 |
| 不接整套 Agent 框架替代采集 | ai-job-search仍需Agent写代码；MR.Jobs抽取不完整 | 降低模型依赖与不可预期运行 |
| 不把“有通用fallback”写成“任意官网可抓” | JobNavigator有页数上限；MR.Jobs只读部分链接 | 宣称与实际能力相符 |
| 不增加邮箱/自动投递/主题数量 | 不解决本轮核心故障 | 保持产品聚焦 |

这份比较支持的下一步是：**先产品化启动、配置、已有官方供给和支持ATS的接入，再扩覆盖；不是先扩项目依赖或加入更多Agent。**
