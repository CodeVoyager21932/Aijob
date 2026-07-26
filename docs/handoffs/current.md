# 当前项目交接：中小企业 300–500 岗位与 JD 洞察进入 G2 重新验收

> 交接日期：2026-07-26
>
> 当前分支：`codex/g0-research-prototype`
>
> 动态事实源：[MVP 路线与当前决策面板](../06-mvp-roadmap.md)
>
> 工程与发现证据：[G2 正确性重新验收记录](../evidence/g2/correctness-reacceptance-2026-07-20.md)、[验收反馈修正记录](../evidence/g2/acceptance-followup-2026-07-20.md)、[全部职能扩容离线基础验收](../evidence/g2/all-function-expansion-foundation-2026-07-20.md)、[新公司官方来源首批评估与低频探测](../evidence/ingestion/new-source-batch-2026-07-20.md)、[1000 家审查宇宙首批台账](../evidence/ingestion/internship-company-universe-2026-07-26.md)、[审批包 01 执行记录](../evidence/ingestion/approved-source-batch-01-2026-07-26.md)

## 1. 当前唯一目标

原 31 岗位 `G2 Local Complete MVP` 已完成正确性修复和重新验收。coco 现按 ADR-0017/0018 将本机假设扩展为 20–30 家企业、300–500 条全部职能实习岗位，并新增确定性 JD 洞察；中小企业不少于企业数 60% 和岗位数 50%。新范围重新进入 G2 验收。当前不购买服务器、不招募或运行参与者任务，产品证据保持 `E0`。

2026-07-26 按 ADR-0019 完成 1000/1000 家企业/机构审查记录：前 300 家在主台账，301–1000 家分批保存在七个暂存表。合计 113 家有明确活动实习证据、227 家需继续复核、362 家仅为 `discovery_only`、296 家岗位已截止、2 家命中为非岗位活动。301–1000 家中 699 家有岗位级或企业官方证据、1 家只有已结束的企业 AI 实习专场证据；历史与当前合并的方向发现覆盖为电子信息技术 262 家、产品/运营 200 家、两类重叠 88 家，374/700 家至少覆盖一个优先方向，但 `active_explicit` 中对应数量仅为 48 家、39 家和 18 家。123 家记录到企业官方 URL、企业域名邮箱或两者，其中只有 74 家尚未标为截止。901–1000 家的 100 个高校历史详情页均可正常访问，但全部只证明历史供给，未新增当前活动岗位或官方申请链；浙江精准学因企业加入页实际导向 BOSS 已从官方申请链降级。公司行业没有替代岗位方向证据，暂存记录还未因完成检索而获得 `candidate`、探测或导入资格。

2026-07-26 晚 coco 批准审批包 01 并确认百度/京东/字节抽检通过，随后完成执行：

- 帆软、慧策、灵明光子、普渡完成低频结构核验、契约冻结、适配器实现与真实探测，各导入首批 5 条明确实习岗位；四次运行各只发 1 个列表请求、5/5/0，重复探测幂等不触网。
- 新增 `fanruan-trainee-public-api` 适配器（表单 POST 列表 JSON、mode=实习官方标记）与 `beisen-zhiye-public-api` 共享适配器（三租户注册表、0 起分页、Category 1/2/3 官方语义、PortalId 人工冻结、标题实习标记过滤）。
- `safe-http` 新增受控 `formBody`（与 `jsonBody` 互斥，既有 JSON 调用行为与指纹不变）。
- 千寻智能因飞书 ATS 岗位接口需动态 CSRF 令牌+Cookie 会话，按审批包预设暂停并转人工浏览器快照候选。
- 物化后本地目录 61 → 81 条；20/20 新修订为实习生 scope、有官方申请链与活动要求集；0 疑似重复对；整库 19 MB。
- 全量 337 项测试、TypeScript、生产构建、255 文件 lint 通过。
- coco 抽检通过后已提额到单家最多 30 条：帆软 18、慧策 30、灵明 7、普渡 30，目录 146 条；详见审批包 01 执行记录第 8 节。

同日抽检反馈修复（北森申请链接与字段契约，适配器 0.1.1、政策 v2）：

