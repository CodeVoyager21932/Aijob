# MVP 路线与当前决策面板

> 本文是阶段、证据、Gate 和下一决定的唯一动态事实源。工程完成、岗位数量和页面可用性不等于用户价值证据。

## 最新产品决定（2026-08-09）

- [ADR-0030](decisions/0030-adopt-job-centric-career-os-and-interaction-first-integration.md) 已接受：Aijob 升级为可信官方岗位驱动的完整求职 OS，首个交付为“一岗全闭环”。
- [ADR-0031](decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md) 已接受：OS 2.0 初版进入长期 Career OS 架构修正。用户创建/确认的职业资产默认长期保留并由用户主动删除；原始文件和临时解析仍最长 24 小时。Case 支持公共岗位引用与 owner-only 私有 JD；Resume Review 从正文中分离。
- Phase 1A、Phase 1B、Phase 2 领域设计、migration 023/024 的历史 Gate 记录保留；migrations 025–029、`Phase 2B-1/2/3` 与 `Phase 2B-4A Resume Document Aggregate API` 已通过。其决定为“继续”；当前唯一工程切片为 `Phase 2B-4B Resume Content/Layout Revision API`。
- 采用一套全局侧栏、顶部工具栏、主画布和右侧检查器；单岗位标签固定为概览、JD能力、定制简历、投递、面试、复盘。
- 开源项目只做审计后的选择性移植，不整仓拼接；引用式经验库不抓全文，不做社区；语音、OCR、自动投递和浏览器代填继续排除。
- 100/1000 与 110/1100 目标没有取消；一岗闭环通过后恢复 ADR-0028 的容量型官方 ATS 扩容。完整计划见 [Career OS 2.0 升级计划](plans/career-os-v2-upgrade-plan-2026-08-04.md)。

## 最新执行增量（2026-08-09）

- `Phase 2B-4A Resume Document Aggregate API` 已完成稳定列表、同 owner 详情和幂等 base/case-derived 创建；派生文档固定 Case、public/private JobContext、基础简历修订与当前已确认证据 revision。旧 V1 以顶层只读来源摘要明确发现，不伪装成 V2 聚合，GET 不写库。证据见 [Phase 2B-4A 验收](evidence/product/career-os-v2/phase-2b4a-resume-document-aggregate-api-acceptance-2026-08-09.md)。
- 首轮 Platform 全包复现了应用毫秒时间覆盖 PostgreSQL 微秒时间的既有竞态；已用数据库单调时间修复 Case 聚合及子实体更新时间，不放宽约束。focused 5/5、第二轮 Platform 441/441 与最终全仓均通过。
- 最新隔离 PostgreSQL 串行全仓测试通过 config 17、contracts 59、database 51、platform 441、web 91，共 659/659；lint 387 files、typecheck、build 与 `audit:ci` 通过。依赖审计仍保留 1 个仅开发链的 high ignored；该例外不是漏洞已修复，移除条件已记录在验收证据中。
- 四选一决定为“继续”到 `Phase 2B-4B Resume Content/Layout Revision API`：只实现 V1 只读转换、首次编辑生成 V2、同文档不可变正文/布局修订、`expectedRevision` 并发与稳定 ID；不做 Review/Tailoring、DOCX、Interview、Knowledge、前端或真实 AI。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0；Phase 4 前不恢复真实来源。

## 上一执行增量（2026-08-07）

- 已新增 ADR-0031 和 Phase 2R：收口 OS 2.0 初版与长期产品目标之间的冲突；不再把 30 天自动删除作为职业资产默认行为。
- Phase 2R 已完成实现前契约细化；`Phase 2A-Forward-Contract` 新增公共/私有 JobContext、strict Case event、Resume Content/Layout/Review 分层，通过 37 项 contract tests 和 023F/024F 隔离 PostgreSQL 7/7。023F/024F 仍未注册，身份前置已单独注册为 migration 025。执行记录见 [Phase 2R 架构对齐报告](evidence/product/career-os-v2/phase-2r-architecture-realignment-2026-08-06.md)、[契约与迁移影响矩阵](plans/career-os-phase-2r-contract-and-migration-impact-matrix-2026-08-06.md)、[前向修复与隔离测试设计](plans/career-os-phase-2a-forward-contract-and-isolated-db-test-design-2026-08-06.md) 与 [Forward Contract 与隔离原型验收](evidence/product/career-os-v2/phase-2a-forward-contract-acceptance-2026-08-06.md)。
- 023F/024F 复核发现：`identity.owners.retention_expires_at`、session 校验和 retention worker 仍会在 30 天后拒绝 owner 并启动全量删除。四选一决定为“修改”，先做长期 owner 与邮箱身份前向契约；不能只放宽 Case/Resume TTL 后宣称 ADR-0031 已落地。
- `Phase 2A-Identity-Forward-Contract` 已新增长期 owner、Account、EmailIdentity 与邮箱验证码 challenge 的 strict contracts 和未注册 025F 原型；contracts 5/5、隔离 PostgreSQL 5/5 通过。决定继续正式 migration 025；证据见 [Identity Forward Contract 验收](evidence/product/career-os-v2/phase-2a-identity-forward-contract-acceptance-2026-08-06.md)。
- `Phase 2A-025` 已把身份原型注册为正式 additive migration，统一 session/业务/任务的 owner active predicate，限制自动 retention 只处理匿名 owner，并提供受 owner deletion epoch 约束的身份清除入口。迁移 6/6、全仓 629/629 通过，决定“继续”；证据见 [Phase 2A-025 验收](evidence/product/career-os-v2/phase-2a-025-identity-account-email-expand-acceptance-2026-08-06.md)。
- `Phase 2A-026` 已正式注册私有 JD snapshot/revision、公共/私有 Case、长期生命周期、strict event 与 ApplicationCase 删除覆盖。迁移 9/9、全仓 631/631 通过；但只读 Schema 复核证明要求子表仍强制引用公共 `catalog.job_requirement_sets`，私有要求事件校验返回 false，四选一决定为“修改”。证据见 [Phase 2A-026 验收](evidence/product/career-os-v2/phase-2a-026-application-case-long-lived-forward-repair-acceptance-2026-08-06.md)。
- `Phase 2A-026B` 已正式注册 `PublicRequirementContext | PrivateRequirementContext`、owner/epoch/Case-scoped requirement-state FK、public/private 部分唯一索引、确定性 legacy backfill 与 private strict event。隔离 PostgreSQL 10/10、全仓 635/635 通过；决定“继续”到 migration 027。证据见 [Phase 2A-026B 验收](evidence/product/career-os-v2/phase-2a-026b-private-requirement-context-forward-repair-acceptance-2026-08-06.md)。
- `Phase 2A-027` 已正式注册长期 Resume、public/private Case 派生引用、`resume-content-v1`、`resume-layout-v2`、独立 Review Run/Finding/Suggestion/Decision、owner 删除与迟到任务保护。隔离 PostgreSQL 11/11、全仓 636/636 通过；决定“继续”到 migration 028。证据见 [Phase 2A-027 验收](evidence/product/career-os-v2/phase-2a-027-resume-document-review-forward-repair-acceptance-2026-08-06.md)。
- `Phase 2A-028` 已正式注册 Interview Session/Turn/Feedback、Debrief/Confirmation 与 owner-only Knowledge Clip/Case Link，固定 public/private JobContext、已确认证据、Case 选择性脱离、长期保留、owner 删除、迟到写入和最小角色权限。隔离 PostgreSQL 12/12、全仓 645/645 通过；决定“继续”到 Phase 2B-1。证据见 [Phase 2A-028 验收](evidence/product/career-os-v2/phase-2a-028-interview-debrief-knowledge-expand-acceptance-2026-08-07.md)。

