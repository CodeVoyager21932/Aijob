# UX-0 页面—系统—证据追踪矩阵

> 状态：Accepted baseline / UX-0 已完成代码反证、Review 兼容核验与四视口当前运行基线；OS-1–OS-6 触达行已关闭，OS-7 系统总 Gate 进行中暂停
>
> 基线日期：2026-08-13；后续关闭更新：2026-08-28

> 后续关闭记录：OS-1 已完成唯一 WorkspaceShell、访问/session、统一 overlay/focus 与运行时响应基础；OS-2 已完成规范岗位目录/详情、服务器派生推荐、市场洞察、简历导入/确认、Case 创建、URL 恢复及对应 owner/session/runtime schema Gate；OS-3 已完成 Case list/board 完整集合、Peek、显式阶段命令、owner/404/409/session 与四视口 Gate；OS-4 已完成固定版本 Case match state/create、`case_pinned` Worker、岗位版本 diff/显式升级、Requirements 深链与对应竞态/四视口 Gate；OS-5 已完成三栏 Resume Studio、Review v1/v2 expand、固定 requirement/evidence 引用、唯一新写入、草稿/409/session、DOCX/打印与四视口 Gate；OS-6 已完成今日单一 Board read model、显式投递、模板面试、复盘确认事件与回流、选择性/全部删除、删除回执/session 边界、旧 Tailoring 只读和四视口 Gate。见 [OS-1 验收证据](../evidence/product/career-os-v2/os-1-system-shell-and-runtime-contract-acceptance-2026-08-13.md)、[OS-2 验收证据](../evidence/product/career-os-v2/os-2-profile-and-trusted-job-entry-acceptance-2026-08-13.md)、[OS-3 验收证据](../evidence/product/career-os-v2/os-3-application-board-and-case-command-acceptance-2026-08-14.md)、[OS-4 验收证据](../evidence/product/career-os-v2/os-4-case-decision-and-pinned-match-acceptance-2026-08-14.md)、[OS-5 验收证据](../evidence/product/career-os-v2/os-5-resume-studio-and-review-v2-acceptance-2026-08-16.md)与 [OS-6 验收证据](../evidence/product/career-os-v2/os-6-application-interview-debrief-data-control-acceptance-2026-08-28.md)。下表的 UX-0 审计时点反证保留历史事实，不能据此把已关闭的 OS-1–OS-6 重新生成成任务。
>
> OS-7 已补齐剩余 Web runtime schema、视觉字号/字重守门和双库总 runner；修复后的完整 runner、全仓工程 Gate 与 acceptance 尚未运行。当前只记录[暂停检查点](../evidence/product/career-os-v2/os-7-system-gate-checkpoint-2026-08-28.md)，不得把矩阵状态提升为关闭。
>
> 本矩阵是[当前交付计划](career-os-current-delivery-plan.md)的 UX-0 工作产物，不生成新的任务顺序。稳定规则见[端到端体验与系统契约](../14-career-os-end-to-end-experience-contract.md)。

## 1. 使用方法

每个核心用例只有在以下列都明确后才能进入产品实现：

1. 规范路由和用户动作。
2. 读取/写入的 Contracts 与 Problem code。
3. Platform 领域所有者和 PostgreSQL 事实。
4. owner、CSRF、幂等、revision、删除和 session 恢复语义。
5. Web 的 URL、草稿、响应 schema 和错误责任。
6. 真实隔离数据库与浏览器证据。
7. `R / A / E / M / X` 处置决定。

处置含义：`R` 直接复用；`A` 在现有模块内适配；`E` 扩展 Contracts/API/read model；`M` 经证明的最小 migration；`X` 明确排除并给出替代入口。UX-0 关闭只表示归属、可表达性和当前反证已锁定，不表示对应 OS 切片已经实现。

## 2. 核心用例矩阵

