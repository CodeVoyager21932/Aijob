# 架构决策记录

本目录记录跨模块、涉及信任边界或难以逆转的决定。ADR 只说明为什么这样选、承担什么代价以及何时复查，不替代实现和验证。

当前决策：

- [ADR-0001：核心领域能力由项目自行实现](0001-own-core-domain.md)
- [ADR-0002：只接入白名单中的官方公开来源](0002-allowlisted-official-sources.md)
- [ADR-0003：采用规则优先、证据驱动的可解释匹配](0003-rule-first-explainable-matching.md)
- [ADR-0004：自动化前先进行人工礼宾验证（已被取代）](0004-concierge-before-automation.md)
- [ADR-0005：采用匿名邀请会话、owner 所有权和最小保留](0005-invitation-session-ownership-retention.md)
- [ADR-0006：采用模块化单体、三个进程、PostgreSQL 真源与岗位快照 Bucket（文件上传边界已修订）](0006-modular-monolith-runtime-boundaries.md)
- [ADR-0007：使用 PostgreSQL 任务表、至少一次执行和幂等消费](0007-postgres-task-idempotency.md)
- [ADR-0008：使用不可变版本、三轴结果和用户决策契约](0008-immutable-match-versioning.md)
- [ADR-0009：模板优先，AI 默认关闭并延后供应商决定（本地 MVP 边界已修订）](0009-template-first-ai-feature-gate.md)
- [ADR-0010：采用精确采集网络策略并延后 Playwright](0010-ingestion-network-policy.md)
- [ADR-0011：先构建本地 MVP，再进行参与者验证](0011-mvp-before-participant-validation.md)
- [ADR-0012：允许本地 MVP 隔离处理 PDF/DOCX 简历](0012-isolated-resume-document-ingestion.md)
- [ADR-0013：本地 MVP 实现确定性推荐与受控 AI 简历优化](0013-local-ai-recommendation-and-resume-tailoring.md)
- [ADR-0014：本地 MVP 使用可替换的后端 AI 配置来源](0014-local-backend-ai-config-source.md)
- [ADR-0015：先在本机扩展全部职能实习，再决定是否上云（已被取代）](0015-local-all-function-internship-expansion.md)
- [ADR-0016：允许本机人工浏览器辅助导入受控官方实习岗位](0016-manual-browser-assisted-source-import.md)
- [ADR-0017：本机扩展中小企业岗位并限定公众号与企业邮箱边界](0017-local-sme-expansion-and-official-account-boundary.md)
- [ADR-0018：使用冻结样本生成确定性 JD 市场洞察](0018-deterministic-job-market-insights.md)
- [ADR-0019：建立约 1000 家企业的实习来源审查宇宙](0019-thousand-company-internship-discovery-universe.md)
- [ADR-0020：优先覆盖产品运营与电子信息技术实习](0020-prioritize-product-operations-and-electronic-information-internships.md)
- [ADR-0021：压缩无中小规模证据企业的单家配额并公开中小岗位占比缺口](0021-compress-large-company-quota-and-publish-sme-gap.md)
- [ADR-0022：以获批计划批量预授权来源批次并委托抽检](0022-plan-batch-preauthorization-and-delegated-spot-checks.md)
- [ADR-0023：强化运行时与数据库角色边界](0023-enforce-runtime-and-database-role-boundaries.md)
- [ADR-0025：扩大 G2 企业上限并延续 SME 批次预授权（目标已被部分替代）](0025-extend-g2-sme-company-cap-and-batch-authorization.md)
- [ADR-0026：允许显式配置的本机来源自动刷新](0026-local-automatic-source-refresh.md)
- [ADR-0027：建立 Private Alpha 100 家企业 / 1000 条岗位供给门槛](0027-establish-private-alpha-supply-gate.md)
- [ADR-0028：以容量型来源族推进 Private Alpha 供给](0028-capacity-first-private-alpha-supply.md)
- [ADR-0029：企业官网与官方 ATS 构成岗位目录唯一真源](0029-official-source-catalog-trust-boundary.md)

尚未接受的提案：

- [ADR-0024：统一来源适配器描述符与运行模式](0024-unify-source-adapter-descriptors-and-run-modes.md)

新决定从 [ADR 模板](../templates/adr.md) 复制创建。已有决定变化时新增一条 ADR，并将旧记录标记为 `superseded`，不要静默改写历史理由。
