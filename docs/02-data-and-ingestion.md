# 来源、岗位数据与采集设计

## 1. 目标与边界

采集系统把经过人工审核的公开官方页面转换为可追溯、可复查、可回放的岗位版本。它不负责推荐，不接触用户简历，不执行页面中的指令，也不接受普通用户提供的任意 URL。

工程 MVP 以 PostgreSQL 作为唯一查询、任务和元数据真源；原始岗位响应保存在独立岗位快照 Bucket，PostgreSQL 只保存对象键、哈希、大小和内容类型等元数据。用户简历不进入该 Bucket。MVP 不引入独立搜索、向量或消息系统；固定测试夹具可以保存在代码仓库中，但不是生产数据真源。

## 2. 来源准入的四个独立维度

来源主体是否可证明、访问政策是否允许、采用何种采集方式、证据是否仍然新鲜是四个不同问题，不使用单一 `trust_level=A/B/C` 混合表达。

### 2.1 主体证明 `provenance_level`

| 值 | 含义 | MVP 处理 |
|---|---|---|
| `organization_owned` | 企业或高校自有域名的公开招聘页面/接口 | 优先接入 |
| `verified_ats_tenant` | 已核验企业归属和租户路径的官方 ATS 页面 | 接入精确租户范围 |
| `university_published` | 高校就业网站公开发布，企业主体可核验 | 保留高校来源；企业申请页无法核验时明确降级 |
| `official_account_link` | 企业认证公开账号链接到官方落地页 | 只把核验后的落地页作为岗位来源 |
| `unverified` | 转载、截图、个人表格或主体不明页面 | 不进入正式岗位库 |

### 2.2 访问政策 `policy_status`

- `pending_review`：尚未完成主体、条款和网络范围审核。
- `approved`：允许按登记策略运行。
- `paused`：临时停止，保留历史岗位和证据。
- `blocked`：不满足访问、安全或合规边界。
- `retired`：不再维护，不自动恢复。

公开可见不等于允许任意批量复制或长期展示。每个来源都要记录 robots、服务条款、合理频率、展示字段、复核日期、退出与纠错方式。

### 2.3 采集方式 `acquisition_mode`

| 值 | 含义 | MVP 处理 |
|---|---|---|
| `public_api` | 公开 API 或稳定 JSON | 启用 |
| `json_ld` | `schema.org/JobPosting` | 启用 |
| `deterministic_html` | 固定 ATS 模板或来源专用 DOM 映射 | 启用 |
| `browser_required` | 必须执行浏览器脚本才能得到数据 | 记录但不启用；Playwright 延后单独决策 |

### 2.4 新鲜度 `freshness_state`

新鲜度是根据最近一次完整运行和来源约定复查周期计算的运行状态，不写进来源证明等级：

- `fresh`：仍在约定复查周期内。
- `due`：已经到达复查时间，等待下一次运行。
- `stale`：超过复查周期且没有新的完整成功运行。
- `unknown`：尚无足够运行证据。

前台展示岗位自己的最后核验时间和活动状态；来源新鲜度只用于调度、告警和运营判断，不能自动证明某条岗位仍在招聘。

## 3. `SourcePolicy` 契约

每个可运行来源都必须有版本化的 `SourcePolicy`。任务固定 `policy_version`；只有准入、网络范围、频率或规则变化时才创建新策略版本：

| 字段 | 说明 |
|---|---|
| `source_id` | 内部唯一标识 |
| `organization_id` | 企业或高校主体；共享 ATS 中仍按企业租户分别登记 |
| `source_type` | 企业官网、企业 ATS、高校就业网 |
| `provenance_level` | 主体证明等级 |
| `policy_status` | 当前访问政策状态 |
| `acquisition_mode` | 采集方式 |
| `entrypoints` | 审核后的列表页、站点地图或公开接口入口 |
| `fetch_targets` | 允许采集的协议、主机、端口和路径前缀集合 |
| `apply_targets` | 允许展示为官方申请入口的独立目标集合 |
| `adapter_key` | 本项目维护的适配器标识 |
| `adapter_version` | 当前适配器版本 |
| `crawl_interval` | 最小采集间隔和允许时间窗 |
| `rate_policy` | 并发、请求速率、响应上限和退避策略 |
| `absence_policy` | 只有完整运行才能累计的未见次数、最短观察时间和关闭阈值 |
| `policy_notes` | 条款、robots、展示和退出说明 |
| `reviewed_at` | 最近人工复核时间 |

