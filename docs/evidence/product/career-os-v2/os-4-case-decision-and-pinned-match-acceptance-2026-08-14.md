# OS-4 单 Case 决策与固定版本匹配验收（2026-08-14）

> 分支：`codex/career-os-ux-convergence`
>
> 起始 HEAD：`ff1f769 feat(career-os): close os3 application board`
>
> 决定：**完成 OS-4，进入 OS-5 准备；OS-5 尚未实施，等待 coco 指令。**

## 1. 验收范围与五项状态

OS-4 只收敛单 Case 的固定岗位决策与三轴匹配：Case Header、Requirements/Evidence、问题、岗位版本状态、显式 diff/upgrade、服务端派生的 MatchRun 输入、Worker 固定上下文、owner/404、revision 409、幂等、session 恢复、四视口与回退。没有实施 OS-5 Review v2/受控 AI provenance/Resume Studio migration，也没有进入 OS-6–OS-7。

| 状态项 | 结果 | 证据 |
|---|---|---|
| Contract | **通过** | 新增 Case match state/create schema、八种状态、固定输入、陈旧原因与严格的 legacy / `case_pinned` task payload union；Web 对 match-state、job-version diff/upgrade 做 runtime parse |
| Database/Platform | **通过** | Platform 从同 owner、未删除 Case 派生固定 job/requirement 与当前资料 revisions；现有 MatchRun/任务表/三轴引擎继续作为唯一事实，Worker 计算前后重验；无 migration、无新服务 |
| Web | **通过** | Case Overview 显示三轴分离结果、当前/陈旧/私有/不完整/失败状态；岗位版本 diff 只经显式确认升级，409 后保留对话框并再次确认；Requirements URL 可恢复 |
| Integrated Gate | **通过** | 全新隔离 PostgreSQL、真实 Platform API/Worker、合成公共与私有 Case、1536/1280/768/320 浏览器 Gate 通过；网络仅 loopback |
| Evidence | **通过** | 本记录、路线图、当前交接、当前计划、计划索引、证据索引和追踪矩阵同步；只关闭 OS-4，不冒充真实供给、用户价值或 Private Alpha |

## 2. Contract、Platform 与 Worker 结果

### 2.1 Case-scoped 状态与创建

新增：

- `GET /v1/application-cases/:caseId/match-state`
- `POST /v1/application-cases/:caseId/match-runs`

POST 只接受 `{ expectedCaseRevision }` 和 `Idempotency-Key`。浏览器不能提交岗位版本、要求集或资料 revision ID；Platform 在 owner 事务内从 Case 和当前已确认资料派生：

- `publishedJobVersionId`
- `requirementSetId`
- `profileFactRevisionId`
- `preferenceRevisionId`
- `evidenceRevisionId`

幂等 request hash 同时包含 `caseId + expectedCaseRevision`、全部派生输入和缺失输入；同一个幂等键面对变化后的 Case 或资料返回 `IDEMPOTENCY_KEY_REUSED`，不会错误复用旧任务。

`CaseMatchState` 明确区分：

- `not_applicable_private`
- `profile_incomplete`
- `not_run`
- `queued`
- `processing`
- `current`
- `stale`
- `failed`

`catalogState=current/stale/closed/unavailable` 只描述目录现状；只要 run 仍绑定 Case 当前固定输入，它不会因为目录指针变化被误标为 run stale。run stale 原因只来自固定岗位版本/要求集或 fact/preference/evidence revisions 变化。私有 Case GET 返回 `not_applicable_private`，POST 返回 422 `CASE_MATCH_NOT_APPLICABLE_PRIVATE`。

### 2.2 固定旧版本与任务竞态

旧匹配入口继续使用严格 `{ runId }` 载荷和 current catalog 语义；Case 入口在同一任务类型中增加：

```ts
{
  runId,
  executionContext: {
    kind: "case_pinned",
    caseId,
    expectedCaseRevision,
    publishedJobVersionId,
    requirementSetId,
  },
}
```

Worker 在计算前和结果写回前分别重验：

- owner、owner epoch 与任务 lease；
- Case 仍存在、未删除且 revision 未变化；
- Case 仍固定到任务中的 job version 与 requirement set；
- 固定版本、要求集和条件投影仍可读取。

固定版本不要求继续是目录 current/public pointer，因此目录升级后旧 Case 仍能按原版本复现；Case 删除或显式升级后，旧任务失败并且不能写回。MatchRun 仍归 `matching`，结果不复制进 Case，也没有新增 Case 外键或第二套 Run。

固定错误覆盖 `APPLICATION_CASE_NOT_FOUND`、`APPLICATION_CASE_REVISION_CONFLICT`、`CASE_MATCH_PROFILE_INCOMPLETE`、`CASE_MATCH_INPUT_CHANGED`、`CASE_MATCH_CONTEXT_CHANGED`、`CASE_MATCH_CONTEXT_UNAVAILABLE` 与 `IDEMPOTENCY_KEY_REUSED`。

### 2.3 数据可表达性结论

现有 `application_cases` 固定上下文、`matching.match_runs`、`task_queue.tasks` 与 profile revisions 已能持久恢复 OS-4 结果。OS-4 没有新增表、字段、索引、migration、数据库、队列、服务或依赖。

浏览器删除 Gate 还复现了 Windows 与 PostgreSQL 时钟存在偏差时，快速创建后立即删除可能让 `deleted_at` 早于数据库 `created_at` 并返回 500。Case、Resume Document、Interview 与 Debrief 在未显式传入测试时间时改用事务内 PostgreSQL `clock_timestamp()`；显式测试时间参数和原删除语义不变。

