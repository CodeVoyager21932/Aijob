# Aijob 计划索引

本目录严格区分“当前执行计划”“后续验收 Gate”和“历史归档”。新任务只能从路线图、当前交接与当前执行计划共同指向的唯一切片开始。

## 当前执行

- [Career OS 前台体验收敛计划](career-os-current-delivery-plan.md)：当前唯一活动计划；coco 已批准整个用户前台高保真收敛，当前切片为 UX-0，产品代码尚未实施。
- [MVP 路线与当前决策面板](../06-mvp-roadmap.md)：当前阶段、真实分母、Gate 和下一决定的最高动态事实源。
- [当前项目交接](../handoffs/current.md)：当前分支、工程基线、当前切片、代码入口和安全边界。

## 后续验收 Gate

- [Private Alpha 与上线就绪 Gate](private-alpha-readiness-gates.md)：只回答进入真实参与者测试和推广上线前不能遗漏什么；不得从中生成当前 UX 任务。

## 历史归档

所有已完成、被取代或只用于解释既有实现的计划统一列在[历史计划归档](archive/README.md)。其中包括：

- M0–M4 与 PA-1 已完成交付计划
- M2/M3/M4 集成设计与差距审计
- Phase 2/2R/2A 契约与迁移设计
- R2 UI/UX 旧视觉方向
- G2 收束和旧 G4-first 严格总计划

归档正文中的“当前”“下一步”“授权”“时间盒”和历史分母只描述当时时点，不得覆盖现行路线。

旧路径 [career-os-v2-upgrade-plan-2026-08-04.md](career-os-v2-upgrade-plan-2026-08-04.md) 仅为兼容历史链接的废止路标。

## 事实源与冲突处理

1. 当前阶段、目标和下一决定：`docs/06-mvp-roadmap.md`。
2. 当前分支、工程基线和执行入口：`docs/handoffs/current.md`。
3. 当前切片、顺序和退出条件：`docs/plans/career-os-current-delivery-plan.md`。
4. 不可静默改变的架构与产品决定：ADR。
5. Private Alpha 完整条件：`private-alpha-readiness-gates.md`，只守门。
6. 历史设计、验收与归档：只作证据和上下文。

若活动文档与 Git、运行状态或彼此冲突，先记录并复核；不得静默选择，也不得回到历史计划继续执行。