| 用户结果 / 规范路由 | 用户动作 | Contracts / API | Platform / PostgreSQL 事实 | 关键安全与恢复语义 | 当前 Web 状态 | 真实测试要求 | 处置 |
|---|---|---|---|---|---|---|---|
| 打开 OS `/today` | 恢复本地 owner 与当前任务 | `SessionStatus`、`CareerDataScopeResponse`、Case list | `identity`、`profile`、`applications`；owner/epoch 与 Case 为真源 | owner boundary、读恢复一次、mutation 不重放、删除中/已删除 | Shell 与摘要存在；路由错误和访问回接不统一 | 新 owner、已有 owner、session 更换、全量删除后重入、404/error | `R/A` |
| 浏览岗位 `/jobs` | 查询、筛选、分页、返回 | `JobSearchQuery/Response`、`/v1/jobs` | `catalog` published projection；公开指针、unknown 和 facet | 公共/本地模式不混淆；cursor 与 query 绑定 | **OS-2 已关闭**：规范工作台、筛选 URL、刷新/深链/返回、空态和 503 重试 | 真实空目录、合成公开目录、刷新/深链/返回、cursor 错误 | `R/A/E` 已按 OS-2 触达范围关闭；无 migration |
| 查看岗位 `/jobs/:jobId` | 核对岗位事实、来源、版本 | `JobDetail`、`/v1/jobs/:id` | `catalog` 的 published job/version/requirement set | 不显示未准入公共岗位；不存在与不可见一致 404 | **OS-2 已关闭岗位详情**；OS-4 已从创建后的 Case 规范入口承接固定版本三轴核对，不复活岗位详情旧动作 | 正常/unknown/关闭/404/版本变化 | `R/A` 已关闭；匹配归 Case |
| 创建公共 Case | 显式“加入我的求职” | `CreateApplicationCaseWithJobContextRequest/Response`、`POST /v1/application-cases` | `applications` 固定 public job version；幂等活动 Case | CSRF、Idempotency-Key、owner、重复 reuse | **OS-2 已从岗位详情接入并导航 Requirements** | 重复点击、刷新、session 恢复不重放、跨 owner | `R` 已按 OS-2 关闭 |
| 创建私有 Case | 粘贴私有 JD、确认来源/重复处理 | 同上；`private_input` | owner-private snapshot 与 content revision | 私有内容不入公共目录；owner 404；显式 duplicate handling | 入口在看板页；视觉/overlay 待收敛 | reuse/create_separate、长文本、非法 URL、跨 owner、删除保留 | `R/A` |
| 看板 `/applications` | 五阶段浏览、stage/city/sort、Peek | 扩展 Case list；新增 `GET /v1/application-cases/board` | `applications` 在 repeatable-read 中返回五列首批 items/total/cursor；后续单列复用 stage list | cursor 与 query 绑定、owner/deleted 不可见；private city 为 unknown | **OS-3 已关闭**：服务端完整集合、逐列续页、URL 恢复、宽屏/overlay/移动 Peek | 105 Case 跨页、26 Case 浏览器满态、计数/筛选/排序、深链/404、固定请求数 | `E` 已关闭；`EXPLAIN` 未证明需要索引，无 migration |
| 推进 Case 阶段 | 显式选择阶段/结果并确认 | `TransitionApplicationCaseRequest`、`POST .../transitions` | Case revision 与 append-only event | CSRF、Idempotency-Key、409、不允许非法回退/结果 | **OS-3 已关闭**：显式阶段/outcome、409 最新读取与保留选择、再次确认、session mutation 不重放 | 合法/非法 transition、幂等、409 保稿、刷新、session 403 | `A` 已关闭 |
| 固定岗位版本 | 查看 diff、显式升级 | `ApplicationCaseJobVersionDiffResponse`、Upgrade request | Case 固定 version、requirement context、event | owner、revision、幂等；禁止静默升级 | **OS-4 已关闭**：状态条、字段/要求 diff、对话框显式确认、409 保留并再次确认、升级后刷新 | unchanged/changed/unavailable、升级、409、requirements 连续性 | `A` 已关闭；无 migration |
| JD Requirements `/applications/:id/requirements` | 查看原句，确认状态/备注，关联证据，提问 | Requirements、Put State/Links、Questions contracts | `applications` requirement state/link/question；`profile` evidence revision | 三状态分离、只接受已确认证据、revision 409、owner 404 | **OS-4 触达范围已关闭**：规范入口、检查器、长文、深链、刷新及前进/后退恢复；既有写命令语义保留 | public/private、三状态、证据无效、409 保稿、长文、删除 | `R/A` 已按 OS-4 触达范围关闭 |
| 三轴核对（Case 规范入口） | 对 Case 固定岗位版本用当前资料修订运行/查看 | `GET .../match-state`、`POST .../match-runs` 与 `case_pinned` task union | `matching` immutable run 绑定 job/requirement/profile/preference/evidence revisions；Platform 服务端派生输入，Worker 计算前后重验 owner/Case revision/删除/固定上下文；不新增 caseId | owner、资料确认、Case revision、固定版本陈旧、不输出总分；private GET 为 not_applicable、POST 422 | **OS-4 已关闭**：`profile_incomplete/not_run/queued/processing/current/stale/failed/private`、三轴分离、目录状态分离、刷新恢复 | 幂等/重用、固定旧版本、资料/目录陈旧、任务前后删除/升级、404、409、session、四视口 | `E` 已关闭；无 Case 外键、第二套 Run 或 migration |
| 市场 Insights `/jobs/insights*` | 从岗位探索查看跨岗位市场聚合 | 复用 `CreateJobInsightRunRequest/JobInsightRun` | `insights` scope 聚合快照；Case Requirements 继续归 applications/catalog | 来源/样本门槛、unknown、资料证据可选，不能串成匹配结论 | **OS-2 已关闭**：规范表单、scope URL、持久 Run 深链；旧 V2 路径重定向 | persisted run 深链、scope 恢复、无样本、过期、无证据；不出现在 Case JD | `A` 已关闭；V2=false 保留 |
| 推荐岗位 `/jobs/recommended*` | 用确认资料从可信候选中查看可解释推荐并加入 Case | 现有 RecommendationRun 下新增 search scope create 与 job projection view | `matching` 在 repeatable-read 内冻结 candidate/requirement/freshness/profile；`catalog` 一次提供固定版本显示 | 三轴分开、catalog stale/invalid、不得自动隐藏；owner；mutation 不重放 | **OS-2 已关闭**：规范创建/Run 深链/岗位投影，不再由浏览器提交候选 IDs | 空公共目录、候选变化、stale/invalid、深链、岗位投影、加入 Case、固定请求数 | `E` 已关闭；无第二种 Run、无 migration |
| 导入/确认简历 `/resumes/import*` | 文本/PDF/DOCX、本地检查、确认事实与证据 | Resume analysis、Profile confirmation contracts | `resume` 临时解析；`profile` 长期确认修订 | 原文立即/24h 删除、文件安全、owner、session、不得进 URL | **OS-2 已关闭**：规范路由、共享 runtime schema、一次性确认；旧 V2 路径重定向 | 三输入、扫描/宏/加密/超限、确认、刷新、原文清理 | `R/A` 已按 OS-2 关闭 |
| 简历资产 `/resumes` | 查看基础/岗位/脱离资产，创建/删除 | Resume document list/create/delete contracts | `resume-documents` immutable document/revisions；Case link/detach | owner、idempotency、revision、选择性删除、删除后 404 | **OS-5 触达范围已关闭**：基础/岗位资产进入同一 Studio，删除与 Case 派生语义保留 | cursor、三种资产、跨 owner、删除/detach、空态 | `R/A` 已按 OS-5 触达范围关闭 |
| Resume Studio `/resumes/:id` 与 Case resume tab | 编辑内容/布局、针对固定 JD 的 Review 决策、DOCX/打印 | OS-5 已扩展 Content/Layout、Review v1/v2、Decision、DOCX 与 requirement citation contracts | `resume-documents` revisions、review runs、decisions；template/controlled AI 均读取 Run 固定的 public/private Requirements、内容修订和确认证据 | 409 保稿、已确认证据与岗位要求分别引用、无自动写入、owner、删除 | **OS-5 已关闭**：三栏/三模式、URL 恢复、草稿导航保护、409/session、逐建议决定、DOCX/打印 | public/private 固定要求、save/409/导航、接受/编辑/拒绝、DOCX、打印、删除 | `E + M` 已关闭；migration 033 expand-only |
| 模板/受控 AI Review 与历史 Tailoring | 新写入只在岗位 Resume Review；旧 run 只读 | Create Review union、生成 provenance、failure/fallback 与 requirement 引用；旧 Tailoring API 保留读 | v1/v2 双读、`resume_review`/`resume_review_v2` 双 handler；固定要求 DB guard；复用低层 provider/去标识化/结构化校验 | 显式同意、去标识化、要求与证据白名单、模拟 provider 离线 Gate；公开/远程默认关闭；关闭/失败时明确模板降级 | **OS-5 已关闭**：Review 是唯一新写入，fallback/provenance 可见，旧 Tailoring V2 只读 | template/模拟 AI/关闭与失败回退、provenance、逐建议决策、历史可读/404、无真实请求 | `E + M` 已关闭；不复活旧 service |
| 投递 `/applications/:id/application` | 打开官方链接、显式记录已投递、查看时间线 | ManualApplication、Case events 与 transition | `applications` append-only event 与 Case stage/revision | 外链打开不等于投递；CSRF、幂等、409 | **OS-6 已关闭**：外链与显式确认分离，成功状态 URL 可恢复，时间线即时刷新 | 外链无 mutation、显式投递一次、409、前后退、删除 | `R/A` 已关闭 |
| 面试 `/applications/:id/interview` | 创建模板会话、回答、查看反馈 | Interview contracts/routes 与 runtime parser | `interviews` sessions/turns/feedback | owner、idempotency、revision、无真实 AI/语音视频 | **OS-6 已关闭**：Session 与 Debrief 分离；按 Session 保存草稿，409 保稿并显式丢弃，成功回答即时更新 | 创建/恢复/回答/反馈/404/409/删除 | `R/A` 已关闭 |
| 复盘 `/applications/:id/debrief` | 准备、逐项决定、确认并回流 | Debrief prepare/confirm/delete contracts 与 Case events | `interviews` debrief/confirmations/decisions；同事务追加 `debrief_confirmed` | 确认前不回流；owner、revision、幂等、删除 | **OS-6 已关闭**：逐项决定、离开保护、确认后唯一回流与 Case 列表/事件刷新 | draft/confirmed/回流、409、刷新、删除、深链焦点 | `R/A` 已关闭 |
| 数据设置 `/settings/data*` | 查看范围、单项/Case/全部删除 | CareerDataScope、Delete Case/Resume/Interview/Debrief/Profile 与 deletion receipt parser | 各领域删除 + `profile/identity` owner 删除；成功回执在签名 cookie TTL 内可重复读取 | 删除中/已删除、不可枚举、session boundary、资产处置 | **OS-6 已关闭**：选择性删除成功后重读；全量删除不新建 session；规范/旧回执 URL 可刷新 | 每种选择性删除、全量删除、轮询、原 URL 404、公共岗位保留 | `R/A` 已关闭 |
| flag 回退 | 关闭 V2 使用旧 ProductShell/岗位页 | `VITE_CAREER_OS_V2`、兼容模式 | 不改变后端事实 | 不访问真实外部系统；旧 URL 可用 | **OS-6 触达范围已关闭**：V2=false 的旧壳与岗位页继续可用 | true/false 两套 smoke、旧导入/岗位、无 V2 chunk 越界 | `R` 已按 OS-6 回归；OS-7 总验 |

