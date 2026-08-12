# 当前项目交接：Aijob Career OS M4-4 工程与浏览器 Gate

> 交接日期：2026-08-12
>
> 当前分支：`codex/career-os-phase-1`
>
> M4-3 代码：`f40da77 test(platform): add m4 one-job candidate`
>
> 后续精确 HEAD 以 `git log -1` 为准。
>
> 正常工作树预期只剩未跟踪 `.claude/`；不得读取、修改、暂存、覆盖或清理它。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

唯一活动计划：[Career OS 当前交付计划](../plans/career-os-current-delivery-plan.md)

最近验收：[M4-3 一岗本地测试候选](../evidence/product/career-os-v2/m4-3-one-job-local-candidate-acceptance-2026-08-12.md)

后续 Gate：[Private Alpha 与上线就绪 Gate](../plans/private-alpha-readiness-gates.md)

## 1. 当前唯一目标

当前唯一里程碑仍是 **M4 旧流程收口与测试候选**，当前唯一执行切片是 **M4-4 工程与浏览器 Gate**。

M4-4 不再建设新业务模块，只在隔离 PostgreSQL 和合成数据上验收已形成的一岗候选：

```text
全新隔离库与零网络合成候选
→ 真实 Career OS 页面完成一岗主路径
→ 1280 / 320 / 200% 等效视口
→ 键盘、焦点、抽屉和对话框回退
→ 刷新、深链、前进/后退
→ 404 / 409 / session 恢复与 mutation 不重放
→ DOCX 与浏览器打印
→ VITE_CAREER_OS_V2 关闭后的旧壳层回退
→ 控制台、网络、包体和全仓检查
→ 形成 M4 总证据与继续/修改/回退/停止决定
```

只有发现可复现的当前闭环阻塞时才允许做最小修复。邮箱账号、Knowledge、真实 AI、真实来源、服务器、参与者、生产 seed 和未来架构都不进入 M4-4。

## 2. 已通过基线

- M1–M3、M4-0、M4-1、M4-2A、M4-2B 与 M4-3 已完成。
- M4-3 已把同一合成公共岗位 Case 从 API 创建/重开、固定岗位版本、Requirements/Evidence、Resume/Review、DOCX、外链无副作用、显式投递、模板面试、复盘确认和回流运行到 Case 选择性删除与全部 owner 删除。
- 全部删除已证明会话立即撤销、迟到任务转为 `OWNER_EPOCH_STALE`、个人资产清空而公共合成岗位保留。
- M4-3 全仓回归为 Config 17、Contracts 79、Database 54、Platform 459、Web 141，共 750/750；lint 444、typecheck、build、audit 和 diff check 通过。
- Web main chunk 仍为 564.42 kB；Resume Editor 29.23 kB、Interview 23.51 kB、数据设置 9.15 kB，重工作区继续独立 lazy load。
- M4-3 没有新增 migration、依赖、真实网络或产品运行代码；所有精确 M4-3 隔离库均已删除，项目 PostgreSQL 容器与网络已关闭，3000/5173/5432 未监听。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位为 0。

## 3. M4-4 固定执行顺序

同一时间只允许一个检查点进行：

1. **M4-4-0 可重复环境**：确认 tracked 工作树干净、远端同步、容器关闭；创建一个符合 `aijob_*_test_*` 命名的全新隔离库，只写入合成岗位、合成 owner、合成简历和证据。准备可重复启动器，但不得提交密钥、运行目录、下载或截图。
2. **M4-4-1 桌面主路径**：在 1280 CSS px 下从岗位进入同一 Case，完成要求核对、岗位简历、模板 Review、DOCX、显式投递、面试、复盘确认、回流和选择性删除；刷新、深链、前进/后退后仍恢复正确资源。
3. **M4-4-2 移动与可访问性**：在 320 CSS px 和 200% 等效视口下检查无水平滚动、抽屉/对话框、键盘全流程、可见焦点、关闭后焦点返回、状态通知和长文本布局。
4. **M4-4-3 错误与回退**：验证非法/跨 owner 404、revision 409 草稿保留、会话恢复后 mutation 不自动重放、API 失败重试、删除后不可读；关闭 `VITE_CAREER_OS_V2` 后旧 ProductShell 和旧岗位流程保持可用且不加载新工作区。
5. **M4-4-4 输出与加载**：验证当前修订 DOCX、浏览器打印预览、控制台无新增 warning/error、无真实招聘/AI 请求；岗位与 Case 首屏不加载 Resume Editor/Interview，main chunk 相对 Phase 1A 不超过既定 10% 边界。
6. **M4-4-5 总 Gate**：在最终代码上重新运行 lint、typecheck、全新隔离库 750+ tests、build、audit 和 diff check；更新 M4 总证据，清理精确测试库和启动器，停止容器，再作完成/修改/回退/停止决定。

