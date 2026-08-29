# ADR-0034：两层来源准入（厂商／租户）与资格对账驱动的发布步骤

- 状态：accepted
- 日期：2026-08-29（同日由 coco 审定通过）
- 决策者：coco
- 关联：ADR-0002、ADR-0010、ADR-0026、ADR-0027、ADR-0028、ADR-0029、ADR-0032、ADR-0033
- 替代：替代「每个企业一份独立来源政策文件」的组织方式；替代 `eligible_for_alpha` 以 `revision.publication_state = 'published'` 为条件的循环口径。不改写既有采集事实、岗位修订与历史证据

## 背景

2026-08-29 对准入链条做了一次完整拼装（此前都是零散发现），得到七步：发现 → 评估 → 触网采集 → 归一化入库 → 目录物化 → 资格投影 → **发布**。前六步都有实现，**第七步不存在**。

### 一、公开供给恒为 0 的真正根因是循环依赖

`catalog.job_version_eligibility` 的 `eligible_for_alpha` 条件包含 `publication_state = 'published'`，而 `publication_state` 是 `ingestion.source_job_revisions` 上的列，由适配器产出并由 `persistence.ts` 原样写入。

`NormalizedOfficialJob.publicationState` 的类型是字面量 `"review"`，因此任何适配器都不可能产出 `"published"`。全仓没有任何生产代码把该列改成 `published`；出现 `published` 的位置只有测试夹具直接插入。

`materialize.ts` 只在 `revision.publication_state === "published"` 时设置 `catalog.published_jobs.public_version_id`，因此生产路径上该指针永不被设置，而所有公开读取路径（`catalog/repository.ts`、`matching/service.ts`、`insights/service.ts`、`local-bootstrap.ts`）在非 local MVP 时都走 `public_version_id`。

**门与钥匙互为前提**：岗位要「已发布」才算「够格发布」，而发布只在「已发布」时发生。这不是一道严格的门槛，是一个结构性死锁。松开 `accessPolicyAccepted` 或任何上游门都不会让公开供给变成正数。

需要明确的是：**适配器只能产出 `"review"` 这件事本身是对的**——采集器不应自我决定发布。错的是把「已发布」当成「够格发布」的组成部分，以及把发布当成目录物化的副作用。

数据库层面不存在障碍：migration 001 的约束为 `publication_state IN ('draft','review','published','suppressed','archived')`，`published` 是合法值；`public_version_id` 可为空。

### 二、修订不可变，因此发布不能改写修订

`revision_content_hash` 由 `hashCanonicalJson({ normalized: semanticRevisionValue(normalizedWithoutHash), adapterVersion, normalizerVersion })` 计算，而 `publicationState` 在 `normalizedWithoutHash` 内、未被 `semanticRevisionValue` 排除。因此改写 `revision.publication_state` 会使内容哈希与实际内容不一致，违反 ADR-0029 第 11 条的不可变要求与「岗位修订必须可复现」的工程边界。

发布必须表达在目录层，而不是修订层。

### 三、逐企业政策文件在 1000 家规模下不可行

`config/sources/` 现有 34 份配置共 5202 行，**平均每家企业 153 行手写政策 JSON**。按此推算 1000 家需约 15 万行手写配置。

按内容归属拆解这 153 行，约 110 行是**厂商级判断在逐企业重复**：

| 内容 | 约行数 | 真实归属 |
|---|---|---|
| `hardGates` 六项结论与说明 | 18 | 其中 `noAuthBypass`、`officialApplyLink`、`stableIdentityAndFields` 为厂商级；ToS 部分亦为厂商级 |
| `scores` 五项分值与说明 | 25 | 基本厂商级 |
| `policyNotes` | 5 | 厂商级 |
| `fetchTargets` / `applyTargets` URL 模式 | 24 | 厂商级（同一套接口） |
| `refreshCoverage` / `absencePolicy` / `localProbe` 预算形状 | 20 | 厂商级 |
| `organization` 主体 + 租户标识 + 入口 URL | 20 | **逐企业** |

代码中已有正确形状的先例：`beisen-zhiye-adapter.ts` 的 `beisenZhiyeTenantList` 中，新增一家企业只需一条 `{ sourceKey, companyName, host, portalId, category }`。现有 5 家北森租户（`adaps-ph`、`huicecom`、`woanhome`、`pudutech`、`shining3d`）即以此方式共用一个适配器。

一处必要的精确化：**robots 不全是厂商级**。Moka 为 `app.mokahr.com/<企业>` 单主机，一份 `robots.txt` 覆盖全部租户；北森与飞书招聘为 `<企业>.zhiye.com`、`<企业>.jobs.feishu.cn` 逐租户子域，robots 需逐主机核验。服务条款仍为厂商级。

### 四、其余焊死约束