## 3. UX-0 架构决定与关闭条件

| 编号 | 未决问题 | 首选核验顺序 | 关闭条件 |
|---|---|---|---|
| A-01 | 看板完整集合 | **已实现：Case list 扩展 + board 初始 read model；无语义 migration** | OS-3 已通过 105 Case、同快照、逐列续页与 `EXPLAIN ANALYZE` Gate；未新增索引 |
| A-02 | MatchRun 的 Case 恢复语义 | **已实现：Case-scoped adapter + `case_pinned` Worker 上下文；按固定 job/requirement 与资料 revisions 查回，不加 caseId** | OS-4 已通过派生输入幂等 hash、严格任务 union、固定旧版本、资料陈旧、删除/升级竞态与四视口 Gate |
| A-03 | Insights 与单岗 Requirements 边界 | **已实现：市场洞察归 `/jobs/insights*`，从 Case JD 明确排除** | OS-2 兼容跳转、scope/Run 深链、刷新与错误 Gate 已关闭 |
| A-04 | Recommendation 入口与候选冻结 | **已实现：归 `/jobs/recommended*`；复用 RecommendationRun 的 search create 与 view adapter** | OS-2 scope 同义、服务器冻结、岗位投影、owner/session、请求数与空目录 Gate 已关闭 |
| A-05 | Tailoring / Review 唯一写入所有权 | **已实现：Review 唯一新写入，受控 AI 与岗位要求引用使用 migration 033 expand-only；Tailoring 历史只读** | OS-5 已通过 v1/v2、双任务 handler、固定引用、模拟 provider、fallback、决定、删除与四视口 Gate |
| A-06 | Web 核心响应运行时校验 | **已选并由 OS-1 建立基础；OS-2–OS-5 扩展岗位/Case/Resume，OS-6 扩展 timeline/application/interview/debrief/data scope/legacy/export/deletion** | OS-1–OS-6 的畸形响应、敏感 payload、session、触达 parser 与包体断言已关闭；OS-7 扫描余量 |

