# OS-2 资料准备与可信岗位入口验收（2026-08-13）

> 分支：`codex/career-os-ux-convergence`
>
> 起始 HEAD：`f57d6cb feat(career-os): close os1 shell runtime contract`
>
> 决定：**完成 OS-2，进入 OS-3 准备；OS-3 尚未实施，等待 coco 指令。**

## 1. 验收范围与五项状态

OS-2 只收敛资料准备与可信岗位入口：岗位目录/详情、规范推荐、市场洞察、简历导入/确认、从岗位显式创建 Case，以及这些路径的 URL、session、响应契约和四视口行为。没有实施 OS-3 看板 read model、OS-4 Case 固定版本匹配、OS-5 Review v2、OS-6 或 OS-7。

| 状态项 | 结果 | 证据 |
|---|---|---|
| Contract | **通过** | 新增按搜索创建推荐、带固定岗位投影读取、当前资料空态及一次性资料确认的共享 runtime schemas；OS-2 触达响应均在 Web 边界解析 |
| Database/Platform | **通过** | 在现有 `catalog`、`matching`、`profile` 与 `insights` 模块内实现；推荐候选、岗位版本、Requirement Set、新鲜度和确认资料在 repeatable-read 内冻结；无 migration、无第二套 Run 或服务 |
| Web | **通过** | `/jobs*`、`/jobs/recommended*`、`/jobs/insights*`、`/resumes/import*` 成为 V2 规范路径；旧 V2 路径重定向，flag-off 旧 `ProductShell` 保持可用 |
| Integrated Gate | **通过** | 全新隔离 PostgreSQL、真实 Platform API、合成岗位/owner/资料/Case、真实 worker 与 1536/1280/768/320 浏览器 Gate 通过；网络仅 loopback |
| Evidence | **通过** | 本记录、路线图、当前交接、当前计划、稳定契约和追踪矩阵同步；只关闭 OS-2，不冒充后续切片、真实供给、用户价值或 Private Alpha |

## 2. Contract 与 Platform 结果

### 2.1 推荐规范适配器

在现有 RecommendationRun 资源下新增：

- `POST /v1/recommendation-runs/from-search`
- `GET /v1/recommendation-runs/:runId/view`

创建请求只接收与 `/v1/jobs` 同源的筛选 scope，不再由浏览器先拉取最多 1100 个岗位后提交候选 ID。服务端在同一 repeatable-read 事务中：

1. 使用目录同义筛选解析最多 1100 个候选；
2. 读取当前已确认的 facts、preferences 与 evidence；
3. 冻结候选岗位版本、Requirement Set 和 freshness snapshot；
4. 复用现有 RecommendationRun 与 worker，不创建第二种 Run；
5. 通过 view 一次返回 Run 固定版本的岗位显示投影，避免浏览器逐项 N+1。

同一幂等键会绑定 scope 与服务端实际派生的全部输入。候选或资料在事务内变化时返回稳定 `RECOMMENDATION_INPUT_CHANGED`；PostgreSQL `23505` 幂等竞争或 `40001` 序列化冲突最多重试 3 次，耗尽后显式失败。跨 owner 或非法 Run 统一 404。

### 2.2 资料与响应契约

- 新增 `ResumeAnalysisView`、当前 profile facts/preferences/evidence 的已确认态与 revision 0 空态 schemas。
- 简历导入、读取、当前资料、一次性确认、岗位搜索/详情、推荐与洞察响应均使用共享 runtime schema；畸形成功响应继续统一为脱敏 `INVALID_API_RESPONSE`。
- 显式 `/v1/session` 与受保护读取共享同一个 pending session promise，首次页面并发不会创建多个匿名 owner。
- session 恢复仍只自动重试读请求；推荐创建等 mutation 不自动重放。

### 2.3 数据库边界

OS-2 没有新增数据库、migration、Redis、队列、认证或依赖。PostgreSQL 继续是唯一查询和任务真源；推荐继续写入现有表，Insights 继续使用现有持久 Run，简历确认继续使用现有 profile revisions。OS-3 看板、OS-4 Case-pinned matching 与 OS-5 Review v2 的后续数据语义没有在本切片抢跑。

## 3. Web 与交互结果

V2 规范路由已经接入：

- `/jobs`：筛选写入 URL，刷新、深链、返回和前进恢复同一目录状态；真实空态、筛选空态、unknown 和 API 失败可区分。
- `/jobs/:jobId`：显示可信来源、最后核验、Requirements 和官方交接边界；从当前岗位显式创建同一 Case。
- `/jobs/recommended`、`/jobs/recommended/:runId`：使用当前确认资料创建推荐，固定 Run 可刷新与深链；stale/invalid 仍保留当时依据但不冒充当前可投。
- `/jobs/insights`、`/jobs/insights/:runId`：市场聚合与单 Case Requirements 保持分离；scope 写入 URL，持久 Run 可刷新与深链。
- `/resumes/import`、`/resumes/import/confirm/:analysisId`：自然承接文本/PDF/DOCX 导入与确认，不把简历原文写入 URL。
- V2 的 `/recommendations`、`/insights`、`/resume*` 重定向到规范路径；`VITE_CAREER_OS_V2=false` 继续使用旧 `ProductShell` 和旧岗位页。

