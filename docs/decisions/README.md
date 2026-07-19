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

新决定从 [ADR 模板](../templates/adr.md) 复制创建。已有决定变化时新增一条 ADR，并将旧记录标记为 `superseded`，不要静默改写历史理由。
