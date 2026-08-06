# Phase 2R 架构对齐报告

- 日期：2026-08-06
- 状态：contract review ready
- 产品基线：OS 2.0 初版，而不是最初 Aijob
- 当前决定：Phase 2R 契约审查就绪；进入 `Phase 2A-Forward-Contract`，未批准 025–027
- 上位决策：[ADR-0031](../../../decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md)
- 契约矩阵：[Phase 2R 契约与迁移影响矩阵](../../../plans/career-os-phase-2r-contract-and-migration-impact-matrix-2026-08-06.md)
- 前向修复设计：[Phase 2A 前向修复契约与隔离 PostgreSQL 测试设计](../../../plans/career-os-phase-2a-forward-contract-and-isolated-db-test-design-2026-08-06.md)

## 1. 目的

本报告把已经完成的 OS 2.0 工作台与长期 Career OS 产品目标对齐。它只记录架构和执行事实，不代表用户价值已经验证，不开放真实岗位、真实 AI、服务器或真实简历。

## 2. 当前 OS 2.0 基线

- `WorkspaceShell`、全局侧栏、顶部工具栏、主画布和右侧检查器已完成。
- `/today`、`/applications`、Case 概览、JD 能力、定制简历、投递、面试、复盘路由已具备静态入口。
- JD 三态、URL 状态、检查器焦点恢复、简历逐段接受/编辑后采用/拒绝和响应式 Gate 已完成。
- migration 023/024 已提交并有历史验收记录；它们不是本报告重新确认的最终长期契约。
- `/resumes`、`/interviews`、`/knowledge` 仍有占位；Case 投递、面试和复盘还未接入真实内部 API。

## 3. 发现的冲突

| 领域 | OS 2.0 初版/旧设计 | Phase 2R 修正 |
|---|---|---|
| 生命周期 | Career OS 结构化数据最长 30 天自动删除 | 职业资产默认长期保留，用户主动删除；原始文件/临时解析最长 24 小时 |
| 岗位上下文 | Case 仅绑定公共 `published_job_id` | `PublicJobReference | PrivateJobSnapshot`；私有 JD 只对 owner 可见 |
| 简历审查 | `suggestionDecision` 混在正文 block | Resume Content、Layout、Review Run/Finding/Suggestion/Decision 分离 |
| 契约形状 | `eventData`、layout `settings` 任意 JSON | 版本化 strict Schema，不允许正文或模型输入泄露 |
| 身份 | 匿名 owner 可长期规划不足 | 规划 `Account + EmailIdentity`，邮箱验证码优先，匿名 owner 本地兼容 |
| 业务真源 | 新旧页面存在重复写入语义 | `applications`/Case 工作台唯一写入真源；旧页面跳转或只读 |

## 4. 新决定

新决定已写入 ADR-0031，并同步到主计划、路线图、交接、README 和 Phase 2 设计文档。Case 删除时是否删除派生简历、面试和复盘由用户选择；私有 JD 不进入公共目录、推荐、供给分母或跨用户去重；BYOK 默认仅本次会话，长期保存需加密并由用户主动选择。

## 5. Phase 2R 范围

1. 完成长期资产删除矩阵和恢复不复活测试矩阵。
2. 完成公共/私有岗位联合类型、私有快照权限和版本差异契约。
3. 完成 Resume Review 独立聚合和 V1/V2 兼容边界。
4. 完成 Account + EmailIdentity 规划，不在本阶段切换认证。
5. 完成事件、布局和审查 Schema 的 strict 定义。
6. 完成旧路由兼容、唯一真源和迁移 023/024 前向修复评估。

上述范围已经细化为可审查的联合类型、删除矩阵、Review 状态机、strict Schema、旧路由矩阵和迁移影响矩阵；详见[契约与迁移影响矩阵](../../../plans/career-os-phase-2r-contract-and-migration-impact-matrix-2026-08-06.md)。Phase 2R 文档 Gate 已满足，前向修复契约和隔离数据库测试设计已形成；实施仍需通过独立的 023F/024F 证据 Gate。

## 6. 不做的事情

- 不创建 migrations 025–027。
- 不注册 HTTP API，不调用真实 AI，不访问真实招聘来源或真实简历。
- 不新增认证、数据库、队列、通用富文本编辑器、OCR、语音或自动投递。
- 不提交 `.claude/`、`.data/`、密钥、令牌、本地数据库、简历原文或下载产物。

## 7. 退出 Gate

必须具备：ADR、契约与迁移影响矩阵、删除矩阵、旧路由真源规则、strict Schema、测试矩阵和文档链接检查。以上材料和前向修复设计现已具备；下一步运行 023F/024F 隔离 PostgreSQL 测试并形成证据包，仍不创建 025–027。完成后只允许四种决定：

- 继续：批准 Phase 2A 的前向修复顺序；025–027 仍需新的 migration Gate；
- 修改：保留 OS 2.0 基线，补充缺失契约；
- 回退：撤回未落地的 Phase 2R 设计，不删除已有数据；
- 停止：暂停 Career OS 扩展并保留已验证的 OS 2.0 静态基线。

## 8. 当前证据结论

工程基线可追溯，产品证据仍为 `E0`。Phase 2R 已达到“契约审查就绪”，当前唯一目标是 **Phase 2A 前向修复契约与隔离 PostgreSQL 测试设计**，而不是 Interview/Debrief/Knowledge 的实现。
