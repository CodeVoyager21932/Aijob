# 当前项目交接：R1 已完成，R2 为下一阶段

> 交接日期：2026-07-29
>
> 当前分支：`codex/g0-research-prototype`
>
> 动态事实源：[MVP 路线与当前决策面板](../06-mvp-roadmap.md)
>
> 工程与发现证据：[G2 正确性重新验收记录](../evidence/g2/correctness-reacceptance-2026-07-20.md)、[验收反馈修正记录](../evidence/g2/acceptance-followup-2026-07-20.md)、[审批包 01 执行记录](../evidence/ingestion/approved-source-batch-01-2026-07-26.md)、[审批包 02 执行记录](../evidence/ingestion/approved-source-batch-02-execution-2026-07-26.md)、[G2 收束执行计划](../plans/g2-closeout-plan-2026-07-26.md)、[1000 家审查宇宙台账](../evidence/ingestion/internship-company-universe-2026-07-26.md)、[分层收录清单](../evidence/ingestion/import-candidate-list-2026-07-26.md)

## 1. 当前唯一目标

coco 按 ADR-0017/0018 将本机假设扩展为 20–30 家企业、300–500 条全部职能实习岗位（中小企业不少于企业数 60% 和岗位数 50%），新范围处于 G2 重新验收。当前不购买服务器、不招募或运行参与者任务，产品证据保持 `E0`。

2026-07-26 coco 作出四项决定并已全部执行：

1. **审批包 02 修订为纯 SME 版并批准**（硕方、鲸驰寰宇、神谷文化、红海云、鹏扶，米哈游移入批次 05）。执行结果：4 家完成核验、契约冻结、真实低频探测与首批导入（硕方 5、其余各 1，全部 0 拒绝、重复探测幂等不触网）；**鹏扶按预设暂停**——页面主体为上海鹏扶投资管理有限公司（台账误记法人名），同页两个投递邮箱域名 `pengfu.tech`/`pengfu.fund` 均无主体证据且互相矛盾。
2. **方案 A 落地为 [ADR-0021](../decisions/0021-compress-large-company-quota-and-publish-sme-gap.md)**：无 `small/medium` 规模证据企业单家目录配额压缩至 10 条（有证据企业维持 30），择优保留 ADR-0020 双优先轨道，缺口公开分母。迁移 016 建立确定性配额选择表，物化择优、目录/洞察读取过滤与 `/v1/jobs` `companyQuotaGaps` 已上线；普渡 30→10、慧策 30→10、帆软 18→10、腾讯 14→10，共压缩 52 条（版本与修订历史完整保留）。
3. **千寻智能/万境千寻人工快照批次执行**：两条台账记录实为同品牌（Spirit AI），合并为单一来源 `spirit-ai-feishu-manual`（飞书 ATS 站点主体千寻智能（杭州）科技有限公司，目录展示品牌名"千寻智能"）。按 ADR-0016 人工浏览器读取职位列表第一页 10 岗（页面自身调用的公开接口响应），7 条含完整职责与任职要求进入零网络快照导入（`request_count=0`、重放幂等）；3 条无任职要求正文的岗位按最低字段要求排除留痕。
4. **放弃窗口 ≤6 天的 5 家**（壳牌、恒丰、开源证券、汉腾、巨一）。

2026-07-26 深夜，coco 进一步批准 [ADR-0022](../decisions/0022-plan-batch-preauthorization-and-delegated-spot-checks.md)：批次 03–06 按计划预授权，抽检由执行方自检自审并逐批留档；鹏扶不补位。coco 不再逐批审批或审阅报告，唯一保留的人工卡点为 P7 G2 终局判定。

2026-07-29，P0 已按该治理口径完成：台账事实已修正；批次 02 的 15 条岗位由执行方逐条自审，15/15 通过；硕方扩至 6 条；千寻前三页公开列表共 30 条，按“实习 + 职责与任职要求均完整”纳入 22 条，排除 4 条缺字段实习与 4 条正式岗位；目录物化为总供给 177、可见 113、15 家企业。

同日完成 [R1 架构与组件系统性审视](../evidence/r1/architecture-review-2026-07-29.md)：直接修复 owner task 过期租约与最大尝试、删除事务旧任务冻结、24 小时删除回执、Problem Details 媒体类型、browser-only 双重拒绝、特殊用途 IP、绝对超时和物理请求预算；运行时/数据库角色边界与来源 descriptor/run mode 仅形成 [ADR-0023](../decisions/0023-enforce-runtime-and-database-role-boundaries.md)、[ADR-0024](../decisions/0024-unify-source-adapter-descriptors-and-run-modes.md) 提案。R1 未访问真实来源、未改变产品边界、未进入 R2 或后续来源批次。

