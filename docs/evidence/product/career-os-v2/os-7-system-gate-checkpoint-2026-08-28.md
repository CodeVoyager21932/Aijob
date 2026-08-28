# OS-7 系统总 Gate 暂停检查点

> 日期：2026-08-28
>
> 状态：**进行中 / 已按 coco 指令暂停**
>
> 决定：**停止当前运行与测试；保留已实现改动，尚未通过 Integrated Gate、全仓工程 Gate 或 Evidence Gate。**

本记录是可恢复的工程检查点，不是 OS-7 验收证据。它不能用于宣称 Career OS 同步改进完成、进入 Private Alpha、产品价值已验证或生产就绪。

## 1. 起点与固定边界

- 分支：`codex/career-os-ux-convergence`。
- 起始 HEAD：`e56ceae feat(career-os): close os6 lifecycle and data control`。
- OS-6 可信基线保持 Config 20、Contracts 86、Database 54、Platform 466、Web 175，共 801/801。
- 本轮只使用 loopback、全新 `aijob_*_test_*` PostgreSQL、合成岗位/owner/简历/证据和确定性模板。
- 未访问真实招聘来源、真实 AI、邮件、服务器、参与者或真实简历；未读取或修改 `.claude/`、`.data/`、密钥、令牌、本地业务数据库、下载产物或截图。
- 没有新增 migration、数据库、服务、队列、认证、Redis、向量库、AI SDK 或远程依赖。

## 2. 已形成但尚未总验收的改动

### Contract / Web API 边界

- 为当前证据、固定证据修订、旧岗位决定、旧 Tailoring 创建和片段决定补齐共享 runtime schema。
- 畸形成功 payload 继续统一转为脱敏的 `502 INVALID_API_RESPONSE`，不把 TypeScript 泛型断言冒充运行时契约。

### Web 视觉与旧能力融合

- Career OS 可见文字最低 12px，数字字重收敛到标准 100 档，主页面标题上限收敛到 32px token。
- 旧 `/resumes/import*` 与只读 `/resume-tailorings/:runId` 在 `.career-os` 作用域内使用统一字重和字号；`VITE_CAREER_OS_V2=false` 的旧 ProductShell 不受该作用域影响。
- 新增静态视觉契约测试，守住最小字号、标准字重、主标题上限和旧页面融合规则。

### 浏览器 Gate 基础设施

- `m1-browser-gate.cjs` 的公共合成岗位 seed 支持多岗位参数，同时保持默认行为。
- 基础简历 seed 按 owner 当前最大修订号顺延，避免已有资料确认修订时与 revision 1 冲突；文档自身 revision 仍从 1 开始。
- 新增 `os7-browser-gate.cjs`：设计为一套完整满态库加一套真实空库，覆盖五阶段 Case、三证据状态、current/stale match、推荐/洞察、Resume/Review/DOCX/打印、投递/面试/复盘、删除/owner/404/409/session、错误重试、键盘焦点、全路由、四视口、空态、lazy load、N+1、控制台/网络和 flag-off 回退。
- 看板性能断言允许 React 开发模式一次重挂载，即 1–2 次相同聚合读取，但仍严格要求逐 Case 请求为 0。

## 3. 已完成的检查

- 一次因命令参数写法意外触发的 Web 全包：42 files、180/180 tests 通过；之后没有因格式或脚本小改重复全包。
- 最终静态视觉契约：1 file、4/4 tests 通过。
- Web typecheck 在 API/视觉主体改动后通过；后续测试正则调整已由对应 Vitest 编译执行。
- 触达文件 Biome 检查、`node --check` 和 `git diff --check` 通过。
- 键盘定点探针通过：Skip Link、主内容聚焦、Ctrl+K 搜索框聚焦、Escape 后焦点返回。
- `/resumes/import` 计算后样式定点探针通过：无低于 12px 的可见文字，无非标准数字字重。

这些检查只说明当前局部改动可继续，不代替 OS-7 最终浏览器 Gate 和全仓工程 Gate。

## 4. 浏览器运行反证与暂停点

OS-7 总 runner 在全新隔离库上逐步暴露并修正了以下 Gate/fixture 问题：

1. 非 ASCII 文本误入 `Idempotency-Key`，浏览器拒绝请求头；已改为纯 ASCII UUID key。
2. 已确认资料存在 owner revision 1 时，旧基础简历 seed 重复写 revision 1；已改为 owner 修订号顺延，并在失败库中单点证明产生 revision 2。
3. 面试中 Case 未先创建岗位派生简历；后端正确返回 `INTERVIEW_INPUTS_NOT_READY`，runner 已改为先创建岗位简历，不放宽后端规则。
4. 看板聚合读取在 React StrictMode 下出现两次；runner 已与 OS-6 既有语义对齐为允许一次开发模式重挂载，仍禁止逐 Case N+1。
5. 键盘测试从路由自动聚焦后的 main 开始，`blur()` 不能重置遍历起点；runner 已明确从 body 开始，并以小探针验证完整焦点链。
6. 全路由视觉检查发现 `/resumes/import` 继承旧 650/750 字重；已在 `.career-os` 内做最小样式修复并通过定点检查。

最后一次完整 runner 已走到全路由视觉阶段，在发现第 6 项后按失败退出。第 6 项修复完成后，coco 指令暂停，因此**没有再运行新的完整 runner，也没有形成 `passed: true` 证据**。

## 5. 尚未完成

五项状态账本：

| 状态项 | 当前状态 | 未完成条件 |
|---|---|---|
| Contract | 进行中 | 最终代码上的全仓契约回归尚未运行 |
| Database/Platform | 进行中 | 最终新库上的完整业务/语义与全仓回归尚未通过 |
| Web | 进行中 | 最终全路由四视口视觉回归和构建包体尚未通过 |
| Integrated Gate | 进行中 | 最终修复后的双库 runner 尚未产生 `passed: true` |
| Evidence | 进行中 | 只有本暂停检查点，没有 OS-7 acceptance 和完成决定 |

恢复时不得重跑 OS-1–OS-6 独立脚本。固定顺序为：

1. 核对分支、远端和清洁运行态。
2. 创建一组全新 `aijob_ux_full_test_*` / `aijob_ux_empty_test_*` 数据库。
3. 只运行一次最终 `os7-browser-gate.cjs`；若失败，只处理真实阻塞并做定点验证。
4. 浏览器 Gate 稳定后，只运行一次全仓 lint、typecheck、串行全新库 tests、build、audit 和 diff check。
5. 全部通过后才更新 OS-7 acceptance、路线图、当前计划、追踪矩阵与交接，并作“进入 Private Alpha 准备 / 修改 / 回退 / 停止”之一的决定。

## 6. 暂停清理

- 本轮 8 个精确 `aijob_ux_*_test_*` 数据库已删除。
- Platform、V2 Web、flag-off Web、empty Web 与项目 PostgreSQL 已停止；3000、3001、5173、5174、5175、5432 均未监听。
- `C:\Users\72998\AppData\Local\Temp\aijob-os7-f057-final` 下只剩 `full/`、`empty/` 两个空目录壳；Windows 执行策略拒绝递归删除，目录内没有文件、数据或进程。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位仍为 0。
