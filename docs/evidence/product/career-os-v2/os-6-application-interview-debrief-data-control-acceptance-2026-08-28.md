# OS-6 投递、面试、复盘与数据控制验收（2026-08-28）

> 分支：`codex/career-os-ux-convergence`
>
> 起始 HEAD：`9d44a0d feat(career-os): close os5 resume studio`
>
> 决定：**完成 OS-6，进入 OS-7 准备；OS-7 尚未实施，等待 coco 指令。**

## 1. 验收范围与五项状态

OS-6 只收敛 `/today`、同一 Case 的显式投递、确定性模板面试、复盘逐项决定与确认后回流、选择性/全部删除、删除回执、旧 Tailoring 只读和兼容 URL。它同步核验既有 Contracts、PostgreSQL/Platform、Web 与真实隔离浏览器 Gate，没有进入 OS-7 系统总 Gate，也没有启动真实 AI、真实招聘来源、邮件、服务器或参与者。

| 状态项 | 结果 | 证据 |
|---|---|---|
| Contract | **通过** | 复用既有 application timeline/manual application、interview/debrief、data scope、legacy Tailoring、export 与 deletion receipt 契约；Web 触达响应均增加运行时 parser，畸形成功响应统一为 502 |
| Database/Platform | **通过** | 无新 migration；Case/Session/Debrief 非法或跨 owner 统一不可枚举 404；revision 先于 completed 状态校验；首次复盘确认同事务递增 Case revision 并追加唯一 `debrief_confirmed`；删除回执在既有签名 TTL 内可重复读取 |
| Web | **通过** | `/today` 单一 Board read model；投递、Interview、Debrief 分离；Session 草稿/409 恢复；确认后回流；选择性删除重读；全部删除后不隐式 bootstrap session；规范/兼容回执 URL 可刷新 |
| Integrated Gate | **通过** | 全新隔离 PostgreSQL、真实 Platform API、合成岗位/owner/简历/证据、1536/1280/768/320 浏览器 Gate；网络仅 loopback，无真实招聘或 AI 请求 |
| Evidence | **通过** | 本记录、README、路线图、当前交接、当前计划、计划/证据索引、稳定契约和追踪矩阵同步；只关闭 OS-6 |

## 2. Platform 与数据一致性

- application Case、Interview Session 和 Debrief 的非法 UUID、跨 owner 或删除后读取统一返回不可枚举 404。
- 对已完成 Session 的陈旧回答请求先核对 revision；陈旧 revision 返回 `INTERVIEW_SESSION_REVISION_CONFLICT`，不会被较宽泛的 `INTERVIEW_SESSION_NOT_ACTIVE` 吞掉，Web 因而能保留本地草稿并要求用户显式丢弃或重试。
- 首次 Debrief 确认在同一数据库事务内写入逐项决定和 confirmation、递增 Case revision，并追加一个 `debrief_confirmed` Case event。事件 payload 固定包含 `debriefId` 与 `evidenceRevisionId`；同幂等键 replay 或同一 confirmation 的新键读取不会重复事件或再次递增 revision。
- `/today` 的新鲜申请看板在 PostgreSQL `40001` 序列化冲突时只对有限次 read model 读取重试，不重放 mutation。
- 全量 owner 删除沿用现有签名回执 cookie 的 24 小时 TTL。成功回执不会在第一次读取时清空，因此刷新、深链和兼容 URL 都能稳定读取；原 owner 私有资源仍不可读，公共岗位事实保留。
- Database forward-contract 中 legacy fixture 缺少 `created_at` / `updated_at`，本轮只修正测试夹具以符合既有 schema，没有修改生产语义或增加 migration。

## 3. Web 交互与运行时边界

- `/today` 只消费一个 Board read model，不为每个 Case 发起 N+1 请求。
- 打开官方岗位 URL 不产生投递写入；只有用户明确确认才提交 manual application 命令。成功状态可从 URL、刷新和历史导航恢复。
- Interview 与 Debrief 使用独立页面表面。答案草稿按 Session 隔离；409 显示服务端状态并保留陈旧草稿，必须由用户明确丢弃。成功回答立即更新本地 Session，同时后台刷新规范状态，避免可编辑状态因慢刷新短暂回退。
- Debrief 支持逐项决定和未确认离开保护；确认成功后刷新 Case detail、events、list 和 Board，只有确认后的证据修订进入回流。
- 选择性删除只有在范围查询完成重新读取后才提示成功，避免成功提示与旧计数竞争。全量 owner 删除先抑制 session bootstrap，再清空缓存并进入删除回执；只有用户明确选择“以新身份浏览岗位”才恢复 bootstrap。
- `/settings/data/deletion`、`/data-control/deletion` 及旧子路径在 Shell/Utility Bar 初始化前识别为回执路由，避免兼容重定向期间创建新 owner。
- 旧 `/resume-tailorings/:runId` 在 V2 继续只读；`VITE_CAREER_OS_V2=false` 继续使用旧 `ProductShell` 与旧岗位页。
- timeline、manual application、interview/debrief、data scope、requirements、legacy Tailoring、exports 与 deletion receipt 的成功响应都在 Web 边界运行时解析；畸形 payload 不进入页面状态，也不写入控制台。

## 4. 真实隔离浏览器 Gate

最终浏览器 Gate 使用：

