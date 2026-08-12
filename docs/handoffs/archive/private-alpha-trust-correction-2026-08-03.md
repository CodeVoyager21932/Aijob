# 【历史归档】项目交接：Private Alpha 岗位可信度纠偏

> 本文只保存 2026-08-03 时点事实，其中的“当前唯一目标”和来源授权均已被后续路线取代，不提供当前任务。当前执行见[现行交接](../current.md)。

> 交接日期：2026-08-03
>
> 当前工作分支：`codex/g2-1000-alpha-supply`（从最新 `origin/main` 建立；不得覆盖并行中的规模化供给实现改动）
>
> 动态事实源：[MVP 路线与当前决策面板](../../06-mvp-roadmap.md)
>
> 工程与发现证据：[Private Alpha 官方来源资格硬门](../../evidence/ingestion/private-alpha-official-source-gate-2026-08-03.md)、[Private Alpha 容量审计](../../evidence/ingestion/private-alpha-capacity-audit-2026-08-03.md)、[G2 终局重新验收报告](../../evidence/g2/g2-reacceptance-2026-07-30.md)、[自动刷新首轮扩展观察](../../evidence/ingestion/source-refresh-first-rollout-observation-2026-08-02.md)、[空库恢复演练](../../evidence/g2/local-bootstrap-drill-2026-07-30.md)、[供给检查点](../../evidence/g2/supply-checkpoint-2026-07-30.md)

## 最新执行增量（2026-08-03）

- [ADR-0029](../../decisions/0029-official-source-catalog-trust-boundary.md) 已接受：企业官网和官网确认的官方 ATS 是用户目录唯一岗位真源；高校、政府、公众号及其他二手页面统一为 `discovery_only`。
- 系统审查发现运行目录实际为 152 条岗位、30 家企业，其中高校来源 38 条/17 家；另有 3 条测试岗位、7 条空职责岗位、14 条来源冲突岗位。只有 12 条为 `fresh`，150/152 条仍有未关闭复核项。
- 中央资格门已落地：迁移 019/020 统一拦截非官网、测试作用域、未登记配置、来源陈旧、岗位未在当前周期复核、硬冲突和字段缺失；目录、匹配、推荐、洞察、优化及 Worker 共用同一资格投影。
- [ADR-0023](../../decisions/0023-enforce-runtime-and-database-role-boundaries.md) 已接受；迁移 021/022 建立五个运行角色、任务 RLS、原始抓取数据隔离和 match worker 完成 owner 删除所需的列级最小权限。Alpha/Production 强制五个独立数据库 URL。
- Alpha 邀请入口已落实为哈希凭证、精确 HTTPS Origin、失败限流和 Secure/HttpOnly 会话；后端所有产品读取 API 同步要求会话，不能绕过前端直接读取目录。PDF/DOCX 改由受限子进程解析。
- 100 家/1000 岗 PostgreSQL 容量回归已证明目录遍历、版本核验、同一候选集合幂等入队及 1000 个候选/要求集/新鲜度快照完整冻结；前端只分批渲染，不截断候选集合。
- 本机自动刷新总开关保持关闭；单来源纠偏通过 `source:refresh-now <source-key> --wait --confirm-live` 复用真实计划队列临时执行。北森试点、候选探测和其他新来源扩容继续暂停。
- [ADR-0028](../../decisions/0028-capacity-first-private-alpha-supply.md) 已接受，主线从逐家高校单页改为容量型来源族；`40/400`、`70/700`、`100/1000` 都是最低检查点而非精确企业数。
- `config/source-candidates.json` 已升级至 v4；`source:batch-plan` 与新增的零网络 `source:candidate-audit` 统一输出动态分母、容量、SME、职能、城市与人工来源缺口。
- 纠偏前规划器 231/149/29 与运行目录 152/30 都是历史待清洗事实。干净 `aijob_alpha` 为 22 条岗位、3 家企业、3 个官方 ATS 来源：先临三维 9、卧安机器人 5、灵明光子 8；SME 2 家/14 岗，人工、Alpha 和公共岗位均为 0。开发库 14/2 不再作为验收分母。
- 北森适配器已能通过配置新增租户；当前审计没有 `capacity` 就绪候选，因此没有进行未经授权的真实来源族试点。
- 先临三维计划刷新 9/9/0、卧安机器人 5/5/0；卧安同小时重放 `reused=true`。百度因 `BAIDU_INITIAL_DATA_INVALID_JSON` 暂停；慧策因 29/30 `SOURCE_KIND_CONFLICT`、腾讯因结构字段缺失/目标范围复核同步提升为暂停政策。
- `aijob_alpha` 与开发库均已升级至迁移 022；Git 忽略的恢复清单已校准为 22/22/3/0，并只包含三个已授权 canonical 确定性来源。`local:bootstrap` 与 `source:probe` 均要求显式 `--confirm-live`。
- Alpha 后端读取绕过修复后的最终工程门：隔离 PostgreSQL 全仓 557/557、全仓 TypeScript、生产构建、331 文件 lint 与 `git diff --check` 全绿。