- Phase 2A-1 已完成 ApplicationCase strict contracts 和 migration 023，Phase 2A-2 已完成 Resume Document V2 contracts 和 migration 024；两项历史验收均通过，但其中的 30 天生命周期、公共岗位绑定和 Resume Review 建模正在 Phase 2R 复核，不能直接视为长期契约。证据见 [Phase 2A-1 验收](evidence/product/career-os-v2/phase-2a1-application-case-core-acceptance-2026-08-05.md) 与 [Phase 2A-2 验收](evidence/product/career-os-v2/phase-2a2-resume-document-v2-acceptance-2026-08-05.md)。
- 盘点解决两项文档/代码冲突：Resume V2 复用既有 revision 表而非重复建表；系统架构按 ADR-0023 恢复为当前任务 RLS/直接表访问事实，并移除不存在的旧决定 `match_run_id` 描述。session Cookie SameSite 差异登记为服务器就绪前安全债。
- Phase 1A 已以独立提交 `7bb2140` 冻结；Phase 1B 两个静态工作区通过共享 Case、URL、三态、建议决策、焦点、旗标回退和 1920/1280/768/320 浏览器 Gate，证据见 [Phase 1B 验收](evidence/product/career-os-v2/phase-1b-static-workspaces-acceptance-2026-08-05.md)。
- 最新串行全仓测试通过 config 17、contracts 53、database 50、web 91、platform 434，共 645 项；migration 028/Phase 2A 隔离测试 12/12，owner 删除/retention 2/2。lint 380 文件、TypeScript 和生产构建通过；新发现的 `pdfjs-dist` 高危项已升级修复，`audit:ci` 恢复到 1 high ignored/1 moderate 的已登记基线。web 主包 536.40 kB，仅有既有 chunk warning；本轮没有前端交互变化。
- 严格总计划已固定 Phase 4 后产品收口与供给并行、G3 三来源连续 7 天、G1 的 300–500 岗研究子集、服务器授权边界和每切片 0.5–2 人日纪律；产品证据仍为 `E0`。

## 最新执行增量（2026-08-03）

- [ADR-0029](decisions/0029-official-source-catalog-trust-boundary.md) 已接受：企业官网和官网确认的官方 ATS 成为用户目录唯一真源；高校、政府、公众号和其他二手页面统一降级为 `discovery_only`。本机自动刷新已关闭，真实扩容暂停。
- 系统审查确认运行目录实际为 152 条岗位、30 家企业，其中 38 条/17 家来自高校页面，另有 3 条测试岗位、7 条空职责岗位；只有 12 条岗位为 `fresh`，150/152 条仍有未关闭复核项。以上数据是待清洗运行事实，不是可信供给基线。
- Private Alpha P0/P1 纠偏代码与干净库收口完成：中央岗位资格门、千岗推荐完整性、Alpha 身份、简历解析进程隔离、恢复守卫和数据库运行角色均已落地；北森灰度或其他真实扩容仍需在本轮提交后恢复。
- 迁移 019–022 已把中央资格、精确配置登记、岗位级新鲜度、运行角色和 owner 删除最小权限落实到 PostgreSQL；纠偏前的 231/149/29 只保留为历史运行事实。干净 `aijob_alpha` 当前为 22 条可信岗位、3 家企业、3 个官方 ATS 来源，Alpha 与公开岗位仍为 0。
- [ADR-0028](decisions/0028-capacity-first-private-alpha-supply.md) 已接受：扩容主线改为容量审计与多租户 ATS 来源族，高校单详情页只承担结构补缺；`40/400` 是最低检查点，按当前分母最早可能在 44 家企业、22 家 SME 时通过企业占比。
- 候选注册表已升级为 v4，新增零网络 `source:candidate-audit`。当前 1000 条台账中没有同时满足容量、活动性、确定性合同、预检和 Alpha 内部展示条件的 `capacity` 候选，因此未虚构可执行批次。
- `aijob_alpha` 已升级至迁移 022，并以已授权官方来源恢复先临三维 9、卧安机器人 5、灵明光子 8；本地恢复清单同步为 22/22/3/0，且拒绝 `discovery_only`、暂停或未显式确认的真实探测。
- 百度因 `BAIDU_INITIAL_DATA_INVALID_JSON` fail-closed 暂停，慧策和腾讯因既有结构硬冲突保持暂停。刷新调度的 110 来源 12 小时容量验证仍是离线能力证据，不是当前真实扩容许可。

## 1. 当前快照

