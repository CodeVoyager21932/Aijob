# U6 运行、队列与导出继续验收

日期：2026-09-08。承接 [U0–U6 体验升级](../experience-upgrade-2026-09-07/README.md)，仍在 `C:\Users\72998\Projects\Aijob` 开发。没有重新恢复业务、改动旧 OS-7、迁移业务数据库或启用真实采集。业务库保持061，容器保持停止。本记录只补充本轮实际完成的检查，整体发布仍未完成。

后续继续见[查询与持续队列验收](../query-endurance-2026-09-08/README.md)。本页数字保留原测量条件，不提供最新任务。

## 交付与修复

| 范围 | 变化及意义 | 依据 |
|---|---|---|
| Contract | 产品范围、BYOK 与直接导入规则不变；没有新增用户确认步骤 | ADR-0038、已批准修正版 |
| Database / Platform | 任务领取 SQL 增加 `LIMIT 1`，避免一次领取锁住全部候选；已中止的 worker 不再消耗尝试次数 | 真 PostgreSQL 阻塞触发器复现：修复前失败，修复后第二个 worker 可同时领取另一个任务 |
| Database / Platform | 筛选项先按岗位去重再计数；图谱语义行只带聚合实际使用的字段 | 当前查询、资格撤回/缓存/原句/个人隔离回归及 HTTP 测量 |
| Web / Export | 修复 Linux PDF 的普通汉字变兼容部首、邮箱 `fi` 变连字的问题；不改用户正文 | 修复前16份失败原样保留；新字体、版式及独立解析检查见下方 |
| Integrated | 真实调度器同时处理助手、解析、删除；发布镜像构建及静态路由冒烟 | 专属合成库、无外部模型或招聘站请求 |

任务领取问题由测试中的临时数据库触发器稳定复现：第一条任务更新被锁住时，第二个 worker 必须能领取另一条。旧查询的 `executeTakeFirst()` 只在客户端取第一行，SQL 没有限制候选数。修复保留租约、幂等、fencing、失败隔离及原有2个交互/1个解析/1个后台执行通道。

## 性能：1万岗位、50并发

[完整 HTTP 记录](performance-10000-50.json)。环境为 i5-12500H、16逻辑核、16.8GB主机内存、Windows Node22.16、Docker PostgreSQL16.15，每权限边界连接池10。101家合成企业，一家占40%岗位，20%未知地点、10%未解析、6种方向；批量岗位使用较短JD及空旧要求集合，不能代替复杂真实分布。与上一轮保持同一测量路径。

| 指标 | 本轮 | 上一轮仅作比较 |
|---|---:|---:|
| 热目录 p95 | 286ms | 348ms |
| 热图谱 p95 | 291ms | 342ms |
| 后台并行目录 p95 | 574ms | 754ms |
| 后台并行图谱 p95 | 608ms | 901ms |
| Case写入 p95 | 880ms | 1367ms |
| 首次无筛选目录 | 2402ms | 2114ms |
| 首次图谱 | 1208ms | 1467ms |

1000/1000 HTTP请求完成、0错误，2个后台任务成功；后台包含目录重新物化和真实 PDF 生成/解析。**首次无筛选目录仍超过2秒；后台并行的两项p95仍超过500ms。** 热缓存达标不能掩盖这些缺口。首次结果包含旧全目录基线调用后的进程状态，不把单条 SQL 的 EXPLAIN 时间冒充首次页面响应。

[查询诊断](aggregate-variants.json)显示缩小图谱聚合字段和调整筛选去重减少了数据库工作；[未采用的查询变化](query-variants.json)仍保留。10万/100本轮没有重测，上一轮的未完成请求和容量限制继续有效，不宣称新版本已通过。

## 助手与解析队列

[队列记录](owner-queue.json)来自实际调度器、BYOK协议服务、PostgreSQL、PDF解析及账户删除。20个合成用户，24秒内每400ms提交一次，共60次；模拟供应商通常250ms，每第10次2000ms，另设一个15秒请求供取消验证。真实模型调用数为0。

- 助手60/60完成、失败0、遗留任务0；8/8 PDF导入完成。
- 排队至模型开始 p95 172ms；从提交到观察到完成 p95 2271ms，包含模拟模型延迟及250ms完成轮询延迟。
- 进程峰值RSS约214MiB。删除请求后193ms中止进行中的模拟请求，账户已删除、相关对话剩余0。
- 所有时长均由同一进程 `performance.now()` 测量；数据库时间戳只作诊断。

初版使用主机开始时间减数据库完成时间，出现跨时钟偏差。该版完整保留于 [不采纳的旧计时](owner-queue-crossclock-notaccepted.json)，不使用其端到端数字。修正后在新的空合成数据库重测；不是用修改旧JSON的方式修正结论。

这是短时持续到达测试，**没有验证数小时稳定性、慢供应商持续饱和、真实模型质量或生产费用**。初始8个解析任务仍使用Windows合成PDF；Linux输出的真实容器解析另行核验。

## Linux 输出与运行包

原始 Noto CJK OTF 的首次16份导出在外观正常的情况下全部未通过文本检查，保留于 [修复前](linux-export-before-font-fix/verification.json)。当前 `infra/runtime/font.py` 仅去除映射到同一字形的冗余兼容别名、禁用可选连字，并将改造字体重命名为 Aijob Sans/Serif CJK；保留版权、许可证、源文件和输出散列，不修改简历内容。