## 1. 当前唯一目标

coco 已通过 [ADR-0029](../../decisions/0029-official-source-catalog-trust-boundary.md) 修正岗位事实源，高校等二手页面只能用于发现企业方向。P0/P1 可信度纠偏已完成代码与干净库收口。**当前唯一目标是冻结并提交本轮纠偏结果，然后按 ADR-0028 恢复容量优先的企业官网/官方 ATS 来源族扩容，从 22 岗/3 家可信分母推进 100/1000。** 产品证据保持 `E0`，G0/G1 和其他外部用户测试继续暂停。

2026-07-26 coco 作出四项决定并已全部执行：

1. **审批包 02 修订为纯 SME 版并批准**（硕方、鲸驰寰宇、神谷文化、红海云、鹏扶，米哈游移入批次 05）。执行结果：4 家完成核验、契约冻结、真实低频探测与首批导入（硕方 5、其余各 1，全部 0 拒绝、重复探测幂等不触网）；**鹏扶按预设暂停**——页面主体为上海鹏扶投资管理有限公司（台账误记法人名），同页两个投递邮箱域名 `pengfu.tech`/`pengfu.fund` 均无主体证据且互相矛盾。
2. **方案 A 落地为 [ADR-0021](../../decisions/0021-compress-large-company-quota-and-publish-sme-gap.md)**：无 `small/medium` 规模证据企业单家目录配额压缩至 10 条（有证据企业维持 30），择优保留 ADR-0020 双优先轨道，缺口公开分母。迁移 016 建立确定性配额选择表，物化择优、目录/洞察读取过滤与 `/v1/jobs` `companyQuotaGaps` 已上线；普渡 30→10、慧策 30→10、帆软 18→10、腾讯 14→10，共压缩 52 条（版本与修订历史完整保留）。
3. **千寻智能/万境千寻人工快照批次执行**：两条台账记录实为同品牌（Spirit AI），合并为单一来源 `spirit-ai-feishu-manual`（飞书 ATS 站点主体千寻智能（杭州）科技有限公司，目录展示品牌名"千寻智能"）。按 ADR-0016 人工浏览器读取职位列表第一页 10 岗（页面自身调用的公开接口响应），7 条含完整职责与任职要求进入零网络快照导入（`request_count=0`、重放幂等）；3 条无任职要求正文的岗位按最低字段要求排除留痕。
4. **放弃窗口 ≤6 天的 5 家**（壳牌、恒丰、开源证券、汉腾、巨一）。

2026-07-26 深夜，coco 进一步批准 [ADR-0022](../../decisions/0022-plan-batch-preauthorization-and-delegated-spot-checks.md)：批次 03–06 按计划预授权，抽检由执行方自检自审并逐批留档；鹏扶不补位。coco 不再逐批审批或审阅报告，唯一保留的人工卡点为 P7 G2 终局判定。

