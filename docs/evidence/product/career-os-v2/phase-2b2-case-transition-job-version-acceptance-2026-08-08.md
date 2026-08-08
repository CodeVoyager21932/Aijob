# Phase 2B-2 Case Transition/Job Version 验收

- 日期：2026-08-08
- 分支：`codex/career-os-phase-1`
- 实现前基线：`6bcc601 feat(platform): add application case API`
- 产品证据：仍为 `E0`
- 四选一决定：**继续**到 `Phase 2B-3 Requirement Service/API`

## 1. 目标与范围

本切片只在 Phase 2B-1 的 owner-protected ApplicationCase 服务上完成：

- `POST /v1/application-cases/:caseId/transitions`：阶段流转和已结束结果纠正。
- `GET /v1/application-cases/:caseId/job-version-diff`：固定版本与当前准入版本的确定性差异。
- `POST /v1/application-cases/:caseId/job-version-upgrades`：用户显式升级固定岗位版本。
- 旧 `/v1/job-decisions` 对已有 Case 做可无损的事务内兼容。

没有实现 requirement 状态、证据链接或问题写入，没有接前端、Resume/Interview/Knowledge 服务、真实 AI、真实招聘来源、邮件或服务器。没有读取真实 JD、真实简历或本地业务数据库。

明确排除 `.claude/`、`.data/`、密钥、令牌、本地数据库文件、下载产物和真实个人材料。

## 2. 实现证据

### 状态机、修订与事件

- 状态机固定为 `interested -> preparing|resolved`、`preparing -> interested|applied|resolved`、`applied -> interviewing|resolved`、`interviewing -> applied|resolved`，`resolved` 不可重开。
- 25 个 from/to 组合由服务实际使用的同一判断函数穷举验证，不依赖测试内复制的分支逻辑。
- 进入 `resolved` 必须携带 outcome；非 `resolved` 不得携带 outcome。已结束 Case 只允许带大写原因码纠正 outcome，并追加 `outcome_corrected`。
- 每次有效写入锁定同 owner/epoch Case，校验 `expectedRevision`，只递增一次聚合 revision，并追加一条同序号不可变事件。
- 过期 revision 返回 `409 APPLICATION_CASE_REVISION_CONFLICT`；非法迁移、同阶段无变化和终态重开返回 `409 INVALID_CASE_TRANSITION`。
- transition 和 upgrade 使用 owner-scoped advisory lock；同幂等键同请求稳定重放原事件，同键不同请求返回 `409 IDEMPOTENCY_KEY_REUSED`。

### 岗位版本差异与升级

- public Case 比较固定 `published_job_version`/requirement set 与同一稳定岗位当前准入版本；private Case 返回 `409 JOB_VERSION_UPGRADE_NOT_APPLICABLE`。
- 字段差异对 known/unknown 包装做语义规范化，忽略 `evidenceRefs` 等来源定位噪声；requirement 差异先识别语义不变，再以 `kind + sourceText` 配对 changed，稳定输出 added/removed/changed。
- 无当前准入目标返回 `target_unavailable`；固定版本就是当前版本返回 `up_to_date`；只有不同且可用的当前版本返回 `update_available`。
- 显式升级只接受同一稳定岗位当前 local MVP/Alpha 准入版本；跨岗位、旧版本或不可用版本返回 `422 PUBLIC_JOB_CONTEXT_UNAVAILABLE`。
- 升级只更新 Case 固定版本与要求集并追加 `job_version_upgraded`，不级联改写既有 Resume、Interview、Debrief 或历史事件。

### 旧决定兼容与 HTTP 安全

