# 当前项目交接：供给准入扩容轨道（SA Track）阶段 0 进行中

> 交接日期：2026-08-28
>
> 当前分支：`codex/career-os-ux-convergence`
>
> 精确 HEAD、远端跟踪与工作树以 `git log -1`、`git status` 为准。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

当前执行计划：[供给准入扩容轨道（SA Track）](../plans/supply-admission-scaleup-track.md)（进行中，阶段 0）

上一轨道计划：[Career OS 前后端同步改进计划](../plans/career-os-current-delivery-plan.md)（已收敛，OS-1–OS-7 全部关闭）

稳定实施契约：[Career OS 端到端体验与系统契约](../14-career-os-end-to-end-experience-contract.md)

当前追踪矩阵：[UX-0 页面—系统—证据追踪矩阵](../plans/career-os-ux-0-end-to-end-traceability-matrix.md)

本轮关闭证据：[OS-7 系统总 Gate 验收](../evidence/product/career-os-v2/os-7-system-gate-acceptance-2026-08-28.md)

过程检查点（已被取代）：[OS-7 暂停检查点](../evidence/product/career-os-v2/os-7-system-gate-checkpoint-2026-08-28.md)

## 0. 绿色基线

| 提交 | 性质 |
|---|---|
| OS-7 验收对应提交 | **当前绿色基线。** 五项状态全部通过；全仓 808/808、lint 485 files、typecheck、build（主包 401.33 kB）、audit、隔离 PostgreSQL、双库四视口浏览器 Gate 与 diff check 均通过 |
| `e56ceae feat(career-os): close os6 lifecycle and data control` | 上一绿色基线（OS-6，801/801）。注意：其记录的 typecheck 通过对 `apps/platform/src/resume-documents/routes.integration.test.ts` 并不成立，该缺口已在 OS-7 修复并登记 |
| `10f7451 chore(career-os): checkpoint paused os7 gate` | OS-7 中途暂停检查点，**不是**通过版本；已被 OS-7 验收取代 |

## 1. 当前决定

**OS-7 已完成（UX-0 与 OS-1–OS-7 全部关闭）。coco 于 2026-08-28 选择「供给准入扩容」为下一条轨道。SA Track 的 Phase A（零触网标准与机制）A1–A10 已全部完成。**

四份 ADR 均已 `accepted`（2026-08-29）：

- [ADR-0035](../decisions/0035-student-applicable-supply-admission.md)：供给单位从「实习岗位」改为「**在校生可投岗位**」；来源稳定性按**观察次数与跨度**计量而非在线时长；撤销一批任意数值与分布配额门槛；投递入口缺失改为待审核；ATS 租户恢复为线索。**这份是当前供给准入的主口径,与它冲突的旧表述以它为准。**
- [ADR-0032](../decisions/0032-reachability-first-supply-admission.md)：以可达性取代 SME；冻结五项收录属性；用户可见岗位必须 `closure_detectable`。其「可达岗位 ≥50%」聚合门槛**已由 ADR-0035 撤销**，可达性判据本身保留并升格为逐岗位准入判据。
- [ADR-0033](../decisions/0033-access-policy-basis-and-minimal-body-scope.md)：以站点 `robots.txt` + 服务条款为 `accessPolicyAccepted` 判据；岗位正文限定在职责与任职要求原句（D1）。审定时未取得法律意见，按原样记录在该 ADR 的前置条件里。
- [ADR-0034](../decisions/0034-two-layer-source-admission-and-reconciled-publication.md)：来源准入拆为**厂商层／租户层**两层；**解除公开供给的结构性死锁**；发布由**双向资格对账**自动驱动。§一+§二+§四 已落地，§三 已完成北森族（每家约 158 行 → 约 87 行）。

### ADR-0034 的核心发现：公开供给恒为 0 是循环依赖，不是门槛太严