### 3.1 UX-0 代码反证结论

| 接缝 | UX-0 审计时点代码事实 | 结论与后续关闭 |
|---|---|---|
| 看板 | `application-cases` list 只接收 `cursor / limit / stage`，Platform 固定按更新时间分页；`ApplicationsPage` 对最多 100 条已加载结果在浏览器内做城市筛选、排序和列计数 | `E` 成立；必须由服务端提供完整集合语义与初始 board read model，不需要先加表 |
| Case 匹配 | `CreateMatchRun` 没有 Case 上下文；创建服务和 Worker 都要求岗位版本仍是 current/public pointer | `E` 成立；Case 固定旧版本需要受 owner/删除状态约束的 `case_pinned` adapter/task，不增加 Case 外键 |
| Recommendation | 浏览器先拉最多 1100 个岗位并提交候选版本 ID；Run 读取又没有岗位显示投影 | `E` 成立；候选范围和显示投影由 Platform 派生，继续复用现有 RecommendationRun |
| Insights | 现有 Run 是跨岗位 scope 聚合，当前 V2 兼容文案却把结果描述成具体岗位；不存在单 Case insight API | `A` 成立；市场洞察与 Case Requirements 必须分开 |
| Review | 创建请求只开放 `template`；Run/Finding/Suggestion 都是 v1，生成器不读取固定 Requirements，失败状态没有稳定 reason | `E + M` 成立；该审计缺口已由 OS-5 migration 033、双 handler 与唯一 Review 写入关闭 |
| Web runtime | 通用 `apiRequest<T>` 对多数业务响应直接 `as T`；只有少数 identity/session 路径显式 schema parse | `A` 成立；触达的核心响应必须逐切片使用共享 schema 运行时解析 |

