# OS-1 系统外壳与运行契约验收（2026-08-13）

> 分支：`codex/career-os-ux-convergence`
>
> 起始 HEAD：`8d6a8bb docs(ux): close ux0 system baseline`
>
> 决定：**完成 OS-1，进入 OS-2 准备；OS-2 尚未实施，等待 coco 指令。**

## 1. 验收范围与五项状态

OS-1 只收敛系统外壳与运行契约，没有扩建岗位、匹配、Review、AI、邮件、来源或服务器能力。

| 状态项 | 结果 | 证据 |
|---|---|---|
| Contract | **通过** | `apiRequest` 支持运行时 response schema；畸形 JSON/schema 统一为不泄露 payload 的 `502 INVALID_API_RESPONSE`；session boundary 继续保证 mutation 不自动重放 |
| Database/Platform | **通过** | 无 migration、无表结构变化；真实并发读取发现并修复 Requirements repeatable-read 的 `40001` 暂态冲突，仅对读事务做最多 3 次有界重试，耗尽后返回稳定 503 |
| Web | **通过** | V2 访问 Gate、404、loading、route error 都保留在唯一 `WorkspaceShell`；Utility Bar 使用真实 session；Peek、移动导航、命令菜单、Requirement inspector、私有 JD 与删除确认统一使用可访问 overlay/focus 契约 |
| Integrated Gate | **通过** | 全新隔离 PostgreSQL、真实 Platform API、合成岗位/owner/Case 与 1536/1280/768/320 四视口浏览器 Gate 通过；flag-off 旧 `ProductShell` 通过 |
| Evidence | **通过** | 本记录、路线图、当前交接、当前计划与索引已同步；决定只关闭 OS-1，不冒充 OS-2–OS-7 或产品价值已验证 |

## 2. Contract 与 Web 结果

### 2.1 运行时响应契约

- `apps/web/src/api/client.ts` 新增通用 `responseSchema` 边界，触达的 session、邮箱 challenge、owner claim 与 Case 读取使用共享 schema 解析成功响应。
- 无效 JSON 或 schema 不匹配统一变为 `502 / INVALID_API_RESPONSE / 服务返回了无法验证的数据，请刷新后重试。`；响应正文、简历内容和 schema diagnostics 不进入用户消息或控制台。
- 登录和 owner claim 成功后只发出一次 session boundary 通知；读请求仍只允许一次恢复，mutation 仍不自动重放。
- 本切片只关闭已经触达的核心端点；OS-2–OS-6 每次触达的其余核心 adapter 仍必须同步接入 parser，OS-7 再扫描余量。

### 2.2 唯一 Shell、路由与身份状态

- `VITE_CAREER_OS_V2=true` 时，访问 Gate 进入 `WorkspaceShell` 主画布，不再套第二个 `ProductShell`。
- V2 未知路径显示 Shell 内 404；lazy loading 与未捕获 route render error 也保留全局导航、当前 URL 和安全返回入口。
- 顶部账号状态来自真实 `/v1/session`，覆盖 loading、错误、匿名与账号管理，不再显示静态伪状态或无事实来源的通知红点。
- `VITE_CAREER_OS_V2=false` 继续保留旧 `ProductShell` 与旧岗位页，未移除回退旗标。

### 2.3 统一 overlay 与焦点

- 新增一个 portal-based `ModalSurface`，统一 `role=dialog`、`aria-modal`、背景 inert、滚动锁、焦点约束、Escape、遮罩关闭、嵌套计数和关闭后返焦。
- 1280/1536 的 Peek 与 Requirement inspector 保持 inline；768/320 转为 modal surface，避免把窄画布继续压缩或裁剪。
- 移动全局导航、命令菜单、私有 JD、Peek、Requirement inspector、Case/Resume 删除确认全部复用同一机制。
- 建立 Career OS 的基础字体、颜色、字号、间距、圆角、阴影、层级、侧栏、工具栏和 inspector token；焦点环改为高对比实色。OS-3 看板密度和 OS-5 Resume Studio 三栏仍由各自切片负责，OS-1 没有越界宣称整体视觉已经完成。

## 3. 同步发现并关闭的 Platform 阻塞

四视口真实 API Gate 在同时读取 Case 与 Requirements 时复现 PostgreSQL `40001 could not serialize access due to concurrent update`，原实现把它暴露为 HTTP 500。这证明本切片不能只改前端。