| 项目 | 当前值 |
|---|---|
| 更新日期 | 2026-08-09 |
| 当前阶段 | Career OS 2.0 → Phase 2B owner-protected service/API；Phase 1A/1B、Phase 2A 长期领域迁移与 Phase 2B-1/2/3/4A 已通过，100 家企业 / 1000 条可信岗位与服务器就绪 Gate 通过前，G0/G1 暂停 |
| 当前切片 | `Phase 2B-4B Resume Content/Layout Revision API`：在真实 Resume Document 聚合上实现 V1 只读转换、第一次编辑生成 V2，以及同文档不可变正文/布局修订；不提前实现 Review/Tailoring、DOCX、Interview、Knowledge、前端或真实外部调用 |
| 当前实现契约 | [PRD v0.2：本地完整 MVP](01-prd-v0.2.md)；长期 owner、公共/私有 Case、requirement context、Resume/Review、Interview/Debrief/Knowledge 与 Case mutation event v2 已注册为 migrations 025–029 |
| 当前产品证据 | `E0`：没有可复核目标用户行为证据；H-PROBLEM-001、H-VALUE-001 均未判定 |
| 本地岗位目录 | 干净 `aijob_alpha` 为 22 条岗位 / 3 家企业 / 3 个官方 ATS 来源；开发库 14/2 与纠偏前 231/149/29、152/30 仅保留为历史运行事实 |
| 来源政策 | 34 个 Git 配置中 12 个 `canonical`：7 个活动确定性、2 个浏览器提醒、3 个硬冲突暂停；22 个高校等来源全部为 `discovery_only` 且零调度；公共 `/v1/jobs` 为 0 |
| 金标 | 50 条跨职能分类金标覆盖 12 个职能且 A/B 盲标 50/50 一致；40 条三轴工程金标继续通过；均不计为用户研究样本 |
| 工程质量 | 隔离 PostgreSQL 串行全仓 659/659 通过；Resume Document HTTP/PostgreSQL 2/2、ApplicationCase + Resume focused 5/5、database 51/51、platform 441/441。lint 387 files、typecheck、build、audit 通过；audit 保留 1 个有明确移除条件的 dev-only high ignored，UI 继续沿用 Phase 1B 的 1920/1280/768/320 Gate |
| AI | 单块真实 `suggestedText`、要求/证据引用、未选区块保留、编辑和真实章节 DOCX 已通过；公开环境关闭 |
| 参与者验证 | 尚未开始；G0 为 0/2，只有 coco 明确启动后才执行，G1 仍未开始 |
| 下一决定 | Phase 2B-4B 完成 V1 只读转换、首次编辑生成 V2、不可变正文/布局修订和 owner/并发/删除回归后，四选一：继续后续 Resume Review/Tailoring 切片、修改、回退或停止 |
| 下一决定日期 | Phase 2B-4B 证据包完成后 |

工程证据见 [Private Alpha 官方来源资格硬门](evidence/ingestion/private-alpha-official-source-gate-2026-08-03.md)、[Private Alpha 容量审计](evidence/ingestion/private-alpha-capacity-audit-2026-08-03.md)、[本机自动来源刷新验收](evidence/ingestion/source-refresh-automation-2026-08-01.md)、[首轮扩展运行观察](evidence/ingestion/source-refresh-first-rollout-observation-2026-08-02.md)、[G2 正确性重新验收记录](evidence/g2/correctness-reacceptance-2026-07-20.md)、[验收反馈修正记录](evidence/g2/acceptance-followup-2026-07-20.md)、[全部职能扩容离线基础验收](evidence/g2/all-function-expansion-foundation-2026-07-20.md)和[新公司官方来源首批评估与低频探测](evidence/ingestion/new-source-batch-2026-07-20.md)；旧工程基线见 [2026-07-18 工程验收记录](evidence/g2/local-complete-mvp-engineering-2026-07-18.md)。

### Private Alpha 供给差距

| 指标 | 当前基线 | 硬门槛 | 当前差距 |
|---|---:|---:|---:|
| 可见活动岗位 | 22 | 1000 | 978 |
| 企业 | 3 | 100 | 97 |
| SME 企业 | 2 / 3 | 至少 50% | 到 100 家门槛至少再需 48 家合格 SME |
| SME 可见岗位 | 14 / 22 | 至少 40% | 到 1000 岗门槛至少再需 386 条 SME 岗 |
| 人工/浏览器来源企业 | 0 / 3（0%） | 不高于 20% | 当前通过；浏览器来源继续冻结 |
| 人工/浏览器来源可见岗位 | 0 / 22（0%） | 不高于 10% | 当前通过；浏览器来源继续冻结 |
| 12 职能实际分布 | 产品 1、运营 0、工程 3、数据与 AI 8、行政人事法务 3、市场 1、销售商务 1、冲突 3、未知 2 | 产品/运营/工程/数据与 AI 各 100；其余各 15 | 按干净库实际分母继续补缺 |
| 8 城市实际分布 | 杭州 8、深圳 6、上海 4；其他区/省/组合地点不能冒充目标城市计数 | 各 40 条地点已知岗位 | 按明确城市继续补缺 |

110 家企业 / 1100 条可见岗位是吸收到期和来源暂停的运营缓冲，不替代 100/1000 硬门槛。当前可信供给是 22/3；231/149/29 只表示纠偏前目录运行事实，产品证据仍为 `E0`。

## 2. 当前最高产品风险

| ID | 假设 | 当前证据 | 验证时机 |
|---|---|---|---|
| H-PROBLEM-001 | 目标学生仍需要跨官方来源的资格与经历证据决策层 | E0，未验证 | 供给硬门槛和服务器就绪 Gate 后的 2 人校准与 6 人任务 |
| H-VALUE-001 | 来源/时效、三轴推荐和简历对照修改能改善投递决定且不造成错误劝退 | E0，未验证 | 供给硬门槛和服务器就绪 Gate 后的正式任务与 72 小时回访 |

当前接受先投入完整 MVP 工程成本再验证价值的风险。岗位数量、抓取成功、AI 调用、DOCX 或自动化测试都不能支持这两个假设。

## 3. Gate 状态

固定顺序：

```text
Phase 1A/1B（已通过）
  -> Phase 2 领域与接口
  -> Phase 3 三个 PoC
  -> Phase 4 一岗全闭环
  -> [Phase 5/6 产品收口 || G2 100/1000 可信供给 + G3 三来源连续 7 天]
  -> 服务器就绪 Gate
  -> G0 2 人协议校准
  -> G1 6 人价值验证
  -> G4 Private Alpha
```

