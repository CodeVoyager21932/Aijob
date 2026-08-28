# 供给准入扩容轨道（SA Track）

- 状态：Active / 当前执行切片
- 生效日期：2026-08-28
- 上一轨道：Career OS 前后端同步改进（UX-0 与 OS-1–OS-7，已关闭）
- 授权：coco 于 2026-08-28 选择「供给准入扩容」为 OS-7 之后的下一条轨道
- 事实源顺序：本文服从 [路线图](../06-mvp-roadmap.md) 与 [当前交接](../handoffs/current.md)；准入硬门槛以 [Private Alpha 就绪 Gate §3/§7](private-alpha-readiness-gates.md) 与 ADR-0026/0027/0028 为准

本轨道只解决一件事：把可信供给从当前基线推进到 Private Alpha 供给硬门槛，全程不越过 `AGENTS.md` 与 ADR 的来源边界。本文不重定义产品、不重搭架构、不启动服务器就绪工作、不进入 G0/G1。

---

## 1. 现状（2026-08-28 实测）

均来自本机开发库 `aijob` 的只读审计与配置扫描，非估算。

| 项目 | 实测值 | 来源 |
|---|---|---|
| 已登记来源配置 | 34 个 | `config/sources/*.json` |
| 其中 `policy.status` | `pending_review` 26 / `paused` 8 / `approved` **0** | 配置扫描 |
| 其中 `accessPolicyAccepted` 硬门槛 | **34/34 全部 fail** | 配置扫描 |
| 其中 `localProbe.publicationAllowed` | **0/34** | 配置扫描 |
| 来源类型 | 高校就业网 22 / 企业官网 8 / 官方 ATS 4 | 配置扫描 |
| 可见公开岗位 `/v1/jobs` | 0 | `source-candidate-audit --milestone 40` baseline |
| 库内 `published_jobs` | 236（全部 `eligible_for_local_mvp=false`） | PostgreSQL |
| 候选审计 capacity 就绪数 | **0**（单一最大来源族 26 候选中 0 就绪） | 审计 `familyGroups[*].capacityReadyCount` |
| 可信供给（路线图口径） | 22 岗 / 3 家企业 / 3 官方 ATS | 路线图快照 |
| 供给发现线索 | 389 个候选企业自有域名（本轮从飞书表格提取，仅线索） | `.data/source-leads/`（git-ignored） |

### 真正的瓶颈不是「找不到企业」

审计里每个候选的 `readinessBlockers` 都是同一组：
`deferred`、`automation_not_deterministic`、`capacity_unverified`、`preflight_not_ready`、`alpha_display_not_approved`（部分含 `activity_recheck_required` / `official_application_missing`）。

也就是说候选企业不缺（单族即 26 个，另有 389 个新线索），缺的是**每个候选逐一通过评估并被显式批准**。而这一步的关键是 `accessPolicyAccepted`——34 个来源全部卡在这里，导致：

- 连本机 `local_mvp` 目录都进不去（岗位被 `SOURCE_NOT_FRESH` + `JOB_NOT_RECENTLY_VERIFIED` 阻塞，因为最近核验停在 2026-08-03）；
- 离公开 `/v1/jobs` 更差两级：`eligible_for_alpha` 额外要求 `policy_status='approved'` 且 `runtime_scope IN ('alpha','production')`，当前无一满足。

因此本轨道的主线是**准入证据补齐**，不是「多抓岗位」。

---

## 2. 准入流水线（复用现有机制，不新造）

按代码实测，一个来源从候选到公开的既有路径为：

1. `source:candidates` — 只读列出候选注册表。
2. `source:candidate-audit --milestone <40|70|100>` — 零网络审计容量、来源族、证据缺口（本轨道对齐缺口的权威口径）。
3. `source:assess [source-key]` — 登记并计算候选评分；**评分不自动批准**。
4. `source:probe` / `source:refresh-now <key> --confirm-live` — **唯一触网步骤**，需显式 live 确认；受 ADR-0026 逐来源网络预算约束。
5. `source:batch-plan --milestone <40|70|100>` — 只读计算里程碑缺口并稳定选出下一批。
6. `source:batch-import` — 把已评估候选纳入目录。
7. `source:refresh-enable` / `source:refresh-status` — 开启并观察确定性来源的定时刷新。

准入判定（`packages/database/src/migrations/019/020`）：

- `eligible_for_local_mvp` = `blocking_reasons` 为空（policy 在 `pending_review`/`approved` 即可进本机目录）。
- `eligible_for_alpha` = 上者 **且** `policy_status='approved'` **且** `runtime_scope IN ('alpha','production')`。
- 阻塞原因码：`SOURCE_POLICY_NOT_LOCAL_ALLOWED`、`INGESTION_NOT_VALIDATED`、`PUBLICATION_NOT_REVIEWABLE`、`JOB_NOT_ACTIVE`、`SOURCE_NOT_FRESH`、`JOB_NOT_RECENTLY_VERIFIED`（超 `crawl_interval` 未核验）、`RESPONSIBILITIES_MISSING`、`REQUIREMENTS_MISSING`、`EXACT_APPLICATION_NOT_AVAILABLE`、`BLOCKING_REVIEW_OPEN`、`NON_CANONICAL_SOURCE`、`TEST_RUNTIME_SCOPE`。