- coco 发现灵明光子逐岗详情链接报"参数错误"；实测三租户官方 `GetJobAdInfo` 对包括官方详情页自身在内的全部调用一律参数错误，逐岗深链在官方侧不可用。官方交互为职位列表页内联详情+立即投递，申请链接改为官方列表页（慧策 `/campus/jobs`、灵明/普渡 `/intern/jobs`，均人工验证可用；先例为南开·好未来指向 Moka 列表页）。
- 列表契约修正：请求体带含 `LocId` 的 `DisplayFields` 才返回城市与发布时间；修复后目录城市"已知 66 · 未说明 15"变为"已知 81 · 未说明 0"，北森岗位补齐 `publishedAt`。标题实习标记与官方 `Kind` 矛盾时仍导入但写 `SOURCE_KIND_CONFLICT` 复核项。
- 重探测 3 租户各 5/5/0、重物化 15 新版本、目录保持 81 条；修复后全量 339 项测试、TypeScript、生产构建、256 文件 lint 通过。集成测试改用隔离数据库 `aijob_test`（与 dev worker 共库会互抢任务队列）。运行与验证细节见[审批包 01 执行记录](../evidence/ingestion/approved-source-batch-01-2026-07-26.md)第 7 节。

2026-07-20 验收反馈修正：

- “简历与画像”和“数据控制”可查看、复用并重新选择确认后保留 30 天的结构化简历区块，不恢复已删除的原文件/临时原文。
- 经历证据匹配升级为有版本、可解释的能力词典；“用户调研—用户访谈”“数据分析—SQL/指标看板”可连接，但 SQL/Python/Figma 等明确工具仍必须原词命中。
- 推荐页直接解释资格、证据、偏好和排序逻辑；真实 31 岗位合成验收从统一 0/N 变为按实际要求出现 1/2、1/9、2/6、3/5 等覆盖。
- 当前 PostgreSQL 整库约 16 MB（扩容前实测约 15 MB）；扩至 300–500 条的瓶颈是官方来源审查与维护，不是存储。1000 条合成岗位已在同一 PostgreSQL 中完成目录筛选与确定性排序容量回归并回滚。
- 岗位目录的关键词、城市和岗位方向已统一基线，“查看岗位”移入独立操作区；已保存简历支持一键全选和清空，并在保存前显示 N/总数。

2026-07-20 已修复并重新验收：

- 31 个活动岗位统一读取 v4 活动要求集和唯一条件投影；解析器升级没有伪造岗位版本。
- “优先”局部化；目标美团学历在读、3 个月、4 天均为独立 `required` 原子要求。
- 有序 `ResumeDocumentRevision` 和 `ResumeEvidence v2` 建立单块引用；1612 字无换行文本拆为 4 块。
- 学历、专业、毕业年份、在校状态和技能候选补齐；真实浏览器发现的专业候选错位已修复。
- 不限城市语义、coverage、basisState、类型化 gaps、资格分组和 `decision-readiness-v2` 已落地。
- AI 返回单块真实建议稿和引用，未选区块原序保留；页面可逐条编辑、自动增高并导出真实章节 DOCX。
- 岗位详情加载竞态和 320 px 最终预览横向溢出已在真实浏览器中发现并修复。

当前闭环已经能在本机运行：