关键核验事实（批次 02）：

- 硕方：南开实习信息栏目 6 页同企业详情（116235–116240）；发布主体北京硕方信息技术有限公司经 `supvan.com.cn` 页脚营业执照核验；投递走原文明示的 `https://www.supvan.com/joinUs`（关联主体硕方科技官网，Moka 先例、仅导航不采集）；邮箱域 `jtsupvan.com` 无主体证据被白名单拒绝并留 `COMPANY_EMAIL_DOMAIN_UNVERIFIED` 复核标记。
- 鲸驰寰宇：契约冻结港中深中文版页面（台账证据为英文路径）；邮箱与原文明示官网 `jcquant.vip` 同域通过；官网建设中留复核项。
- 神谷文化：邮箱域 `shengumedia.com` 无可达网站，以工商登记企业邮箱同域佐证通过。
- 红海云：实际岗位名为**商务助理**（台账误记业务助理）；`hr-soft.cn` ICP 主体精确匹配；浙大企业信息栏 200-500 人构成首个合格中小规模证据（`medium`，配额 30）；工作性质"全职,实习"与多城市补充说明留 `SOURCE_KIND_CONFLICT`/`MULTI_CITY_SUPPLEMENT` 复核项。

当前闭环已经能在本机运行：

```text
十五个已接入来源，总供给 177 条、按 ADR-0021 配额可见 113 条
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

- 目录终态：总供给 177 条、可见 113 条、15 家企业——京东/帆软/腾讯/百度/慧策/字节跳动/美团/普渡机器人/千寻智能各 10、灵明光子 7、好未来 7、硕方信息 6、神谷文化 1、红海云 1、鲸驰寰宇 1；被压缩 64 条保留全部不可变版本并在目录页公开"X/供给 Y"。
- 十五个已接入来源均为 `pending_review`，只能进入本机 `local_mvp`；公开 `/v1/jobs` 保持 0 条。
- P0 提额运行：硕方 run `f4d022fa-d7ff-4004-a990-d29cc113797c` 为 6 请求、6/6/0，同小时重放 `reused=true`；千寻 run `b26d6015-da9e-4a28-93f5-5cd96233da5a` 为 `request_count=0`、22/22/0，同快照重放 `reused=true` 且 0 新修订。快照哈希为 `46aca0c1…3a93127`。
- 新增共享适配器 `university-employment-detail-html` 0.1.0：冻结南开 correcruit / 港中深 jobview（中文版）/ 浙大 jyxt 三种载体格式；每页一岗单请求、服务端无 Cookie curl 复现、严格 UTF-8；company_email 复用企业域名白名单（域名相等或子域 + 原句含邮箱），official_url 与页面原文明示网址精确比对，fail-closed 负例有离线覆盖并经四张真实页面互证。
- ADR-0021 配额机制：`catalog.company_quota_selections`（迁移 016）由物化在同一事务整表重写；择优为优先轨道（product/operations/engineering/data_ai 的 known 值）在前、组内按 created_at 与 id 稳定排序；目录 `loadLocalRows` 与洞察样本 SQL 按 `selected` 过滤，推荐候选集经目录搜索自然继承，历史冻结运行不回溯；未物化修订不受配额影响（兼容既有容量测试路径）。
- `/v1/jobs` 搜索响应新增可选 `companyQuotaGaps`（公司、规模档、配额、供给、已显示），目录页顶部公示缺口且注明"不代表岗位关闭"。
- 中小企业占比现状（公开分母）：有合格中小规模证据企业 1/15（红海云 medium）、中小证据岗位 1/113；其余 `unknown` 按非中小计；距 60%/50% 目标缺口显著，不降低证据标准凑比例。
- 千寻智能来源：`sourceType=official_ats`、`acquisitionMode=browser_required`、复用 `official-account-manual-snapshot` 通用适配器（无新代码路径）；快照文件在 Git 忽略的 `.data/browser-imports/`；官方逐岗详情页作为 `official_url` 投递；动态签名与 CSRF 未逆向、未复用。
- 审批包 01 既有事实（北森列表契约、帆软表单、官方列表页申请链、字节人工快照、百度/京东幂等探测等）继续有效，详见其执行记录。
- 正式 `/jobs/*`、简历、确认、推荐、优化、数据控制页面均由 PostgreSQL 和 `/v1` API 提供数据；localhost 匿名 owner、Origin/CSRF、owner epoch、不可变修订、TTL、删除墓碑和迟到任务拒绝已实现。
- 三轴、32 个命名金标、coverage/basisState/类型化 gaps、确定性分组推荐、冻结要求集/画像/核验时间、五态决定和官方链接交接已实现；AI 只能对单个已确认 `sourceBlockId` 返回建议稿并逐块校验，失败安全降级为模板。
- 2026-07-29 R1 最终工程门：隔离数据库 `aijob_test` 中全量 365 项测试（platform 273、web 56、config 16、contracts 15、database 5）、TypeScript、生产构建、biome lint（266 文件）与 `git diff --check` 通过。

## 3. 当前未完成项

1. **下一阶段 R2**：系统审视正式 `/jobs/*`、简历、推荐、洞察、优化与数据控制的 UI/UX；R1 的 ADR-0023/0024 仍为提案，不得在 R2 顺手实施运行时或采集架构大改。
2. 目录可见 113 条、15 家企业；300–500 条、20–30 家、中小企业占比（企业数 60% / 岗位数 50%）、至少 50 条跨职能分类金标尚未完成，缺口按 ADR-0020/0021 公开。
3. 鹏扶按 ADR-0022 不补位；批次 03–06 名单与暂停条件已由计划预授权，但 R1 完成前不提前进入后续来源批次。
4. 301–1000 家仍需逐步补齐行业、主体、导入处置和企业规模证据后分批合并主台账。
5. 为普渡、灵明光子、硕方、鲸驰、神谷、千寻等继续检索官方/政府规模证据；命中 `small/medium` 的企业在下一物化周期恢复 30 条配额（ADR-0021 第 5 条）。
6. G0 的 2 人协议校准尚未开始；扩大后的 G2 通过后才招募、执行和记录。G3 来源准入仍为 0/3。公开 AI 仍未获批准。

## 4. 关键实现位置

- 岗位目录与配额：`apps/platform/src/catalog/`（`materialize.ts` 含 `applyCompanyQuotaSelections`、`repository.ts` 含 `companyQuotaGaps`）、`apps/web/src/pages/JobListPage.tsx`
- 官方来源：`apps/platform/src/sources/`、`config/sources/`；批次 02 共享适配器 `university-employment-adapter.ts`（注册表含四家冻结契约）；千寻配置 `spirit-ai-feishu-manual.json`
- 探测与导入：`apps/platform/src/ingestion/probe.ts`（`runUniversityEmploymentAdapterProbe`）、`manual-browser-import.ts`
- 匿名 owner 与安全：`apps/platform/src/identity/`、`apps/platform/src/profile/`
- 简历：`apps/platform/src/resume/`；匹配与推荐：`apps/platform/src/matching/`；JD 洞察：`apps/platform/src/insights/`
- 优化与 DOCX：`apps/platform/src/tailoring/`、`apps/platform/src/ai/`；决定与删除：`apps/platform/src/decisions/`
- 数据迁移：`packages/database/src/migrations/004_local_complete_mvp.ts` 至 `016_company_quota_selections.ts`

## 5. 本地恢复

```powershell
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm source:probe
pnpm source:import-browser-snapshot spirit-ai-feishu-manual --file .data/browser-imports/spirit-ai-feishu-manual-2026-07-26.json
pnpm catalog:materialize
pnpm dev
```

`source:probe` 会按配置低频访问已登记的真实官方来源，只能由维护者明确运行；`source:import-browser-snapshot` 只读取人工生成的本机快照，不会访问招聘站。日常测试和 CI 不应调用真实来源。产品入口：

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
[ ] 已确认目录为总供给 177 / 可见 113 条 local_mvp 岗位、15 家企业，十五个已接入来源仍 pending_review
[ ] 已确认 P0 15/15 自审通过，硕方 6 条、千寻 22 条，鹏扶按预设暂停且不补位
[ ] 已确认 ADR-0021 配额压缩生效（64 条公开缺口），配额恢复需合格规模证据
[ ] 已确认产品证据仍为 E0，G0/G1 未开始，G3 为 0/3
[ ] 已确认 R1 已完成，下一阶段是 R2，不提前进入后续来源批次
[ ] 已确认 P7 G2 终局判定是 coco 唯一保留的人工卡点
[ ] 已确认不会读取、打印或提交本机 AI 密钥
```
