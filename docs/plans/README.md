# Aijob 计划索引

本目录把“当前执行路线”“未来验收门”和“历史设计记录”分开。任何新任务都不得从历史计划、归档文件或旧验收记录中选择下一项工作。

## 当前唯一活动计划

- [Career OS 当前交付计划](career-os-current-delivery-plan.md)：定义当前产品里程碑、顺序、时间盒和退出条件。
- [MVP 路线与当前决策面板](../06-mvp-roadmap.md)：记录当前唯一目标、真实分母、Gate 状态和下一决定；它是动态进度的最高事实源。
- [当前项目交接](../handoffs/current.md)：记录当前分支、工程基线、未提交状态、代码入口和本轮执行清单。

## 后续验收门

- [Private Alpha 与上线就绪 Gate](private-alpha-readiness-gates.md)：只回答进入真实参与者测试和推广上线前不能遗漏什么，不提供当前任务顺序。

## 已完成的设计记录

- [M3 投递、文字面试与复盘集成边界](career-os-m3-application-interview-integration-boundary-2026-08-11.md)
- [M2 专业简历闭环复用与集成边界](career-os-m2-resume-integration-boundary-2026-08-09.md)
- [Phase 2 领域契约与迁移设计](career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md)
- [Phase 2R 契约与迁移影响矩阵](career-os-phase-2r-contract-and-migration-impact-matrix-2026-08-06.md)
- [Phase 2A 前向修复与隔离测试设计](career-os-phase-2a-forward-contract-and-isolated-db-test-design-2026-08-06.md)
- [R2 UI/UX 视觉参考与设计方向](r2-ui-ux-reference-direction-2026-07-29.md)

这些文件用于解释既有代码和决策，不能覆盖当前路线图或交接。

## 历史与废止计划

- [已废止的 Career OS 2.0 → Private Alpha 严格开发总计划](archive/career-os-v2-upgrade-plan-2026-08-04.md)
- [历史 G2 收束执行计划](g2-closeout-plan-2026-07-26.md)

旧路径 [career-os-v2-upgrade-plan-2026-08-04.md](career-os-v2-upgrade-plan-2026-08-04.md) 仅为兼容历史链接的废止路标。

## 事实源与冲突处理

1. 当前阶段、目标和下一决定：`docs/06-mvp-roadmap.md`。
2. 当前分支、工作树和执行入口：`docs/handoffs/current.md`。
3. 不可静默改变的架构决定：ADR。
4. 里程碑定义与时间盒：当前交付计划。
5. 历史设计、验收与归档：只作证据和上下文。

若活动文档与历史文件冲突，必须更新或标记活动文档中的冲突；不得回退到历史计划继续执行。