`eligible_for_alpha` 的条件里含 `AND publication_state = 'published'`，而 `NormalizedOfficialJob.publicationState` 是字面量类型 `"review"`，全仓无任何生产代码写过 `published`（只有测试夹具）。`materialize.ts` 又只在修订为 `published` 时设 `catalog.published_jobs.public_version_id`，而所有公开读取路径（`catalog/repository.ts`、`matching/service.ts`、`insights/service.ts`、`local-bootstrap.ts`）在非 local MVP 时都走该指针。

**要「已发布」才算「够格发布」，而发布只在「已发布」时发生。** 因此松开 `accessPolicyAccepted` 或任何上游门都不会让公开供给变成正数。数据库无障碍：migration 001 允许 `published`，`public_version_id` 可为空。

两条必须一起满足的实现约束：

1. `revision_content_hash` 的输入包含 `publicationState`，因此**改写 `revision.publication_state` 会破坏不可变性与可复现性**（ADR-0029 §11）。发布只能表达在 `public_version_id`。
2. **自动发布必须配自动撤回。** 指针是持久化的，来源被自动 `paused`、岗位过期、新鲜度过期、职责或要求被清空、复核项打开，都会使资格失效而指针滞留，产生对外可见漂移。只做单向发布比完全不发布更糟。

保留的人工动作仅三项，且都是逐来源一次、不随岗位数量增长：来源准入（`policy.status → approved`）、运行范围提升（`runtime_scope → alpha`）、强制下架（履行「异议即停」）。

三份 ADR 已于 2026-08-29 由 coco **审定通过**（状态 `accepted`）。ADR-0033 未取得法律意见即被审定，这一点按原样记录在该 ADR 的前置条件里。

### ADR-0034 §一+§二+§四 已落地（零触网）

- 迁移 **035** 重建 `catalog.job_version_eligibility`：去掉 `publication_state = 'published'`，新增 `publication_suppressed` 条件；`catalog.published_jobs` 增加 `publication_suppressed_at` / `publication_suppressed_reason`（CHECK 要求成对）；新增 `catalog.publication_events` 并逐角色授权。
- `materialize.ts` 不再设置 `public_version_id`，只负责 `current_version_id`。
- 新增 `catalog/publication-reconciliation.ts`：`reconcilePublication` 做双向对账（合格即发布、失格即撤回、指针前移至最新合格版本），`suppressJobPublication` / `releaseJobPublicationSuppression` 提供人工强制下架与解除。CLI 加 `catalog-reconcile-publication`、`catalog-suppress-job`、`catalog-release-job-suppression`。
- 删除 `publicationAllowed`（含 36 份配置各一行），`candidateStatus` 与 `completion` 放宽为枚举。

**落地时发现的最重要事实：循环依赖不止一处。** `publication_state = 'published'` 除资格视图外，还散布在 **6 处生产读取路径**：`catalog/repository.ts` 公开查询、`matching/service.ts` 三处（`getMatchRun`、快照查询、推荐候选查询与其 TS 守卫）、`local-bootstrap.ts` 的 `publicJobs` 统计、`insights/service.ts` 的行过滤。这些位置的公开分支**本来就已带指针条件**，那句是冗余且致死的，已统一改为 `IN ('review','published')`（与 `PUBLICATION_NOT_REVIEWABLE` 同义，仍挡住 `draft`/`suppressed`/`archived`）。另外 `catalog/repository.ts` 的 `displayStatus` / `isInternal` 由 `publication_state` 推导，若不处理会把每个公开岗位标成 `pending_review`、`isInternal` 恒真，因此公开查询改为按指针派生该列。

只改视图不足以解除死锁——这是本轮最容易漏掉的一点。

### ADR-0034 §三 两层 schema 已落地

`source-config.ts` 已拆为厂商层与租户层，北森族 5 份配置迁到租户形状（790 → 539 行，每租户约 158 → 约 87 行）。等价性由 `fixtures/source-configs/legacy-beisen/` 的冻结基线证明，而不是拿迁移后的配置自我比较。