| Gate | 通过条件摘要 | 当前状态 | 当前决定 |
|---|---|---|---|
| G2 Local Complete MVP / Private Alpha 供给 | 100 家企业、1000 条可见活动实习；SME 企业 ≥50%、岗位 ≥40%；产品/运营/工程/数据与 AI 各 ≥100，其余职能各 ≥15；8 个目标城市各 ≥40；人工来源企业 ≤20%、岗位 ≤10%；完整产品闭环继续通过 | 可信度纠偏完成、规模未通过 | 当前可信 22 岗 / 3 家、均为确定性官方 ATS；距总量至少缺 97 家 / 978 岗，E0 不变 |
| 服务器就绪 | 可重复镜像、迁移、五角色、配置/密钥、监控、备份恢复、回滚；授权后私有 HTTPS、持久限流、隔离解析、RPO/RTO、20 并发负载和日志脱敏通过 | 已定义、未开始 | 先做基础设施无关部署包；供应商、地区、预算和数据路径必须由 coco 在供给 Gate 后授权 |
| G0 协议可用 | 完整 MVP 做 2 人校准，术语、任务、记录和外链返回无需额外教学 | 暂停 | 供给硬门槛与服务器就绪 Gate 均通过后再由 coco 明确启动，历史 0/2 |
| G1 MVP 用户价值 | 4/6 找到 3 个岗位；5/6 正确区分四类概念；3/6 完成高质量决定且 2 人自报投递；守护指标为 0 | 未开始 | G0 后开始 |
| G3 数据可持续 | 至少 3 个已准入确定性 canonical 来源连续 7 天，每 12 小时完成应到刷新，失败隔离且无静默空结果、重复触网或目录污染 | 未开始，0/3 | Phase 4 前不恢复真实来源；历史运行证据不回写为新 Gate 通过 |
| G4 Private Alpha | 供给硬门槛、服务器就绪 Gate 与 G0–G3 全部通过，现有分类/三轴金标门继续通过，删除/恢复/运行演练完成 | 未开始 | 不扩大邀请 |
| G5 Beta | Alpha 失败模式可控，金标扩至 60，公开合规与安全门通过 | 未开始 | 不公开扩张 |

任何硬条件漏检、错误劝退、虚构经历、未确认事实参与结论、跨 owner 越权或隐私事件都不能用平均指标抵消。

## 4. G2 切片状态

### S0：契约与基线

- [x] PRD v0.2 与 ADR-0011/0012/0013 固定“先完整 MVP、后参与者验证”。
- [x] 历史 `/research/*` 保留；正式产品使用 `/jobs/*`。
- [x] 研究筛选、移动抽屉、键盘语义和相关测试收口。
- [x] README、路线、架构、安全、体验、匹配和 API 契约一致。
- [x] ADR-0015 记录全部职能扩容，ADR-0017 将目标更新为 300–500 岗位和中小企业为主，ADR-0025 进一步把企业范围调整为 30–40 家；这是当时已执行的历史目标，2026-08-02 起由 ADR-0027 的 100/1000 供给门槛部分替代。
- [x] ADR-0016 允许本机人工浏览器辅助导入，但不允许生产 Playwright、动态签名绕过或正式校招全职混入当前实习集。
- [x] ADR-0017 固定认证公众号、企业域名邮箱、公司规模证据和逐批审批边界。
- [x] ADR-0018 固定确定性 JD 洞察、样本门槛和个人证据对照。
- [x] ADR-0028 固定容量型来源族、动态分母、`capacity/coverage/deferred` 候选车道和两个来源族失败后的停止条件。

### S1：多来源岗位目录

- [x] PostgreSQL 提供正式 `/v1/jobs`、详情、facets、覆盖率和已知/未知条件语义。
- [x] 腾讯、南开就业网·好未来、美团三个适配器各有离线夹具和受限网络策略。
- [x] 本地目录 31 条，三个来源各至少 5 条；来源内幂等、不可变版本和要求集成立。
- [x] 跨来源疑似重复只生成复核项；未说明字段保持 `unknown`。
- [x] `pending_review` 只允许 `local_mvp`，公开目录保持空。
- [x] 将职能契约、来源列表、适配器复用和请求预算扩展到 ADR-0015 范围；新增来源仍需逐项评估和显式探测批准。
- [x] 首批完成字节、阿里、京东、百度、华为和小米的只读评估；百度与京东各建立受限适配器并各以 1 个列表请求写入 10 条本地岗位，重复执行不触网且不生成重复版本。
- [x] 字节首屏 10 条官方实习详情经人工逐条核对；快照不含签名、Cookie 或浏览器状态，离线导入运行请求数为 0，重复导入和物化均幂等。
- [x] 审批包 01 执行：帆软表单列表适配器与北森 zhiye 共享适配器（慧策/灵明光子/普渡三租户）完成契约冻结、离线夹具与真实低频探测，各导入首批 5 条明确实习；千寻智能因飞书动态令牌按预设暂停。
- [x] 抽检反馈修复：北森逐岗深链经实测对官方自身也不可用（GetJobAdInfo 参数错误），申请链接改为官方职位列表页（适配器 0.1.1、政策 v2）；DisplayFields 契约修正补齐三租户全部城市与发布时间，目录城市未说明从 15 条降为 0。
- [x] 审批包 02 执行：高校就业详情页共享适配器（南开 correcruit / 港中深 jobview / 浙大 jyxt 三种冻结格式）完成契约冻结、离线夹具、真实页面互证与低频探测；硕方 5、鲸驰 1、神谷 1、红海云 1 首批导入，鹏扶因投递邮箱域名无法核验按预设暂停；红海云成为首家带合格中小规模证据（medium）的企业。
- [x] ADR-0021 配额压缩：迁移 016 建立确定性单家配额选择表，物化择优（优先轨道在前）、目录/洞察读取过滤与 `/v1/jobs` 公开缺口分母上线；普渡/慧策/帆软/腾讯压至各 10 条，52 条被压缩供给保留缺口记录。
- [x] 千寻智能人工快照批次：飞书 ATS 首批 7 条实习经人工浏览器读取生成零网络快照导入（request_count=0、重放幂等）；3 条无任职要求正文的岗位按最低字段要求排除留痕。
- [x] P0 提额后硕方为 6 条，千寻前三页按完整字段标准导入 22 条；批次 02 的 15 条自审通过。
- [x] P1–P5 首轮执行：中信证券上海分公司新增 1 条；批次 03–06 其余来源按过期、主体/申请链冲突或 `ECONNRESET` 分别暂停。
- [x] ADR-0025 恢复批次：先临三维 8、分享投资 1、北京鼎帷 1 通过；全志、昆仑芯、DTL 分别因结构或主体硬冲突暂停；目录更新为 188 / 124 / 19，SME 3/19 与 10/124。
- [x] 批次 07-01：固定 20 家队列完成核验；卧安 4、一清 3、三石园 1 通过并完成 8/8 来源级自审；目录更新为 196 / 132 / 22，SME 6/22 与 18/132。
- [x] 批次 07-02：千家台账首组 5 家完成核验；寒序 2 条纯实习完成 2 请求、2/2/0、同小时幂等与 2/2 自审；共享高校适配器升至 `0.1.2`，目录更新为 198 / 134 / 23，SME 7/23 与 20/134。
- [x] 批次 07-03：7 月 31 日截止的 5 家完成核验；望尘 1 条在截止前完成 1 请求、1/1/0、同小时幂等与 1/1 自审；共享高校适配器升至 `0.1.3` 并排除港中深页脚污染；截止后来源转 v3 `paused`，该批收口时点目录回到 198 / 134 / 23，SME 7/23 与 20/134。
- [x] ADR-0026 三来源真实灰度：卧安 5/5/0、先临 9/9/0、硕方 6/6/0；同窗口重放均 `reused=true`，0 硬冲突，物化新增 2 条合格岗位。随后把其余 18 个活动确定性来源分散排期，浏览器来源继续零网络提醒。
- [x] 2026-08-02 首轮扩展运行观察：神谷 1/1/0、帆软 12/12/0、普渡 30/30/0、寒序 2/2/0、鲸驰 1/1/0 与慧策 30/30/0 均自动接受，0 拒绝、0 自动暂停且未触发熔断；普渡新增 2 条有效供给，目录推进至 202 / 136 / 23，详见[观察记录](evidence/ingestion/source-refresh-first-rollout-observation-2026-08-02.md)。
- [x] 2026-08-03 稳定切片：已验证来源汇总后规划器基线为 231 / 149 / 29；候选注册表 v4、`source:candidate-audit`、动态 SME 检查点、人工来源冻结和配置引用完整性已通过离线验证。
- [x] P6 建立 50 条跨职能分类金标，覆盖 12 个职能并完成独立 A/B 盲标。
- [ ] 达到 100 家企业、1000 条可见活动岗位及 ADR-0027 的 SME、职能、城市和人工来源占比门槛；110/1100 作为运行缓冲，所有记录继续满足官方来源、规模证据、申请方式、字段完整性和抽检标准。