数据库反证已由 OS-5 migration 033 落实：public requirement 从固定 `catalog.job_requirement_sets.requirements` 校验，private requirement 从同 owner/epoch 的固定 `application.private_job_snapshot_revisions.requirements` 校验，Review 不依赖会随 Case 删除而消失的可变状态。migration 只扩展 Review 版本/provenance/failure、requirement 引用与版本化任务，不新增第二套 Review 聚合或 Case 外键。

## 4. 实施防返工规则

- 任何页面 PR/提交必须引用本矩阵对应行，并说明 `R / A / E / M / X` 是否已关闭。
- 如果实现发现矩阵中的后端事实不成立，先回到 UX-0/当前切片修改契约和证据，不在 React 中静默补逻辑。
- 新 API 必须同时有 Contract schema、Platform route/service 测试、owner/错误语义和 Web runtime parse。
- 新持久字段必须证明刷新/跨设备/删除/审计需要；仅为了视觉展示不允许 migration。
- 切片 Gate 以真实 Platform API + 全新隔离 PostgreSQL 的用户动作通过为准，组件截图或成功 mock 不算端到端通过。

## 5. 字段级契约草案

本节锁定后续实现的最小形状；名称若因现有代码类型复用而机械调整，必须保持这里的语义并同步更新矩阵和证据。

### 5.1 Application Board / List

扩展 `ListApplicationCasesQuery`：

```ts
{
  cursor?: string;
  limit: 1..100;                 // default 20
  stage?: CaseStage;
  city?: string;                 // exact known location; unknown/private does not match
  sort: "updated" | "deadline"; // default updated
}
```

`ListApplicationCasesResponse` 增加 `total`，表示应用 cursor 前、应用 stage/city 后的完整结果数。排序稳定规则：

- `updated`：`updated_at DESC, id DESC`。
- `deadline`：已知截止时间优先，`deadline_at ASC, updated_at DESC, id DESC`；unknown 在最后。
- cursor 必须绑定 `stage + city + sort` 的 query hash，参数变化后旧 cursor 返回 `INVALID_APPLICATION_CASE_CURSOR`。

新增 `GET /v1/application-cases/board?city=&sort=&limitPerStage=`：

```ts
type ApplicationBoardResponse = {
  schemaVersion: "application-board-v1";
  generatedAt: Timestamp;
  filters: { city: string | null; sort: "updated" | "deadline" };
  columns: Array<{
    stage: CaseStage;             // exactly five, stable order
    total: number;
    items: ApplicationCaseWithJobContext[];
    nextCursor: string | null;
  }>;
};
```

五列首批数据必须在同一 repeatable-read 事务中读取。单列“加载更多”使用扩展后的 list endpoint，不再重取五列。固定错误：`INVALID_APPLICATION_BOARD_QUERY`、`INVALID_APPLICATION_CASE_CURSOR`。列表和 board 均只返回当前 owner、当前 epoch、未删除 Case。

### 5.2 Case-scoped Match State

新增：

- `GET /v1/application-cases/:caseId/match-state`
- `POST /v1/application-cases/:caseId/match-runs`，需要 `Idempotency-Key`

POST body：

```ts
{ expectedCaseRevision: number }
```

服务端在同一 owner 范围内读取 Case 固定岗位版本、固定 requirement set 和当前已确认的 fact/preference/evidence revisions；客户端不提交这些 ID。幂等 request hash 必须包含 `caseId + expectedCaseRevision` 以及服务端实际解析出的全部岗位/要求/资料 revision ID，不能只 hash 请求 body；相同幂等键面对不同派生输入必须返回 `IDEMPOTENCY_KEY_REUSED`。响应：

```ts
type CaseMatchState = {
  schemaVersion: "case-match-state-v1";
  caseId: UUID;
  caseRevision: number;
  status:
    | "not_applicable_private"
    | "profile_incomplete"
    | "not_run"
    | "queued"
    | "processing"
    | "current"
    | "stale"
    | "failed";
  input: null | {
    publishedJobVersionId: UUID;
    requirementSetId: UUID;
    profileFactRevisionId: UUID;
    preferenceRevisionId: UUID;
    evidenceRevisionId: UUID;
  };
  catalogState: null | "current" | "stale" | "closed" | "unavailable";
  missingInputs: Array<"facts" | "preferences" | "evidence">;
  staleReasons: Array<
    "case_job_version" | "profile_facts" | "preferences" | "evidence"
  >;
  run: MatchRun | null;
};
```