依据：[Noto CJK上游](https://github.com/notofonts/noto-cjk)、[fontTools TTFont](https://fonttools.readthedocs.io/en/latest/ttLib/ttFont.html)。这是针对本机 Linux Chromium 的实测修复，不声称所有系统/阅读器的兼容性都已经验证。

最终版式、可复制文本、原始邮箱、链接、75条多页记录、独立容器解析及镜像信息在本目录对应 JSON 中记录。`pypdf` 会在 Type3 英文字符间推测空格，其检查使用紧凑文本；独立的实际 PDF.js 解析另要求邮箱原样连续存在，不能用去空格掩盖实际导入问题。

[最终16份PDF](linux-export/verification.json)全部通过；[固定digest容器解析](linux-export/parser-verification.json)完成16份PDF和1份75条长DOCX读回，每份邮箱原样保留、无新增兼容部首/连字；损坏PDF按解析失败拒绝。PDF解析约3.25–5.68秒，DOCX约1.57秒，均在原10秒上限内。字体[来源散列](linux-export/font-provenance.json)及[许可证](linux-export/LICENSE-Noto.txt)随证据保留。

对衬线首页、长双栏第2页和明确分页第3页进行了渲染目视检查，中文清楚，无重叠或裁切；未逐页人工检查全部文档。最终生成耗时约6.9–13.9秒/份，运行在2CPU/2GB容器内，不能算作交互首屏时间。

[完整验收账目](verification.json)及[三个镜像digest](images.json)可逐项核对。PostgreSQL专项两批26项/5项通过，最后并发1项复验通过；这些批次有重复，不累加为独立测试总数。平台类型检查、全仓error级lint和Linux全仓构建通过。此前全仓883项测试属于上一批记录，本次没有重新运行并冒称全量通过。

候选源码包位于 `.data/releases/runtime-20260908-v2/`，清单与归档逐文件散列校验另存于该目录；原候选保留。包排除业务数据、真实环境、密钥、依赖及二进制图片/PDF/DOCX证据，仍需重新构建。镜像只在本机构建，未推送远端或部署。

静态 web 镜像已验证简历、API设置、材料、面试的深链接返回应用根页面；未配置 API 代理时 `/v1/jobs` 返回503符合该镜像设置。这只是静态容器检查，不是已部署完整服务。

## 复现入口与限制

只使用显式命名的本机测试数据库。目录/队列脚本拒绝业务库；队列脚本要求新建空库，不能对已有数据执行重置。命令从项目根目录执行，变量使用本地夹具值；不加载业务 `.env` 或真实用户密钥。

```powershell
# 设置 AIJOB_TEST_DATABASE_URL 为独立测试库后运行 PostgreSQL 专项
pnpm --filter @aijob/platform exec vitest run src/workers/owner-task-concurrency.integration.test.ts --no-file-parallelism

# 队列：设置 AIJOB_BENCH_DATABASE_URL，数据库名必须含 queue_benchmark_test
pnpm --filter @aijob/platform exec tsx src/performance/owner-queue.ts

# 目录：设置 AIJOB_BENCH_DATABASE_URL，数据库名必须含 benchmark_test
# AIJOB_BENCH_JOBS=10000、AIJOB_BENCH_CONCURRENCY=50；复用夹具需显式 REUSE_FIXTURE=1
# PDF并行检查还需 AIJOB_TEST_BROWSER_EXECUTABLE / AIJOB_TEST_PDF_FONT
pnpm --filter @aijob/platform exec tsx src/performance/product-core.ts

docker build -f infra/runtime/Dockerfile --target platform -t aijob-platform:runtime-20260908-v2 .
docker build -f infra/runtime/Dockerfile --target resume-parser -t aijob-resume-parser:runtime-20260908-v2 .
docker build -f infra/runtime/Dockerfile --target web -t aijob-web:runtime-20260908-v2 .

# 设置 AIJOB_PARSER_TEST_IMAGE 为已构建的固定digest、AIJOB_EXPORT_TEST_DIRECTORY为合成输出目录
pnpm --filter @aijob/platform exec tsx ../../infra/runtime/verify-container-parser.mts
```

Linux生成脚本为 [generate-fixtures.mts](linux-export/generate-fixtures.mts)，在 platform 镜像内执行。只读根文件系统、非root、全部capabilities移除、no-new-privileges、Chromium seccomp、2CPU/2GB、shm256MiB、tmpfs512MiB；浏览器sandbox开启。挂载的 `/evidence` 只含合成材料，数据库网络仅连专属测试容器；页面渲染禁止外网。解析使用固定digest的独立容器：network none、只读、256MiB、0.5CPU、10秒上限。

## 尚未完成的发布条件

1. 无筛选首次目录和后台并行性能继续优化；长会话及数小时负载尚未验收。
2. 实体手机软键盘、部署主机上的rootless解析权限、HTTPS及真实SMTP仍需检查。
3. 用户自带API的五类真实输出质量未验收，平台继续不提供模型。
4. 来源准入、真实连续刷新和自动化比例未验收；公开目录仍0。不得用离线夹具替代真实来源记录。

本轮不新增功能清单，不重新实施 OS-7 或业务恢复。接续任务继续围绕已有主体的实际运行缺口。