### S2：匿名 owner、简历与数据控制

- [x] localhost 匿名 owner、HttpOnly 会话、Origin/CSRF 和 owner 级鉴权。
- [x] PDF、DOCX、文本输入；5 MiB、MIME/魔数、宏、加密、ZIP bomb 和扫描 PDF 失败路径。
- [x] `ProfileFact`、`JobPreference`、`ResumeDocumentRevision` 与 `ResumeEvidence v2` 分组确认和不可变修订；已有事实优先，候选只填空白。
- [x] 原文件/原文确认后立即删除且最长 24 小时；数据库只保存无正文候选元数据，授权读取时才从加密临时文本即时重建。
- [x] 历史实现曾设置结构化 owner 数据最长 30 天自动删除；该约束已由 ADR-0031 标记为待复核，不再作为长期 Career OS 目标。
- [x] 删除墓碑、epoch、并发到期清理、迟到任务拒绝、状态查询和删除后不可恢复访问。
- [x] 历史实现支持确认后的有序简历区块在 30 天内查看和复用；Phase 2R 将其改为职业资产长期保留、用户主动删除，原文件和临时原文仍不可恢复。
- [x] Alpha 使用哈希邀请凭证、精确 HTTPS Origin、失败限流和 Secure/HttpOnly 会话；后端所有产品读取接口同步要求已认证会话，不能绕过前端访问岗位目录。
- [x] PDF/DOCX 解析移至受限 Node 子进程，具备内存、时间、输出、页数/条目/解压大小限制，任务失效或超时会终止子进程，且不继承数据库、AI 或密钥环境变量。

### S3：三轴匹配与推荐

- [x] 原子 `JobRequirementSet v4`、活动要求集、唯一条件投影、32 个命名金标和毕业年份/中文月份边界。
- [x] 不可变 `MatchRun` 与资格、经历证据、偏好三轴。
- [x] `RecommendationRun` 冻结候选、要求集、画像修订、规则版本与来源核验时间。
- [x] 目录客户端完整遍历游标并拒绝重复/停滞/缺版本；100 家/1000 个官方来源岗位可完整入队并冻结 1000 个候选，前端分批渲染但不截断候选集合。
- [x] 排序使用资格、偏好、证据、新鲜度和稳定 ID；不展示数字分数。
- [x] 推荐原因、未知项、来源、官方链接和五态 `JobDecision` 可用。
- [x] 经历证据先严格原词、再用 `capability-ontology-v2` 连接全部职能的同类行为；明确工具不得被同能力工具替代，推荐页公开解释规则。
- [x] `JobInsightRun` 冻结岗位版本、要求集、来源核验时间、筛选和证据修订；按公司覆盖优先生成硬门槛、能力经验、加分项和个人对照。
- [x] 洞察在少于 20 岗位、5 家公司或 70% 原子要求覆盖时拒绝排名；旧 v1 简历证据不得伪造 `sourceBlockId`。

### S4：受控 AI、模板与 DOCX

- [x] OpenAI-compatible HTTPS 适配层、可替换后端配置来源、超时、响应大小、无工具调用和 Schema 校验。
- [x] 模型针对单个 `sourceBlockId` 返回真实 `suggestedText` 和已确认 evidence/requirement 引用；服务端逐块校验，不允许发明事实或数字。
- [x] 用户可逐段接受、拒绝或编辑；AI 不自动修改最终简历。
- [x] AI 不可用时模板降级；复制和冻结后的 ATS DOCX 可用。
- [x] 模拟供应商、安全失败和事实引用测试通过。
- [x] coco 通过 `pnpm ai:configure` 填写本地后端配置；固定合成、去标识化、已确认 ID 的真实兼容接口冒烟返回 `status=passed`、`selectionCount=1`。

### S5：运行与端到端

