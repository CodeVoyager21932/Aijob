# 架构决策记录

本目录记录跨模块、信任边界与重要取舍。ADR 解释决定及代价，不表示对应能力已经通过验证；当前任务读取 [路线图](../06-mvp-roadmap.md) 与 [当前交接](../handoffs/current.md)。

以下为 2026-10-13 的有效范围索引，不改写历史 ADR 原文。“部分替代”仅撤销表中指出的旧条款；其余有效边界保留。阶段授权、运行快照和旧“后续动作”不能当作现在的执行指令。旧文中的 accepted 是当时状态，阅读时须同时核对本索引的后续决定。

## 近期决定与替代关系

| ADR | 当前状态 | 有效范围及更新 |
|---|---|---|
| [0037 产品主体与受控供给自动化](0037-product-core-and-controlled-automation.md) | 有效，个人材料流程由 0038 更新 | 本硕博在校生、学历/院校不作全局排除、robots 分级、collector 受控浏览器、受限内部台；替代早期全局排除与浏览器/内部 UI 一律禁止。来源准入和访问控制继续有效 |
| [0038 直接导入、完整经历与简历工作区](0038-resume-workspace-and-direct-import.md) | 有效 | 替代旧原件 24 小时删除、个人材料脱敏/逐句确认、AI 前事实审批、国产供应商白名单和仅运营方配置限制；原件保留到用户删除，临时副本独立清理，个人兼容 API、账户加密、局部采用/撤销。新访客材料长期；旧匿名 owner 仅在仍活动且主动保存时事务转换，不复活已删除/过期对象 |
| [0039 方向图谱与模板工作室](0039-direction-graph-and-template-studio.md) | 部分替代 | 方向语义、版本、完整经历、V2 工作区与旧结果兼容保留；30 套及旧模板质量/排版路线由 [0040](0040-resume-studio-quality-and-export-artifacts.md)、[0041](0041-native-resume-core.md)、[0042](0042-opportunity-and-resume-system-upgrade.md) 更新，旧矩阵不是当前必跑任务 |
| [0040 简历质量与导出产物](0040-resume-studio-quality-and-export-artifacts.md) | 部分替代 | 内容完整性、不可变产物、模板/字体版本及失败证据保留；HTML 主渲染由 [0041](0041-native-resume-core.md) 更新，再由 [0042](0042-opportunity-and-resume-system-upgrade.md) 增量演进。原文“实施中”属于 9/10 时点，不提供当前状态 |
| [0041 原生简历核心](0041-native-resume-core.md) | 部分替代 | 原生文档、只读投影、成对修订、PDF.js、同产物下载和旧稿兼容保留；固定 RRv5 的新排版方向由 [0042](0042-opportunity-and-resume-system-upgrade.md) 更新，不重做 K0–K5 |
| [0042 机会发现与简历准备](0042-opportunity-and-resume-system-upgrade.md) | 有效，搜索连接范围部分更新 | 局部纠错、统一服务端 PDF、四类主推模板、订阅/摘要、有限验证保留；Tavily 单入口及全局共享是旧 ownerless 路径，个人搜索选择/缓存/预算/权限按 [0043](0043-local-opportunity-productization.md) 执行 |
| [0043 本机产品化与搜索选择](0043-local-opportunity-productization.md) | 有效；桌面专属实施暂停 | 仅已有来源/复用个人 AI 搜索/独立 Tavily 三选一，真实搜索能力绑定配置修订，owner 搜索由 match-worker 执行，来源首次启用仍需明确操作。按 coco 同日决定，桌面专属同步、构建、安装验证与资料迁入暂停；已有代码、候选和网页能力保留 |

## 基础与早期决定