- 只处理 `saved -> interested`、`preparing_to_apply -> preparing`、`applied -> applied`、`abandoned -> resolved/withdrawn`；`undecided` 不创建 Case。
- 旧接口只同步已经存在且可无损表示的 Case，不自动创建新 Case，不把 `interviewing` 或其他新结果压扁到旧五态。
- 无法表示时返回 `409 CAREER_OS_STATE_NOT_REPRESENTABLE`，旧决定写入和 Case 写入在同一事务回滚。
- 打开官方链接仍不改变 Case 阶段，也不自动记录已投递。
- 三个新接口复用 owner session、Origin/CSRF、Problem Details、全局 `no-store` 和 PostgreSQL；跨 owner、删除和不存在继续统一不可枚举 404。
- 没有新增迁移、幂等表、认证、缓存、队列、数据库或 AI SDK。

## 3. 自动化结果

| 检查 | 结果 |
|---|---|
| ApplicationCase contracts | 15/15，通过 |
| 状态矩阵单测 | 2/2，通过；穷举 25 个阶段组合并证明 `resolved` 终态 |
| ApplicationCase PostgreSQL/HTTP | 2/2，通过；覆盖 public/private、状态、结果、并发、幂等、版本、旧决定、owner、CSRF 与会话 |
| database 全包（隔离 PostgreSQL） | 50/50，通过 |
| platform 全包（隔离 PostgreSQL） | 438/438，通过 |
| 串行全仓测试 | config 17 + contracts 55 + database 50 + platform 438 + web 91 = 651/651，通过 |
| `pnpm lint` | 383 files，通过；配置排除 `.claude/.data` |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过；Web 主包 538.57 kB，仅有既有 chunk warning |
| `pnpm audit:ci` | 退出码 0；1 high ignored |
| `git diff --check` | 通过，仅有工作区换行提示 |

### 测试环境异常收口

- 第一轮 platform 全包中，既有 `resume plaintext minimization` 用例在本机负载下触发 15 秒超时；本切片未修改该模块。
- 同一隔离库单独复跑该文件 2/2 通过，核心用例约 5.9 秒；随后换用全新隔离库 `aijob_test_phase2b2_gate_975c_20260808` 执行完整 `pnpm test`，651/651 和退出码 0 均通过。
- 没有放宽测试超时、删除断言或吞掉数据库错误；开发库、Alpha 库和本地业务数据均未读取或修改。

### 依赖审计

- 审计继续保留 Phase 2B-1 已登记的 1 个 Vite/PostCSS 开发链 `nanoid` high ignored。
- 本切片没有新增或升级依赖；该例外不进入生产业务路径，也不代表漏洞已修复，移除条件继续以 Phase 2B-1 验收和依赖配置注释为准。

## 4. 人工与视觉检查

本切片没有前端交互、样式或路由变化，不重复伪造浏览器价值证据。Phase 1B 的 1920/1280/768/320、200% 缩放、键盘和功能旗标结果继续作为 UI 基线；构建仅保留既有 chunk warning。

## 5. 风险与后续边界

- requirement 三态、证据链接和未知问题仍只有数据库/contract 基础，尚未形成 owner-protected 服务。
- 当前 `ApplicationCaseRequirementsSchema` 顶层只表达公共 `requirementSetId: UUID`，与 migration 026B 的公共/私有对等上下文不一致；Phase 2B-3 必须先修正为联合 requirement context，不能让 private Case 伪装公共要求集。
- `expectedRevision` 在 Case 子资源写入中必须继续表示 ApplicationCase 聚合 revision；子表 revision 只是最后修改它的 Case revision，不能建立第二套并发序列。
- 旧决定只兼容已有 Case；它不会成为 Case 创建入口，也不能表示 `interviewing`、offer/rejected/expired 等新状态。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。

## 6. 决定

决定：**继续**。

唯一下一目标为 `Phase 2B-3 Requirement Service/API`：只实现固定公共/私有要求上下文读取、Case 聚合 revision 保护的三态更新、同 owner 已确认证据的原子链接，以及未知问题创建/更新。不实现前端、Resume/Interview/Knowledge 服务、真实 AI、真实来源、邮件或服务器。