运行结果单独保存在 `SourceRuntimeState`，不回写历史策略版本：

| 字段 | 说明 |
|---|---|
| `source_id`、`policy_version` | 对应来源和当前运行所依据的策略 |
| `freshness_state` | `fresh/due/stale/unknown` 的当前派生状态 |
| `last_complete_run_at` | 最近一次完整成功运行时间 |
| `consecutive_failures` | 连续失败次数与最近稳定错误码 |
| `next_due_at` | 根据复查周期计算的下次应运行时间 |

`fetch_targets` 不是仅包含主机名的白名单。每项至少包含：

```text
scheme=https
host=jobs.example.com
port=443
path_prefix=/tenant/acme/
```

共享 ATS 必须核验企业租户路径或租户 ID，不能因为一个企业获准而允许访问该 ATS 主机上的全部租户。重定向每一跳重新校验，申请链接使用单独的 `apply_targets`，不能继承采集权限。

普通用户建议的新来源只进入人工审核队列，不触发网络请求。

## 4. 岗位与版本模型

### 4.1 `RawJobSnapshot`

原始快照是重新解析所需的最小证据。响应正文和可查询元数据分开保存：原始 JSON 或安全压缩的 HTML 只写入独立岗位快照 Bucket；PostgreSQL 中的 `RawJobSnapshot` 只记录：

- `snapshot_id`、`crawl_run_id`、来源请求地址和最终地址。
- HTTP 状态、内容类型、取得时间和响应头白名单。
- `object_key`、`content_hash`、`byte_size`、`content_type` 和压缩/编码方式。
- 适配器版本、抓取结果和错误分类。

采集进程流式读取响应时先执行压缩前后大小、解压和内容类型限制，再计算 SHA-256。对象键由来源标识和内容哈希确定性生成，例如 `job-snapshots/{source_id}/{hash_prefix}/{content_hash}`；相同正文重试得到同一个对象键，不能使用用户输入拼接对象键。对象使用条件写入且不可原地覆盖，正文变化必须产生新的哈希和对象键。

快照正文不返回前台，不与模型系统指令拼接，也不允许浏览器渲染。岗位快照 Bucket 绝不存放用户简历、画像、匹配结果、邀请令牌或日志。只有 `collector-worker` 的专用服务身份可以访问其受限前缀；超过上限的响应直接拒绝，不能借助 Bucket 绕过限制。

对象必须先完整上传并通过哈希/大小校验，随后才能在 PostgreSQL 事务中提交 `RawJobSnapshot` 元数据、来源修订和候选版本。对象不存在、读取失败或哈希不一致时，对应版本不得进入 `publication_state=published`。若对象上传成功但数据库事务没有提交，该对象视为孤儿；定时清理任务在对象创建满 24 小时且仍无 PostgreSQL 引用后删除，避免与尚在提交或重试的任务竞争。

### 4.2 `SourceJobRecord` 与 `SourceJobRevision`

`SourceJobRecord` 是某来源中一个岗位的稳定身份，至少使用以下唯一约束之一：

- `UNIQUE(source_id, source_job_id)`；或
- 在没有稳定 ID 时使用 `UNIQUE(source_id, canonical_source_url)`。

每次内容变化生成不可变 `SourceJobRevision`，并记录 `import_mode=collector/manual`、原始值、标准化值、字段置信度和字段来源。两种导入证据不能混淆：

- `collector`：必须引用已完成完整性校验的 `RawJobSnapshot`；重复处理相同 `content_hash` 不产生新修订。
- `manual`：仅作为完整本地 MVP 的采集失败回退，由 `internal ops CLI` 使用；可以不创建快照，但必须引用已批准 `SourcePolicy`，保存原始来源 URL、核验时间、复核人、导入批次，以及支持每个关键字段的最小纯文本摘录或“来源未说明”。人工导入不保存原始 HTML，也不得标记为“可回放快照”。

两种模式都计算覆盖规范字段与证据引用的 `revision_content_hash`；同一 `SourceJobRecord` 的相同哈希不得重复生成修订。人工导入和自动采集都必须通过同一字段 Schema、URL/申请目标校验、不可变版本和发布复核。后续自动采集到同一岗位时创建新的快照支持修订，不在原有人工修订上补写快照。

关键字段包括：

- 企业、岗位标题、部门和岗位编码。
- 招聘类型、用工形式、职能分类和招聘批次。
- 国家、省、市、区、远程状态和原始地点。
- 发布时间、截止时间、首次发现和最后确认时间。
- 原始职责、要求、申请地址和已能确定性提取的资格候选。
- 字段缺失、审核状态、活动状态和解析错误。

