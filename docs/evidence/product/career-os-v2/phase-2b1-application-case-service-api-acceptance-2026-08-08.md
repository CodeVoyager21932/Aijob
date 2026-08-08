# Phase 2B-1 ApplicationCase Service/API 验收

- 日期：2026-08-08
- 分支：`codex/career-os-phase-1`
- 实现前基线：`eee9856 chore(security): refresh frontend toolchain audit baseline`
- 产品证据：仍为 `E0`
- 四选一决定：**继续**到 `Phase 2B-2 Case Transition/Job Version`

## 1. 目标与范围

本切片只把 migrations 025-028 已注册的 ApplicationCase 领域接入既有 owner-protected 模块化单体：

- `GET /v1/application-cases?cursor&limit&stage`：同 owner 稳定游标列表。
- `POST /v1/application-cases`：public/private JobContext 幂等创建。
- `GET /v1/application-cases/:caseId`：同 owner 详情。

没有实现阶段流转、结果纠正、岗位版本差异/升级、requirement 写入、旧决定双写、前端接入、真实 AI、真实招聘来源、邮件或服务器。没有读取真实 JD、真实简历或本地业务数据库。

明确排除 `.claude/`、`.data/`、密钥、令牌、本地数据库文件、下载产物和真实个人材料；Biome 已同步排除 `.claude`，标准 lint 不再读取该目录。

## 2. 实现证据

### Contracts

- 新增 strict `ListApplicationCasesResponse`，固定 `items + nextCursor`，不泄漏游标内部结构。
- 新增 strict `CreateApplicationCaseResponse`，固定 `applicationCase + created`，不回传幂等键或请求 hash。
- public/private Case 继续复用既有 `ApplicationCaseWithJobContext`，没有建立第二套岗位、owner 或 Case 类型。

### 列表与详情

- 列表只读取当前 `owner_id + owner_epoch` 且未删除的 Case，按 `(updated_at DESC, id DESC)` 稳定分页。
- 游标是版本化 base64url envelope，包含筛选条件 hash；跨 `stage` 复用、篡改或非法游标统一返回 `400 INVALID_APPLICATION_CASE_CURSOR`。
- public Case 返回固定岗位版本、要求集和官方 HTTPS 投递地址；private Case 返回固定 snapshot/content/requirement revision 和 owner-only 展示信息。
- 详情不存在、已删除或跨 owner 统一返回 `404 APPLICATION_CASE_NOT_FOUND`，不能枚举对象归属。

### 创建与并发

- public 创建复用 `job_version_eligibility` 的 local MVP/Alpha 动态准入、当前版本和单公司配额语义；不可用或版本不匹配返回 `422 PUBLIC_JOB_CONTEXT_UNAVAILABLE`。
- private 创建只接受同 owner、同 epoch、未删除且指定 revision 存在的 snapshot；不存在与跨 owner 统一 `404 PRIVATE_JOB_CONTEXT_NOT_FOUND`。
- 同 owner 同 JobContext 只返回一个未结束 Case，不静默升级岗位版本。
- 创建事务先锁 owner-scoped 幂等键，再锁岗位上下文；Case 与首条 `case_created` event 原子提交。
- 同键同请求重放原创建结果；同键不同请求返回 `409 IDEMPOTENCY_KEY_REUSED`；不同键并发创建同一上下文只产生一个 Case 和一条创建事件。
- owner epoch 在写事务内再次校验；失效会话不能绕过身份边界。

### HTTP、安全与兼容

- 写入继续使用现有 Origin/CSRF hook，并要求 1-200 字符 `Idempotency-Key`。
- `/v1/application-cases` 已登记到 owner 响应前缀，成功和错误响应均为 `Cache-Control: no-store`。
- 路由复用既有 `requireOwnerContext`、Problem Details、`ServiceError` 和 PostgreSQL，不新增认证、缓存、数据库或幂等表。
- 旧 `/v1/job-decisions` 行为保持不变；本切片不把旧决定静默升级为新 Case 真源。
- 回归验收补齐同 owner 成功详情、跨 owner 空列表、无效 public/private 固定版本、stage 筛选、CSRF、会话失效和不可枚举 404。
- retention fixture 显式使用同一个测试时钟创建 Interview Session，修复数据库默认当前时间与固定完成时间倒置导致的测试约束冲突；没有改变生产保留逻辑。