2026-07-29，P0 已按该治理口径完成：台账事实已修正；批次 02 的 15 条岗位由执行方逐条自审，15/15 通过；硕方扩至 6 条；千寻前三页公开列表共 30 条，按“实习 + 职责与任职要求均完整”纳入 22 条，排除 4 条缺字段实习与 4 条正式岗位；目录物化为总供给 177、可见 113、15 家企业。

同日完成 [R1 架构与组件系统性审视](../../evidence/r1/architecture-review-2026-07-29.md)：直接修复 owner task 过期租约与最大尝试、删除事务旧任务冻结、24 小时删除回执、Problem Details 媒体类型、browser-only 双重拒绝、特殊用途 IP、绝对超时和物理请求预算；运行时/数据库角色边界与来源 descriptor/run mode 仅形成 [ADR-0023](../../decisions/0023-enforce-runtime-and-database-role-boundaries.md)、[ADR-0024](../../decisions/0024-unify-source-adapter-descriptors-and-run-modes.md) 提案。R1 未访问真实来源、未改变产品边界、未进入 R2 或后续来源批次。

同日 coco 审核通过[历史 R2 UI/UX 视觉方向](../../plans/archive/r2-ui-ux-reference-direction-2026-07-29.md)，R2 随后正式启动并完成。执行方保存七个正式页面 1280 基线，建立独立“向阳生长”产品作用域和米白/群青/杏黄/竹青/朱橙 token，完成 `/jobs` 高保真切片、岗位详情证据阅读以及简历/推荐/洞察/优化/数据控制的共享视觉推广。中文编辑式首屏、方向快捷筛选、配额旁注、单列岗位比较、100→113 条明确后续加载、次级安全状态和真实 320px 结构均已通过浏览器检查；未来手机端所需 token、语义顺序和 Grid/Flex 重排能力保留。详情见 [R2 `jobs` 实施记录](../../evidence/r2/jobs-high-fidelity-slice-2026-07-29.md)与 [R2 收口记录](../../evidence/r2/ui-ux-closeout-2026-07-29.md)。

关键核验事实（批次 02）：

- 硕方：南开实习信息栏目 6 页同企业详情（116235–116240）；发布主体北京硕方信息技术有限公司经 `supvan.com.cn` 页脚营业执照核验；投递走原文明示的 `https://www.supvan.com/joinUs`（关联主体硕方科技官网，Moka 先例、仅导航不采集）；邮箱域 `jtsupvan.com` 无主体证据被白名单拒绝并留 `COMPANY_EMAIL_DOMAIN_UNVERIFIED` 复核标记。
- 鲸驰寰宇：契约冻结港中深中文版页面（台账证据为英文路径）；邮箱与原文明示官网 `jcquant.vip` 同域通过；官网建设中留复核项。
- 神谷文化：邮箱域 `shengumedia.com` 无可达网站，以工商登记企业邮箱同域佐证通过。
- 红海云：实际岗位名为**商务助理**（台账误记业务助理）；`hr-soft.cn` ICP 主体精确匹配；浙大企业信息栏 200-500 人构成首个合格中小规模证据（`medium`，配额 30）；工作性质"全职,实习"与多城市补充说明留 `SOURCE_KIND_CONFLICT`/`MULTI_CITY_SUPPLEMENT` 复核项。

历史闭环能力已经能在本机运行；当前目录分母已按 ADR-0029 收紧：