| ADR | 当前状态 | 保留与替代说明 |
|---|---|---|
| [0001 自行实现核心领域](0001-own-core-domain.md) | 有效，经后续接入决定补充 | 领域真源和信任边界由项目负责；允许按 0041/0042 固定版本接入简历能力，不等于移植上游全站 |
| [0002 官方公开来源白名单](0002-allowlisted-official-sources.md) | 有效，经后续补充 | 官方事实与精确准入保留；来源范围、政策状态和内部预览分别依 0029、0033、0035、0037 |
| [0003 规则优先匹配](0003-rule-first-explainable-matching.md) | 部分替代 | 确定性规则、unknown、不虚构和可解释性保留；旧“用户确认”不能恢复 0038 已取消的前置事实审批 |
| [0004 先礼宾后自动化](0004-concierge-before-automation.md) | 已替代 | 由 [0011](0011-mvp-before-participant-validation.md) 替代，不重新设为开发前置 |
| [0005 邀请会话与 owner 留存](0005-invitation-session-ownership-retention.md) | 部分替代 | owner 隔离、会话与删除墓碑保留；职业资产/原件留存依 [0031](0031-long-lived-career-os-architecture-realignment-2026-08-06.md)、[0038](0038-resume-workspace-and-direct-import.md)，不能再把会话期限当资料 TTL |
| [0006 模块化单体与三进程](0006-modular-monolith-runtime-boundaries.md) | 有效，文件边界已修订 | PG 真源与三个权限边界保留；上传隔离依 [0012](0012-isolated-resume-document-ingestion.md)，保留原件依 [0038](0038-resume-workspace-and-direct-import.md) |
| [0007 PG 任务与幂等消费](0007-postgres-task-idempotency.md) | 有效 | 租约、重试、幂等和失败隔离；新增任务按 0042/0043 明确服务权限 |
| [0008 不可变版本与用户决定](0008-immutable-match-versioning.md) | 有效 | 固定版本、三轴、用户决定；后续草稿不能改写实际投递历史 |
| [0009 模板优先与 AI 特性门](0009-template-first-ai-feature-gate.md) | 部分替代 | 无 AI 基础能力和如实报告真实状态保留；本地 AI 由 [0013](0013-local-ai-recommendation-and-resume-tailoring.md)、[0038](0038-resume-workspace-and-direct-import.md) 更新，公开条件读取现行 Gate |
| [0010 精确采集网络策略](0010-ingestion-network-policy.md) | 部分替代 | 精确协议/主机/端口/路径/参数与重定向校验保留；延后/禁止生产浏览器由 [0037](0037-product-core-and-controlled-automation.md) 更新 |
| [0011 先本地 MVP 后参与者验证](0011-mvp-before-participant-validation.md) | 部分替代 | 先形成可用闭环与真实用户证据诚实性保留；固定 2+6 人协议为历史研究方法，不是当前开发/发布前置，按 [现行条件](../plans/private-alpha-readiness-gates.md) 随交付收集反馈 |
| [0012 隔离 PDF/DOCX 导入](0012-isolated-resume-document-ingestion.md) | 部分替代 | 格式校验、5 MiB、隔离解析、无 OCR 保留；原件 TTL 与导入确认流程由 [0038](0038-resume-workspace-and-direct-import.md) 替代 |
| [0013 确定性推荐与受控 AI](0013-local-ai-recommendation-and-resume-tailoring.md) | 部分替代 | 推荐确定性、不编造、预算和降级保留；个人材料、供应商及采用流程依 [0038](0038-resume-workspace-and-direct-import.md)、[0042](0042-opportunity-and-resume-system-upgrade.md) |
| [0014 后端 AI 配置来源](0014-local-backend-ai-config-source.md) | 部分替代 | 适配器边界与不暴露密钥保留；个人 AI 的“前端无设置/只用运营方配置”由 [0038](0038-resume-workspace-and-direct-import.md) 替代，个人任务不回退运营方模型 |
| [0015 本机扩展全职能实习](0015-local-all-function-internship-expansion.md) | 已替代 | 由 [0017](0017-local-sme-expansion-and-official-account-boundary.md) 替代；当前供给单位继续由 0035/0037 更新 |
| [0016 人工浏览器辅助导入](0016-manual-browser-assisted-source-import.md) | 部分替代 | 明确操作、主体核验与不绕过访问控制保留；生产受控浏览器另依 [0037](0037-product-core-and-controlled-automation.md)，不能将所有浏览器方式均视为人工 |
| [0017 SME 与公众号/邮箱边界](0017-local-sme-expansion-and-official-account-boundary.md) | 部分替代 | 公众号仅发现、官方主体与企业邮箱核验保留；旧 SME 配额、规模目标与只收实习由 0027、0032、0035–0037 更新 |
| [0018 冻结样本 JD 洞察](0018-deterministic-job-market-insights.md) | 有效，经后续补充 | 冻结输入、原句和分母保留；新方向语义、版本和公共/个人隔离依 0037/0039，历史洞察不改写 |
| [0019 千家来源审查宇宙](0019-thousand-company-internship-discovery-universe.md) | 历史发现依据，部分替代 | 发现台账不等于准入或当前访问授权；供给/来源选择由 0028、0029、0035、0037、0043 更新 |
| [0020 产品运营/电子信息优先](0020-prioritize-product-operations-and-electronic-information-internships.md) | 历史阶段优先级 | 不限制当前全部职能与用户方向；旧批次“后续动作”不提供当前任务，当前方向按 0039/0043 |
| [0021 单家配额与 SME 缺口](0021-compress-large-company-quota-and-publish-sme-gap.md) | 配额已替代，历史证据保留 | 30/10 截断由 [0036](0036-remove-company-job-cap.md) 取消；不得据此限制单家公司岗位数 |
| [0022 批次预授权与委托抽检](0022-plan-batch-preauthorization-and-delegated-spot-checks.md) | 历史批次授权已结束 | 原批次授权不延伸到当前或未来来源；证据留痕保留，首次启用/扩范围/恢复暂停按当前明确操作执行 |
| [0023 运行时与数据库角色](0023-enforce-runtime-and-database-role-boundaries.md) | 有效 | 三服务最小权限；不能以旧“待实施”覆盖实际版本，owner 搜索任务权限按 0043 |
| [0024 来源描述符与运行模式](0024-unify-source-adapter-descriptors-and-run-modes.md) | 未批准提案 | 不作为改造或迁移授权 |
| [0025 G2 扩容与批次授权](0025-extend-g2-sme-company-cap-and-batch-authorization.md) | 部分替代，历史批次记录 | 数量/SME/批次规模由 0027、0032、0035 更新，单家上限由 0036 取消；不重启 G2 或沿用旧批次授权 |
| [0026 显式配置的自动刷新](0026-local-automatic-source-refresh.md) | 有效，调度目标已补充 | 获准范围普通刷新无需反复确认；历史每小时 3 家/24 小时分散不是永久目标，容量依 0028，稳定性依 0035 |
| [0027 Private Alpha 供给条件](0027-establish-private-alpha-supply-gate.md) | 部分替代 | 逐来源质量、明确启用与真实分母保留；100/1000 和人工占比由 [0035](0035-student-applicable-supply-admission.md) 降报告项，职能/城市降观察项，SME 结构门由 0032 替代 |
| [0028 容量型来源族](0028-capacity-first-private-alpha-supply.md) | 部分替代 | 来源族复用、预算/失败隔离和受控容量变更保留；旧配额/最低数值/结构门依 0032、0035、0036，来源接入按 0037/0043，不自动扩容 |
| [0029 官网与官方 ATS 唯一真源](0029-official-source-catalog-trust-boundary.md) | 有效，经后续补充 | 第一方事实真源不变；二手与搜索仅发现，入口缺失的本机预览/公开差异依 0035 |
| [0030 岗位中心 Career OS](0030-adopt-job-centric-career-os-and-interaction-first-integration.md) | 部分替代 | 连续工作区、Case 固定岗位与投递材料保留；旧 Case 优先与阶段顺序由 [0038](0038-resume-workspace-and-direct-import.md)、[0042](0042-opportunity-and-resume-system-upgrade.md) 更新，简历/经历/面试可独立开始 |
| [0031 长期职业资产](0031-long-lived-career-os-architecture-realignment-2026-08-06.md) | 部分替代 | 长期资产、私有 Case、正文/布局/审阅分离与历史固定保留；原件删除、供应商白名单/运营方回退及个人流程按 [0038](0038-resume-workspace-and-direct-import.md) |
| [0032 可达性与五项收录属性](0032-reachability-first-supply-admission.md) | 部分替代 | 五项属性与逐条判定保留；50% 聚合门由 [0035](0035-student-applicable-supply-admission.md) 撤销，学历/院校全局排除由 [0037](0037-product-core-and-controlled-automation.md) 撤销 |
| [0033 访问政策与最小正文](0033-access-policy-basis-and-minimal-body-scope.md) | 有效，政策状态处理补充 | robots/ToS、署名回链、异议即停与最小岗位原句保留；robots 缺失/受限/故障等分级依 [0037](0037-product-core-and-controlled-automation.md)，缺失不等于公开获准 |
| [0034 两层来源准入与发布对账](0034-two-layer-source-admission-and-reconciled-publication.md) | 有效，经后续补充 | 厂商/租户准入、公开指针与失格撤回保留；本机与公开可见差异依 0035，来源目录/试采依 0043，不因搜索命中自动公开 |
| [0035 在校生范围与观察稳定性](0035-student-applicable-supply-admission.md) | 部分替代 | unknown 保留、观察次数/跨度、实际试采、规模报告与本机/公开差异保留；30 条上限由 [0036](0036-remove-company-job-cap.md) 取消，硕博/院校全局排除由 [0037](0037-product-core-and-controlled-automation.md) 撤销 |
| [0036 取消单家公司上限](0036-remove-company-job-cap.md) | 有效 | 不按企业规模或岗位数量截断符合逐条条件的供给；不放宽来源准入与字段真实性 |

## 维护方式

新决定使用 [ADR 模板](../templates/adr.md)，明确替代的条款和仍保留的边界，并同步本索引。完整替代才标 superseded；部分替代不能把整条 ADR 作废。只整理已批准决定时不新造 ADR，也不借索引改变实现、数据或授权范围。