- `publicationAllowed: z.literal(false)`：**全仓从未被任何代码读取**，纯摆设。
- `candidateStatus: z.literal("local_probe_only")`、`completion: z.literal("partial")`：把过渡期状态写成类型常量，配置无法表达任何其他阶段。

## 决定

### 一、把「够格发布」与「已发布」彻底分开

1. `eligible_for_alpha` **去掉** `publication_state = 'published'` 条件。它的语义改为**发布的前置条件**：阻塞项为空、来源 `policy_status = 'approved'`、`runtime_scope IN ('alpha','production')`、且 `closure_detectable`（ADR-0032 第二条）。
2. 「已发布」由 `catalog.published_jobs.public_version_id` 唯一表达。该列已存在，且全部公开读取路径在非 local MVP 时已走它。
3. `PUBLICATION_NOT_REVIEWABLE` 阻塞项保持不变（仍允许 `review` 与 `published`），不因本条放宽。
4. **保留** `NormalizedOfficialJob.publicationState` 的 `"review"` 字面量类型。采集器不得自我决定发布，这是正确的边界。

### 二、新增发布步骤（第七步），由资格对账自动驱动

人工判断已经在**来源层**发生：某岗位要 `eligible_for_alpha`，前提是已有人把 `policy.status` 改为 `approved`、把 `runtime_scope` 提为 `alpha`，并使六个硬门全过。在此之后再逐条人工确认岗位**不产生任何新信息**——1000 条规模下人工无法逐条实质复核，只会退化为橡皮章，反而制造虚假的安心感。因此人工门留在来源层，不下沉到岗位层。

1. 发布由**双向资格对账**驱动，而不是逐条人工动作：

   | 条件 | 动作 |
   |---|---|
   | 某版本 `eligible_for_alpha` 且该岗位无公开指针 | 设 `public_version_id` |
   | 当前公开版本不再 `eligible_for_alpha` | 清空 `public_version_id` |
   | 出现更新的合格版本 | 指针前移至最新合格版本 |

2. **自动发布必须配自动撤回。** `public_version_id` 是持久化指针，若只单向发布会产生漂移：来源因 robots 或条款转为禁止而被自动 `paused` 后，`SOURCE_POLICY_NOT_LOCAL_ALLOWED` 会使 `eligible_for_alpha` 变为 `false`，但已写入的指针仍让岗位对外可见。同样的漂移适用于岗位过期、来源新鲜度过期、职责或要求被清空、复核项被打开。缺少撤回的自动发布不得上线。
3. 指针前移是安全的：Case 固定自己的岗位版本并要求显式升级（OS-4），公开指针移动不会改变用户 Case 所依据的内容。
4. 对账**只写** `catalog.published_jobs.public_version_id`，**不改写任何修订**，从而保持 ADR-0029 第 11 条的不可变性与可复现性。
5. `materialize.ts` **不再**根据 `revision.publication_state` 设置 `public_version_id`；物化只负责 `current_version_id`。发布与物化解耦。
6. 对账的每次状态变化必须留下可复核记录（时间、目标版本、发布或撤回、触发依据）。
7. **保留一个人工强制下架操作**，用于履行 ADR-0033 的「异议即停」义务：可立即压制某来源或某岗位而不等下一次对账；被强制下架的对象不得由对账自动恢复，须显式解除。
8. 保留的人工动作仅三项：来源准入（`policy.status → approved`）、运行范围提升（`runtime_scope → alpha`）、强制下架。三者都是逐来源一次，不随岗位数量增长。

### 三、来源准入改为两层

**厂商层**（评估一次，全部租户继承）：

- 服务条款核验结论
- 认证模型不绕过（`noAuthBypass`）
- 页面／接口结构稳定（`stableIdentityAndFields`）
- 投递 URL 模式（`officialApplyLink`）
- 采集方式、刷新覆盖、缺席政策、请求预算形状
- 适配器与归一化版本

**租户层**（逐企业，目标 3–5 个字段）：

- 租户标识（子域或路径段）
- **主体证明**：企业自有站点存在指向该租户页的链接，或 ICP 备案主体与企业一致。这正是「企业把招聘信息挂在那里」的可核验形式（`officialIdentity`）
- 当前是否在招实习（`targetSupply`）
- robots 判定（逐主机厂商如北森、飞书招聘需逐租户核验；单主机厂商如 Moka 由厂商层覆盖）

不改变的部分：六个硬门的**语义**不变，只改变**评估单位**——厂商级门评一次即全部租户继承，租户级门逐企业评。`assessSource()` 仍要求六门全过且 `totalScore >= 75`，仍不自动批准任何来源。

### 四、拆除无效约束

1. **删除** `publicationAllowed`（从未被读取，且与第一、二条的新语义重复）。
2. `candidateStatus` 由 `z.literal("local_probe_only")` 松为枚举，默认值不变。
3. `completion` 由 `z.literal("partial")` 松为枚举，默认值不变。

