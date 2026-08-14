# OS-3 申请看板与 Case 命令验收（2026-08-14）

> 分支：`codex/career-os-ux-convergence`
>
> 起始 HEAD：`163e8fe feat(career-os): close os2 trusted job entry`
>
> 决定：**完成 OS-3，进入 OS-4 准备；OS-4 尚未实施，等待 coco 指令。**

## 1. 验收范围与五项状态

OS-3 只收敛申请集合与显式 Case 阶段命令：列表/看板完整集合语义、分页筛选排序、右侧 Peek、owner/404、revision 409、幂等、session 恢复、四视口和性能反证。没有实施 OS-4 的 Case 固定版本匹配、岗位版本 diff/upgrade 与 Requirements 完整决策，也没有进入 OS-5–OS-7。

| 状态项 | 结果 | 证据 |
|---|---|---|
| Contract | **通过** | Case list 增加 `stage / city / sort / cursor / total`，cursor 与查询绑定；新增固定五列 `ApplicationBoardResponse` 及 Web runtime parser |
| Database/Platform | **通过** | list 与 board 都在 repeatable-read 中读取；board 同一快照返回五列首批 items/total/cursor，单列续页复用 list；无 migration、无新服务 |
| Web | **通过** | 看板、列表和 Peek 使用服务端完整集合语义；显式阶段命令覆盖 revision、幂等、冲突保稿与再次确认；移动端单列、全屏 Peek |
| Integrated Gate | **通过** | 全新隔离 PostgreSQL、真实 Platform API、26 个合成 Case 与 1536/1280/768/320 浏览器 Gate 通过；网络仅 loopback |
| Evidence | **通过** | 本记录、路线图、当前交接、当前计划、证据索引和追踪矩阵同步；只关闭 OS-3，不冒充真实供给、用户价值或 Private Alpha |

## 2. Contract 与 Platform 结果

### 2.1 完整集合 read model

`GET /v1/application-cases` 现在支持：

- `stage`：可选单阶段；
- `city`：只精确匹配公共岗位中 `known` 的地点数组，unknown 与私有 JD 不匹配；
- `sort=updated|deadline`：更新时间倒序，或已知截止时间升序且 unknown 最后；
- `cursor`：v2 opaque cursor 同时绑定 `stage + city + sort`，跨查询复用返回 `INVALID_APPLICATION_CASE_CURSOR`；
- `total`：应用 cursor 前、应用阶段/城市后的完整集合数量。

列表的 count 与 page 在同一 repeatable-read 事务内读取。集成测试使用 105 个可见 Case 验证跨 100 条分页，并证明已删除 Case 与旧 owner epoch 不可见。

新增 `GET /v1/application-cases/board`，固定按五阶段顺序返回首批 `items`、逐列 `total` 和 `nextCursor`。五列在同一 repeatable-read 事务内生成；后续某列加载更多继续调用带 stage 的 list，不重取五列，也不产生卡片级 N+1。

非法 board 参数固定返回 `INVALID_APPLICATION_BOARD_QUERY`。Case 详情的非法 UUID、缺失、删除与跨 owner 统一为 404 `APPLICATION_CASE_NOT_FOUND`，不暴露记录是否存在。

### 2.2 阶段命令与数据边界

Web 复用现有 `POST /v1/application-cases/:caseId/transitions`，每次显式确认都携带 `expectedRevision` 和 `Idempotency-Key`。阶段图保持 Platform 既有规则；进入结果阶段必须显式选择 outcome，已结束 Case 只允许显式更正 outcome，不提供拖拽或自动阶段推断。

OS-3 没有新增数据库表、字段、索引或 migration。隔离合成负载的代表性 `EXPLAIN ANALYZE` 结果为：owner/stage/更新时间列表命中既有 `application_cases_owner_updated_idx`，约 `0.099 ms`；城市与截止排序约 `0.286 ms`。该证据未显示新增索引的必要性，因此没有为了视觉便利改数据库。

## 3. Web 与交互结果