```text
十个已接入来源 146 条岗位
  -> 清洗、去重、结构化和来源追溯
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

- 本地目录为 146 条：普渡机器人 30、慧策 30、帆软 18、腾讯 14、字节 10、百度 10、美团 10、京东 10、南开就业网·好未来 7、灵明光子 7；coco 已完成 4 家新来源抽检，单家提额到 30 条上限（普渡 72 条供给中保留 42 条缺口记录）。
- 十个已接入来源均为 `pending_review`，只能进入本机 `local_mvp`；公开 `/v1/jobs` 保持 0 条。
- 帆软探测运行 `78559a41-3e4d-496e-9ef4-ce9c8917d68d`、慧策 `e0ff6f5f-4c19-4c65-863a-b4c74ae5cb2f`、灵明光子 `3c057595-e623-4a69-9394-ce4176aea58e`、普渡 `f498eeba-d368-40d6-a4f4-a01b67144b99` 各只发 1 个列表请求、发现/规范化 5/5、拒绝 0；重复探测复用原任务不触网。
- 北森 zhiye 共享适配器覆盖慧策/灵明光子/普渡三租户；PortalId 与 Category 于 2026-07-26 从官方入口人工冻结；标题无实习标记的岗位一律拒绝。帆软以 mode=实习为官方标记，社招/兼职一律拒绝。
- 千寻智能保持暂停：飞书 ATS 岗位接口需动态 CSRF 令牌与 Cookie 会话，转人工浏览器快照候选。
- 新增 `organization_official_account`、公司规模证据和 `official_url/company_email` 投递方式；公众号只允许本机零网络人工快照，个人邮箱、二维码-only、非实习岗位和不确定表单整批拒绝。
- `/insights` 和 `JobInsightRun` 已实现：至少 20 岗位、5 家企业、70% 原子要求覆盖才输出排名；按公司数优先，硬要求、能力经验和加分项分离，冻结岗位版本、要求集、来源核验时间和 `ResumeEvidence v2` 修订。
- 旧 `ResumeEvidence v1` 不参与个人洞察，也不生成伪 `sourceBlockId`；用户必须重新确认后才能对照。
- 字节列表、筛选和详情接口依赖动态 `_signature`，不带签名不能获得岗位 JSON；未逆向或复制签名。ADR-0016 允许人工读取官方可见 DOM，导入 CLI 只读本机快照且没有招聘站网络请求能力。
- 百度成功探测运行 `cf967b11-69f7-4e1a-b038-1bee8af74c2d` 发现/规范化 10/10、拒绝 0；10/10 有活动要求集和官方 UUID 申请链接。
- 京东成功探测运行 `1832f7e8-331f-424b-a762-d65a11e7db91` 只发送 1 个列表请求，发现/规范化 10/10、拒绝 0；10/10 为活动岗位、10/10 有活动要求集和官方详情链接。
- 字节人工导入运行 `aa5c2271-a5b8-41ef-ab75-c61aa3028280` 的 `request_count=0`，发现/规范化 10/10、拒绝 0；10/10 修订标记为 `manual`、10/10 明确为实习、10/10 有活动要求集和官方详情链接。
- 重复百度与京东探测均直接复用各自原运行记录且不触网；京东重复物化返回 51 个 eligible revisions、0 个新岗位版本、0 个新要求集、0 个疑似重复对。
- 正式 `/jobs/*`、简历、确认、推荐、优化、数据控制页面均由 PostgreSQL 和 `/v1` API 提供数据。
- localhost 匿名 owner、Origin/CSRF、owner epoch、不可变修订、TTL、删除墓碑和迟到任务拒绝已实现。
- PDF、DOCX、粘贴文本、5 MiB 限制、MIME/魔数、宏/加密/ZIP bomb/扫描 PDF 失败路径已有自动化覆盖。
- 三轴、32 个命名金标、coverage/basisState/类型化 gaps、确定性分组推荐、冻结要求集/画像/核验时间、五态决定和官方链接交接已实现。
- 当前 owner 可跨日读取确认后的 `ResumeDocumentRevision` 并只用当前 `sourceBlockId` 重选经历证据；每次保存生成新的不可变 evidence 修订。
- 经历证据规则为 `eligibility-rules-v3`、`zh-cn-internship-v3+capability-ontology-v2` 和 `three-axis-explanation-v3`；v2 增加全部职能的高精度能力词典，具体工具要求仍不使用能力域替代。
- AI 只能对单个已确认 `sourceBlockId` 返回建议稿，并引用已确认 evidence/requirement ID；服务端逐块校验，失败时安全降级为模板。
- 固定合成数据的真实 OpenAI-compatible 冒烟已通过；共享精确输出契约与 `resume-tailoring-selection-v2` 防止模型自创字段名，Schema 保持严格。
- 本地 AI 配置通过 `pnpm ai:configure` 写入 Git 忽略的后端文件；前端没有供应商配置接口，线上配置来源留待部署阶段替换。
- 逐段决定、复制、冻结后的 DOCX 和全部个人数据删除已跑通。
- 本地简历加密密钥首次启动时随机生成并保存在 Git 忽略的 `.data/`；`alpha/production` 必须显式配置，不再使用源码固定密钥。
- 用户任务的开始、成功和失败写入均在同一事务核对 owner、epoch、租约、心跳期限与 fencing token；租约接管和删除撤销后的旧 worker 不能写回业务表。
- 简历解析结果只持久化无正文元数据；完整候选仅在 active owner 和 24 小时 TTL 内从加密文本即时重建，确认、到期或失败会清除正文与原始文件名。
- 固定 owner 保留期到期会并发幂等地创建删除墓碑、撤销会话并清理全部个人数据；DOCX 密文 24 小时、结构化数据 30 天、无正文审计与删除墓碑 90 天的边界均有 PostgreSQL 集成覆盖。
- 简历确认与 owner 删除后会清理浏览器中的原文、画像、推荐和优化缓存；岗位详情不会展示属于其他岗位版本的旧匹配结果。
- 语义相同的新来源修订通过关联表复用不可变岗位版本；目录物化使用 PostgreSQL advisory lock 串行提交。
- 2026-07-20 重新验收结果：244 项测试、TypeScript、生产构建和 202 文件 lint 全部通过。
- 随后验收反馈修正结果：全量 247 项测试、TypeScript、生产构建和 203 文件 lint 通过；真实浏览器完成资料复访、3→2 段证据重选、31 条重新推荐和能力解释核对。
- 全部职能离线扩容基础结果：隔离数据库中 285 项测试、TypeScript、生产构建和 212 文件 lint 通过；1000 岗位容量用例、来源候选 CLI 和本机浏览器复核通过。
- 字节人工导入后结果：隔离数据库中 300 项测试、TypeScript、生产构建和 225 文件 lint 通过；人工导入 PostgreSQL 集成与 1000 岗位容量回归继续通过。
- 洞察与公众号实现已通过隔离数据库中的全量 317 项测试、TypeScript、生产构建和 245 个文件 lint；覆盖低样本拒绝、真实覆盖分母、幂等、owner 隔离、不可变运行、删除联动、公司规模数据库约束、企业邮箱和零网络导入。
- 旧字节集成测试已改为随机合成来源，不再清理本机真实来源；字节 10 个修订与 10 个目录版本未变化，70 条字段证据和 26 条复核项已由原本机快照恢复，恢复运行未产生新修订。
- 审批包 01 收束物化返回 146 个 eligible revisions、65 个新岗位版本、65 个新 v4 要求集、0 个疑似重复对；146 条目录由活动要求集驱动，85/85 新来源修订为实习 scope 且有官方申请链。
- 真实浏览器用纯合成简历完成 31 条推荐、目标美团详情、逐块改写、9,125 字节 DOCX 和全部个人数据删除。
- 真实浏览器在 `/insights` 生成产品方向洞察时得到 18 个岗位、4 家公司、18/18 要求已拆解，并按门槛明确显示“样本不足”、不输出伪排名；控制台无错误。
- 1280 px 与 320 px 下目录、详情、推荐、岗位洞察和优化无全局横向溢出；洞察筛选、样本卡片和按钮文字完整，优化文本框自动增高。

## 3. 当前未完成项

1. 当前目录为 146 条、10 家企业；300–500 条、20–30 家、中小企业占比、规模证据、至少 50 条跨职能分类金标尚未完成。
2. 审批包 01 四家与百度/京东/字节的人工抽检均已由 coco 确认通过；四家新来源已提额至单家 30 条上限。下一步收敛审批包 02；301–1000 家仍需逐步补齐行业、主体、导入处置和企业规模证据后再分批合并主台账。千寻智能等待 coco 决定是否安排人工浏览器快照批次。
3. G0 的 2 人协议校准尚未开始；扩大后的 G2 通过后才招募、执行和记录，不以工程测试代替参与者。
4. G3 来源准入仍为 0/3，十个已接入来源继续保持 `pending_review` 和仅限本机的 `local_mvp` 状态；人工导入不计持续性。
5. 公开 AI 仍未获批准，需要后续供应商、隐私、合规和至少 4/6 增量价值 Gate。

真实 AI 冒烟不是公开启用批准。公开 AI 仍需供应商、隐私、合规和至少 4/6 增量价值 Gate。

## 4. 关键实现位置

- 岗位目录：`apps/platform/src/catalog/`、`apps/web/src/pages/JobListPage.tsx`
- 官方来源：`apps/platform/src/sources/`、`config/sources/`；新批次适配器为 `fanruan-trainee-adapter.ts` 与 `beisen-zhiye-adapter.ts`（三租户注册表）
- 匿名 owner 与安全：`apps/platform/src/identity/`、`apps/platform/src/profile/`
- 简历：`apps/platform/src/resume/`、`apps/web/src/pages/ResumePage.tsx`
- 匹配与推荐：`apps/platform/src/matching/`、`apps/web/src/pages/RecommendationsPage.tsx`
- JD 洞察：`apps/platform/src/insights/`、`apps/web/src/pages/JobInsightsPage.tsx`
- 优化与 DOCX：`apps/platform/src/tailoring/`、`apps/platform/src/ai/`、`apps/web/src/pages/ResumeTailoringPage.tsx`
- 本地 AI 配置：`apps/platform/src/ai/local-provider-config.ts`、`apps/platform/src/config/platform-config.ts`、`pnpm ai:configure`
- 决定与删除：`apps/platform/src/decisions/`、`apps/web/src/pages/DataControlPage.tsx`
- 数据迁移：`packages/database/src/migrations/004_local_complete_mvp.ts` 至 `015_freeze_job_insight_source_verifications.ts`

## 5. 本地恢复

```powershell
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm source:candidates
pnpm source:assess
pnpm source:probe
pnpm source:import-browser-snapshot bytedance-campus-manual --file .data/browser-imports/<snapshot>.json
pnpm catalog:materialize
pnpm dev
```

`source:probe` 会按配置低频访问已登记的真实官方来源，只能由维护者明确运行；`source:import-browser-snapshot` 只读取人工生成的本机快照，不会访问招聘站。日常测试和 CI 不应调用真实来源。产品入口：

- <http://127.0.0.1:5173/jobs>
- <http://127.0.0.1:5173/resume>
- <http://127.0.0.1:5173/recommendations>
- <http://127.0.0.1:5173/insights>
- <http://127.0.0.1:5173/data-control>

日常工程门：

```powershell
$env:AIJOB_TEST_DATABASE_URL='postgresql://aijob:aijob@127.0.0.1:5432/aijob'
pnpm test
pnpm typecheck
pnpm build
pnpm lint
```

## 6. 不得改变的边界

- 不抓 BOSS、实习僧、牛客等综合平台，不绕过登录、验证码或访问控制。
- 未说明字段保持 `unknown`；资格、证据、偏好分开；不显示匹配百分比或自动劝退。
- `pending_review` 只允许本机目录，不得写成获准公开或 G3 已通过。
- AI 不修改三轴、不创造经历、不调用工具；原文件不发送给模型。
- 不自动填写、模拟登录、批量投递或替用户提交。
- 不引入 Redis、向量库、独立搜索、消息总线、生产 Playwright 或公共管理后台；ADR-0016/0017 只允许维护者按批次人工生成官方可见内容快照。
- 不提交 `.data/`、密钥、令牌、简历原文、本地数据库或下载的 DOCX。

## 7. 新任务接手检查

```text
[ ] 已读 AGENTS.md、README.md、docs/06-mvp-roadmap.md 和本交接
[ ] 已检查分支、git status、最近提交和未提交差异
[ ] 已确认目录是 146 条 local_mvp 岗位，十个已接入来源仍 pending_review
[ ] 已确认产品证据仍为 E0，G0/G1 未开始，G3 为 0/3
[ ] 已确认原 31 岗位正确性基线已于 2026-07-20 重新通过，但 300–500 条、中小企业与 JD 洞察扩大范围的 G2 仍在重新验收；产品证据仍为 E0，G0/G1 未开始，G3 为 0/3
[ ] 已确认不会读取、打印或提交本机 AI 密钥
```
