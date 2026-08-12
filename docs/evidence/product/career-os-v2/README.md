# Career OS 2.0 概念图解释契约

> 状态：accepted interpretation
>
> 日期：2026-08-05
>
> 上位事实源：[ADR-0030](../../../decisions/0030-adopt-job-centric-career-os-and-interaction-first-integration.md)、[当前交付计划](../../../plans/career-os-current-delivery-plan.md)

> 当前状态：M1–M4 与 PA-1 已完成并归档；coco 已批准整个用户前台进行高保真体验收敛，当前唯一切片为 `UX-0 视觉契约与基线`。本目录各历史验收中的“继续”“下一唯一切片”和等待决定只记录当时时点，不得生成当前任务。

已完成工程路线的证据依次见 [M1 真实 Case 工作台](m1-real-case-workspace-acceptance-2026-08-09.md)、[M2 专业简历闭环](m2-professional-resume-acceptance-2026-08-11.md)、[M3 总验收](m3-workflow-acceptance-2026-08-12.md)、[M4 工程与浏览器总验收](m4-engineering-browser-gate-acceptance-2026-08-12.md)和 [PA-1 离线候选](pa-1-offline-identity-parser-candidate-acceptance-2026-08-12.md)。这些证据保留历史工程事实，但不覆盖[动态路线](../../../06-mvp-roadmap.md)、[当前交付计划](../../../plans/career-os-current-delivery-plan.md)或[当前交接](../../../handoffs/current.md)。

长期架构修正以 [ADR-0031](../../../decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md) 和 [Phase 2R 对齐报告](phase-2r-architecture-realignment-2026-08-06.md) 为准；本目录的概念图仍只约束布局、信息层级和交互关系，不覆盖长期生命周期、私有 JD 或 Resume Review 数据契约。

Phase 2A 前向修复的代码证据见 [Forward Contract 与隔离原型验收](phase-2a-forward-contract-acceptance-2026-08-06.md)。该记录证明 37 项 contract tests、023F/024F 隔离 PostgreSQL 7/7 和串行全仓 617 项测试通过；原型尚未注册为正式 migration，并因匿名 owner 的 30 天全量删除依赖作出“修改”决定。

身份前置的后续证据见 [Identity Forward Contract 验收](phase-2a-identity-forward-contract-acceptance-2026-08-06.md)。长期 owner、Account、EmailIdentity 和验证码 challenge contracts/隔离原型分别 5/5 通过；决定继续正式 migration 025，但尚未发送真实邮件或注册身份 API。

正式身份前置见 [Phase 2A-025 Identity Account/Email Expand 验收](phase-2a-025-identity-account-email-expand-acceptance-2026-08-06.md)。migration 025、owner active predicate、anonymous-only retention、运行角色与身份删除兼容已通过 6 项迁移测试和串行全仓 629 项测试；该记录当时决定进入 ApplicationCase Long-Lived Forward Repair。

ApplicationCase 前向修复见 [Phase 2A-026 验收](phase-2a-026-application-case-long-lived-forward-repair-acceptance-2026-08-06.md)。migration 026、公共/私有 Case、长期生命周期、strict event 和 ApplicationCase 删除已通过 9 项迁移测试及串行全仓 631 项测试；复核发现私有要求上下文仍只接受公共 requirement set，决定“修改”，下一唯一切片为 026B。

本目录的三张 PNG 只用于表达布局、信息层级和交互关系，不是字段、状态、品牌命名或业务规则的事实源。图片中的示例公司、岗位、日期、链接、用户身份、数据和建议文案都是静态演示，不得进入业务夹具、用户事实或产品证据。

## 统一采用项

- 一套全局侧栏、顶部工具栏、主画布和可收起右侧检查器。
- 单岗位共享 `CaseHeader`，局部标签固定为`概览 / JD能力 / 定制简历 / 投递 / 面试 / 复盘`。
- 看板、列表、工作区和检查器共享同一 Aijob 品牌、路由、视觉 token 与焦点规则。
- 右侧检查器展示当前选中的 Case、要求、证据或建议，不作为悬浮 AI 聊天机器人。
- 所有岗位事实引用固定岗位版本及官方原文；推导内容必须与岗位事实分开。

## 明确拒绝与术语映射

| 图片内容 | 处理决定 |
|---|---|
| 概念 01 的“匹配良好 / 匹配中 / 有差距” | 拒绝，不实现匹配等级、百分比或自动劝退；侧览改为分别展示资格、经历证据与偏好，三者不得合并成总评。 |
| 概念 03 的“已验证” | 统一映射为`已有证据`。 |
| 任何“证据不足”“待完善”等近义文案 | 只有用户已确认存在缺口时才使用`证据待补充`；尚未确认时必须使用`用户尚未确认`。 |
| 概念 03 左上角独立“AI 简历工作台”品牌 | 拒绝；定制简历必须运行在统一 Aijob `WorkspaceShell` 内，不建立第二套产品壳层或主导航。 |
| 图片中的 AI 建议 | 仅表达“建议—确认”交互；建议不得自动写入，用户只能接受、编辑后采用或拒绝。 |
| 打开官方页面、点击投递按钮 | 只代表外链交接，不得自动推断为已投递。 |

合法证据状态只有：

1. `已有证据`
2. `证据待补充`
3. `用户尚未确认`

## 分图采用边界

### 概念 01：我的求职看板与岗位侧览

- 采用：唯一侧栏、列表/看板切换、阶段列、岗位侧览、下一步任务和官方来源说明。
- 拒绝：匹配等级、把侧览状态当成岗位事实、从界面操作自动推断投递结果。
- Phase 1A 以该图为主要视觉参考。

### 概念 02：单岗位 JD 能力工作区

- 采用：CaseHeader、固定岗位版本提示、六个标签、要求分组、选中要求与证据检查器。
- 约束：硬条件、职责能力和未知待确认分开；每项要求必须保留官方原文引用。
- Phase 1B 已实现完整静态工作区；后续 Phase 2/3 才接入持久化 Case、要求状态和岗位版本升级。

### 概念 03：岗位定制简历工作室

- 采用：简历结构区、A4 主预览、当前区块检查器、逐段接受/编辑/拒绝。
- 拒绝：独立简历产品品牌、自动接受、完整编辑器提前接入、未经确认的事实或数字进入建议稿。
- Phase 1B 已实现完整静态工作区；真实 Resume V2、DOCX 行为和 AI 接口仍属于后续阶段。

发生歧义时，优先级固定为：动态路线与当前交接 → 当前交付计划 → ADR-0030/0031 → 本解释契约 → PNG 视觉内容。归档升级计划不得提供当前任务。
