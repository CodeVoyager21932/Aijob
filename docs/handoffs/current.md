# 当前项目交接：G2 首轮自动刷新运行，随后继续批次 07-04

> 交接日期：2026-08-02
>
> 当前主线：`main`（PR #2 已合并；后续工作从最新 `origin/main` 新建 `codex/` 分支）
>
> 动态事实源：[MVP 路线与当前决策面板](../06-mvp-roadmap.md)
>
> 工程与发现证据：[G2 终局重新验收报告](../evidence/g2/g2-reacceptance-2026-07-30.md)、[自动刷新首轮扩展观察](../evidence/ingestion/source-refresh-first-rollout-observation-2026-08-02.md)、[空库恢复演练](../evidence/g2/local-bootstrap-drill-2026-07-30.md)、[供给检查点](../evidence/g2/supply-checkpoint-2026-07-30.md)、[G2 收束执行计划](../plans/g2-closeout-plan-2026-07-26.md)

## 1. 当前唯一目标

coco 已在 P7 终局判定中选择继续扩容，并通过 ADR-0025 把企业目标从 20–30 家调整为 30–40 家；300–500 条可见岗位、SME 企业 60% 和 SME 岗位 50% 保持不变。批次 07-03 已完成；为避免继续依赖维护者逐家重跑，coco 又批准了 [ADR-0026](../decisions/0026-local-automatic-source-refresh.md)。三来源真实灰度已经通过，其余 18 个活动确定性来源也已显式启用并分散排期；首轮扩展中的神谷、帆软、普渡、寒序、鲸驰与慧策已自动接受，目录现为 202 有效总供给、136 可见、23 家企业，SME 为 7/23 家与 22/136 岗位。**当前唯一目标是继续完成首轮扩展排期；来源级失败继续隔离，运行稳定后按冻结排序规则继续批次 07-04。** 企业达到 40 家立即停止；产品证据保持 `E0`，G0/G1 暂停。

2026-07-26 coco 作出四项决定并已全部执行：

1. **审批包 02 修订为纯 SME 版并批准**（硕方、鲸驰寰宇、神谷文化、红海云、鹏扶，米哈游移入批次 05）。执行结果：4 家完成核验、契约冻结、真实低频探测与首批导入（硕方 5、其余各 1，全部 0 拒绝、重复探测幂等不触网）；**鹏扶按预设暂停**——页面主体为上海鹏扶投资管理有限公司（台账误记法人名），同页两个投递邮箱域名 `pengfu.tech`/`pengfu.fund` 均无主体证据且互相矛盾。
2. **方案 A 落地为 [ADR-0021](../decisions/0021-compress-large-company-quota-and-publish-sme-gap.md)**：无 `small/medium` 规模证据企业单家目录配额压缩至 10 条（有证据企业维持 30），择优保留 ADR-0020 双优先轨道，缺口公开分母。迁移 016 建立确定性配额选择表，物化择优、目录/洞察读取过滤与 `/v1/jobs` `companyQuotaGaps` 已上线；普渡 30→10、慧策 30→10、帆软 18→10、腾讯 14→10，共压缩 52 条（版本与修订历史完整保留）。
3. **千寻智能/万境千寻人工快照批次执行**：两条台账记录实为同品牌（Spirit AI），合并为单一来源 `spirit-ai-feishu-manual`（飞书 ATS 站点主体千寻智能（杭州）科技有限公司，目录展示品牌名"千寻智能"）。按 ADR-0016 人工浏览器读取职位列表第一页 10 岗（页面自身调用的公开接口响应），7 条含完整职责与任职要求进入零网络快照导入（`request_count=0`、重放幂等）；3 条无任职要求正文的岗位按最低字段要求排除留痕。
4. **放弃窗口 ≤6 天的 5 家**（壳牌、恒丰、开源证券、汉腾、巨一）。

2026-07-26 深夜，coco 进一步批准 [ADR-0022](../decisions/0022-plan-batch-preauthorization-and-delegated-spot-checks.md)：批次 03–06 按计划预授权，抽检由执行方自检自审并逐批留档；鹏扶不补位。coco 不再逐批审批或审阅报告，唯一保留的人工卡点为 P7 G2 终局判定。

