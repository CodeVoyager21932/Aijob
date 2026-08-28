# OS-7 系统总 Gate 验收（2026-08-28）

> 分支：`codex/career-os-ux-convergence`
>
> OS-7 起始 HEAD：`e56ceae feat(career-os): close os6 lifecycle and data control`
>
> 中途检查点：`10f7451 chore(career-os): checkpoint paused os7 gate`（暂停，非通过）
>
> 治理修正：`78b51c7 docs(career-os): correct os7 gate rules and evidence boundaries`
>
> 决定：**完成 OS-7；Career OS 前后端同步改进收敛结束。不自动进入 Private Alpha，等待 coco 授权下一条轨道。**

本记录取代[OS-7 暂停检查点](os-7-system-gate-checkpoint-2026-08-28.md)作为 OS-7 的结论证据。检查点保留为过程事实，不再表示当前状态。

## 1. 五项状态

| 状态项 | 结果 | 证据 |
|---|---|---|
| Contract | **通过** | 无新增契约；Web 触达响应的运行时 schema 在 OS-1–OS-6 基础上扫描完毕，畸形成功响应继续统一为脱敏 `502 INVALID_API_RESPONSE` |
| Database/Platform | **通过** | 无新 migration、无新服务、无依赖变更；满态库 manifest 精确断言与空库计数断言均通过 |
| Web | **通过** | 全路由 1536/1280/768/320 视觉契约、键盘焦点、控制台与 loopback 网络通过；主包 401.33 kB 在 411.31 kB 上限内 |
| Integrated Gate | **通过** | `os7-browser-gate.cjs` 在全新满态库 + 真实空库上 8 个 step 全过，输出 `passed: true` |
| Evidence | **通过** | 本记录与 README、路线图、当前计划、当前交接、计划/证据索引、追踪矩阵同步；只关闭 OS-7 |

## 2. 双库浏览器 Gate

最终一次运行使用：

- 满态库 `aijob_ux_full_test_r0828151200g`、真实空库 `aijob_ux_empty_test_r0828151200g`，两者均从零迁移到 `033_resume_review_v2_expand`（71 张表）；
- loopback Platform `127.0.0.1:3000`（满态）与 `127.0.0.1:3001`（空态）；
- Web `127.0.0.1:5173`（V2 满态）、`127.0.0.1:5174`（`VITE_CAREER_OS_V2=false` 回退）、`127.0.0.1:5175`（V2 空态）；
- 合成岗位/owner/简历/证据、确定性模板与 `.example.test` 链接；
- 真实 Platform API、真实 PostgreSQL、真实浏览器；未访问真实招聘来源、真实 AI、邮件、服务器或参与者；未生成截图或下载产物。

8 个 step 依次通过：

1. `full-manifest-cases-profile-and-lazy-entry`
2. `matching-recommendation-and-insight-real-services`
3. `resume-review-conflict-session-docx-and-print`
4. `application-interview-debrief-and-detached-assets`
5. `owner-boundary-loading-error-retry-and-keyboard`
6. `full-routes-four-viewports-and-visual-contract`
7. `empty-database-real-empty-states`
8. `flag-off-and-manifest-database-assertions`

其中 **step 7 与 step 8 在 OS-7 历史上从未被执行到**，本轮为首次执行并通过。step 8 含本脚本最严的断言：owner 维度 `{active_cases: 5, public_cases: 4, private_cases: 1, stages: 5}` 精确相等、15 项 manifest 计数各 ≥1、requirement 状态分布、待决建议数、`debrief_confirmed` 事件恰好 1 条，以及全局“无外部请求 / 无控制台问题 / 无非预期 HTTP / 403+404+409+503 均确实发生过”。

最终输出：

```json
{"passed":true,"fullDatabase":"aijob_ux_full_test_r0828151200g","emptyDatabase":"aijob_ux_empty_test_r0828151200g","viewports":[1536,1280,768,320]}
```

脚本：`apps/web/scripts/os7-browser-gate.cjs`。本轮共 7 次运行，前 6 次均为失败反证，不计为通过证据；只有第 7 次计入 Gate。

## 3. Gate 发现并修复的真实 Web 缺陷

以下四项都是**产品缺陷**，不是断言过严。全部修在 `apps/web/src/career-os/career-os.css`，**未修改 `apps/web/src/styles.css`**，因此 `VITE_CAREER_OS_V2=false` 的旧 `ProductShell` 外观完全不变。

1. **裸 `small` / `sub` / `sup` 低于 12px 下限。** 用户代理默认把 `small` 计算为相对的 `smaller`，在 14px 上下文中落到 11.6667px。凡组件未显式给字号处即违反下限，`/settings/data` 一次命中 7 个。已用零特异性 `.career-os :where(small, sub, sup)` 设为 `var(--co-text-xs)`，既补下限又让所有既有组件规则继续优先。