### ADR-0035 已落地：迁移 037 与「对外才筛」的具名化

- 迁移 **037** 新增 `catalog.job_reachability_verdict(text, text)`，并**同时重建两个资格视图**（`current_job_eligibility` 与 `job_version_eligibility`）。判定做成数据库函数而非视图内联，因为同一套短语已存在于 `packages/contracts/src/job-reachability.ts`；两份实现的**逐分支对账**由 `apps/platform/src/sources/job-reachability-sql-parity.integration.test.ts` 覆盖（`@aijob/database` 刻意不依赖 `@aijob/contracts`，不为一个测试反转分层）。
- 新增列 `reachability_verdict`、`student_applicable`、`alpha_blocking_reasons`。`RESPONSIBILITIES_MISSING` + `REQUIREMENTS_MISSING` 合并为 `JOB_BODY_MISSING`（至少存在其一）。
- **只约束对外可见的四项必须具名，不能内联成布尔条件。** 第一版把新鲜度、核验时效、投递入口与可投性直接 AND 进 `eligible_for_alpha`，结果 `publication-reconciliation` 撤回公开指针时 `blocking_reasons` 为空、原因码退化为笼统的 `NOT_ELIGIBLE_FOR_ALPHA`——ADR-0034 明确要求逐项区分撤回原因。现在这四项产出 `SOURCE_NOT_FRESH`、`JOB_NOT_RECENTLY_VERIFIED`、`EXACT_APPLICATION_NOT_AVAILABLE`、`JOB_NOT_STUDENT_APPLICABLE`，汇成 `alpha_blocking_reasons`，撤回事件把它与 `blocking_reasons` 一并记入。
- **两个视图必须同时改。** 第一版只改版本级视图，于是 ADR-0035 第九条（新鲜度只约束对外可见）在本机预览上根本没生效——本机预览读的正是 `current_job_eligibility`，而 `SOURCE_NOT_FRESH`（223 条）与 `JOB_NOT_RECENTLY_VERIFIED`（110 条）恰是实测阻塞量最大的两项。`019_official_source_catalog_eligibility.integration.test.ts` 现在对两个视图断言**同一份**期望，分叉复现即失败。
- 适配器侧撤销标题过滤：北森族不再因标题不含「实习」而丢弃岗位，筛选上移到资格层。`fanruan-trainee-adapter` 与 `university-employment-adapter` 的 `*_NOT_EXPLICIT_INTERNSHIP` 过滤**尚未**同样处理，见下文待办。
- 顺带修掉一个预先存在的时序 flake：`024_resume_document_v2_expand.integration.test.ts` 用插入**之前**取的 JS 时间戳推进 `updated_at`，并行跑全量时插入常落在 1 秒之后，于是 `resume_documents_update_after_creation` 间歇性拒绝。改为从数据库读回 `created_at` 再推进，去掉对时钟与延迟的依赖。

### ADR-0035 收口：过度限制的其余三处

**实习字样过滤已全部清掉。** `probe.ts` 里整个「软拒绝」分类被删除——它只装四个 `*_NOT_EXPLICIT_INTERNSHIP` 码，存在的唯一理由是「这条不是实习」不该算采集冲突，供给单位改掉后集合为空，随之 `scheduledRefreshRejectionCode`、`trackedRecordAwareRejectionCode` 与 `TRACKED_RECORD_NOT_INTERNSHIP` 一并失效。`isHardRefreshConflictCode` 回到本来的样子：凡不可重试即硬冲突。

高校适配器的六处 `实习` 检查**不是同一类东西**，分开处置：三处是字段取值过滤（CUHK 与 ZJU 的「工作性质」、以及 `normalizeUniversityEmploymentJob` 里那道**全部高校来源共用**的过滤——每个解析器最终都汇到 normalize，它一条就足以把校招、应届与管培生全部挡在库外），已撤销；另外三处保护的是**冻结公告与标题锚点**（华科公告以「实习生」为标题与小标题锚点，`allwinnerRoles` 与 `dtlRoles` 是只对某一份公告成立的硬编码岗位表，南开 meta keywords 校验的是栏目页身份），公告换了还按这些表产出岗位就是凭空编造，因此**保留**守卫但改用 `UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED`——原先它们属「软拒绝」，也就是页面换了还照样自动接受，现在是硬冲突。