2026-07-29，P0 已按该治理口径完成：台账事实已修正；批次 02 的 15 条岗位由执行方逐条自审，15/15 通过；硕方扩至 6 条；千寻前三页公开列表共 30 条，按“实习 + 职责与任职要求均完整”纳入 22 条，排除 4 条缺字段实习与 4 条正式岗位；目录物化为总供给 177、可见 113、15 家企业。

同日完成 [R1 架构与组件系统性审视](../evidence/r1/architecture-review-2026-07-29.md)：直接修复 owner task 过期租约与最大尝试、删除事务旧任务冻结、24 小时删除回执、Problem Details 媒体类型、browser-only 双重拒绝、特殊用途 IP、绝对超时和物理请求预算；运行时/数据库角色边界与来源 descriptor/run mode 仅形成 [ADR-0023](../decisions/0023-enforce-runtime-and-database-role-boundaries.md)、[ADR-0024](../decisions/0024-unify-source-adapter-descriptors-and-run-modes.md) 提案。R1 未访问真实来源、未改变产品边界、未进入 R2 或后续来源批次。

同日 coco 审核通过 [R2 UI/UX 视觉方向](../plans/r2-ui-ux-reference-direction-2026-07-29.md)，R2 随后正式启动并完成。执行方保存七个正式页面 1280 基线，建立独立“向阳生长”产品作用域和米白/群青/杏黄/竹青/朱橙 token，完成 `/jobs` 高保真切片、岗位详情证据阅读以及简历/推荐/洞察/优化/数据控制的共享视觉推广。中文编辑式首屏、方向快捷筛选、配额旁注、单列岗位比较、100→113 条明确后续加载、次级安全状态和真实 320px 结构均已通过浏览器检查；未来手机端所需 token、语义顺序和 Grid/Flex 重排能力保留。详情见 [R2 `jobs` 实施记录](../evidence/r2/jobs-high-fidelity-slice-2026-07-29.md)与 [R2 收口记录](../evidence/r2/ui-ux-closeout-2026-07-29.md)。

关键核验事实（批次 02）：

- 硕方：南开实习信息栏目 6 页同企业详情（116235–116240）；发布主体北京硕方信息技术有限公司经 `supvan.com.cn` 页脚营业执照核验；投递走原文明示的 `https://www.supvan.com/joinUs`（关联主体硕方科技官网，Moka 先例、仅导航不采集）；邮箱域 `jtsupvan.com` 无主体证据被白名单拒绝并留 `COMPANY_EMAIL_DOMAIN_UNVERIFIED` 复核标记。
- 鲸驰寰宇：契约冻结港中深中文版页面（台账证据为英文路径）；邮箱与原文明示官网 `jcquant.vip` 同域通过；官网建设中留复核项。
- 神谷文化：邮箱域 `shengumedia.com` 无可达网站，以工商登记企业邮箱同域佐证通过。
- 红海云：实际岗位名为**商务助理**（台账误记业务助理）；`hr-soft.cn` ICP 主体精确匹配；浙大企业信息栏 200-500 人构成首个合格中小规模证据（`medium`，配额 30）；工作性质"全职,实习"与多城市补充说明留 `SOURCE_KIND_CONFLICT`/`MULTI_CITY_SUPPLEMENT` 复核项。

当前闭环已经能在本机运行：

```text
二十三个可见企业，有效总供给 202 条、按 ADR-0021 配额可见 136 条
  -> 清洗、去重、结构化和来源追溯（缺口公开分母）
  -> PDF / DOCX / 文本简历与隐私检查
  -> 事实、偏好和经历证据确认
  -> 三轴匹配与确定性推荐
  -> 按方向生成有样本门槛的 JD 洞察与个人证据对照
  -> 受控 AI 选择或安全模板降级
  -> 逐段接受、拒绝或编辑
  -> ATS DOCX、官方投递链接和五态决定
  -> 删除全部个人数据
```

## 2. 已确认工程事实