里程碑目标由 `source-batch-planner` 动态计算，实测 @40 为：40 家 / 400 可见岗 / 20 SME 家 / 160 SME 岗 / 每城 16 岗 / 人工来源上限 8 家、40 岗。批次约束：每批 ≤10 家、来源族试点 ≤3 家、初始每家 5 岗、`requiresExplicitLiveProbeApproval=true`、`automaticFirst=true`、`browserFallbackOnly=true`。

---

## 3. 分阶段目标（40 → 70 → 100）

沿用 planner 的三级里程碑，不一次冲 100。每阶段是独立检查点，未过不进下一阶段。

### 阶段 0（当前，不触网）—— 线索与评估就绪
- 从 389 域名线索里，用「近 30 天更新」优先，按同域名对应互斥公司名等特征剔除中介/聚合残留，产出首批待评估企业候选（仅公司名 + 疑似官方域名）。
- 对首批候选跑 `source:assess`（离线登记评分，不触网）。
- 退出条件：产出一份可复核的首批候选清单与离线评分；`source:candidate-audit --milestone 40` 缺口数字与本清单对齐。

### 阶段 1 —— 40 家里程碑
- 逐候选做四项评估：主体证明、访问政策、新鲜度、采集方式。**触网步骤需 coco 逐批 live 授权。**
- 只有 `accessPolicyAccepted` 与其余硬门槛全过、且显式批准（`policy.status→approved`、`alphaDisplayStatus→approved`）的来源才纳入。
- 退出条件：40 家 / 400 可见岗 / SME ≥20 家 ≥160 岗 / 每城 ≥16 岗 / 人工来源 ≤8 家 ≤40 岗；至少 3 个已准入确定性 canonical 来源开始连续刷新。

### 阶段 2 —— 70 家里程碑
- 在 40 家基础上扩容，维持 SME 与城市分布、人工来源占比不超标。
- 退出条件：planner @70 缺口清零；来源持续性证据继续累积。

### 阶段 3 —— 100 家 Alpha 供给门槛
- 达到 [Private Alpha 就绪 Gate §3](private-alpha-readiness-gates.md)：100 家 / 1000 可见活动可信实习岗（缓冲 110/1100）；SME ≥50% 家、≥40% 岗；产品/运营/工程/数据与 AI 各 ≥100 岗，其余 8 职能各 ≥15 岗；八城各 ≥40 地点已知岗；人工/浏览器来源 ≤20% 家、≤10% 岗；追溯率与未知诚实率 100%。
- 退出条件：≥3 个已准入确定性 canonical 来源连续 7 天按 12 小时周期运行，失败隔离、无静默空结果、无重复触网、无目录污染。

---

## 4. 验收 Gate

- **每阶段**：`source:candidate-audit` 与 `source:batch-plan` 对应里程碑缺口清零；纳入来源全部 `policy.status=approved`；无 `pending_review` 来源被误标为公开；追溯率 100%、未知字段保留 `unknown`。
- **数据/迁移改动**：新增 PostgreSQL 集成验证。
- **提交前**：与改动相称的 lint、typecheck、test、build 通过。
- **轨道收束**：达到阶段 3 全部退出条件后，写一份供给扩容验收证据，登记真实可信供给数字；此时才由路线图判断是否进入服务器就绪或 G0/G1。

---

## 5. 不可越界项（与既有边界一致，重申）

- 不抓 BOSS、实习僧、牛客等综合平台；不抓第三方聚合站；本轮线索清单已整行剔除命中禁止平台的记录。
- 不绕过登录、验证码、访问控制、付费墙或明确禁止的访问政策。
- 技术可访问 ≠ 获准聚合或公开；`pending_review` 只进本机 `local_mvp`。
- 触网仅限 `source:refresh-now --confirm-live` 等显式步骤，且需 coco 逐批授权；CI、构建、Alpha、Production 不访问真实招聘站。
- 未在官方页明确出现的字段保留 `unknown`，不由规则或模型补写。
- 保持模块化单体 + 单一 PostgreSQL 事实源 + `web-api`/`collector-worker`/`match-worker` 三权限边界；本轨道不引入 Redis、搜索、向量库、消息总线、生产 Playwright 采集或公共管理后台。
- 逐来源网络预算、安全边界、失败隔离不得放宽；ADR-0028 动态容量仅在检查点通过后受控启用。
- 飞书线索表与 389 域名清单不构成供给证据；工程可行性、候选或自动分类不计为用户价值证据。

---

## 6. 当前唯一下一步

阶段 0：产出首批待评估候选清单并跑离线 `source:assess`。**进入阶段 1 的任何触网评估前，须 coco 逐批明确 live 授权。**