## 3. Web 与交互结果

- Case Overview 只分别显示资格、经历证据与个人偏好，不产生总分、百分比或“匹配良好/中/差”。
- `profile_incomplete` 明确列出缺少的求职事实、岗位偏好或经历证据；私有 JD 保持逐项 Requirements 核对，不伪造公共目录 MatchRun。
- `queued/processing` 自动读取状态；`current` 只表示结果对应当前固定输入；`stale` 保留上次结果并列出具体修订原因；`failed` 保留固定输入并允许显式重试。
- 岗位版本条明确显示当前固定版本与目录状态。只有 `update_available` 才开放“查看变化”，对话框分别展示字段和 Requirements 的新增、移除、修改。
- 版本升级只在用户确认后发送 revision + 幂等命令；409 后强制刷新 Case/diff，保留对话框和变化内容，再次确认使用新的幂等键，不自动重放 mutation。
- Requirements 选中项写入 URL；长文本、刷新、深链、返回与前进保持同一上下文。
- 删除对话框的程序化初始焦点补上可见轮廓；版本对话框支持焦点约束、Escape 和关闭后返回触发按钮。
- Case 首屏不加载 Resume Editor 或 Interview；`VITE_CAREER_OS_V2=false` 继续使用旧 `ProductShell` 与旧岗位页。

## 4. 真实隔离浏览器 Gate

浏览器 Gate 使用：

- 精确隔离库：`aijob_os4_test_20260814_f057`；
- loopback Platform `127.0.0.1:3000`、V2 Web `127.0.0.1:5173`、flag-off Web `127.0.0.1:5174`；
- 仅合成公共岗位版本/要求、同 owner 公共与私有 Case、合成资料 revisions；
- 真实 Platform API、PostgreSQL、本地 Worker 和浏览器；没有访问真实招聘来源、AI、邮件或服务器，没有生成截图。

通过项：

1. 从岗位进入同一 Case/Requirements；match-state 刻意 503 后自动一次重试并可手动重读。
2. mutation 刻意 403 后 session 恢复但不重放，只有用户再次点击才产生第二次 POST。
3. 真实 Worker 使用固定版本完成三轴运行；刷新后恢复 current 结果。
4. 新资料 revision 使旧 run 变为 stale；显式重新核对后恢复 current。
5. 目录产生新岗位版本后，Case 保持旧固定版本；diff 对话框展示字段和长 Requirements 变化。
6. 版本升级 revision 409 后对话框与变化保留，再次确认成功；两次命令均有幂等键且键不同。
7. 升级后旧 run 变为 stale，重新核对绑定新固定版本；Requirements 深链、刷新、返回和前进恢复。
8. 私有 Case GET 为 not applicable、POST 422；非法、跨 owner 与删除后统一 404。
9. 1536、1280、768（200% 等效边界）和 320 均无页面级水平溢出；长文本正确换行。
10. 键盘、可见焦点、对话框焦点约束、Escape 与关闭后返焦通过。
11. 删除后 Case/match-state 不可读；flag-off 旧壳与岗位页可用。
12. Case 首屏未加载 Resume Editor/Interview；控制台无 warning/error；除刻意 503/403/409/422/404 外无异常响应；所有请求只到 loopback。

最终脚本结果包含 `passed: true` 与 `viewports: [1536, 1280, 768, 320]`。

脚本：

- `apps/platform/scripts/isolated-test-server.ts`
- `apps/web/scripts/os4-browser-gate.cjs`

## 5. 最终工程 Gate

最终完整回归使用全新隔离库 `aijob_os4_test_final_20260814_f057`，按 workspace 顺序一次完成：

| Gate | 结果 |
|---|---|
| Config | 20/20 |
| Contracts | 85/85 |
| Database | 54/54 |
| Platform | 465/465 |
| Web | 158/158 |
| 合计 | **782/782** |
| `pnpm lint` | 通过，474 files |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm audit:ci` | 离线缓存模式退出码 0；1 个既有 high 由已提交审计基线忽略，本切片未新增依赖 |
| `git diff --check` | 通过 |

Web production main chunk 为 397.80 kB（gzip 116.09 kB），低于 PA-1 的 566.69 kB 基线和 10 kB 增量守门；Case Workspace 24.05 kB、Requirements 13.61 kB、Resume Editor 29.38 kB、Interview 23.76 kB，重工作区继续独立 lazy load。

第一轮全仓测试没有被静默计为通过：既有 `local-owner-flow.integration.test.ts` 曾超时并与清理形成 deadlock；随后在同一已污染库单独复现时先领取了残留 `owner_deletion`。只读队列核验确认污染原因后，没有修改产品代码或测试掩盖该问题。全新库中的 Platform 465/465 与上述最终单次全仓 782/782 均通过，最终 Gate 以全新库绿色结果为准。

## 6. 清理、未完成项与决定

验收结束后只删除 OS-4 精确测试库和临时目录，停止 Platform、V2 Web、flag-off Web 与 PostgreSQL，并确认 3000、5173、5174、5432 不再监听。

以下事实没有因 OS-4 改变：

- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- OS-5 Resume Studio、Review v2、受控 AI provenance、requirement 引用和最小 expand migration 尚未实施。
- OS-6 与 OS-7 均未完成。
- 真实 AI、真实招聘来源、真实邮件、解析镜像、服务器、参与者和 Private Alpha 均未启动。
- 没有读取或修改真实简历、本地业务数据库、`.claude/`、`.data/`、密钥、令牌、下载产物或截图。

因此本轮决定是：**完成 OS-4，进入 OS-5 准备；不自动开始 OS-5，等待 coco 的下一条指令。**