- ADR-0026 自动刷新基础设施已实现：独立 `collector-worker` 随 `pnpm dev` 启动；`.data/source-refresh.local.json` 缺失时默认关闭；配置显式授权后按 PostgreSQL `next_due_at` 稳定排序，并以数据库 advisory lock 保证全局单并发、每小时最多 3 个不同来源和一小时传输层熔断执行 `scheduled` 任务。浏览器来源只生成提醒，不触网。
- 来源契约新增 `full_scope`、`tracked_records`、`manual_snapshot` 与连续未见策略；计划批次必须先通过接受门，硬冲突自动暂停且保留上一可用目录。接受运行在目录物化成功前保持到期，重启只补物化、不重复触网；冻结高校详情页本次保存的 404/410 证据可关闭对应岗位。截止日期按上海自然日即时下架，`uncertain` 继续可见；目录、配额、匹配、推荐和洞察统一排除 `closed`。
- 运维命令为 `source:refresh-enable/disable/status/now`，扩大多来源时可用 `source:refresh-enable --stagger-hours 24` 稳定分散当前到期任务。首次启用、扩大范围、恢复暂停与浏览器快照仍需人工明确操作；CI、测试、构建、Alpha 和 Production 均不访问真实来源。2026-08-02 运行观察时本机总开关、`collector-worker`、`match-worker` 与开发服务均在运行；该进程状态是本次交接时点事实，不是部署承诺。ADR-0023/0024 仍为提案。
- 三来源真实灰度已通过：卧安 run `959c48cc-8e36-4f6a-9a6c-3c49266207f0` 为 1 请求、5/5/0、`complete`；先临 run `de9d0fb2-48b5-44fe-a71d-a00946f1ccc0` 为 1 请求、9/9/0、`complete`；硕方 run `d07a7608-4633-48e1-9378-340dc9ab2395` 为 6 请求、6/6/0、`partial`。三者均被自动接受，同到期窗口重放 `reused=true` 且不触网，物化新增卧安、先临各 1 个岗位版本，硕方没有伪版本。
- 灰度通过后，其余 18 个活动确定性来源各提升一个政策版本并按稳定哈希分散到 24 小时窗口；最终矩阵为 21 个确定性来源启用、2 个浏览器来源只生成快照提醒、4 个暂停来源保持关闭。启用过程先关闭本地 Gate 并等待 collector advisory lock，全部登记和排期成功后才重新开启；禁用命令等待活动周期结束后返回，耗尽重试的死任务退到下一周期且不阻塞后续来源。
- 当前目录：有效总供给 202 条、可见 136 条、23 家企业；批次 07-03 望尘 1 条在截止前导入，2026-08-01 转 `paused` 后不再计入当前目录；自动刷新灰度新增 2 条，普渡首轮扩展又新增 2 条。被压缩 66 条保留全部不可变版本并在目录页公开"X/供给 Y"。
- 截至 2026-08-02 14:58，首轮扩展计划运行已完成神谷 1/1/0、帆软 12/12/0、普渡 30/30/0、寒序 2/2/0、鲸驰 1/1/0 与慧策 30/30/0，合计 9 请求、76 发现、76 规范化、0 拒绝，六者均为 `accepted`；没有自动暂停、传输错误或熔断。当前 9 个确定性来源为新鲜、其余 12 个到期等待，2 个浏览器来源只生成快照提醒。
- 通过来源均为 `pending_review`、只能进入本机 `local_mvp`；全志、昆仑芯、DTL 与望尘已转 `paused`。数据库公共版本指针保持 0；公共模式 `/v1/jobs` 为空，本机启用 `local_mvp` 时同一路由返回 136 条内部预览。
- P0 提额运行：硕方 run `f4d022fa-d7ff-4004-a990-d29cc113797c` 为 6 请求、6/6/0，同小时重放 `reused=true`；千寻 run `b26d6015-da9e-4a28-93f5-5cd96233da5a` 为 `request_count=0`、22/22/0，同快照重放 `reused=true` 且 0 新修订。快照哈希为 `46aca0c1…3a93127`。
- 共享适配器 `university-employment-detail-html` 已升至 0.1.3：在既有南开 correcruit / 港中深 jobview / 浙大 jyxt 契约上，继续保持职责与要求确定性分段，并新增浙大“（二）任职要求”、公开“招聘链接”、NFKC 主体比较、“每周可保证 N 个工作日”识别和港中深页脚截断；company_email 继续要求企业同域与原句同时成立。
- ADR-0021 配额机制：`catalog.company_quota_selections`（迁移 016）由物化在同一事务整表重写；择优为优先轨道（product/operations/engineering/data_ai 的 known 值）在前、组内按 created_at 与 id 稳定排序；目录 `loadLocalRows` 与洞察样本 SQL 按 `selected` 过滤，推荐候选集经目录搜索自然继承，历史冻结运行不回溯；未物化修订不受配额影响（兼容既有容量测试路径）。
- `/v1/jobs` 搜索响应新增可选 `companyQuotaGaps`（公司、规模档、配额、供给、已显示），目录页顶部公示缺口且注明"不代表岗位关闭"。
- 中小企业占比现状（公开分母）：有合格中小规模证据企业 7/23（红海云、先临三维、分享投资、卧安、一清、三石园、寒序），中小证据岗位 22/136；望尘的合格 `medium` 证据和不可变修订保留，但过期来源不计入当前分母；其余 `unknown` 按非中小计。
- 批次 07-03：望尘最终 run `09c2b783-859b-4893-b157-e8520a85bc4a` / task `638d30eb-45b5-44d0-a574-d80db9da942d` 为 1 请求、1/1/0、`partial`，同小时重放 `reused=true`；`0.1.3` 修复后正文不含港中深页脚，1/1 来源级自审通过。全部真实操作在 2026-07-31 截止前完成；8 月 1 日离线登记 v3 `paused`、关闭探测并重物化，该批收口时点目录为 198/134/23，公开岗位与疑似重复为 0。
- ADR-0025 恢复已执行：先临三维 8、分享投资 1、北京鼎帷 1 通过且重放幂等；全志、昆仑芯、DTL 分别因静态载荷、主体和实习栏目硬冲突暂停；没有安全绕行。
- P6 已完成 50 条跨职能分类金标，覆盖 12 个职能，A/B 盲标 50/50 一致；三轴工程金标实际 40 条。
- P7 真实浏览器闭环已完成：1280/320 无全局横向溢出，100 岗推荐、产品洞察、模板降级、9,176 字节 DOCX 下载、官方链接交接、五态决定与全部个人数据删除通过，控制台无 warning/error。
- `pnpm local:bootstrap` 已实现；隔离空库完成迁移、字节 10 条与千寻 22 条零网络导入，随后首个网络来源三次 `ECONNRESET` 后 fail-closed，未伪造目录成功。
- 千寻智能来源：`sourceType=official_ats`、`acquisitionMode=browser_required`、复用 `official-account-manual-snapshot` 通用适配器（无新代码路径）；快照文件在 Git 忽略的 `.data/browser-imports/`；官方逐岗详情页作为 `official_url` 投递；动态签名与 CSRF 未逆向、未复用。
- 审批包 01 既有事实（北森列表契约、帆软表单、官方列表页申请链、字节人工快照、百度/京东幂等探测等）继续有效，详见其执行记录。
- 正式 `/jobs/*`、简历、确认、推荐、优化、数据控制页面均由 PostgreSQL 和 `/v1` API 提供数据；localhost 匿名 owner、Origin/CSRF、owner epoch、不可变修订、TTL、删除墓碑和迟到任务拒绝已实现。
- 三轴、32 个命名金标、coverage/basisState/类型化 gaps、确定性分组推荐、冻结要求集/画像/核验时间、五态决定和官方链接交接已实现；AI 只能对单个已确认 `sourceBlockId` 返回建议稿并逐块校验，失败安全降级为模板。
- 2026-07-29 R1 最终工程门：隔离数据库 `aijob_test` 中全量 365 项测试（platform 273、web 56、config 16、contracts 15、database 5）、TypeScript、生产构建、biome lint（266 文件）与 `git diff --check` 通过。
- 2026-07-29 R2 终局工程门：隔离库全量 366 项测试（platform 273、web 57、config 16、contracts 15、database 5）、全仓 TypeScript、全仓生产构建、biome lint（266 文件）、改动级 Biome 与 `git diff --check` 通过；真实来源未访问、AI 未调用。
- 2026-07-30 P7 终局工程门：隔离库全量 391 项测试（platform 298、web 57、config 16、contracts 15、database 5）、全仓 TypeScript、全仓生产构建、biome lint（276 文件）与 `git diff --check` 通过。
- 2026-07-30 批次 07-01 工程门：隔离库全量 401 项测试（platform 308、web 57、config 16、contracts 15、database 5）、全仓 TypeScript、生产构建、`pnpm lint`（279 文件）与 `git diff --check` 通过。
- 2026-07-31 批次 07-02 工程门：隔离库全量 406 项测试（platform 313、web 57、config 16、contracts 15、database 5）、全仓 TypeScript、生产构建、`pnpm lint`（280 文件）与 `git diff --check` 通过。
- 2026-07-31 批次 07-03 工程门：隔离库全量 412 项测试（platform 319、web 57、config 16、contracts 15、database 5）、全仓 TypeScript、生产构建、`pnpm lint`（281 文件）与 `git diff --check` 通过。
- 2026-08-01 自动刷新基础设施初始工程门：隔离库全量 457 项测试（platform 363、web 57、config 16、contracts 15、database 6）、全仓 TypeScript、生产构建、`pnpm lint`（300 文件）与 `git diff --check` 通过；该时点总开关保持关闭，未访问真实来源。
- 2026-08-01 灰度、全量排期与竞态加固后工程门：隔离库全量 460 项测试（platform 366、web 57、config 16、contracts 15、database 6）、全仓 TypeScript、生产构建、`pnpm lint`（300 文件）与 `git diff --check` 通过。工程门未访问真实来源；真实灰度仅访问三家授权来源。详见[验收记录](../evidence/ingestion/source-refresh-automation-2026-08-01.md)。
- 2026-08-02 合并前工程门：隔离库全量 460/460、全仓 TypeScript、生产构建、`pnpm lint`（300 文件）与 `git diff --check` 再次通过；工程命令未访问真实来源。同期计划运行观察独立记录在[首轮扩展证据](../evidence/ingestion/source-refresh-first-rollout-observation-2026-08-02.md)。