读取时按 owner、该 Case 的固定岗位版本/requirement set 和资料修订找到最近一次 run；不在 Case 表或 event 中复制结果。`catalogState=stale/closed` 只说明目录现状，不会把仍匹配 Case 固定输入的 run 错标为 stale。私有 Case 的 GET 返回 `not_applicable_private`，POST 返回 422 `CASE_MATCH_NOT_APPLICABLE_PRIVATE`。其他固定错误：

- 404 `APPLICATION_CASE_NOT_FOUND`：非法、删除或跨 owner 统一。
- 409 `APPLICATION_CASE_REVISION_CONFLICT`：Case 在提交前变化。
- 422 `CASE_MATCH_PROFILE_INCOMPLETE`：缺少已确认资料；响应 detail 不包含简历原文。
- 409 `CASE_MATCH_INPUT_CHANGED`：事务内资料当前修订变化，要求重新确认。
- 409 `CASE_MATCH_CONTEXT_CHANGED`：任务处理前或提交结果前，Case 被删除、升级或固定 requirement set 改变。
- 409 `CASE_MATCH_CONTEXT_UNAVAILABLE`：Case 指向的不可变岗位版本或要求集已经物理缺失；不得偷偷改用当前版本。

新增的任务载荷使用受控 union：旧入口保持 `{ runId }` 的 `current_catalog` 语义；Case 入口写入 `{ runId, executionContext: { kind: "case_pinned", caseId, expectedCaseRevision, publishedJobVersionId, requirementSetId } }`。Worker 在计算前和写回前都重验 owner、epoch、未删除 Case 与固定上下文，随后只对该不可变版本运行现有三轴引擎，不要求它仍是目录 current pointer。Case 删除后 adapter 404；既有 MatchRun 仍作为 owner 的历史运行保留到全部个人数据删除。Case 显式升级岗位版本后，旧 run 只能返回 stale，不能自动复用为 current。

OS-4 已按上述形状实现并通过独立验收；本节继续作为兼容契约保留，不再生成 OS-4 任务。

### 5.3 Recommendation in Job Discovery

在现有 RecommendationRun 资源下新增规范 adapter，不创建第二种 Run：

- `POST /v1/recommendation-runs/from-search`，需要 `Idempotency-Key`
- `GET /v1/recommendation-runs/:runId/view`
- 旧 `POST /v1/recommendation-runs` 与 `GET /v1/recommendation-runs/:runId` 保留给 V2=false 兼容页

POST body 只包含岗位候选 scope；服务器读取当前已确认资料修订：

```ts
const JobRecommendationScopeSchema = JobSearchQuerySchema.omit({
  cursor: true,
  limit: true,
}).strict();
type JobRecommendationScope = z.infer<typeof JobRecommendationScopeSchema>;
type CreateJobRecommendationRunRequest = { scope: JobRecommendationScope };
```

服务端在 repeatable-read 中调用与 `/v1/jobs` 同一内部 catalog query/policy 解析最多 1100 个候选版本，同时读取当前已确认资料修订，再调用现有 RecommendationRun；禁止通过 loopback HTTP 自调或复制第二套筛选。成功响应与 view GET 使用：

```ts
type JobRecommendationRunView = {
  schemaVersion: "job-recommendation-run-view-v1";
  run: RecommendationRun;
  jobs: Array<{
    ordinal: number;
    publishedJobId: UUID;
    publishedJobVersionId: UUID;
    display: {
      title: string;
      companyName: string;
      locations: FieldValue<string[]>;
      workMode: FieldValue<string>;
      deadlineAt: FieldValue<Timestamp>;
      sourceName: string;
      lastVerifiedAt: Timestamp | null;
    };
    officialUrl: string | null;
    catalogState: "current" | "stale" | "invalid";
  }>;
};
```

Run 处于 queued/processing 时 `jobs=[]`；成功后 `jobs` 与 `run.items` 必须一一对应且按 ordinal 排序。岗位事实和官方链接来自 Run 固定的 immutable version，`lastVerifiedAt` 使用 Run 已冻结 snapshot；`sourceName` 沿该 version 的 source revision/record 关系读取，只有 `catalogState` 反映当前目录状态。不得把当前 `/v1/jobs` 投影覆盖到历史 version 上。由 Platform 一次组装，Web 不逐项查询。固定错误：

- 422 `RECOMMENDATION_PROFILE_INCOMPLETE`
- 422 `RECOMMENDATION_CANDIDATES_EMPTY`
- 422 `RECOMMENDATION_CANDIDATE_LIMIT_EXCEEDED`
- 400 `INVALID_RECOMMENDATION_SCOPE`
- 404 `RECOMMENDATION_RUN_NOT_FOUND`（含跨 owner）
- 409 `RECOMMENDATION_INPUT_CHANGED`

结果页即使某项变为 stale/invalid 仍显示当时三轴依据，但禁止把它当当前可投岗位；加入 Case 前重新读取当前 JobDetail 并由现有 Case create 校验版本。

