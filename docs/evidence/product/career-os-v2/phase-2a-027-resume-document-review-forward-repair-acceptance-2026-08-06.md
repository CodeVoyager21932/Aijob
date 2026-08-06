# Phase 2A-027 Resume Document/Review Forward Repair 验收

- 日期：2026-08-06
- 分支：`codex/career-os-phase-1`
- 基线：`3042683 feat(database): support private requirement contexts`
- 迁移：`027_resume_document_review_forward_repair`
- 产品证据：仍为 `E0`
- 四选一决定：**继续**到 `Phase 2A-028 Interview/Debrief/Knowledge Expand`

## 1. 目标与范围

本切片只把 024F 原型中经过复核的长期 Resume、public/private Case 派生引用、strict Content/Layout、独立 Review 聚合和 owner 删除覆盖注册为 additive migration 027。没有注册业务 API，没有实现前端编辑器，没有读取真实 JD/简历，没有调用真实 AI、真实招聘来源、邮件或服务器。

明确排除 `.claude/`、`.data/`、密钥、令牌、本地数据库文件、下载产物和真实个人材料。

## 2. 实现证据

### Contracts

- 新写入只接受 `resume-content-v1` 结构化语义正文和 `resume-layout-v2` 严格布局；`resume-document-v1/v2`、`resume-layout-v1` 继续只读兼容。
- base Resume 不带岗位上下文；Case 派生 Resume 固定 base document/revision、evidence revision 和 public/private JobContext。
- 派生 Resume 只能处于 active Case 或显式 detached Case 二者之一；private JobContext 必须与 Resume owner 相同。
- Review Run/Finding/Suggestion/Decision 独立于正文；正文变更建议必须引用已确认证据，accepted/edited 必须引用新的 semantic content revision，rejected 不伪造正文修订。

### PostgreSQL

- `profile.resume_documents.expires_at` 改为可空；长期新资产不自动到期，历史 expiry 保留，原始上传、临时解析与导出期限没有放宽。
- 既有派生 Resume 从实际 Case 确定性回填 JobContext，不使用 public revision 1 等硬编码；Case 后续升级不改变已有 Resume/Review 固定的生成版本。
- 正式注册 `resume_review_runs/findings/suggestions/decisions` 四表、严格引用守卫、追加式 finding/decision 和 suggestion 当前决策投影。
- owner epoch 变化后，Resume/Review 迟到写入被拒绝；collector 无访问权限，match-worker 不能创建 Review Run 或用户 Decision。
- Case 删除只通过显式 `case_id -> detached_from_case_id` 保留所选资产；单项 Resume 删除在 Review 图未处理时由 FK 阻断，删除 Review 不会级联删除 Resume。
- owner 全量删除服务按 Decision → Suggestion → Finding → Run → Resume 顺序清除完整图；migration `down` 为非破坏性 no-op。

## 3. 自动化结果

| 检查 | 结果 |
|---|---|
| Resume contracts | 11/11，通过 |
| contracts 全包 | 45/45，通过 |
| migration 027/Phase 2A 隔离 PostgreSQL | 11/11，通过 |
| database 全包（隔离 PostgreSQL） | 49/49，通过 |
| owner 删除/retention 回归 | 2/2，通过 |
| 串行全仓测试 | config 17 + contracts 45 + database 49 + web 91 + platform 434 = 636/636，通过 |
| `pnpm lint` | 377 files，通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过；Web 主包 531.86 kB，仅有既有 chunk warning |
| `pnpm audit:ci` | 按仓库策略通过；1 high ignored / 1 moderate 已登记 advisory |
| `git diff --check` | 通过，仅有工作区换行提示 |

隔离 PostgreSQL 覆盖空库正式迁移链、026/026B/027 非破坏回退、public/private 派生 Resume、strict content/layout、Review 证据和决定、Case 选择性脱离、单项删除、角色权限、owner 全量删除与迟到写入。测试数据库使用唯一 `aijob_test*` 名称并在结束后删除。

第一次全仓运行中，既有 1000 岗容量测试在共享 PostgreSQL 并发压力下触发 30 秒超时；该套件单独重跑 2/2 通过，随后第二轮完整串行 `pnpm test` 以 636/636 和退出码 0 通过，未复现功能失败。

## 4. 人工与视觉检查

本切片没有前端交互或样式变化，不重复宣称新的浏览器价值证据；Phase 1B 的响应式结果仍是 UI 基线。Web 主包从上一证据的 531.59 kB 变为 531.86 kB，增量约 0.05%，未触发 10% 拆包门。

## 5. 风险与后续边界

- migration 027 只建立数据契约和权限边界，尚无 Resume/Review HTTP API；不能把数据库可写等同于用户闭环可用。
- suggestion 当前决策是追加式 decision 的投影；后续服务必须只创建 Decision，不得绕过投影直接把 suggestion 当第二业务真源更新。
- 单项 Resume 删除需要后续服务提供明确的 Review 处理选择；当前数据库只负责拒绝悬空引用。
- Interview、Debrief、Knowledge 尚未注册；产品证据仍为 `E0`，可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。

## 6. 决定

决定：**继续**。

唯一下一目标为 `Phase 2A-028 Interview/Debrief/Knowledge Expand`：只做 additive contracts/migration，固定 public/private JobContext、owner/epoch、长期生命周期、单项删除、Case 选择性脱离、迟到任务拒绝、角色权限、owner 全量删除和非破坏回退。仍不注册 HTTP API、不实现前端、不调用真实 AI、不访问真实招聘来源或真实材料。
