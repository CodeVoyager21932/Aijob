# M4-1 兼容入口与写边界验收

> 日期：2026-08-12
>
> 结论：**通过 M4-1 工程验收，决定继续 M4-2A 单项删除与选择性级联**
>
> 代码提交：`84ebe34 feat(web): isolate legacy career os writes`

## 1. 本次证明的边界

本切片只修改 Web 路由、页面与兼容策略，没有修改 Platform、Contracts、Database 或 migration：

- `VITE_CAREER_OS_V2=true` 时，岗位详情只读取岗位事实并保留官方跳转、幂等创建/重开 Case；旧 Match、Decision、Tailoring、Profile 辅助查询和 `official-link-opened` 写入均不再启用。
- `/recommendations` 与 `/insights` 改为不依赖 Product API 或 React Query 的兼容说明页，分别引导到岗位目录和 Case 工作台；旧数据库记录没有删除。
- `/resume-tailorings/:runId` 继续 owner-scoped 读取历史，但建议文本为只读，不显示接受、编辑、拒绝或新建 DOCX 操作；已有且仍有效的下载与复制能力继续保留。
- `/resume` 与 `/resume/confirm/:analysisId` 继续承担解析、事实和证据确认；V2 下保存、沿用和已确认状态全部回到 `/resumes`，旗标关闭时仍进入旧推荐流程。
- `/data-control*` 在 V2 下无损进入 `/settings/data*`，删除成功直接进入新的回执 URL；旗标关闭时旧 URL 与旧页面行为不变。

本次没有把页面隐藏冒充单项删除。Case、Resume、Interview 与 Debrief 的 owner-protected 单项删除仍由 M4-2A 守门。

## 2. 自动化与构建结果

- focused tests：兼容策略、零请求页面、运行时依赖边界、岗位详情和简历入口共 5 个文件、12/12 通过。
- Web 完整回归：33 个文件、131/131 通过；相对 M3 的 125 项新增 6 项兼容边界测试。
- `pnpm --filter @aijob/web typecheck`：通过。
- `pnpm lint`：436 files，通过。
- `pnpm --filter @aijob/web build`：通过。
- `git diff --check`：通过；只有 Windows 行尾提示。
- 本次没有增加依赖，未访问 PostgreSQL，也未启动前端、后端或浏览器。

## 3. 加载与回退结果

- 兼容说明页保持独立 lazy chunk，为 1.41 kB。
- Web main chunk 为 560.59 kB；相对 M3 的 558.27 kB 增长 2.32 kB，约 0.42%，未超过 10% 边界。
- Resume Editor、Requirements 与 Interview 工作区仍是独立 lazy chunk，没有进入岗位列表首屏。
- `legacySurfaceMode` 对 JobDetail、Recommendation、Insight、旧 Tailoring 和旧 Data Control 给出单一处置，并用测试锁定旗标关闭时全部返回 `legacy`，避免兼容收口破坏紧急回退。
- M4-1 的退出条件只要求 focused 工程与旗标回退检查；1280/320、200% 等效、键盘、控制台和完整一岗浏览器验收统一留在 M4-4 执行，不在本记录中冒充已通过。

## 4. 证据边界与决定

- 没有访问真实招聘来源、真实 JD、真实 AI、真实简历、邮件、服务器或参与者数据。
- 没有读取、修改、暂存或提交 `.claude/`、`.data/`、密钥、令牌、本地数据库、下载产物或截图。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位仍为 0。
- M4-1 只证明新旧页面不再并行写入，不证明单项删除、长期账号、用户价值或 Private Alpha 就绪。

决定为 **继续**：当前唯一切片切换为 `M4-2A 单项删除与选择性级联`。实现必须复用已有 `deleted_at`、`detached_from_case_id`、owner epoch、revision 和 PostgreSQL guard；不得新增 migration，也不得先做 M4-2B 的账号/保留模式或未来功能。