- [x] `web-api`、采集 CLI/worker、`match-worker` 和 PostgreSQL 任务表保持权限边界。
- [x] ADR-0023 已接受：Alpha/Production 强制独立数据库 URL；迁移 021/022 建立五个运行角色、任务 RLS、原始快照隔离和 owner 删除列级最小权限。
- [x] 采集任务使用 `source_id`，用户任务使用 `owner_id + owner_epoch`，约束禁止混用。
- [x] 推荐、优化、DOCX、决定、删除和删除后拒绝旧任务的浏览器闭环通过。
- [x] 320 px 下目录、详情、推荐、岗位洞察、优化和数据控制无全局横向溢出；主要操作目标达标。
- [x] 全量安全、数据库、幂等、构建、类型和 lint 工程门通过。

2026-07-19 的旧工程门因 2026-07-20 运行审计发现硬条件漏投影、证据粒度失真、偏好误判和建议稿未真实改写而失效。随后完成 v4 活动要求集/唯一投影、简历文档修订/原子证据 v2、`decision-readiness-v2` 和逐块优化修复；目标美团句式、31 条离线目录、PDF/DOCX/文本、1612 字单块、推荐解释、DOCX XML、桌面和 320 px 均重新通过。中小企业与 JD 洞察实现随后通过 317 项测试、TypeScript、生产构建和 245 个文件 lint；真实浏览器确认产品方向当前 18 岗位、4 公司、18/18 要求已拆解时明确拒绝排名，桌面和 320 px 无全局横向溢出或控制台错误。原 31 岗位 G2 基线因此重新通过，但 ADR-0017/0018 扩大的 300–500 岗位与 JD 洞察范围仍处于 G2 重新验收，产品证据仍为 E0。该句保留当时范围事实；2026-08-02 后续治理已由 ADR-0027 的 100/1000 供给门槛替代。

## 5. 历史数据来源进度

> 本表保留 ADR-0029 前的导入与适配器历史，不再代表当前用户目录。当前可信目录只包含先临三维 9、卧安机器人 5、灵明光子 8；高校、公众号和其他二手页面只能用于发现官网方向。

| 来源 | 本地岗位 | 当前事实 | G2 | G3 |
|---|---:|---|---:|---:|
| 腾讯官方招聘 `p_104` | 14 | 官方企业域名公开接口；聚合占位 ID 被拒绝；政策待审批 | 14 | 0 |
| 南开就业网·好未来 2027 暑期实习 | 7 | 高校官方单页列出企业与 Moka 申请链接；岗位级职责未知 | 7 | 0 |
| 美团官方招聘产品实习 | 10 | 企业自有域名公开列表/详情接口；字段未说明时保持未知 | 10 | 0 |
| 百度官方实习招聘 | 10 | 企业自有域名 SSR 首屏；单次 1 请求、10 条，申请链接为官方 UUID 详情；coco 抽检通过，政策待审批 | 10 | 0 |
| 京东校园招聘实习生 | 10 | 企业自有域名公开实习列表接口；单次 1 请求、10 条，申请链接为官方详情；coco 抽检通过，政策待审批 | 10 | 0 |
| 字节校园招聘人工快照 | 10 | 企业自有域名可见 DOM；人工逐条核对、离线零网络导入、只收明确实习；coco 抽检通过，动态签名不逆向，政策待审批 | 10 | 0 |
| 帆软实习生招聘 | 18 | 企业自有域名公开列表 JSON；mode=实习官方标记，19 条在招中 18 条实习全量导入，申请链接为官方数字 id 详情；coco 抽检通过 | 18 | 0 |
| 慧策校园招聘·实习 | 30 | 北森租户公开列表接口；标题实习标记过滤达单家 30 条上限，申请链接为官方校招职位列表页；南开简章佐证约 3000 人为 large；coco 抽检通过 | 30 | 0 |
| 灵明光子实习招聘 | 7 | 北森租户专门实习类目；7 条全实习全量导入，申请链接为官方实习职位列表页；coco 抽检通过 | 7 | 0 |
| 普渡机器人实习招聘 | 32 | 北森租户专门实习类目；初始按单家上限导入 30 条，首轮计划刷新 30/30/0 并新增 2 条供给；申请链接为官方实习职位列表页；coco 抽检通过 | 32 | 0 |
| 硕方信息·南开就业网实习 | 6 | 南开实习信息栏目 6 页同企业详情；投递走原文明示官方网址；批次 02 自审通过 | 6 | 0 |
| 鲸驰寰宇·港中深就业网实习 | 1 | 高校详情页 + 企业域名邮箱（与原文明示官网同域）；官网建设中留复核项；批次 02 自审通过 | 1 | 0 |
| 神谷文化·港中深就业网实习 | 1 | 高校详情页 + 企业域名邮箱（工商登记邮箱同域佐证）；批次 02 自审通过 | 1 | 0 |
| 红海云·浙大就业网实习 | 1 | 高校详情页 + 企业域名邮箱（ICP 主体精确匹配）；企业规模 200-500 人合格证据（medium）；批次 02 自审通过 | 1 | 0 |
| 千寻智能飞书校招实习人工快照 | 22 | 前三页 30 条按“实习 + 职责与要求完整”纳入 22 条；零网络导入与重放幂等；动态签名不逆向；批次 02 自审通过 | 22 | 0 |
| 中信证券上海分公司暑期实习 | 1 | 高校官方详情页明确发布主体与实习属性；1/1/0 导入、重放不触网；批次 04 自审通过 | 1 | 0 |
| 先临三维官方实习招聘 | 9 | 官方北森 ATS；官网团队 1300+ 人构成 `medium` 证据；恢复首批 8/8/0、灰度计划运行 9/9/0 | 9 | 0 |
| 分享投资·港中深就业网实习 | 1 | 高校详情页、官网主体与企业域名邮箱闭环；官网团队 50 余人构成 `small` 证据；批次 03 自审通过 | 1 | 0 |
| 北京鼎帷·浙大就业网实习 | 1 | 高校详情页与企业域名邮箱闭环；规模保持 `unknown`；批次 03 自审通过 | 1 | 0 |
| 卧安机器人官方实习招聘 | 5 | 官方北森 ATS；港交所年报 644 名雇员构成 `medium` 证据；批次 07-01 与灰度计划运行通过 | 5 | 0 |
| 一清创新·南开就业网实习 | 3 | 三张冻结高校详情页与企业域名邮箱闭环；官网团队 180+ 构成 `small` 证据；批次 07-01 自审通过 | 3 | 0 |
| 三石园科技·南开就业网实习 | 1 | 冻结高校详情页与企业域名邮箱闭环；官网员工 1400+ 构成 `medium` 证据；批次 07-01 自审通过 | 1 | 0 |
| 寒序科技·浙大就业网实习 | 2 | 两张冻结高校详情页均为纯实习，职责与要求完整；官方 Moka 只作投递交接；2/2/0、重放幂等；批次 07-02 自审通过 | 2 | 0 |
| 望尘科技·港中深就业网实习 | 0 | 截止前 1/1/0、重放幂等并通过自审；2026-08-01 来源转 v3 `paused`、禁止再探测，历史修订与版本保留但当前目录下架 | 0 | 0 |

