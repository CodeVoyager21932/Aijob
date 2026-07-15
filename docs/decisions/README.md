# 架构决策记录

本目录记录跨模块、涉及信任边界或难以逆转的决定。ADR 只说明为什么这样选、承担什么代价以及何时复查，不替代实现和验证。

当前决策：

- [ADR-0001：核心领域能力由项目自行实现](0001-own-core-domain.md)
- [ADR-0002：只接入白名单中的官方公开来源](0002-allowlisted-official-sources.md)
- [ADR-0003：采用规则优先、证据驱动的可解释匹配](0003-rule-first-explainable-matching.md)
- [ADR-0004：自动化前先进行人工礼宾验证](0004-concierge-before-automation.md)

新决定从 [ADR 模板](../templates/adr.md) 复制创建。已有决定变化时新增一条 ADR，并将旧记录标记为 `superseded`，不要静默改写历史理由。