2. **旧 `styles.css` 的 meta 标签在 Career OS 内低于下限。** 扫描确认旧样式表共 33 条 `font-size` 落在 9.76px–11.84px；其中随旧页面进入 Career OS 的部分（如 `.product-chip` 10.72px）确实生效。已新增 `.product-app.career-os` 前缀块统一抬到 `var(--co-text-xs)`。

3. **三处标题突破 32px 上限。** `.career-page-heading h1` 在窄视口为 `2.15rem`（34.4px）；`.career-placeholder-page h1, .career-not-found h1` 为 `2.4rem`（38.4px）；`.career-resume-assets__hero h1` 在窄视口为 `2.1rem`（33.6px）。均改为 `var(--co-title-lg)`。

4. **既有 OS-7 标题上限规则特异性不足，一直未生效。** 旧规则 `.product-app .product-hero:not(.product-hero--jobs) h1` 使用 `clamp(2.35rem, 4.6vw, 3.8rem)`，在 1280px 计算为 58.88px，特异性 (0,3,1)。检查点期形成的 `.career-legacy-tailoring > .product-hero h1` 只有 (0,2,1)，**从未赢过该旧规则**，所以旧 hero 标题在 Career OS 内一直超限。已改为 `.product-app.career-os` 前缀块（(0,4,1)）覆盖全部旧 hero/heading `h1`。`/resumes/import` 同样受此缺陷影响，本次一并修复。

第 4 项说明检查点里“旧 Import/Tailoring scoped 融合已形成”的表述并不成立：规则存在但不生效。这一点由本轮 Gate 首次证伪。

## 4. 静态视觉契约补强

`apps/web/src/career-os/visual-contract.test.ts` 新增“不得超过 32px 标题上限”断言（rem > 2 或 px > 32），现为 5/5。

该断言的价值已被证实：它捕获了 `.career-placeholder-page h1, .career-not-found h1` 的 `2.4rem`。404 页不在浏览器 Gate 的视觉契约路由循环内，**浏览器 Gate 结构上到不了这一页**，只有静态断言能守住。原有断言只检查“低于 12px”，对“高于上限”完全无覆盖。

## 5. 两处 Gate 夹具修正（非产品缺陷）

1. **Case overview 标题的 `exact` 匹配。** `CaseHeader` 渲染 `{companyName} · {roleTitle}`，可及名称是 `"合成·Career OS 企业 3 · 合成·数据产品实习生"`，而断言用的是裸岗位标题 `"合成·数据产品实习生"`。`fullRoutes` 本来就用非 exact 匹配并通过；`representativeRoutes` 统一加了 `exact: true`，因此永不可能匹配。已为该路由单独设 `exact: false`，其余标题保持严格匹配，未整体放宽。

2. **flag-off 资源断言过宽。** 原断言禁止任何路径匹配 `/career-os|WorkspaceShell/`。实测 flag-off 页面只加载两个匹配项：`/src/career-os/legacy-compatibility.ts` 与 `/src/api/career-os.ts`。前者正是 flag-off 的旧页面（`ResumePage`、`ResumeConfirmPage`、`JobDetailPage`、`DataControlPage`）自身 import 的兼容策略模块，后者是旧岗位详情页 Case 动作的 API 客户端；两者都是共享的非 UI 模块。断言已收紧为 `/(WorkspaceShell|career-os\/(pages|components)\/|career-os\.css)/`，保留“flag-off 绝不加载 Career OS 外壳、路由页、组件或样式表”这个真实保证，并已实测该集合为空。

## 6. 一个预先存在的 typecheck 缺陷

全仓 typecheck 暴露 `apps/platform/src/resume-documents/routes.integration.test.ts:3101` 的 `'value' is possibly 'undefined'`（`strict` + `noUncheckedIndexedAccess`，TypeScript 5.8.3）。

`git diff e56ceae` 证明该文件与 `tsconfig.base.json` 与 OS-6 基线**逐字节相同**，因此该错误在 OS-6 就已存在。OS-6 验收记录的“`pnpm typecheck` 通过”对该文件并不成立；OS-7 检查点期间也只跑过 Web typecheck，未跑全仓。这是 OS-6 工程 Gate 的一处真实缺口，已在此明确记录而非抹去。

修法为消除索引访问而非静音告警：`.map((value) => value.split(";", 1)[0])` 改为 `.flatMap((value) => value.split(";", 1))`，结果仍是 `string[]`，运行时语义不变。

## 7. 最终工程 Gate

最终代码在全新隔离库 `aijob_ux_gate_test_g0828152609`（从零迁移）上单次串行完成：