**`SOURCE_KIND_CONFLICT` 不再进 `reviewReasons`。** 这是第二处「阻塞等于什么都没有」：该复核项是 `BLOCKING_REVIEW_OPEN` 的成员，连本机 `local_mvp` 都进不去，而慧策 30 条历史岗位有 29 条命中它、来源随之被暂停。它成立的前提是供给单位为「实习」——那时「官方 `Kind` 写全职」确实让人怀疑这条是否在范围内。单位改为「在校生可投岗位」后全职校招本身在范围内，工作性质不再决定准入，因此改为 `qualityFlags` 的 `OFFICIAL_EMPLOYMENT_TYPE_NOT_INTERNSHIP` 观察项，北森与高校两个适配器都改了。

**D 组数值门槛已撤销**（`source-batch-planner.ts`）：`CAPACITY_MINIMUM_COMPLETE_JOBS` 10→3；`MAX_COVERAGE_COMPANIES_PER_BATCH` 删除；单家配额 30/10 分档合并为恒定 30（分档的判定轴是「该企业有没有可达岗位」，而可达性已下沉为逐岗位判据，「非可达企业」不再是有意义的分类）；`selectSourceBatch` 里的本批可达比例下限删除——它的实际效果是「容量证据没记 `reachableInternships` 的候选被当作 0，拉低本批比例后被跳过」，即用证据缺失做否定推断；`coverage_not_needed` 就绪项撤销。职能与城市缺口、`reachabilityRecoveryRequired` 全部保留为报告项与排序信号。

**`stableIdentityAndFields` 判据已实现**：新模块 `apps/platform/src/sources/source-contract-stability.ts`，成功刷新 ≥3 次、相邻计数间隔 ≥20 小时、结构未变；来源持续性为 ≥3 个来源各 ≥3 次且跨度 ≥72 小时。三个设计点值得记住：

- 「结构未变」直接用 `automation_acceptance = 'accepted'` 表达。该状态已要求 completion 不是 failed、无任何硬冲突码、无数量异常——它就是机器对「冻结契约仍解析得通」的判断，不需要另造一套结构比较。
- 间隔取 **20** 小时而不是 24：`crawl_interval` 普遍是 `24h`，门槛若也写 24，调度抖动几分钟就不计数，永远攒不满。
- 计数用**贪心取点**而不是「每一对相邻运行都必须 ≥20h」：同小时重放与补跑会产生密集运行，后者一次重放就能让整段证据作废。多跑不该受罚。
- 只统计当前 `(policy_version, adapter_version)` 下的观察，适配器改动会清零（约两天可重新攒满），按 fail-closed 取这一侧。

达标进度已接进 `pnpm source:refresh-status`（返回值新增 `contractStability`），可直接看每个来源还差几次。

### 触网边界按 `AGENTS.md` 原文，不额外加严

先前交接把这里写成「任何触网步骤须 coco 逐批明确 live 授权」。**那比 `AGENTS.md` 严，是多加的约束，已撤回。** 规则原文只把四件事留给人工明确操作：首次启用、扩大请求范围、恢复暂停来源、浏览器快照；并明确「按 ADR-0026 在配置中显式启用的确定性来源可由本机 `collector-worker` 定时刷新」。

因此当前 9 个 `crawlInterval.enabled` 来源里，**7 个 `public_api` 确定性来源可直接按周期刷新，无需逐批点头**；剩余 2 个是 `browser_required`，属浏览器快照，仍需人工操作。8 个 `paused` 来源的恢复、17 个未启用来源的首次启用，同样仍需人工操作。