- `/applications` 的 `view / stage / city / sort / peek` 全部写入 URL，刷新、深链、返回和前进恢复同一状态。
- 桌面看板显示五列及服务端总数；每列独立续页、失败提示和重试，不再对已加载子集做全局筛选、排序或计数。
- 列表模式使用相同服务端集合语义和稳定分页。
- 右侧 Peek 显示当前固定岗位摘要和显式阶段命令；1280/768 使用 dialog overlay，宽屏使用固定检查器，320 使用全屏 Peek。
- revision 409 后强制读取最新 Case，保留用户选择并要求再次确认；如果最新阶段使选择失效，提交保持禁用。
- session 恢复不会自动重放 mutation；用户选择仍保留，只能再次确认后产生新的显式请求。
- 非法、跨 owner 或已删除 Peek 保留原 URL 并显示统一 404，避免静默改写用户历史。
- 看板首屏不加载 Resume Editor 或 Interview；`VITE_CAREER_OS_V2=false` 继续使用旧 `ProductShell` 与旧岗位页。

## 4. 真实隔离浏览器 Gate

浏览器 Gate 使用：

- 精确隔离库：`aijob_os3_test_20260813_f057`；
- loopback Platform `127.0.0.1:3000`、V2 Web `127.0.0.1:5173`、flag-off Web `127.0.0.1:5174`；
- 1 个合成公共岗位、同一 owner 下 26 个合成 Case，初始阶段分布为 `22 / 1 / 1 / 1 / 1`；
- 真实 Platform API、PostgreSQL 和浏览器；没有联网安装依赖，没有生成截图。

通过项：

1. 看板首列 `20/22` 首批与单列续页，刻意 503 后显式重试成功。
2. 城市精确筛选、列表/看板切换、刷新、深链、返回和前进恢复。
3. 阶段命令 revision 409 后读取最新 revision、选择保留并再次确认成功。
4. session 恢复后 transition POST 只发一次，不自动重放。
5. 非法、跨 owner 与删除后 Peek 统一 404，原 `peek` URL 保留。
6. 1536、1280、768（200% 等效边界）和 320 均无页面级水平溢出；768 的看板溢出由看板自身承载。
7. 键盘打开、可见焦点、overlay Escape、焦点约束和关闭后返焦。
8. 看板首屏固定一次 board read model，没有卡片级详情请求，也未加载 Resume Editor/Interview。
9. `VITE_CAREER_OS_V2=false` 的旧壳与岗位页可用。
10. 控制台无 warning/error；除刻意 503/409/403/404 外无异常响应；所有浏览器请求只到 loopback。

最终合成对象：Case `05b939e5-e264-454f-8e46-1221bfb185e9`。

脚本：

- `apps/platform/scripts/isolated-test-server.ts`
- `apps/web/scripts/os3-browser-gate.cjs`

## 5. 最终工程 Gate

最终回归使用全新隔离库 `aijob_os3_verify_test_20260814_f057`：

| Gate | 结果 |
|---|---|
| Config | 20/20 |
| Contracts | 83/83 |
| Database | 54/54 |
| Platform | 463/463 |
| Web | 154/154 |
| 合计 | **774/774** |
| `pnpm lint` | 通过，468 files |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm audit:ci` | 退出码 0；1 个既有 high 由已提交审计基线忽略，本切片未新增依赖 |
| `git diff --check` | 通过 |

Web production main chunk 为 395.43 kB（gzip 115.57 kB），低于 PA-1 的 566.69 kB 基线和 10 kB 增量守门；Applications 为 16.35 kB，Resume Editor 29.38 kB、Interview 23.76 kB、数据设置 12.35 kB，重工作区继续独立 lazy load。

## 6. 清理、未完成项与决定

验收结束后只删除精确测试库 `aijob_os3_test_20260813_f057`、`aijob_os3_verify_test_20260814_f057` 和临时目录 `aijob-os3-runtime-f057-20260814`，停止 Platform、V2 Web、flag-off Web 与 PostgreSQL，并确认 3000、5173、5174、5432 不再监听。

以下事实没有因 OS-3 改变：

- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- OS-4 Case 固定岗位版本匹配、岗位版本 diff/upgrade 与 Requirements 完整决策尚未实施。
- OS-5 Resume Studio/Review v2、OS-6 与 OS-7 均未完成。
- 真实 AI、真实招聘来源、真实邮件、解析镜像、服务器、参与者和 Private Alpha 均未启动。
- 没有读取或修改真实简历、本地业务数据库、`.claude/`、`.data/`、密钥、令牌、下载产物或截图。

因此本轮决定是：**完成 OS-3，进入 OS-4 准备；不自动开始 OS-4，等待 coco 的下一条指令。**