| Gate | 结果 |
|---|---|
| Config | 20/20 |
| Contracts | 86/86 |
| Database | 54/54 |
| Platform | 466/466 |
| Web | 182/182 |
| 合计 | **808/808** |
| `pnpm lint` | 通过，485 files |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm audit:ci` | 退出码 0；1 个既有 high 由已提交审计基线忽略，本切片未新增依赖 |
| `git diff --check` | 退出码 0，仅既有 LF/CRLF 提示 |

本次 808/808 为一次跑通，未出现 flake。Web 由 OS-6 的 175 增至 182：新增 4 项视觉契约（其中 1 项为本轮补强）与运行时 schema 反证测试。

最终 Web production 主包 **401.33 kB（gzip 117.04 kB）**，相对 OS-6 基线 401.31 kB 增加 0.02 kB，远低于 411.31 kB 上限。`WorkspaceShell` 14.97 kB、`ResumeDocumentEditor` 38.32 kB、`CaseInterviewWorkspace` 30.24 kB、`CareerDataControlPage` 13.84 kB、`CaseApplicationWorkspace` 9.03 kB 等重工作区继续独立 lazy load。

本轮最终改动仅 4 个文件：

- `apps/web/src/career-os/career-os.css`
- `apps/web/src/career-os/visual-contract.test.ts`
- `apps/web/scripts/os7-browser-gate.cjs`
- `apps/platform/src/resume-documents/routes.integration.test.ts`

没有 migration、没有依赖变更、没有新服务、没有移除 `VITE_CAREER_OS_V2`。

## 8. 运行环境事实

以下为本轮执行环境的可复现事实，不改变产品结论：

- 本工作区是原 Codex worktree 的副本，`node_modules/.modules.yaml` 的 virtual store 仍指向旧路径，pnpm 因此拒绝执行任何脚本。已用 `pnpm install --frozen-lockfile` 修复（234 包全部命中本地 store，`downloaded 0`）；`package.json` 与 `pnpm-lock.yaml` 经 `git diff` 确认未变。
- Playwright 1.62.1 装在仓库之外的临时目录，经脚本既有的 `CODEX_NODE_MODULES` 入口加载；Chromium 下载失败（`ECONNRESET`）后改用本机已安装的 Chrome `151.0.7922.174`（与 Playwright 目标 Chromium 同为 151.0.7922 构建线）经 `OS7_BROWSER_EXECUTABLE` 注入，浏览器下载量为 0。
- Gate 运行时必须用 `WEB_API_ORIGIN` 控制 Vite 的 `/v1` 代理并让页面保持相对同源请求。设置 `VITE_API_BASE_URL` 会让应用跨源直连 Platform，破坏同源 CSRF 模型并导致 `403 CSRF_REJECTED`；这是第 1 次运行失败的原因。
- 实测 PostgreSQL 容器时钟领先宿主机约 280ms。这会让 `024_resume_document_v2_expand` 集成测试的“JS 时钟 + 1s 覆盖数据库时钟”假设在慢负载下失效（该测试混用 JS 计算的 `updated_at` 与数据库默认的 `created_at`，仅留 1 秒余量）。本轮首次运行曾因此失败、复跑通过；最终工程 Gate 未复现。未修改生产约束 `CHECK (updated_at >= created_at)`，也未改该测试，仅登记为已知环境敏感项。

## 9. 清理与未改变的事实

本轮所有名称匹配 `aijob_ux_*_test_*` 的隔离库已删除，5 个 loopback 进程与项目 PostgreSQL 已停止，3000、3001、5173、5174、5175、5432 均不再监听。未读取或修改 `.claude/`、`.data/`、密钥、令牌、真实简历原文、本地业务数据库、下载产物或截图；历史遗留的其他测试库未触碰。

以下事实没有因 OS-7 改变：

- 产品证据仍为 **E0**：没有任何可复核的目标用户行为证据。
- 可信供给仍为 **22 岗 / 3 家企业 / 3 个官方 ATS**，公共与 Alpha 岗位均为 0；距硬门槛仍缺 978 岗、97 家。
- 来源持续性 0/3；服务器就绪、真实邮件、解析镜像未实施；G0/G1 未开始。
- 真实 AI、真实招聘来源与真实参与者均未启动。
- 工程、合成满态、浏览器与视觉全部通过**不等于**用户价值、生产就绪或 Private Alpha 就绪。

## 10. 决定

**完成 OS-7。** UX-0 与 OS-1–OS-7 全部关闭，Career OS 前后端同步改进阶段收敛结束。

不自动进入 Private Alpha 准备：其供给、来源持续性、服务器与参与者条件全部未满足，且需 coco 明确授权。下一条轨道（供给准入扩容或服务器就绪）由 coco 选择，不从本记录自动生成任务。