不变的硬边界：不抓 BOSS/实习僧/牛客等综合平台与第三方聚合站；不绕过登录、验证码、访问控制、付费墙或明确禁止的访问政策；逐来源网络预算与白名单不放宽；CI、构建、Alpha、Production 不访问真实招聘站。仍不得自动进入 Private Alpha、不得启动服务器就绪工作、不得从 [Private Alpha 就绪 Gate](../plans/private-alpha-readiness-gates.md) 生成任务。

产品阶段未变：产品证据仍为 **E0**，可信供给仍为 **22 岗 / 3 家企业 / 3 官方 ATS**，公开 `/v1/jobs` 仍为 0（正确行为）。Phase A 一条可见岗位都没有增加。

产品阶段未变：产品证据仍为 **E0**，可信供给仍为 **22 岗 / 3 家企业 / 3 官方 ATS**。飞书线索表与本轮提取的 389 域名清单只是发现线索，不构成供给证据。

## 2. 五项状态

| 状态项 | 当前状态 |
|---|---|
| Contract | 通过 |
| Database/Platform | 通过 |
| Web | 通过 |
| Integrated Gate | 通过（`passed: true`） |
| Evidence | 通过 |

工程基线（2026-08-29，隔离库 `aijob_v35_gate6_test`，37 个迁移预迁移后跑 `pnpm check` + `pnpm build`）：Config 20、Contracts 100、Database 69、Web 182、Platform 547，共 **918/918**（158 个测试文件），一次跑通无 flake；`biome lint` 515 文件 3 warning（均为既有 `noExplicitAny`，落在 `source-tenant-config.test.ts` 的 legacy 夹具读取处）、全仓 typecheck、生产构建均通过。上一基线为 808/808。

前端主包 **401.33 kB（gzip 117.04 kB）**，上限 411.31 kB。

产品证据仍为 **E0**；可信供给仍为 **22 岗 / 3 家企业 / 3 个官方 ATS**，公共与 Alpha 岗位均为 0。工程与视觉通过不得冒充用户价值、真实供给、Private Alpha 或生产就绪。

## 3. OS-7 那一轮的代码改动（保留为历史记录）

当前供给准入轮次的改动见上文「ADR-0035 已落地」。以下是 OS-7 视觉收口那一轮，仅 4 个文件，无 migration、无依赖变更、无新服务，未移除 `VITE_CAREER_OS_V2`：

- `apps/web/src/career-os/career-os.css`：`small/sub/sup` 12px 下限；旧 `styles.css` meta 标签抬到 12px；三处标题改回 `var(--co-title-lg)`；新增 `.product-app.career-os` 前缀块修正旧 hero 标题上限的特异性失效。
- `apps/web/src/career-os/visual-contract.test.ts`：新增“不得超过 32px 上限”静态断言（5/5）。
- `apps/web/scripts/os7-browser-gate.cjs`：Case overview 标题改非 exact 匹配；flag-off 资源断言收紧为只禁 Career OS 外壳/页面/组件/样式表。
- `apps/platform/src/resume-documents/routes.integration.test.ts`：修复预先存在的 `noUncheckedIndexedAccess` 类型错误。

`apps/web/src/styles.css` **未修改**，因此 `VITE_CAREER_OS_V2=false` 回退外观完全不变。

## 4. 下一任务接手要点（SA Track Phase B）

**下一个里程碑是 1 条公开岗位，不是 100 家企业。** 100 家/1000 岗按 ADR-0035 保留为报告项，不作阻塞门槛，也不作下一步目标。