腾讯、帆软、慧策、普渡与千寻的本地岗位为供给数；按 ADR-0021 配额五家各可见 10 条，当前分别压缩 4、8、20、22、12 条，合计 66 条。千寻智能已按 ADR-0016 以人工浏览器快照进入本机目录；鹏扶投资因两个投递邮箱域名均无法核验主体归属按预设暂停。

当前通过探测的来源 `accessPolicyAccepted` 均未通过，因此只能用于本机目录；结构或主体硬冲突来源保持暂停。不得通过登录、验证码、代理 IP、动态签名逆向或放宽白名单满足数量。字节与千寻只按 ADR-0016 使用维护者人工可见 DOM 快照，导入 CLI 本身不触网，也不进入生产 Worker。评估和运行证据见首批、批次 01–06 与 ADR-0025 恢复执行记录。

## 6. 下一行动

### 已完成的前序动作

1. [x] ADR-0025 的恢复批次、固定 20 家 SME 队列和批次 07-01/07-02/07-03 已完成；失败来源独立暂停，历史执行事实不改写。
2. [x] ADR-0026 的独立 `collector-worker`、本地总开关、到期调度、接受门、活动状态、浏览器提醒和运维 CLI 已完成；三来源灰度及 21 个确定性来源分散排期已通过当时工程门。
3. [x] 2026-08-03 规划器确认当前目录为 231 / 149 / 29；现有 24/168 小时来源仍使用每小时 3 家的历史限制。

### 已完成的 Phase 1A 行动

1. [x] 增加明确的 Career OS 功能旗标；关闭时继续进入现有 `/jobs` 等页面，开启时进入同一套 `WorkspaceShell`，没有建立第二套身份、数据请求或全局状态系统。
2. [x] 使用仓库内静态夹具实现 `/applications` 的列表/看板切换、筛选、排序与 `?peek=<caseId>` 右侧侧览；视图状态写入 URL，侧栏折叠和面板宽度只保存在本机非敏感 UI 偏好中。
3. [x] 建立 `/applications/:caseId/overview|requirements|resume|application|interview|debrief` 的共享 CaseHeader/CaseTabs 路由骨架；六个路由只显示静态上下文和明确占位。
4. [x] 功能旗标回退、刷新/前进/后退恢复、侧览焦点与位置返回、1920/1280/320 无整页横向溢出、键盘焦点和浏览器错误检查全部通过；证据见 [Phase 1A 工作台壳层验收](evidence/product/career-os-v2/phase-1a-workspace-shell-acceptance-2026-08-04.md)。

### 已完成的 Phase 1B 行动

1. [x] `/applications/:caseId/requirements` 已完成三组要求、静态原文、证据三态、`?requirement=`、共享检查器与焦点返回。
2. [x] `/applications/:caseId/resume` 已完成结构导航、两模板、A4 预览、`?block=` 与当前区块检查器；没有独立品牌。
3. [x] 接受、编辑后采用、拒绝与撤销只影响当前会话；真实刷新复位，不调用 AI、不保存用户事实。
4. [x] 旗标回退、1920/1280/768/320 无整页溢出、移动全宽抽屉、焦点和控制台检查通过；证据见 [Phase 1B 验收](evidence/product/career-os-v2/phase-1b-static-workspaces-acceptance-2026-08-05.md)。

### 当前 Phase 2 行动