## 3. 当前未完成项

1. 三来源灰度和 18 个扩展来源分散排期已完成；首轮扩展已通过六个来源，继续观察其余 12 个到期确定性来源，确认来源级失败隔离、每小时上限、熔断和目录物化在完整首轮中持续稳定。
2. 固定 20 家队列与批次 07-01/07-02/07-03 已核验完毕；自动刷新稳定后，下一批继续从千家台账按 `active_explicit → active_needs_recheck`、岗位数降序、截止升序、候选 ID 升序筛选，每批最多 5 家，且不得沿用已截止页面的活动性结论。
3. 目录硬指标仍未达：136 / 300 可见、23 / 30 家企业、SME 企业 30.43% / 60%、SME 岗位 16.18% / 50%。
4. 企业达到 40 家仍不达标时停止扩容并回到 P7，不降低规模证据或字段标准。
5. 空库恢复命令已实现，但尚未完成到当前 202 / 136 / 23 目录统计的最终一致性断言；G0/G1、公开 AI 与公开岗位目录继续关闭。

## 4. 关键实现位置

- 岗位目录与配额：`apps/platform/src/catalog/`（`materialize.ts` 含 `applyCompanyQuotaSelections`、`repository.ts` 含 `companyQuotaGaps`）、`apps/web/src/pages/JobListPage.tsx`
- 官方来源：`apps/platform/src/sources/`、`config/sources/`；批次 02 共享适配器 `university-employment-adapter.ts`（注册表含四家冻结契约）；千寻配置 `spirit-ai-feishu-manual.json`
- 探测与导入：`apps/platform/src/ingestion/probe.ts`（`runUniversityEmploymentAdapterProbe`）、`manual-browser-import.ts`
- 匿名 owner 与安全：`apps/platform/src/identity/`、`apps/platform/src/profile/`
- 简历：`apps/platform/src/resume/`；匹配与推荐：`apps/platform/src/matching/`；JD 洞察：`apps/platform/src/insights/`
- 优化与 DOCX：`apps/platform/src/tailoring/`、`apps/platform/src/ai/`；决定与删除：`apps/platform/src/decisions/`
- 自动刷新：`apps/platform/src/workers/collector-worker.ts`、`apps/platform/src/ingestion/refresh-scheduler.ts`、`apps/platform/src/ingestion/job-activity.ts`、`apps/platform/src/sources/source-refresh-operations.ts`
- 数据迁移：`packages/database/src/migrations/004_local_complete_mvp.ts` 至 `017_source_refresh_automation.ts`