原始值与标准化值始终分开保存。

### 4.3 `PublishedJobVersion`

`PublishedJobVersion` 是用户可见岗位的不可变版本，必须引用：

- 稳定的 `published_job_id`。
- 一个或多个 `SourceJobRevision`。
- 生效时间、发布状态、内容哈希和创建原因。
- 每个规范字段的来源修订和原文位置。

标题、地点、资格、截止时间或申请链接变化时创建新版本，不原地覆盖旧版本。岗位详情和后续匹配必须记录实际使用的 `published_job_version_id`。

跨来源合并在 MVP 中只处理强证据：相同官方岗位 ID、相同规范申请 URL，或经过人工确认的企业/岗位编码组合。近似匹配只进入复核队列。只有一个来源的首个纵向切片不强制引入复杂 `CanonicalJob` 合并层。

### 4.4 关系

```text
SourcePolicy 1---N CrawlTask
SourcePolicy 1---N CrawlRun
CrawlRun 1---N RawJobSnapshot
SourceJobRecord 1---N SourceJobRevision
RawJobSnapshot 1---N SourceJobRevision（仅 collector 导入；manual 导入无快照）
PublishedJob 1---N PublishedJobVersion
PublishedJobVersion N---N SourceJobRevision
PublishedJobVersion 1---N JobRequirementSet
```

## 5. 字段提取优先级

按确定性从高到低执行：

1. 公开岗位 API 或稳定 JSON。
2. 页面中的 `schema.org/JobPosting` JSON-LD。
3. 特定 ATS 模板的确定性映射。
4. 单个来源维护的 DOM 选择器。
5. 通用正文提取，结果进入人工复核。
6. 无法确定的字段保持未知并进入人工复核；MVP 不使用 AI 补全采集字段。

采集进程不持有模型密钥。未来若评估 AI 辅助岗位解析，必须通过新 ADR 重新定义输入、权限和质量门，不能在适配器中直接调用模型。

## 6. 适配器契约

每个适配器由项目自行维护，输入只能是 `source_id` 和已批准策略：

```text
discover(source_policy, cursor) -> CandidateRef[]
fetch_list(source_policy, cursor) -> FetchResult
fetch_detail(source_policy, candidate_ref) -> FetchResult
normalize(snapshot) -> SourceJobRevisionCandidate[]
check_active(revision) -> ActivityEvidence
```

适配器必须提供固定夹具、分页终止条件、超时和速率限制、解析器版本、失败分类及结构变化信号。单元和契约测试不访问真实网站。零结果与抓取失败、解析失败必须是不同结果。

## 7. `CrawlTask` 与 `CrawlRun`

### 7.1 `CrawlTask`

PostgreSQL 任务表至少包含：

- `task_id`、`task_type`、`source_id`、`policy_version`、`adapter_version`。
- 唯一 `idempotency_key`，由 `task_type + source_id + policy_version + 调度窗口/游标 + 输入哈希` 规范化后生成；手工重跑若输入或窗口相同必须复用同一语义键。
- `status`：`queued/running/succeeded/failed/dead`。
- `attempt`、`max_attempts`、`available_at`。
- `backoff_policy`：退避基数、上限、抖动方式和是否遵循上游 `Retry-After`。
- `lease_owner`、`lease_until` 和心跳时间。
- 稳定错误码、最近错误摘要和创建/完成时间。

任务采用至少一次执行语义。Worker 通过租约领取任务；租约过期可以接管，但所有写入必须依靠唯一约束和输入哈希保持幂等。只有临时网络、限流和可恢复上游错误进入有上限的抖动退避；明确的 `Retry-After` 优先，权限、政策、Schema 和完整性错误不得靠无限重试掩盖。

### 7.2 `CrawlRun`

每次实际运行创建 `CrawlRun`；运行期间只更新心跳和计数，完成后记录不可变：

- `run_id`、`task_id`、来源、策略和适配器版本。
- `started_at`、`finished_at`、请求/发现/解析/拒绝数量。
- `completion`：`complete/partial/failed`。
- 每个阶段的错误分类、重试次数和耗时。

只有 `complete` 运行可以参与“本轮未见岗位”的状态判断。`partial` 或 `failed` 运行只能产生新证据和告警，不能把历史岗位关闭或清空。

## 8. 采集流水线与事务边界