1. [x] 盘点 `packages/database` 既有迁移、owner/epoch/TTL/墓碑、删除权限、PostgreSQL 任务队列和 Resume V1 表，形成“复用 / additive 扩展 / 禁止重复”矩阵。
2. [x] 冻结 ApplicationCase、Resume V2、Interview、Debrief、Knowledge 的表、索引、不变量、保留期和删除顺序；同一 owner/稳定岗位唯一未结束 Case 与固定岗位版本由数据库约束支持。
3. [x] 冻结 owner 保护 API、幂等键、`expectedRevision`、不可枚举 404、Problem Details、CSRF 和 `no-store` 契约。
4. [x] 形成迁移 023–027 顺序、V1 只读转换、旧应用兼容、回退/前向修复与 PostgreSQL 集成测试矩阵；设计 Gate 决定为“继续”。
5. [x] Phase 2A-1 新增 ApplicationCase 公共类型与 migration 023 core tables/constraints/indexes/permissions；没有注册 API 或写业务数据。
6. [x] 隔离 PostgreSQL 已同时验证空库 `001 -> 023` 和含 V1/旧决定/任务的 022 fixture 升级；旧行兼容、约束、索引和角色权限通过，证据见 [Phase 2A-1 验收](evidence/product/career-os-v2/phase-2a1-application-case-core-acceptance-2026-08-05.md)。
7. [x] Phase 2A-2 新增 Resume Document V2 contracts、`resume_documents`、`resume_layout_revisions`，并 additive 扩展既有 `resume_document_revisions`；不接 API 或回填 V1。
8. [x] 隔离 PostgreSQL 验证空库 `001 -> 024`、V1 行逐列兼容、V2 owner/document/layout 约束、模板、TTL、不可变修订和角色权限。
9. [x] Phase 2R 已完成长期资产、私有 JD、Resume Review、身份、strict Schema 和唯一真源契约矩阵；不创建 migrations 025-027。
10. [x] Phase 2A-Forward-Contract 离线契约子切片已新增公共/私有 JobContext、strict Case event、Resume semantic content、strict layout 和 Review 聚合；37 项 contract tests 通过，证据见 [契约子切片验收](evidence/product/career-os-v2/phase-2a-forward-contract-acceptance-2026-08-06.md)。
11. [x] `Phase 2A-023F/024F` 未注册原型已前向修复历史 30 天 Case/Resume TTL、公共岗位必填、宽 event/layout JSON 和正文建议状态；隔离 PostgreSQL 7/7 通过。因 owner 级 30 天删除仍存在，决定为“修改”，不注册正式迁移。
12. [x] `Phase 2A-Identity-Forward-Contract` 已完成长期 owner、Account、EmailIdentity、验证码 challenge 和匿名 owner 认领 contracts/隔离原型；5/5 + 5/5 通过，决定为“继续”。
13. [x] `Phase 2A-025 Identity Account/Email Expand` 已注册 additive identity migration、更新数据库类型与 owner active predicate，并通过空库/024 fixture、角色、匿名兼容、身份删除和前向回退；证据见 [Phase 2A-025 验收](evidence/product/career-os-v2/phase-2a-025-identity-account-email-expand-acceptance-2026-08-06.md)。
14. [x] `Phase 2A-026 ApplicationCase Long-Lived Forward Repair` 已正式化私有 JD 快照、长期公共/私有 Case、strict event 和 ApplicationCase 删除覆盖；迁移 9/9、全仓 631/631 通过。因私有要求上下文尚未贯通，决定为“修改”，证据见 [Phase 2A-026 验收](evidence/product/career-os-v2/phase-2a-026-application-case-long-lived-forward-repair-acceptance-2026-08-06.md)。
15. [x] `Phase 2A-026B Private Requirement Context Forward Repair` 已补公共/私有要求上下文联合类型、state-scoped 子表 FK、strict event、owner 隔离、legacy backfill 和删除覆盖；隔离 PostgreSQL 10/10、全仓 635/635 通过，决定“继续”。
16. [x] `Phase 2A-027 Resume/Review Forward Repair` 已正式化长期 Resume、public/private Case 派生引用、strict Content/Layout、Review 四表、owner 删除和非破坏回退；隔离 PostgreSQL 11/11、全仓 636/636 通过，决定“继续”。
17. [x] `Phase 2A-028 Interview/Debrief/Knowledge Expand` 已正式注册三个长期领域聚合、strict contracts、public/private JobContext、owner/epoch、Case 选择性脱离、迟到任务、角色权限、owner 全量删除和非破坏回退；隔离 PostgreSQL 12/12、全仓 645/645 通过，决定“继续”。
18. [x] `Phase 2B-1 ApplicationCase Service/API` 已完成 Case 列表、public/private 幂等创建和同 owner 详情，复用既有 owner session、CSRF、`no-store` 与 Problem Details；串行全仓 648/648 通过，决定“继续”。
19. [x] `Phase 2B-2 Case Transition/Job Version` 已完成追加式阶段/结果事件、`expectedRevision`、确定性岗位版本差异、显式升级和可无损旧决定兼容；状态矩阵 25 组合、隔离 PostgreSQL 和串行全仓 651/651 通过，决定“继续”。
20. [x] `Phase 2B-3 Requirement Service/API` 已完成公共/私有固定要求读取、三态与备注、同 owner 已确认证据链接、未知问题、Case revision/事件一致性和 owner/CSRF 回归；migration 029 以前向兼容方式注册 strict `case-event-v2`，隔离 PostgreSQL 串行全仓 655/655 通过，决定“继续”。
21. [x] `Phase 2B-4A Resume Document Aggregate API` 已完成稳定列表、幂等 base/case-derived 创建、同 owner 详情、V1 只读来源发现、public/private 固定引用及 owner/CSRF/墓碑回归；隔离 PostgreSQL 串行全仓 659/659 通过，决定“继续”。
22. [ ] 当前实现 `Phase 2B-4B Resume Content/Layout Revision API`：只做 V1 只读转换、首次编辑生成 V2、不可变正文/布局修订、文档 `expectedRevision`、幂等和稳定 section/block/evidence ID；不做 Review/Tailoring、DOCX、Interview、Knowledge、前端或真实外部调用。

### 一岗闭环后恢复的规模化行动

1. [x] ADR-0027 冻结 100/1000 硬门槛、110/1100 运行缓冲、SME 50% / 40%、12 职能、8 城市和人工来源占比约束；ADR-0025 的旧数量目标和 40 家停止线不再作为当前终点。
2. [x] 将千家台账转为可重复运行的候选审计、证据与批次规划管线；ADR-0029 后以干净 22 岗/3 家目录重建职能、城市和人工来源分母，候选、过期页或缺字段记录不计入供给。
3. [ ] 一岗全闭环 Gate 通过后，按 40/400、70/700、100/1000 三个检查点恢复企业官网/官方 ATS 容量来源族扩容；每次报告企业、岗位、SME、职能、城市、人工来源、拒绝、暂停、重复与公共目录真实分母。
4. [ ] 12 小时动态容量与 110 来源离线测试已实现；达到 `40/400` 后才把活动确定性来源策略统一切至 12 小时并真实灰度，不放宽逐来源预算、安全边界、失败隔离或熔断。
5. [ ] 达到 100/1000 后执行全量工程门、空库恢复一致性和 1920/1280/768/320/200% 产品闭环，再按已冻结定义通过服务器就绪 Gate。
6. G0/G1 不启动，产品证据保持 `E0`；公开 `/v1/jobs`、公开 AI 与手机端专属实现继续关闭。ADR-0023 已接受，ADR-0024 仍为提案。

## 7. 不可改变边界

- 只抓允许技术访问的官方公开来源；不抓综合平台，不绕过登录、验证码和访问控制。
- 技术可访问不等于获准公开；`pending_review` 只能用于本机 `local_mvp`。
- 岗位未说明字段保持 `unknown`；资格、证据、偏好分开；无匹配百分比和自动劝退。
- AI 只优化表达，不能修改三轴、创造经历、调用工具或接收原文件。
- 用户在官方页面自行投递；不自动填写、模拟登录或批量投递。
- PostgreSQL 是唯一查询和任务真源；不引入 Redis、向量库、独立搜索、消息总线、生产 Playwright 或公共管理后台。
- 不做 OCR、旧版 `.doc`、宏、加密文档或复杂版式复刻。
- 原文件/原文和临时解析最长 24 小时；职业资产默认长期保留，用户可主动单项或全部删除。

## 8. 面板更新规则

每次更新必须写清新增证据、受影响切片、Gate 变化和下一决定。没有目标用户证据时只能写工程完成，不得写“价值已验证”“成熟”或“受到用户认可”。