## 5. 本地恢复

```powershell
pnpm install
pnpm local:bootstrap
pnpm dev
```

`local:bootstrap` 读取 Git 忽略的 `.data/local-bootstrap.json`，先预检全部人工快照，再依次迁移、登记、导入/探测、物化和核对精确目录统计。它可能真实低频访问清单中的官方来源，只能由维护者明确运行；任一必需快照缺失或来源失败都会停止。详见 `docs/runbooks/local-bootstrap.md`。产品入口：

- <http://127.0.0.1:5173/jobs>
- <http://127.0.0.1:5173/resume>
- <http://127.0.0.1:5173/recommendations>
- <http://127.0.0.1:5173/insights>
- <http://127.0.0.1:5173/data-control>

日常工程门（隔离数据库 `aijob_test`，与 dev worker 共库会互抢任务队列）：

```powershell
$env:AIJOB_TEST_DATABASE_URL='postgresql://aijob:aijob@127.0.0.1:5432/aijob_test'
pnpm test
pnpm typecheck
pnpm build
pnpm lint
```

## 6. 不得改变的边界

- 不抓 BOSS、实习僧、牛客等综合平台，不绕过登录、验证码或访问控制；不逆向或复用动态签名与 CSRF 令牌。
- 未说明字段保持 `unknown`；资格、证据、偏好分开；不显示匹配百分比或自动劝退。
- `pending_review` 只允许本机目录，不得写成获准公开或 G3 已通过。
- 企业邮箱投递必须是企业官方域名（或子域）且原句在页面出现；无法核验主体归属的域名 fail-closed 拒绝。
- ADR-0021 配额压缩只在读取层隐藏并公开缺口，不删除岗位版本或来源修订历史；配额恢复只能凭合格规模证据。
- AI 不修改三轴、不创造经历、不调用工具；原文件不发送给模型。
- 不自动填写、模拟登录、批量投递或替用户提交。
- 不引入 Redis、向量库、独立搜索、消息总线、生产 Playwright 或公共管理后台；ADR-0016/0017 只允许维护者按批次人工生成官方可见内容快照。
- 不提交 `.data/`、密钥、令牌、简历原文、本地数据库或下载的 DOCX。