- 精确隔离库：`aijob_os6_test_20260828_f057_browser19`；
- loopback Platform `127.0.0.1:3000`、V2 Web `127.0.0.1:5173`、flag-off Web `127.0.0.1:5174`；
- 只含合成公共岗位、合成 owner、合成简历、合成要求/证据和 `.example.test` 链接；
- 真实 Platform API、PostgreSQL 与浏览器；没有访问真实招聘来源、AI、邮件或服务器，没有生成截图。

通过项：

1. 从 `/today` 和同一 Case 完成显式投递、模板面试、回答/反馈、复盘逐项决定、确认与回流；外链打开没有 application mutation。
2. Interview revision 409 保留 Session 草稿，session 恢复后 mutation 不自动重放；用户显式处理后可继续。
3. 首次确认只产生一个 `debrief_confirmed` event，Case revision 与后续 Session 基线连续，确认前不回流。
4. 旧 Tailoring 只读；非法/跨 owner Case、Session、Debrief 为 404；选择性删除与全部 owner 删除后私有资源不可读。
5. 全量删除后没有新的 `/v1/session` bootstrap；删除回执在刷新、规范深链和旧 `/data-control/deletion` 路径均可读取。
6. 1536、1280、768（200% 等效边界）和 320 均无页面级水平溢出；键盘、可见焦点、对话框返焦和长文本通过。
7. 岗位/Case 首屏不加载 Resume Editor 或 Interview；重工作区只在进入相应页面后 lazy load。
8. flag-off 旧壳与岗位页可用；控制台无新增 warning/error，除刻意注入的错误外无异常响应，所有网络请求只到 loopback。

最终脚本返回：

```json
{"passed":true,"applicationCommands":1,"answerCommands":3,"viewports":[1536,1280,768,320],"ownerDeleted":true}
```

脚本：`apps/web/scripts/os6-browser-gate.cjs`。此前的 browser1–browser18 都是修复过程中的失败反证，不计为通过证据；最终只以 browser19 计入 Gate。

## 5. 最终工程 Gate

最终代码使用全新 `aijob_os6_test_20260828_f057_final3` 隔离库从零迁移并完成完整回归：

| Gate | 结果 |
|---|---|
| Config | 20/20 |
| Contracts | 86/86 |
| Database | 54/54 |
| Platform | 466/466 |
| Web | 175/175 |
| 合计 | **801/801** |
| `pnpm lint` | 通过，483 files |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm audit:ci` | 退出码 0；1 个既有 high 由已提交审计基线忽略，本切片未新增依赖 |
| `git diff --check` | 通过 |

第一次完整 Platform workspace 回归为 465/466：既有简历解析子进程在 10 秒边界出现一次 `RESUME_PARSE_TIMEOUT`。未修改生产超时；对应 privacy 文件随后 2/2 通过，同一最终代码的严格 Platform workspace 单次复验 466/466。上表只记录最终严格通过结果，也保留该瞬态以免将失败静默抹去。

最终 Web production 产物：main 401.31 kB（gzip 117.03 kB）、Resume Document Editor 38.32 kB（gzip 11.74 kB）、Interview 30.24 kB（gzip 9.03 kB）、数据设置 13.84 kB（gzip 5.18 kB）、删除回执 3.81 kB（gzip 1.84 kB）、Case application 9.03 kB（gzip 3.52 kB）。重工作区继续独立 lazy load，主包相对 OS-5 增加 0.84 kB，低于 10 kB 守门。

## 6. 修复过程中的关键反证

浏览器 Gate 没有被机械重复当作进度。每次失败都先定位、做 targeted test 和静态验证；最终只在这些检查稳定后运行 browser19。过程中确认并修复：

- 已确认 Debrief 缺少 `debrief_confirmed` Case event；
- 选择性删除成功提示早于范围重读完成；
- 全量 owner 删除后 Web 会隐式 bootstrap 新 session；
- deletion receipt 首次读取即被清除，刷新/深链和重复 poll 会退化为 404；
- 旧 deletion alias 在重定向前短暂触发 session bootstrap；
- Requirements runtime parser 的既有测试证据与真实 adapter 覆盖不一致，触达边界已补齐畸形响应断言。

这些修复都保持现有模块化单体、PostgreSQL 事实源、队列、身份和数据模型，没有扩建未来服务。

## 7. 清理、剩余边界与决定

验收结束后名称精确匹配 `aijob_os6_test_*` 的本轮隔离测试库已全部删除，Platform、V2 Web、flag-off Web 与项目 PostgreSQL 已停止，并确认 3000、5173、5174、5432 不再监听。19 个 `aijob-os6-f057-*` 目录均已核验为空；Windows 执行策略拒绝删除这些空目录壳，其中没有文件、数据或进程。没有读取或修改 `.claude/`、`.data/`、密钥、令牌、真实简历原文、本地业务数据库、下载产物或截图。

以下事实没有因 OS-6 改变：

- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- OS-7 系统总 Gate 尚未完成。
- 真实 AI、真实招聘来源、真实邮件、解析镜像、服务器、参与者和 Private Alpha 均未启动。
- 工程、合成浏览器和视觉通过不等于用户价值、生产或 Private Alpha 就绪。

因此本轮决定是：**完成 OS-6，进入 OS-7 准备；不自动开始 OS-7，等待 coco 的下一条指令。**