## 4. 准备检查的代码入口

候选和状态：

- `apps/platform/src/resume-documents/routes.integration.test.ts`
- `apps/platform/src/applications/routes.integration.test.ts`
- `apps/platform/src/interviews/routes.integration.test.ts`
- `apps/platform/src/profile/local-owner-flow.integration.test.ts`

Web 主路径：

- `apps/web/src/App.tsx`
- `apps/web/src/career-os/pages/ApplicationsPage.tsx`
- `apps/web/src/career-os/pages/CaseWorkspacePage.tsx`
- `apps/web/src/career-os/pages/CaseRequirementsWorkspace.tsx`
- `apps/web/src/career-os/pages/CaseResumeWorkspace.tsx`
- `apps/web/src/career-os/pages/CaseApplicationWorkspace.tsx`
- `apps/web/src/career-os/pages/CaseInterviewWorkspace.tsx`
- `apps/web/src/career-os/pages/CareerDataControlPage.tsx`
- `apps/web/src/career-os/components/AssetDeletionDialog.tsx`

回退与边界：

- `apps/web/src/environment.ts`
- `apps/web/src/product/session-state.ts`
- `apps/web/src/api/client.ts`
- `apps/platform/src/identity/fastify.ts`

## 5. M4-4 退出条件

只有以下全部成立才可把 M4 标记完成：

1. 同一合成 Case 的桌面主路径能在真实页面从起点运行到复盘回流和删除，刷新/历史/深链不丢失上下文。
2. 1280、320 和 200% 等效视口无阻塞性布局问题或水平滚动；键盘、焦点返回、抽屉、对话框和状态通知可用。
3. 外链不写投递，mutation 不自动重放，404/409/session/API 失败和删除后访问都有真实、可恢复且不覆盖草稿的界面。
4. DOCX 与浏览器打印可用；控制台无新增 warning/error；没有真实招聘来源、真实 AI、邮件或服务器请求。
5. 旗标关闭后旧壳层与旧岗位页保持不变；非简历首屏不加载 Resume Editor 或 Interview，包体仍在既定边界内。
6. 最终全仓 Gate 通过并形成独立 M4 总证据；产品证据仍诚实保持 E0。

## 6. 固定排除

- 不访问真实招聘来源、真实 JD、真实 AI、真实简历、邮件、服务器或参与者数据。
- 不实现邮箱验证码、手机号、账号认领、Knowledge、跨 Case 智能生成、语音/音视频面试、自动投递或站外通知。
- 不新增数据库、migration、Redis、向量库、第二套队列、第二套认证、新 AI SDK、生产 seed 或公共管理页面。
- 不做 G4 前 contract migration，不删除无法证明已迁移的旧资产，不移除 `VITE_CAREER_OS_V2` 回退路径。
- 不读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地业务数据库、下载产物或本机截图。

## 7. 接手检查表

1. 按顺序读取 `AGENTS.md`、`README.md`、`docs/06-mvp-roadmap.md`、本文件和 `docs/plans/README.md`。
2. 检查分支、HEAD、`git status` 和最近提交；已有改动不得覆盖，`.claude/` 不得处理。
3. 确认路线图、当前交付计划和本交接都只指向 M4-4；归档计划与 M4-3 验收中的“下一步”不得覆盖当前任务。
4. 只在需要隔离 PostgreSQL 和浏览器验收时启动项目服务；始终使用零网络合成数据。
5. 结束后按精确库名清理测试库、临时启动器和运行目录，停止前后端与项目容器。