修复保持现有模块化单体与 PostgreSQL 事实源：

- 只在 `getApplicationCaseRequirements` 的 repeatable-read **读取事务**内处理 PostgreSQL `40001`。
- 最多 3 次，退避 5/10 ms；其他错误原样抛出，不吞掉 owner 404 或数据错误。
- 三次耗尽后返回 `503 CONSISTENT_READ_RETRY_EXHAUSTED`，允许读取方显式重试。
- mutation 没有加入重试，因此不会重复提交用户操作。
- Platform 集成测试对同一真实 Case 发起 12 个并发 Requirements GET，全部必须返回 200。

没有新增数据库、migration、Redis、队列、认证或服务。

## 4. 四视口真实浏览器 Gate

浏览器 Gate 使用：

- 精确隔离库：`aijob_os1_test_20260813_f057`；
- loopback Platform `127.0.0.1:3000`；V2 Web `127.0.0.1:5173`；flag-off Web `127.0.0.1:5174`；
- 现有 M4 合成 seed，经真实 Platform API 创建公共岗位、匿名 owner 与同一 Case；
- 仓库外捆绑 Node Playwright 与本机 Chrome，没有联网安装依赖，没有生成截图。

通过项：

1. 从合成岗位显式创建 Case，并在 Requirements 深链读取固定岗位版本。
2. V2 未知路径保留 `WorkspaceShell`；真实非法 Case 返回 404 页面。
3. 1536/1280 inline inspector/Peek 不产生 document-level 水平溢出，关闭后返焦。
4. 注入无效成功响应时显示脱敏 `INVALID_API_RESPONSE`，成功业务数据仍来自真实 API。
5. 768 下 Peek 与 Requirement inspector 为 dialog，打开聚焦、inert、Escape 与返焦通过。
6. 320 下移动导航、命令菜单、私有 JD 与删除确认的焦点约束、Escape、返焦和无页面级水平溢出通过。
7. `VITE_CAREER_OS_V2=false` 的旧 `ProductShell`/岗位页可用。
8. 控制台无 warning/error，除刻意 404 外无 HTTP 异常；所有浏览器请求只到 loopback，没有真实招聘、AI、邮件或其他外部请求。

脚本：

- `apps/platform/scripts/isolated-test-server.ts`
- `apps/web/scripts/os1-browser-gate.cjs`

## 5. 最终工程 Gate

最终回归使用全新隔离库 `aijob_os1_verify_test_20260813_f057`：

| Gate | 结果 |
|---|---|
| Config | 20/20 |
| Contracts | 79/79 |
| Database | 54/54 |
| Platform | 461/461 |
| Web | 145/145 |
| 合计 | **759/759** |
| `pnpm lint` | 通过，457 files |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm audit:ci` | 退出码 0；1 个既有 high 继续由已提交审计基线忽略，本切片未新增依赖 |
| `git diff --check` | 通过 |

Web production main chunk 为 567.51 kB（gzip 163.01 kB），比 PA-1 的 566.69 kB 增加 0.82 kB，低于 10 kB 守门。Resume Editor 29.26 kB、Interview 23.54 kB、数据设置 12.08 kB，继续独立 lazy load；大于 500 kB 的既有主包 warning 仍是后续性能债。

## 6. 清理、未完成项与决定

验收结束后只删除精确测试库 `aijob_os1_test_20260813_f057`、`aijob_os1_verify_test_20260813_f057` 与本任务临时运行目录，停止项目 PostgreSQL、Platform 和 Web，并确认 3000、5173、5174、5432 不再监听。

以下事实没有因 OS-1 改变：

- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- OS-3 的看板列表投影、五列密度/溢出和 OS-5 的 Resume Studio 三栏裁剪仍未关闭。
- Recommendation、Insights、规范简历导入、Case 固定版本匹配、Review v2、受控 AI、投递到复盘总体验仍由 OS-2–OS-6 串行负责。
- 没有访问或修改真实招聘来源、真实 AI、真实邮件、真实简历、本地业务数据库、服务器、参与者、`.claude/`、`.data/`、密钥、令牌、下载产物或截图。

因此本轮决定是：**完成 OS-1，进入 OS-2 准备；不自动开始 OS-2，等待 coco 的下一条指令。**