### 5.4 Market Insights

不新增领域数据结构，直接复用：

- `POST /v1/job-insight-runs`
- `GET /v1/job-insight-runs/:runId`
- `JobInsightScope / JobInsightRun / INSIGHT_RUN_NOT_FOUND`

规范路由 `/jobs/insights` 的表单 state 写入 URL；创建成功后导航 `/jobs/insights/:runId`，刷新只按 run ID 读取持久化报告。样本不足继续是 `dataSufficient=false` 的成功事实，不改成错误。Case Requirements 页面和接口不得导入 `JobInsightRun`，也不得把聚合 `personalStatus` 映射成 Case 的三证据状态。

### 5.5 Resume Review controlled_ai expand

`CreateResumeReviewRequest` 改为 discriminated union：

```ts
| { expectedRevision: number; mode: "template" }
| { expectedRevision: number; mode: "controlled_ai"; privacyConsent: true }
```

这不是把旧 Tailoring service 接回页面。新实现只复用低层 `OpenAiCompatibleProvider`、PII 去标识化和结构化输出校验，并在 Resume Review 领域内读取 public/private Case 已固定的 Requirements、内容修订和确认证据。

`profile.resume_review_runs` 最小 expand 字段：

| 字段 | legacy row | template v2 | controlled_ai v2 |
|---|---|---|---|
| `schema_version text NOT NULL DEFAULT 'resume-review-run-v1'` | `v1` | `v2` | `v2` |
| `generation_provenance_version text` | NULL，不臆造 | `resume-review-generation-v1` | 同左 |
| `template_version text` | NULL，不臆造 | NOT NULL | NOT NULL，记录 fallback 版本 |
| `privacy_consent_at timestamptz` | NULL | NULL | NOT NULL |
| `provider_adapter text` / `model text` | NULL | NULL | 实际尝试 provider 时成对 NOT NULL；AI 关闭且未尝试时为 NULL |
| `prompt_version text` / `output_schema_version text` | NULL | NULL | 新写入 NOT NULL |
| `safety_policy_version text` / `parameters_version text` | NULL | NULL | 新写入 NOT NULL |
| `used_template_fallback boolean NOT NULL DEFAULT false` | false 但 provenance 仍为 unknown | false | true / false |
| `fallback_reason_code text` | NULL | NULL | fallback 时 NOT NULL，否则 NULL |
| `failure_code text` | NULL | 处理失败时写入 | 处理失败时写入 |

不能把“当前模板版本”回填给旧行，那会伪造历史 provenance。Contracts 保留 `resume-review-run-v1` 只读 schema，并新增 v2；新写入必须显式 v2 和完整 `generation_provenance_version`。CHECK 只强制 v2 一致性，legacy v1 保持可读。

同时扩展 `resume_review_findings` 与 `resume_review_suggestions`：新增 `requirement_ids jsonb NOT NULL DEFAULT '[]'`，保留旧 v1 行为空数组，新写入使用 finding/suggestion v2。数据库引用 guard 对 public run 校验固定 requirement set，对 private run 校验固定 snapshot revision；template 与 controlled_ai 都必须读取这份固定要求，受控 AI 的内容改写必须同时引用允许的 requirement 与 confirmed evidence，通用结构/ATS finding 才可为空。输出仍进入 Review Finding/Suggestion/Decision，不直接写正文。

AI 关闭、配置缺失或 provider/Schema/引用校验失败时，按 ADR-0013 生成确定性模板结果并明确写 `usedTemplateFallback=true` 与稳定 `fallbackReasonCode`；不是静默成功，也不需要先返回 503。只有模板生成本身也失败时 Run 才进入 failed 并写 `failureCode`。Worker 改为接收 config、可注入 fetch 与 abort signal；UX 离线验收只注入 loopback 模拟 provider，并由验收网络 allowlist 在发现非 loopback 请求时立即失败。未来本地真实 provider 仍只能经既有显式配置与供应商 Gate 启用，不能被测试 allowlist 误写成生产限制。

迁移采用 expand-only：不删除旧 Tailoring 表、路由或数据，`down` 保持 no-op。同一 `task_queue.tasks` 中保留旧 `resume_review` 任务，并为新 v2 Run 增加 `resume_review_v2` 任务类型；新 Worker 同时读取两者，旧 Worker 的固定任务类型集合不会领取 v2，从部署过程上 fail closed，而不是依赖 payload 额外字段（旧 Zod object 会剥离未知字段）。

滚动部署顺序固定为：先加 nullable/有安全默认值的字段与 v2 任务类型，部署能双读 v1/v2 且分别处理 `resume_review`/`resume_review_v2` 的新 reader/Worker；在全部 reader/Worker 兼容前，template 与 controlled_ai 的 v2 写入都保持关闭；兼容部署完成后才启用 v2 新写入。旧行只把 Run 版本识别为 v1，provenance 继续为 NULL，绝不把当前模板版本回填成历史事实，Finding/Suggestion 的 legacy `requirement_ids` 保持空数组。