以下是 `collector` 自动采集路径：

```text
SourcePolicy
  -> CrawlTask
  -> URL 与网络策略校验
  -> CrawlRun
  -> 响应正文校验与内容哈希
  -> 岗位快照 Bucket（确定性对象键）
  -> RawJobSnapshot 元数据
  -> SourceJobRevision
  -> Schema 与质量校验
  -> 去重候选和人工复核
  -> PublishedJobVersion
  -> JobRequirementSet
```

外部 HTTP 请求和 Bucket 上传/校验不放在 PostgreSQL 事务中。采集进程先上传确定性对象并完成回读、哈希和大小校验，再开启同一个 PostgreSQL 事务完成“快照元数据、修订写入、发布版本指针更新、任务结果和审计事件”；发布转换只能引用本次已校验成功且当前仍存在的对象。任务重试依靠对象键、快照哈希、来源修订和发布版本的唯一约束保持幂等，不得重复生成版本。

数据库提交失败不会删除刚上传的对象，以免破坏并发重试；无引用对象由 24 小时孤儿清理任务处理。Bucket 对象缺失或完整性检查失败时，任务进入失败/人工复核并阻止发布，不能仅凭 PostgreSQL 元数据继续生成用户可见版本。

所有用户查询只读取已发布版本。新解析结果先进入候选或复核状态，不直接覆盖当前可见版本；发现错误时将活动指针切回上一已验证版本，不修改历史。

人工回退路径不伪造网络快照：

```text
已批准 SourcePolicy
  -> internal ops CLI 结构化字段、来源 URL 与字段级摘录
  -> Schema、apply_targets 与证据完整性校验
  -> SourceJobRevision（import_mode=manual）
  -> 人工发布复核
  -> PublishedJobVersion
  -> JobRequirementSet
```

CLI 不获得岗位快照 Bucket 凭据。缺少来源 URL、最后核验时间、复核人或关键字段证据的人工记录不得发布；来源未说明的字段必须显式为未知。

## 9. 去重与合并

证据由强到弱：

1. 同一来源的稳定岗位 ID。
2. 规范化后的官方申请 URL。
3. 企业、招聘批次和岗位编码组合。
4. 企业、标题、地点和正文指纹的近似候选。

第四类只能建议人工合并。城市、毕业年份、招聘批次、部门、岗位编码、截止时间或用工形式不同的记录默认保留。合并和拆分均记录操作者、原因及前后版本关系。

## 10. 三个独立状态轴

不得再用单一线性状态同时表达处理、发布和岗位有效性：

| 状态轴 | 允许值 | 所有者 |
|---|---|---|
| `ingestion_state` | `discovered/parsed/validated/rejected` | 采集与质量模块 |
| `publication_state` | `draft/review/published/suppressed/archived` | 岗位目录与运营者 |
| `activity_state` | `active/uncertain/closed` | 有效性证据规则 |

规则：

- 单次无法访问只把活动状态转为 `uncertain`。
- 官方明确关闭或超过明确截止时间可以进入 `closed`。
- 岗位在首个 `complete` 运行中未见时只能转为 `uncertain` 并进入待复查，不能直接关闭。
- “连续未见”即使达到来源策略阈值，也必须先经历上述待复查状态；只有后续另一次 `complete` 运行再次核验未见，或人工依据官方页面确认关闭后，才可进入 `closed`。
- 页面恢复后生成新修订并进入复核，不直接自动发布。
- 关闭岗位保留历史版本，但不进入默认可投岗位列表；用户仍可查看关闭原因。

## 11. 分类与要求集

招聘阶段、用工形式、职能、行业和学生资格是独立维度。分类词典必须有版本，人工纠正生成新版本或覆盖记录，不修改原始文本。

毕业年份、学历、专业、出勤等用于筛选的规范字段由对应 `JobRequirementSet` 派生并保留 `requirement_id`，避免在来源记录和匹配系统中维护两个互相漂移的事实源。

## 12. 数据质量与运行指标

每个来源至少监控：

- 完整、部分和失败运行数量，连续失败和队列等待时间。
- 发现、解析、拒绝、发布、待复核和关闭数量。
- 关键字段缺失率、未知诚实率和人工抽检准确率。
- 页面结构变化、疑似重复和误合并数量。
- 官方申请链接有效率和来源新鲜度。
- 每次运行请求量、耗时和维护工时。

来源异常只影响该来源。任何批量关闭、异常数量突变或适配器结构变化都必须暂停自动发布并产生告警。
