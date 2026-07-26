# 当前项目交接：审批包 02 执行完毕，等待 coco 抽检批次 02 与千寻快照

> 交接日期：2026-07-26
>
> 当前分支：`codex/g0-research-prototype`
>
> 动态事实源：[MVP 路线与当前决策面板](../06-mvp-roadmap.md)
>
> 工程与发现证据：[G2 正确性重新验收记录](../evidence/g2/correctness-reacceptance-2026-07-20.md)、[验收反馈修正记录](../evidence/g2/acceptance-followup-2026-07-20.md)、[审批包 01 执行记录](../evidence/ingestion/approved-source-batch-01-2026-07-26.md)、[审批包 02 执行记录](../evidence/ingestion/approved-source-batch-02-execution-2026-07-26.md)、[1000 家审查宇宙台账](../evidence/ingestion/internship-company-universe-2026-07-26.md)、[分层收录清单](../evidence/ingestion/import-candidate-list-2026-07-26.md)

## 1. 当前唯一目标

coco 按 ADR-0017/0018 将本机假设扩展为 20–30 家企业、300–500 条全部职能实习岗位（中小企业不少于企业数 60% 和岗位数 50%），新范围处于 G2 重新验收。当前不购买服务器、不招募或运行参与者任务，产品证据保持 `E0`。

2026-07-26 coco 作出四项决定并已全部执行：

1. **审批包 02 修订为纯 SME 版并批准**（硕方、鲸驰寰宇、神谷文化、红海云、鹏扶，米哈游移入批次 05）。执行结果：4 家完成核验、契约冻结、真实低频探测与首批导入（硕方 5、其余各 1，全部 0 拒绝、重复探测幂等不触网）；**鹏扶按预设暂停**——页面主体为上海鹏扶投资管理有限公司（台账误记法人名），同页两个投递邮箱域名 `pengfu.tech`/`pengfu.fund` 均无主体证据且互相矛盾。
2. **方案 A 落地为 [ADR-0021](../decisions/0021-compress-large-company-quota-and-publish-sme-gap.md)**：无 `small/medium` 规模证据企业单家目录配额压缩至 10 条（有证据企业维持 30），择优保留 ADR-0020 双优先轨道，缺口公开分母。迁移 016 建立确定性配额选择表，物化择优、目录/洞察读取过滤与 `/v1/jobs` `companyQuotaGaps` 已上线；普渡 30→10、慧策 30→10、帆软 18→10、腾讯 14→10，共压缩 52 条（版本与修订历史完整保留）。
3. **千寻智能/万境千寻人工快照批次执行**：两条台账记录实为同品牌（Spirit AI），合并为单一来源 `spirit-ai-feishu-manual`（飞书 ATS 站点主体千寻智能（杭州）科技有限公司，目录展示品牌名"千寻智能"）。按 ADR-0016 人工浏览器读取职位列表第一页 10 岗（页面自身调用的公开接口响应），7 条含完整职责与任职要求进入零网络快照导入（`request_count=0`、重放幂等）；3 条无任职要求正文的岗位按最低字段要求排除留痕。
4. **放弃窗口 ≤6 天的 5 家**（壳牌、恒丰、开源证券、汉腾、巨一）。

关键核验事实（批次 02）：

- 硕方：南开实习信息栏目 6 页同企业详情（116235–116240）；发布主体北京硕方信息技术有限公司经 `supvan.com.cn` 页脚营业执照核验；投递走原文明示的 `https://www.supvan.com/joinUs`（关联主体硕方科技官网，Moka 先例、仅导航不采集）；邮箱域 `jtsupvan.com` 无主体证据被白名单拒绝并留 `COMPANY_EMAIL_DOMAIN_UNVERIFIED` 复核标记。
- 鲸驰寰宇：契约冻结港中深中文版页面（台账证据为英文路径）；邮箱与原文明示官网 `jcquant.vip` 同域通过；官网建设中留复核项。
- 神谷文化：邮箱域 `shengumedia.com` 无可达网站，以工商登记企业邮箱同域佐证通过。
- 红海云：实际岗位名为**商务助理**（台账误记业务助理）；`hr-soft.cn` ICP 主体精确匹配；浙大企业信息栏 200-500 人构成首个合格中小规模证据（`medium`，配额 30）；工作性质"全职,实习"与多城市补充说明留 `SOURCE_KIND_CONFLICT`/`MULTI_CITY_SUPPLEMENT` 复核项。

当前闭环已经能在本机运行：