岗位目录、详情、推荐、洞察与资料准备统一进入 Career OS 的工作台布局和响应式规则。重页面继续 route-level lazy load；岗位目录和详情首屏不会加载 Resume Editor 或 Interview。

浏览器 Gate 同步发现并关闭了三个当前阻塞：

1. 首次并发 session 请求可能创建多个匿名 owner，改为共享 pending promise，并增加并发回归测试。
2. 简历导入标题被旧样式高权重覆盖为负字距，提高 Career OS 作用域后实际 computed `letter-spacing: 0`。
3. 洞察空查询页持续 `replace` 相同 URL 导致表单循环卸载，改为只在 query string 真实变化时导航。

Windows 下浏览器 Gate 仅在执行 `.cmd/.bat` 时启用 shell，避免 Node `execFileSync` 无法直接启动 `pnpm.cmd`；这不改变产品运行时。

## 4. 真实隔离浏览器 Gate

浏览器 Gate 使用：

- 精确隔离库：`aijob_os2_test_20260813_f057`；
- loopback Platform `127.0.0.1:3000`、V2 Web `127.0.0.1:5173`、flag-off Web `127.0.0.1:5174`；
- 仅合成公共岗位、owner、资料、证据与 Case；
- 真实 Platform API 和现有本地 worker；
- 仓库外捆绑 Playwright 与本机 Chrome，没有联网安装依赖，没有生成截图。

通过项：

1. 创建合成 Case、一次性资料确认、推荐 worker 和市场洞察持久 Run。
2. 岗位筛选 URL、刷新、深链、返回/前进恢复。
3. 目录 API 503 失败提示与显式重试。
4. session 恢复后推荐 mutation 只发一次，不自动重放。
5. 跨 owner 推荐 Run 返回统一 404。
6. 1536、1280、768（200% 等效边界）和 320 均无页面级水平溢出。
7. 移动导航 Escape、可见焦点、焦点约束与关闭后返焦。
8. `VITE_CAREER_OS_V2=false` 的旧壳和岗位页可用。
9. 控制台无 warning/error；除刻意 503/404 外无异常响应；所有浏览器请求只到 loopback。
10. 岗位目录和详情首屏不加载 Resume Editor 或 Interview。

最终合成对象：Case `7935af8e-f5eb-4c68-afb8-85b91a6400f7`、Recommendation `274ae7a4-e4d2-475a-a4b4-f14f0f614f97`、Insight `e3bda77e-356e-4870-81ef-4399c37de89f`。

脚本：

- `apps/platform/scripts/isolated-test-server.ts`
- `apps/platform/scripts/isolated-owner-task-runner.ts`
- `apps/web/scripts/os2-browser-gate.cjs`

## 5. 最终工程 Gate

最终回归使用全新隔离库 `aijob_os2_verify_test_20260813_f057`：

| Gate | 结果 |
|---|---|
| Config | 20/20 |
| Contracts | 82/82 |
| Database | 54/54 |
| Platform | 462/462 |
| Web | 150/150 |
| 合计 | **768/768** |
| `pnpm lint` | 通过，466 files |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm audit:ci` | 退出码 0；1 个既有 high 由已提交审计基线忽略，本切片未新增依赖 |
| `git diff --check` | 通过 |

第一次 Platform 全量回归中，`public-version-pointer.integration.test.ts` 在 30 秒上限暂态超时，其余 461 项通过；同库单文件 9.35 秒通过。精确重建验证库后，完整第二轮为 462/462，该用例 684 ms。因此该现象保留为暂态反证，不隐藏，也没有据此放宽测试或修改业务语义。

Web production main chunk 为 394.47 kB（gzip 115.29 kB），低于 PA-1 的 566.69 kB 基线和 10 kB 增量守门；Resume Editor 29.38 kB、Interview 23.76 kB、数据设置 12.35 kB，继续独立 lazy load。

## 6. 清理、未完成项与决定

验收结束后已删除精确测试库 `aijob_os2_test_20260813_f057`、`aijob_os2_verify_test_20260813_f057` 和空临时目录 `aijob-os2-runtime-f057-20260813`，停止 Platform、V2 Web、flag-off Web 与 PostgreSQL，移除项目容器/网络，并确认 3000、5173、5174、5432 不再监听。

以下事实没有因 OS-2 改变：

- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- OS-3 看板/Peek、完整集合 read model 和 Case 阶段命令尚未实施。
- OS-4 Case 固定版本三轴匹配、OS-5 Resume Studio/Review v2、OS-6 与 OS-7 均未完成。
- 真实 AI、真实招聘来源、真实邮件、解析镜像、服务器、参与者和 Private Alpha 均未启动。
- 没有读取或修改真实简历、本地业务数据库、`.claude/`、`.data/`、密钥、令牌、下载产物或截图。

因此本轮决定是：**完成 OS-2，进入 OS-3 准备；不自动开始 OS-3，等待 coco 的下一条指令。**
