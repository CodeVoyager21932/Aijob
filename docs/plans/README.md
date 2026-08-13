# Aijob 计划索引

本目录严格区分“当前执行计划”“后续验收 Gate”和“历史归档”。新任务只能从路线图、当前交接与当前执行计划共同指向的唯一切片开始。

## 当前执行

- [Career OS 前后端同步改进计划](career-os-current-delivery-plan.md)：当前唯一活动计划；UX-0 审计与 OS-1 系统外壳/运行契约均已关闭，下一切片是 OS-2 资料准备与可信岗位入口，尚未实施并等待 coco 指令。
- [Career OS 端到端体验与系统契约](../14-career-os-end-to-end-experience-contract.md)：OS-1–OS-7 必须遵守的系统归属、Contracts/Platform/DB/Web、路由、状态、视觉、响应式、焦点和夹具规则；不提供新的任务顺序。
- [UX-0 页面—系统—证据追踪矩阵](career-os-ux-0-end-to-end-traceability-matrix.md)：逐用例记录规范路由、Contracts、Platform/DB、权限/并发/删除语义、Web 状态、真实测试和 `R / A / E / M / X` 处置；未决行关闭前不得实现对应页面。
- [MVP 路线与当前决策面板](../06-mvp-roadmap.md)：当前阶段、真实分母、Gate 和下一决定的最高动态事实源。
- [当前项目交接](../handoffs/current.md)：当前分支、工程基线、当前切片、代码入口和安全边界。

## 后续验收 Gate

- [Private Alpha 与上线就绪 Gate](private-alpha-readiness-gates.md)：只回答进入真实参与者测试和推广上线前不能遗漏什么；不得从中生成当前任务。

## 历史归档

所有已完成、被取代或只用于解释既有实现的计划统一列在[历史计划归档](archive/README.md)。其中包括：

- M0–M4 与 PA-1 已完成交付计划
- M2/M3/M4 集成设计与差距审计
- Phase 2/2R/2A 契约与迁移设计
- R2 UI/UX 旧视觉方向
- G2 收束和旧 G4-first 严格总计划

归档正文中的“当前”“下一步”“授权”“时间盒”和历史分母只描述当时时点，不得覆盖现行路线。

旧路径 [career-os-v2-upgrade-plan-2026-08-04.md](career-os-v2-upgrade-plan-2026-08-04.md) 仅为兼容历史链接的废止路标。

### 旧切片名称映射

旧 `UX-1–UX-7` 已停止作为现行任务名。归档正文保留原名以维护历史证据，阅读时只按下表理解其现行归属，不得沿旧顺序继续：

| 历史名称 | 现行名称 |
|---|---|
| UX-1 | OS-1 系统外壳与运行契约 |
| UX-5 | OS-2 资料准备与可信岗位入口 |
| UX-2 | OS-3 申请看板与 Case 命令 |
| UX-3 | OS-4 单 Case 决策与固定版本匹配 |
| UX-4 | OS-5 Resume Studio 与唯一 Review 写入 |
| UX-6 | OS-6 投递、面试、复盘与数据控制 |
| UX-7 | OS-7 系统总 Gate |

`UX-0` 保留为已完成的端到端契约审计名称及后续实现基线。支持契约、追踪矩阵、证据、未来 Gate、兼容路标和归档都不是独立活动计划，也不得把已关闭审计重新生成成当前任务。

## 事实源与冲突处理

1. 当前阶段、目标和下一决定：`docs/06-mvp-roadmap.md`。
2. 当前分支、工程基线和执行入口：`docs/handoffs/current.md`。
3. 当前切片、顺序和退出条件：`docs/plans/career-os-current-delivery-plan.md`。
4. 不可静默改变的架构与产品决定：ADR。
5. Private Alpha 完整条件：`private-alpha-readiness-gates.md`，只守门。
6. 历史设计、验收与归档：只作证据和上下文。

若活动文档与 Git、运行状态或彼此冲突，先记录并复核；不得静默选择，也不得回到历史计划继续执行。