1. 依次读取 `AGENTS.md`、README、路线图、本交接、[SA Track 计划](../plans/supply-admission-scaleup-track.md)、Private Alpha 就绪 Gate 与相关 ADR（0026/0027/0028/0029/0030/0032/0033/0034/**0035**）。ADR-0035 是当前供给准入主口径。
2. `git fetch` 核对分支/远端/工作树；`codex/g2-1000-alpha-supply`（capacity 感知规划、可复用 ATS 来源族、Private Alpha 信任边界）已完整合入本分支（`merge-base` 即其 tip，left/right = 80/0），无撞车风险；其 worktree 的未提交改动属于 coco，不动。
3. ADR-0032/0033/0034/0035 均已 `accepted`，可据其改动资格视图与发布路径。
4. 剩余待办，按依赖顺序：
   1. ~~落地 ADR-0034 §一 + §二 + §三~~、~~ADR-0035 迁移 037~~、~~撤销 D 组数值门槛~~、~~`stableIdentityAndFields` 判据~~、~~清掉实习字样过滤~~ **已完成**，零触网。
   2. **待 coco 决定**：租户配置 `category` 从 `"3"` 放开到校招并行。北森列表请求的 `Category` 是**单值**（`jobsPagePath` 与 `reportedTotalKey` 都与之耦合），因此「校招 + 实习并行」只能是**每个 category 发一次请求**，属 `AGENTS.md` 的「扩大请求范围」，必须人工明确操作。详见下节。
   3. 重跑线索抽取，ATS 租户恢复为待评线索，产出**各厂商分布**。零触网，是把「100 家」从不可行变成算得出的一步。
   4. 建首次取证通路（取 `/robots.txt` + 核 ToS 写入 `accessPolicyEvidence`），**之后**才接 ADR-0033 复核。顺序见下节。
   5. 攒够运行证据让 `stableIdentityAndFields` 自然达标（判据已实现，跑 `pnpm source:refresh-status` 看 `contractStability.sources[].shortfalls` 还差几次），提 `policy.status → approved` + `runtime_scope → alpha`，跑 `catalog-reconcile-publication`，由对账自动发布使公开 `/v1/jobs` 非 0。

### 待决定：北森租户 `category` 能否扩到校招

ADR-0035 §一 写「租户配置的 `category` 从 `"3"` 放开到校招与实习并行」。实现上有一个约束需要 coco 先定：

北森列表接口的请求体是 `Category: <单个字符串>`，不是数组；`jobsPagePath`（`/intern/jobs` 与 `/campus/jobs`）与 `reportedTotalKey` 都与它一对一耦合。**冻结契约里从未观察到数组形态**，按 ADR-0035「契约未被观察就不写适配器」不能凭空改成数组。因此「并行」只能实现为**每个 category 各发一次列表请求**，一个租户的每轮刷新请求数从 1 组翻成 2 组——这正是 `AGENTS.md` 列为必须人工明确操作的「扩大请求范围」。

已落地的部分不受此影响：慧策租户请求的本来就是 `category="2"`（校园招聘），它的校招岗位此前被标题过滤丢弃、又被 `SOURCE_KIND_CONFLICT` 阻塞，这两处都已撤销。也就是说**最大的一处损失已经修好**，扩 category 是增量。当前 5 个北森租户：慧策 `"2"`，灵明光子／普渡／先临三维／卧安 `"3"`。
5. 触网边界按 `AGENTS.md` 原文：配置中已显式启用的确定性来源可由本机 `collector-worker` 定时刷新；只有首次启用、扩大请求范围、恢复暂停来源和浏览器快照需人工明确操作。不复用 OS-1–OS-7 切片模板，不启动服务器就绪工作。
6. 对账必须**周期性运行**才能保证撤回及时。当前只有 CLI 入口，尚未接进 `collector-worker` 的刷新周期；接线前，来源被暂停到指针被撤回之间存在时间窗，需依赖 `catalog-suppress-job` 兜底。

### 接 ADR-0033 访问政策复核的顺序陷阱（务必先读）

`decideAccessPolicyRecheck` 目前**零生产调用**，看起来只差一步接线。但它在 `recordedEvidence === null` 时返回 `pause`，而**34 份配置的 `policy.accessPolicyEvidence` 全部为 `null`**。因此直接把它接进 `collector-worker` 的刷新前置，会让每个来源一到刷新就被 `ACCESS_POLICY_EVIDENCE_MISSING` 暂停——**目前 7 个能自动跑的确定性来源会全部熄火**，比不接更糟。

正确顺序是两步，不可颠倒：

1. 先建**首次取证**通路：按已登记 fetch target 的每个不同主机取 `https://<host>/robots.txt`，连同服务条款结论写入 `policy.accessPolicyEvidence`。注意 `/robots.txt` 不在任何来源的路径白名单内，需要先决定它的处理方式（在已白名单主机上视为隐含允许，或逐来源把该路径加进 fetch target）——按 `AGENTS.md` 的白名单要求，这一点必须显式决定，不能默认放行。
2. 再把复核接进刷新前置，判定转禁止时自动暂停。

第 1 步是触网动作，但只读 `/robots.txt`，是行为最保守的一次请求；拒绝读 robots 却继续抓其他路径反而更差。
6. 已登记的残留缺口：`university-employment-adapter` 的 `splitRequirements` 无职责锚点（会把公司简介带入职责）。当前高校来源全为 `discovery_only` 不进目录，但高校线重启前必修。

## 5. 复现浏览器 Gate 所需的环境事实

若需再次运行 `os7-browser-gate.cjs`，以下为本轮实测的可复现条件：

- 本工作区是原 Codex worktree 的副本，`node_modules/.modules.yaml` 的 virtual store 指向旧路径，pnpm 会拒绝执行脚本。用 `pnpm install --frozen-lockfile` 修复（本地 store 命中，无网络下载，锁文件不变）。
- 脚本需要 Playwright。仓库不声明该依赖，通过既有 `CODEX_NODE_MODULES` 环境变量从仓库外目录加载即可，不要把它加进 `package.json`。
- Chromium 官方 CDN 在本机不可达（`ECONNRESET`）。用 `OS7_BROWSER_EXECUTABLE` 指向本机 Chrome 即可，无需下载浏览器。
- `OS7_PNPM_EXECUTABLE` 必须给 `pnpm.cmd` 的完整路径，脚本的 Windows shell 分支依赖 `.cmd` 后缀。
- **Web 必须用 `WEB_API_ORIGIN` 控制 Vite 的 `/v1` 代理，页面保持相对同源请求。设置 `VITE_API_BASE_URL` 会跨源直连 Platform 并破坏同源 CSRF，导致 `403 CSRF_REJECTED`。**
- 5 个 loopback 进程：Platform 3000（满态库）、3001（空库）；Web 5173（V2 满态）、5174（V2=false 回退，连 3000）、5175（V2 空态，连 3001）。
- Platform 需显式 `RESUME_ENCRYPTION_KEY`、`ENABLE_AI=false`、`ACCEPTED_ORIGINS` 含 5173/5174/5175，`SNAPSHOT_DIR` 指向临时目录，避免触碰 `.data/`。
- 每次完整运行前必须新建一对空的 `aijob_ux_full_test_*` / `aijob_ux_empty_test_*` 库并迁移到 033；失败后重跑不能复用已被 seed 过的库。
- 已知环境敏感项：PostgreSQL 容器时钟领先宿主机约 280ms，会让 `024_resume_document_v2_expand` 的 1 秒时间余量在慢负载下失效。未修改生产约束或该测试。

## 6. 固定排除与数据安全

- 不访问真实招聘来源、真实 AI、真实邮件、服务器、参与者或真实简历，不获取外部解析镜像。
- 不新增第二套数据库、BFF、Redis、向量库、消息总线、认证或 AI SDK，不移除 `VITE_CAREER_OS_V2`。
- 不读取、修改、暂存、覆盖、清理或提交 `.claude/`、`.data/`、密钥、令牌、真实简历原文、本地业务数据库、下载产物或截图。
- 测试数据库必须全新且匹配 `aijob_*_test_*`，只写合成数据；浏览器和服务只允许 loopback。
- Private Alpha Gate 只用于守门，不得从中生成当前任务。