当前旧 mapper 会忽略未来列并把读取结果硬标成 `resume-review-run-v1`。因此一旦任何 v2 Run 已经写入，回滚到 pre-v2 应用代码就不再安全：关闭 controlled_ai、排空任务或证明没有待处理 v2 task 都不足以恢复兼容，必须前向修复。只有在**从未启用 v2 写入且数据库中不存在任何 v2 Run**时，才允许回退旧应用二进制；数据库 expand migration 本身不反向删除列。

其他固定错误沿用 Review 的 owner 404、revision 409、证据无效和删除语义；新增 `CONTROLLED_AI_CONSENT_REQUIRED`、`RESUME_REVIEW_REQUIREMENT_REFERENCE_INVALID` 和 `RESUME_REVIEW_GENERATION_FAILED`。旧 `/resume-tailorings/:runId` 在 V2 中只读，不提供新建、决策或导出写按钮；历史导出按既有保留规则读取。

### 5.6 Web Runtime Response Parsing

`apiRequest` options 增加不依赖具体 schema 库的 parser interface：

```ts
interface RuntimeParser<T> {
  parse(input: unknown): T;
}

interface ApiRequestOptions<T> {
  // existing method/body/signal/idempotency/headers
  responseParser?: RuntimeParser<T>;
}
```

成功 JSON 先解析为 `unknown`，再调用共享 Contract schema。schema 失败统一抛：

```ts
new ProductApiError(
  "服务返回的数据与当前版本不兼容，请重试或回退。",
  502,
  "INVALID_API_RESPONSE",
)
```

不把原始 payload、Zod issue 中的敏感值或响应正文写入控制台。Problem Details 继续容忍 HTML/proxy 错误，但 JSON problem 使用共享 schema 安全解析。OS-1–OS-6 每次触达的 adapter 必须同时加入 response parser 与畸形响应测试；OS-7 扫描剩余核心用户 API。包体增长计入 10 kB 守门，必要时按路由 lazy import schema，不以删除运行时校验换体积。

## 6. 静态契约进入实施前的断言清单

| 接缝 | Contracts | Platform / Database | Web / 浏览器 |
|---|---|---|---|
| Board | list/board schema、query-bound cursor | >100 Case、五列同快照 total/cursor、private city unknown、跨 owner、`EXPLAIN` 后才决定索引 | URL 筛选、单列续页、Peek 404、固定请求数 |
| Case Match | **OS-4 已关闭**：state、task payload union、Problem | **OS-4 已关闭**：current pointer 与 Case-pinned 旧版本跑同一引擎；处理前/写回前重验 Case；删除/升级竞态；无 Case FK | **OS-4 已关闭**：profile incomplete、queued/current/stale、目录 stale 与 run stale 分开、刷新恢复 |
| Recommendation | search scope runtime schema、view schema | 与 jobs query 同义、1100 上限、候选/requirements/freshness 冻结、一次岗位投影、owner 404 | 规范深链、空目录、stale/invalid、加入 Case 前重验，无 1100 岗浏览器拉取/N+1 |
| Insights | 复用现有 schema | scope 幂等、样本不足成功、owner 404 | URL 表单、run 深链、刷新恢复，Case 页面零 Insights 请求 |
| Review v2 | **OS-5 已关闭**：v1/v2 read union、request union、requirement citations、provenance | **OS-5 已关闭**：fresh/up/legacy/down guard；同队列 versioned task 的新旧 Worker fail-closed；public/private requirement guard；template/模拟 AI/关闭/失败 fallback；删除与迟到任务 | **OS-5 已关闭**：唯一新写入、逐建议决策、fallback 明示、历史 Tailoring 只读、无真实 AI |
| Application / Interview / Debrief / Data | **OS-6 已关闭**：触达响应 parser、稳定 Problem、删除回执 | **OS-6 已关闭**：事件/Case revision 同事务、幂等确认、owner 404、删除后不可读、回执 TTL 重读 | **OS-6 已关闭**：显式投递、Session 草稿/409、复盘确认后回流、全量删除无 session bootstrap、兼容 URL |
| Runtime parse | parser option、共享 response/Problem schema | 畸形测试 fixture 不进入生产服务 | **OS-1–OS-6 触达范围已关闭**：502 可重试、session mutation 不重放、payload 不进 console、主包增量守门；OS-7 扫描余量 |

上表任何一列缺失，都不能以另一列的测试数量代替。实施中若发现现有代码事实与本草案冲突，先停在对应 UX 切片修订契约和证据，不在 Web 或 SQL 中静默发明第三种语义。