## 3. 自动化结果

| 检查 | 结果 |
|---|---|
| ApplicationCase contracts | 14/14，通过 |
| ApplicationCase PostgreSQL/HTTP | 2/2，通过；覆盖 public/private、并发、幂等、owner、CSRF、游标和兼容 |
| database 全包（隔离 PostgreSQL） | 50/50，通过 |
| platform 全包（隔离 PostgreSQL） | 436/436，通过 |
| 串行全仓测试 | config 17 + contracts 54 + database 50 + platform 436 + web 91 = 648/648，通过 |
| `pnpm lint` | 382 files，通过；配置排除 `.claude/.data` |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过；Web 主包 536.51 kB，仅有既有 chunk warning |
| `pnpm audit:ci` | 退出码 0；1 high ignored，0 moderate |
| `git diff --check` | 通过，仅有工作区换行提示 |

### 测试环境异常收口

- Docker Desktop 重新启动后，Phase 2A 前向契约单文件 12/12 和 database 全包 50/50 均通过，先前一次 PostgreSQL `57P01` 未再复现，因此没有做猜测性 teardown 修改。
- 首次串行全仓运行时，曾被前序失败残留污染的 `aijob_test` 含 1000 个岗位和 2000 个版本；1000 候选冻结查询达到 120 秒上限后造成后续清理和用例级联超时。
- 只重建明确命名的隔离测试库 `aijob_test`，未触碰开发库、Alpha 库或本地业务数据；容量用例随后 2/2 通过，核心冻结用例约 20 秒。
- 干净库 platform 436/436 和最终串行全仓 648/648 均通过；没有放宽测试超时、删除断言或吞掉数据库错误。

### 依赖审计

- 验收期间新增 `postcss <=8.5.22` moderate；已通过 workspace override 升级到首个修复版本 `8.5.23`。
- 新增 `nanoid <3.3.17` high 只位于 Vite/PostCSS 开发链，仓库没有直接调用 `customAlphabet/customRandom`，也不进入生产业务依赖路径。
- npm 元数据已声明 `3.3.17`，但本机 pnpm 安装解析器仍返回该版本不可用；未强行覆盖到不兼容的 ESM 大版本。`GHSA-2v37-7h3g-55p8` 暂时登记为带注释的审计例外，pnpm 能稳定解析 `nanoid >=3.3.17` 后必须删除例外并重跑全部 Gate。

## 4. 人工与视觉检查

本切片没有前端交互或样式变化，不重复伪造浏览器价值证据。Phase 1B 的 1920/1280/768/320、200% 缩放、键盘和功能旗标结果继续作为 UI 基线；Web 主包未出现由本切片引入的增长。

## 5. 风险与后续边界

- Case 当前只能创建、列表和读取；还不能流转、纠正结果、查看岗位版本差异或显式升级。
- public Case DTO 当前只携带固定 ID、要求集和官方 URL；Phase 3 接前端前必须决定失效岗位的标题/公司展示是由 pinned version 摘要还是目录组合提供，不能依赖当前公开可见性永久存在。
- 旧决定仍是真实旧页面的独立状态；新 Case 成为唯一真源和无损兼容双写要等后续明确切片，不得提前宣称完成迁移。
- `nanoid` 审计例外是开发工具链临时债，不代表漏洞已修复；移除条件已写入依赖配置和本证据。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。

## 6. 决定

决定：**继续**。

唯一下一目标为 `Phase 2B-2 Case Transition/Job Version`：只实现追加式阶段/结果事件、`expectedRevision` 并发冲突、确定性岗位版本差异、用户显式升级，以及可无损表示的旧决定兼容。不实现 requirement 写入、Resume/Interview/Knowledge 服务、前端、真实 AI 或真实来源。