```text
十五个已接入来源，总供给 161 条、按 ADR-0021 配额可见 109 条
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

- 目录终态：总供给 161 条、可见 109 条、15 家企业——京东/帆软/腾讯/百度/慧策/字节跳动/美团/普渡机器人各 10、灵明光子 7、千寻智能 7、好未来 7、硕方信息 5、神谷文化 1、红海云 1、鲸驰寰宇 1；被压缩 52 条保留全部不可变版本并在目录页公开"X/供给 Y"。
- 十五个已接入来源均为 `pending_review`，只能进入本机 `local_mvp`；公开 `/v1/jobs` 保持 0 条。
- 批次 02 探测运行：硕方 `4983f114-…`（5 请求、5/5/0）、鲸驰 `82b31eec-…`、神谷 `8f9c014c-…`、红海云 `c6341cef-…`（各 1 请求、1/1/0）；重复探测复用原任务不触网。千寻快照导入运行 `f9d7adc7-…`（v1）与 `e79f7d6a-…`（v2 品牌名调整），均 `request_count=0`、7/7。
- 新增共享适配器 `university-employment-detail-html` 0.1.0：冻结南开 correcruit / 港中深 jobview（中文版）/ 浙大 jyxt 三种载体格式；每页一岗单请求、服务端无 Cookie curl 复现、严格 UTF-8；company_email 复用企业域名白名单（域名相等或子域 + 原句含邮箱），official_url 与页面原文明示网址精确比对，fail-closed 负例有离线覆盖并经四张真实页面互证。
- ADR-0021 配额机制：`catalog.company_quota_selections`（迁移 016）由物化在同一事务整表重写；择优为优先轨道（product/operations/engineering/data_ai 的 known 值）在前、组内按 created_at 与 id 稳定排序；目录 `loadLocalRows` 与洞察样本 SQL 按 `selected` 过滤，推荐候选集经目录搜索自然继承，历史冻结运行不回溯；未物化修订不受配额影响（兼容既有容量测试路径）。
- `/v1/jobs` 搜索响应新增可选 `companyQuotaGaps`（公司、规模档、配额、供给、已显示），目录页顶部公示缺口且注明"不代表岗位关闭"。
- 中小企业占比现状（公开分母）：有合格中小规模证据企业 1/15（红海云 medium）、中小证据岗位 1/109；其余 `unknown` 按非中小计；距 60%/50% 目标缺口显著，不降低证据标准凑比例。
- 千寻智能来源：`sourceType=official_ats`、`acquisitionMode=browser_required`、复用 `official-account-manual-snapshot` 通用适配器（无新代码路径）；快照文件在 Git 忽略的 `.data/browser-imports/`；官方逐岗详情页作为 `official_url` 投递；动态签名与 CSRF 未逆向、未复用。
- 审批包 01 既有事实（北森列表契约、帆软表单、官方列表页申请链、字节人工快照、百度/京东幂等探测等）继续有效，详见其执行记录。
- 正式 `/jobs/*`、简历、确认、推荐、优化、数据控制页面均由 PostgreSQL 和 `/v1` API 提供数据；localhost 匿名 owner、Origin/CSRF、owner epoch、不可变修订、TTL、删除墓碑和迟到任务拒绝已实现。
- 三轴、32 个命名金标、coverage/basisState/类型化 gaps、确定性分组推荐、冻结要求集/画像/核验时间、五态决定和官方链接交接已实现；AI 只能对单个已确认 `sourceBlockId` 返回建议稿并逐块校验，失败安全降级为模板。
- 2026-07-26 审批包 02 收束工程门：隔离数据库 `aijob_test` 中全量 359 项测试（platform 268、web 56、config 16、contracts 14、database 5）、TypeScript、生产构建、biome lint（264 文件）通过。

## 3. 当前未完成项

1. 目录可见 109 条、15 家企业；300–500 条、20–30 家、中小企业占比（企业数 60% / 岗位数 50%）、至少 50 条跨职能分类金标尚未完成，缺口按 ADR-0020/0021 公开。
2. **等待 coco 逐条抽检**：批次 02 首批 8 条（硕方 5、鲸驰 1、神谷 1、红海云 1）与千寻快照 7 条。通过后硕方提额至 6 条、千寻采集剩余 19 条（列表第 2、3 页）。
3. 等待 coco 决定：鹏扶暂停后是否从备选池替换；批次 03 名单（台账建议：昆仑芯、鼎帷、Flab、分享成长、DTL量化）。
4. 台账回写待办：鹏扶法人名更正与申请链降级、红海云岗位名更正（商务助理）、千寻/万境双记录合并标注；301–1000 家仍需逐步补齐行业、主体、导入处置和企业规模证据后分批合并主台账。
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
[ ] 已确认目录为总供给 161 / 可见 109 条 local_mvp 岗位、15 家企业，十五个已接入来源仍 pending_review
[ ] 已确认批次 02 首批 8 条与千寻快照 7 条尚待 coco 逐条抽检，鹏扶按预设暂停
[ ] 已确认 ADR-0021 配额压缩生效（52 条公开缺口），配额恢复需合格规模证据
[ ] 已确认产品证据仍为 E0，G0/G1 未开始，G3 为 0/3
[ ] 已确认不会读取、打印或提交本机 AI 密钥
```
