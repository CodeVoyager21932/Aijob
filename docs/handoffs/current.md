# 当前项目交接：Aijob Career OS M4 已完成

> 交接日期：2026-08-12
>
> 当前分支：`codex/career-os-m4-4`
>
> 分支起点：`6ea75fc docs(evidence): accept m4 one-job candidate`
>
> 精确 HEAD 以 `git log -1` 为准。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

已完成交付计划：[Career OS 当前交付计划](../plans/career-os-current-delivery-plan.md)

最新验收：[M4 工程与浏览器总验收](../evidence/product/career-os-v2/m4-engineering-browser-gate-acceptance-2026-08-12.md)

后续守门清单：[Private Alpha 与上线就绪 Gate](../plans/private-alpha-readiness-gates.md)

## 1. 当前决定

M1、M2、M3、M4-0、M4-1、M4-2A、M4-2B、M4-3 与 M4-4 均已完成。M4 最终决定为：

**完成 M4 并进入 Private Alpha 准备。**

该决定只确认本地合成候选的工程与浏览器 Gate 通过，不授权自动访问真实来源、启动服务器、接入真实 AI、创建邮箱身份或招募参与者。当前没有已授权的后续实现任务；等待 coco 明确选择 Private Alpha 准备的具体切片。

## 2. 已通过工程基线

- 1280 CSS px 下，同一合成公共岗位 Case 从要求、证据、岗位简历、模板 Review、DOCX、显式投递、模板面试、反馈复盘、确认回流运行到 Case 选择性删除。
- 320 CSS px（640 物理像素下 200% 等效）无页面水平滚动；长文本、Requirement 抽屉、删除对话框、可见焦点和关闭后焦点返回通过。
- 刷新、深链、前进/后退、非法/跨 owner 404、删除后不可读、revision 409 草稿保留、API 失败重试和会话恢复后 mutation 不重放通过。
- `VITE_CAREER_OS_V2=false` 后旧 ProductShell 与旧岗位页保持可用；新工作区导航不加载。
- DOCX 与浏览器打印入口通过；干净页面控制台无 warning/error，页面资源无真实招聘/AI 外联；岗位与 Case 首屏不加载 Resume Editor/Interview。
- 最终全仓：Config 17、Contracts 79、Database 54、Platform 459、Web 141，共 **750/750**。
- `pnpm lint` 检查 445 files，通过；`pnpm typecheck`、`pnpm build`、`pnpm audit:ci` 和 `git diff --check` 通过。
- Web main chunk 564.42 kB；Resume Editor 29.23 kB、Interview 23.51 kB、数据设置 9.15 kB，重工作区保持 lazy load。既有大于 500 kB 警告仍是技术债。

## 3. M4-4 交付内容

- `apps/web/scripts/m4-browser-fixture.cjs`：只允许 loopback 且名称匹配 `aijob_*_test_*` 的隔离数据库，提供 `seed-job` 与 `seed-resume <case-id>` 两个合成候选命令。
- `apps/web/scripts/m1-browser-gate.cjs`：把既有 `seedCatalog`、`seedBaseResume` 作为模块导出，并延迟加载可选 Playwright 依赖，供 M4 fixture 复用；原脚本直接执行行为保持不变。
- `docs/evidence/product/career-os-v2/m4-engineering-browser-gate-acceptance-2026-08-12.md`：记录浏览器、错误恢复、输出/加载、包体、全仓 Gate 和诚实证据边界。
- README、路线图、计划索引与当前交付计划已更新为 M4 完成状态。

## 4. 产品与 Gate 事实

- 产品证据仍为 `E0`；没有可复核目标用户行为证据。
- 可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS；公共与 Alpha 岗位均为 0。
- 100 家企业 / 1000 条活动岗位、来源连续 7 天、服务器、安全、邀请身份、备份恢复、G0/G1 和 G4 均未通过。
- 工程通过不得写成用户价值已验证、真实来源已准入、Private Alpha 已就绪或生产就绪。

## 5. 固定排除与安全边界

- 不实现邮箱验证码、手机号、账号认领、Knowledge、真实 AI、真实来源、服务器、参与者、生产 seed、语音/视频面试、自动投递或站外通知，除非 coco 后续明确授权相应切片。
- 不新增数据库/migration/Redis/向量库/第二套队列/第二套认证/AI SDK；不做 G4 前 contract migration，不移除 `VITE_CAREER_OS_V2`。
- 不读取、修改、暂存、覆盖、清理或提交 `.claude/`、`.data/`、密钥、令牌、真实简历原文、本地业务数据库、下载产物或截图。
- 自动化测试、构建和 Alpha/Production 不访问真实招聘站；公共目录在来源准入前保持为空是正确行为。

## 6. 下个任务接手清单

1. 依次阅读 `AGENTS.md`、`README.md`、路线图、本交接、计划索引、已完成交付计划和 M4 总证据。
2. 检查实际分支、HEAD、远端跟踪、`git status`、最近提交、项目容器与 3000/5173/5432 端口；冲突先报告，不静默修复。
3. 正常 fetch 并核对远端后，再根据 coco 的明确授权创建独立 `codex/` 分支；不要把 M4 总验收或 Private Alpha Gate 当成自动任务生成器。
4. 新测试仍使用全新且匹配 `aijob_*_test_*` 的精确隔离库，只写合成数据；完成后精确清理测试库和临时运行物并停止服务。