### 五、不改变的边界

1. 不抓取综合招聘平台与第三方聚合站。
2. **不绕过登录、验证码、访问控制、付费墙或速率封锁。** 该条与 robots／服务条款性质不同：后者是民事且可通过「收到异议即停」缓解，前者涉及未授权访问，上行收益为零、下行不可挽回，不作为便利性权衡项。
3. 不放宽 ADR-0029 的来源归属：岗位事实仍只能来自企业自有域名页面、企业官网确认的官方 ATS，或其中可映射到具体岗位的企业域名招聘邮箱。
4. 未在官方页面明确出现的字段保持 `unknown`，不由规则或模型补写。
5. 触网仍需人工逐批显式授权；CI、构建、Alpha、Production 不访问真实招聘站。
6. 岗位正文仍限定在 ADR-0033 的 D1 范围。

## 后果

- 优点：解除公开供给的结构性死锁——此前无论上游多少门通过，公开 `/v1/jobs` 都恒为 0；发布成为由资格对账驱动、天然可逆的状态，而不是物化的隐式副作用，也不是随岗位数量线性增长的人工负担；准入评估单位从企业改为厂商后，单家成本从约 153 行降到 3–5 行，1000 家从结构上不可行变为可行。
- 优点：双向对账比逐条人工发布**更安全**。人工发布没有撤回机制，来源被暂停或岗位失效后已发布的指针会滞留；对账在每一轮都重新判定，失效即撤回。
- 代价：需要新增对账逻辑、状态变化记录与强制下架能力；需要一次迁移重建 `job_version_eligibility`；`source-config.ts` 的 schema 要拆成厂商与租户两层，既有 34 份配置需迁移到新形状。
- 风险：**只实现自动发布而未实现自动撤回会产生对外可见的漂移**，比完全不发布更糟。缓解方式是把撤回与发布放在同一次对账中实现并共同验证，任一缺失不得上线。
- 风险：对账若与来源暂停之间存在时间窗，异议期间岗位可能短暂仍可见。缓解方式是保留人工强制下架，不依赖下一次对账。
- 风险：厂商级继承会放大单点错误——厂商层评估错误将同时影响其全部租户。缓解方式是厂商层结论必须留证据引用，且租户层保留独立的主体证明与供给核验。
- 遗留：两层 schema 的落地与 34 份既有配置的迁移属于较大改动，与第一、二条解耦，可分阶段执行。

### 落地时同步的既有文档（已完成）

两处按旧「人工发布复核」口径书写的稳定规范已随本 ADR 审定同步：

| 位置 | 原表述 | 现表述 |
|---|---|---|
| `docs/02-data-and-ingestion.md`（人工导入流程图） | `SourceJobRevision（import_mode=manual）` → `人工发布复核` → `PublishedJobVersion` | 人工动作是来源准入与导入本身；修订恒为 `review`，物化只设 `current_version_id`，发布由双向资格对账写 `public_version_id` |
| `docs/05-system-architecture.md` 第 11 节（架构验证门） | CLI 人工导入「不能绕过人工发布复核」 | CLI 导入**不能设置 `public_version_id`**，因而绕不过来源准入与资格投影 |

第二处所保护的安全属性在新模型下依然成立且依然必要：CLI 导入不得自我发布。只是该属性的正确表述从「绕不过人工复核」变为「绕不过准入与资格投影」。

## 验证

- `eligible_for_alpha` 不再依赖 `revision.publication_state`；给定一个阻塞项为空、来源 `approved`、`alpha` scope、`closure_detectable` 的版本，其 `eligible_for_alpha` 为 `true`。
- 对账在该版本合格时设置 `public_version_id`，且不需要任何逐条人工动作。
- **对账在该版本失去资格时清空 `public_version_id`**：分别验证来源被 `paused`、岗位新鲜度过期、职责或要求被清空、复核项被打开这四种情形，每一种都必须导致撤回。
- 出现更新的合格版本时指针前移，且已有 Case 仍固定在其原版本上、不被动升级。
- 对账只改变 `public_version_id`；对账前后修订行与 `revision_content_hash` 逐字节不变。
- 物化不再设置 `public_version_id`。
- 人工强制下架可立即生效且不被后续对账自动恢复。
- 全仓无任何代码读取 `publicationAllowed`。
- 公开 `/v1/jobs` 在没有任何来源被人工准入（`policy.status → approved` 且 `runtime_scope → alpha`）之前仍返回 0，这是正确行为。本 ADR 只解除结构性死锁，不自动准入任何来源。

## 复审触发条件

- 两层 schema 落地后校准厂商层与租户层的字段边界。
- 出现单主机与逐租户子域之外的第三种 ATS 主机模型。
- 发布操作需要多人复核或审批流时。