```text
三个可信可见企业、二十二条官网/官方 ATS 当前岗位
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

- ADR-0027 已接受：100/1000 是外部测试硬门槛，110/1100 是运营缓冲；SME、12 职能、8 城市和人工/浏览器来源占比必须用当前可见目录的真实分母独立验收。该决策没有把当前 202/136/23 或任何历史运行结果改写为通过。
- ADR-0029 已落实为数据库中央资格门；当前政策必须由精确 Git 配置登记，每条岗位必须在当前刷新周期内由官网/官方 ATS 重新看见。来源级 `fresh` 不能把未观察到的历史岗位整体洗新。
- 测试数据库硬守卫已加入 `createDatabase`：测试进程只允许连接本机 `aijob_test*`、`aijob_audit*` 等隔离库，拒绝开发库或远程数据库。
- ADR-0026 自动刷新基础设施已实现：独立 `collector-worker` 随 `pnpm dev` 启动；`.data/source-refresh.local.json` 缺失时默认关闭；配置显式授权后按 PostgreSQL `next_due_at` 稳定排序，并以数据库 advisory lock 保证全局单并发和一小时传输层熔断。Worker 与状态命令只认 Git 中显式配置的来源键，孤立测试记录不会污染容量或进入调度。
- ADR-0028 已完成滚动 12 小时容量的离线实现：当全部活动确定性来源都配置为不超过 12 小时，小时上限按 `min(12, max(3, ceil(来源数 / 12) + 1))` 计算并稳定分散；110 个虚拟来源时为 11 家/小时。ADR-0029 后当前只剩 7 个活动确定性 canonical 配置，真实容量切换继续冻结。
- 来源契约新增 `full_scope`、`tracked_records`、`manual_snapshot` 与连续未见策略；计划批次必须先通过接受门，硬冲突自动暂停且保留上一可用目录。接受运行在目录物化成功前保持到期，重启只补物化、不重复触网；冻结高校详情页本次保存的 404/410 证据可关闭对应岗位。截止日期按上海自然日即时下架，`uncertain` 继续可见；目录、配额、匹配、推荐和洞察统一排除 `closed`。
- 运维命令为 `source:refresh-enable/disable/status/now`；供给命令为 `source:batch-plan` 与零网络 `source:candidate-audit`。首次启用、扩大范围、恢复暂停与浏览器快照仍需人工明确操作；CI、测试、构建、Alpha 和 Production 均不访问真实来源。不要从历史运行记录推断当前进程仍在运行。ADR-0023 已接受，ADR-0024 仍为提案。
- 三来源真实灰度已通过：卧安 run `959c48cc-8e36-4f6a-9a6c-3c49266207f0` 为 1 请求、5/5/0、`complete`；先临 run `de9d0fb2-48b5-44fe-a71d-a00946f1ccc0` 为 1 请求、9/9/0、`complete`；硕方 run `d07a7608-4633-48e1-9378-340dc9ab2395` 为 6 请求、6/6/0、`partial`。三者均被自动接受，同到期窗口重放 `reused=true` 且不触网，物化新增卧安、先临各 1 个岗位版本，硕方没有伪版本。
- ADR-0029 后配置矩阵为：7 个活动确定性 canonical、2 个浏览器提醒 canonical、3 个硬冲突暂停 canonical；22 个高校等来源全部为 `discovery_only` 且零调度。此前 21 个确定性来源启用是历史灰度事实，不是当前授权。
- 当前验收真源 `aijob_alpha` 为 22 条岗位、3 家企业：先临三维 9、卧安机器人 5、灵明光子 8；前两家为 `medium`，灵明光子保持 `unknown`，人工来源 0，Alpha/公共岗位 0。历史配额压缩记录和全部不可变版本继续保留。
- 2026-08-02 的神谷、帆软、普渡、寒序、鲸驰与慧策运行结果保留为当时执行事实；其中高校载体已降级为发现线索，慧策已因结构冲突暂停，均不能直接作为当前可信供给。
- 通过来源均为 `pending_review`、只能进入本机 `local_mvp`；数据库公共版本指针保持 0，公共模式 `/v1/jobs` 为空。干净验收库启用 `local_mvp` 时同一路由仅返回中央资格门通过的 22 条内部岗位；开发库保留 14 条历史可信目录。
- P0 提额运行：硕方 run `f4d022fa-d7ff-4004-a990-d29cc113797c` 为 6 请求、6/6/0，同小时重放 `reused=true`；千寻 run `b26d6015-da9e-4a28-93f5-5cd96233da5a` 为 `request_count=0`、22/22/0，同快照重放 `reused=true` 且 0 新修订。快照哈希为 `46aca0c1…3a93127`。
- 共享适配器 `university-employment-detail-html` 已升至 0.1.3：在既有南开 correcruit / 港中深 jobview / 浙大 jyxt 契约上，继续保持职责与要求确定性分段，并新增浙大“（二）任职要求”、公开“招聘链接”、NFKC 主体比较、“每周可保证 N 个工作日”识别和港中深页脚截断；company_email 继续要求企业同域与原句同时成立。
- ADR-0021 配额机制：`catalog.company_quota_selections`（迁移 016）由物化在同一事务整表重写；择优为优先轨道（product/operations/engineering/data_ai 的 known 值）在前、组内按 created_at 与 id 稳定排序；目录 `loadLocalRows` 与洞察样本 SQL 按 `selected` 过滤，推荐候选集经目录搜索自然继承，历史冻结运行不回溯；未物化修订不受配额影响（兼容既有容量测试路径）。
- `/v1/jobs` 搜索响应新增可选 `companyQuotaGaps`（公司、规模档、配额、供给、已显示），目录页顶部公示缺口且注明"不代表岗位关闭"。
- 当前可信中小企业分母为 2/3（先临三维、卧安机器人），岗位为 14/22；灵明光子规模为 `unknown`，不得计为 SME。旧 7/23、22/136 仅保留为 ADR-0029 前历史分母。
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
- 2026-08-01 灰度、全量排期与竞态加固后工程门：隔离库全量 460 项测试（platform 366、web 57、config 16、contracts 15、database 6）、全仓 TypeScript、生产构建、`pnpm lint`（300 文件）与 `git diff --check` 通过。工程门未访问真实来源；真实灰度仅访问三家授权来源。详见[验收记录](../../evidence/ingestion/source-refresh-automation-2026-08-01.md)。
- 2026-08-02 合并前工程门：隔离库全量 460/460、全仓 TypeScript、生产构建、`pnpm lint`（300 文件）与 `git diff --check` 再次通过；工程命令未访问真实来源。同期计划运行观察独立记录在[首轮扩展证据](../../evidence/ingestion/source-refresh-first-rollout-observation-2026-08-02.md)。
- GitHub CI 已配置一次性 PostgreSQL 16 测试服务，预迁移后强制设置 `AIJOB_TEST_DATABASE_URL`，因此 PR 与 `main` 的工程门不再静默跳过 20 个数据库集成测试文件；CI 显式关闭来源探测、本地预览与 AI。PR 分支只由 `pull_request` 触发，合并后由 `main` push 复验，避免同一提交重复运行两套检查。

## 3. 当前未完成项

1. 当前可信总量仅 22 / 1000 岗、3 / 100 家企业，至少缺 978 岗、97 家；达到硬门后还要维持 110/1100 运营缓冲。
2. 当前 SME 为 2/3 家、14/22 岗；到 100 家/1000 岗至少还需 48 家和 386 条合格 SME，规模预判、招聘平台人数和 `unknown` 不能计入。
3. 12 职能和 8 城市仍有巨大缺口：产品 1、运营 0、工程 3、数据与 AI 8；杭州 8、深圳 6、上海 4，区/省/组合地点不能冒充城市计数。
4. 先冻结并提交本轮 P0/P1 纠偏；之后按容量证据恢复北森/第二 ATS 来源族扩容。百度、慧策、腾讯不得绕过暂停，浏览器来源不得自动触网。
5. 服务器就绪 Gate 尚未定义和执行；数据库登录角色/凭据、备份恢复、监控、部署回滚、Alpha 邀请轮换与真实 1000 岗处理时延仍需独立验收。
6. 当前邀请失败计数是单进程内存状态，解析器是受限子进程而非操作系统沙箱；多实例 Alpha 前必须补持久化限流/单人凭证轮换，并以非特权、无外网、资源受限的部署单元运行解析进程。
7. Web 生产包当前主 JS 为 508.70 kB（gzip 150.05 kB），仅触发 Vite 性能警告、不影响正确性；手机端专项前再按路由拆包，不在供给纠偏中扩 UI 范围。

## 4. 关键实现位置

- 岗位目录与配额：`apps/platform/src/catalog/`（`materialize.ts` 含 `applyCompanyQuotaSelections`、`repository.ts` 含 `companyQuotaGaps`）、`apps/web/src/pages/JobListPage.tsx`
- 官方来源：`apps/platform/src/sources/`、`config/sources/`；批次 02 共享适配器 `university-employment-adapter.ts`（注册表含四家冻结契约）；千寻配置 `spirit-ai-feishu-manual.json`
- 探测与导入：`apps/platform/src/ingestion/probe.ts`（`runUniversityEmploymentAdapterProbe`）、`manual-browser-import.ts`
- 容量候选与批次：`apps/platform/src/sources/source-candidates.ts`、`source-candidate-ledger.ts`、`source-batch-planner.ts`；CLI 为 `source:candidate-audit` 与 `source:batch-plan`
- 匿名 owner 与安全：`apps/platform/src/identity/`、`apps/platform/src/profile/`
- 简历：`apps/platform/src/resume/`；匹配与推荐：`apps/platform/src/matching/`；JD 洞察：`apps/platform/src/insights/`
- 优化与 DOCX：`apps/platform/src/tailoring/`、`apps/platform/src/ai/`；决定与删除：`apps/platform/src/decisions/`
- 自动刷新：`apps/platform/src/workers/collector-worker.ts`、`apps/platform/src/ingestion/refresh-scheduler.ts`、`apps/platform/src/ingestion/job-activity.ts`、`apps/platform/src/sources/source-refresh-operations.ts`
- 数据迁移：`packages/database/src/migrations/004_local_complete_mvp.ts` 至 `022_match_worker_owner_deletion_privileges.ts`

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
[ ] 已确认验收真源 `aijob_alpha` 为 22 条 local_mvp 岗位、3 家企业/3 个官方 ATS 来源；SME 2 家/14 岗，人工、Alpha 与公共岗位均为 0；开发库 14/2 和 231/149/29 仅为历史事实
[ ] 已确认 P0 15/15 自审通过，硕方 6 条、千寻 22 条，鹏扶按预设暂停且不补位
[ ] 已确认 ADR-0021 配额压缩生效（66 条公开缺口），配额恢复需合格规模证据
[ ] 已确认产品证据仍为 E0，G0/G1 未开始，G3 为 0/3
[ ] 已确认 P1–P6 已执行，P7 报告已完成但新范围硬指标未通过
[ ] 已确认 ADR-0027 部分替代 ADR-0025 的数量目标：硬门槛为 100 家 / 1000 岗，缓冲为 110 / 1100；旧 40 家停止线不再是当前终点
[ ] 已确认 SME 为企业 ≥50% / 岗位 ≥40%，四个重点职能各 ≥100、其余职能各 ≥15，8 个目标城市各 ≥40，人工来源企业 ≤20% / 岗位 ≤10%
[ ] 已确认固定 20 家队列与批次 07-01/07-02/07-03 已核验完毕；望尘 1/1 岗位截止前自审通过、截止后已暂停下架且不再触网，下一批继续千家台账
[ ] 已确认 ADR-0029 中央资格门、配置登记与岗位级新鲜度已落地；非 canonical、未登记、陈旧或硬冲突岗位不能进入任何新决策链
[ ] 已确认 ADR-0023、迁移 021/022、Alpha 后端访问门、受限简历解析子进程和 1000 候选冻结链已通过自动化验证
[ ] 已确认 ADR-0028 候选 v4、动态分母和零网络审计已实现；北森等新来源扩容必须等待 P0/P1 纠偏完成
[ ] 已确认 12 小时动态容量只完成离线验证；当前 7 个活动确定性 canonical 来源仍按原周期和每小时新来源上限运行，不能写成真实容量切换已通过
[ ] 已确认 `aijob_alpha` 已升级至迁移 022，恢复清单为 22/22/3/0 且只含三个获准 canonical 来源；任何真实重放仍需 `--confirm-live`
[ ] 已确认不会读取、打印或提交本机 AI 密钥
```