## 7. 新任务接手检查

```text
[ ] 已读 AGENTS.md、README.md、docs/06-mvp-roadmap.md 和本交接
[ ] 已检查分支、git status、最近提交和未提交差异
[ ] 已确认目录为有效总供给 202 / 可见 136 条 local_mvp 岗位、23 家企业；活动通过来源 pending_review，硬冲突或过期来源 paused
[ ] 已确认 P0 15/15 自审通过，硕方 6 条、千寻 22 条，鹏扶按预设暂停且不补位
[ ] 已确认 ADR-0021 配额压缩生效（66 条公开缺口），配额恢复需合格规模证据
[ ] 已确认产品证据仍为 E0，G0/G1 未开始，G3 为 0/3
[ ] 已确认 P1–P6 已执行，P7 报告已完成但新范围硬指标未通过
[ ] 已确认 ADR-0025 批准批次 07+、企业目标为 30–40 家且 40 家为停止线
[ ] 已确认固定 20 家队列与批次 07-01/07-02/07-03 已核验完毕；望尘 1/1 岗位截止前自审通过、截止后已暂停下架且不再触网，下一批继续千家台账
[ ] 已确认 ADR-0026 三来源灰度通过，最终矩阵为 21 个确定性来源启用、2 个浏览器来源仅提醒、4 个暂停来源关闭；首轮扩展已通过神谷/帆软/普渡/寒序/鲸驰/慧策，本机总开关与 Worker 正在运行
[ ] 已确认空库恢复入口已实现但网络阶段 fail-closed，不能写成完整恢复通过
[ ] 已确认不会读取、打印或提交本机 AI 密钥
```
