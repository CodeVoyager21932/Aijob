# 当前项目交接：Aijob Career OS M4-3 一岗本地测试候选

> 交接日期：2026-08-12
>
> 当前分支：`codex/career-os-phase-1`
>
> M4-2B Contracts / Platform：`b7f9354 feat(platform): expose career data truth atomically`
>
> M4-2B Web：`edbdb69 feat(web): surface real career data boundaries`
>
> 后续精确 HEAD 以 `git log -1` 为准。
>
> 正常工作树预期只剩未跟踪 `.claude/`；不得读取、修改、暂存、覆盖或清理它。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

唯一活动计划：[Career OS 当前交付计划](../plans/career-os-current-delivery-plan.md)

最近验收：[M4-2B 数据真相与错误恢复](../evidence/product/career-os-v2/m4-2b-data-truth-and-recovery-acceptance-2026-08-12.md)

后续 Gate：[Private Alpha 与上线就绪 Gate](../plans/private-alpha-readiness-gates.md)

## 1. 当前唯一目标

当前唯一里程碑是 **M4 旧流程收口与测试候选**，当前唯一执行切片是 **M4-3 一岗本地测试候选**。

本切片不是继续建设新模块，而是用一个隔离 PostgreSQL 中的合成岗位和合成职业材料，把已经实现的能力贯通成一个可重复候选：

```text
合成可信岗位
→ 创建/重开同一 Case
→ 核对要求与证据
→ 创建岗位简历并完成 Review 决定
→ DOCX/打印交接
→ 打开合成官方链接（不写投递）
→ 用户显式标记已投递
→ 模板文字面试、反馈与复盘确认
→ 回流 Requirements/Resume
→ 选择性删除 Case 资产
→ 删除全部当前 owner 数据
```

M4-3 只修复阻断这条同一 Case 闭环的当前缺口。若发现需要邮箱账号、Knowledge、真实 AI、真实来源、服务器或新 migration 才能继续，必须作“修改/停止”决定，不能扩建范围。

## 2. 已通过基线与已知事实

- M1–M3 已完成真实 Case、Requirements、Resume V2/Review/DOCX、显式投递、确定性文字面试、反馈复盘和用户确认回流。
- M4-1 已停止 V2 正常路径中的旧 Match/Decision/Tailoring/Recommendation/Insight/official-link-opened 并行写入；旧数据保持兼容只读，旗标关闭策略仍为 `legacy`。
- M4-2A 已接通 Case、Resume、Interview、Debrief 的 owner-protected 单项删除与 Case 选择性删除/脱离。
- M4-2B 已完成真实 owner 保留模式/数据范围、脱离资产发现与删除、简历确认单事务、读取/下载一次会话恢复、mutation 不重放、旧 owner 查询清理和占位入口/开发标签收口。
- M4-2B 全仓回归为 Config 17、Contracts 79、Database 54、Platform 458、Web 141，共 749/749；lint 444、typecheck、build、audit 和 diff check 通过。Web main chunk 为 564.42 kB。
- M4-2B 没有新增 migration 或依赖；两个精确隔离测试库已删除，项目 PostgreSQL 容器与网络已关闭。
- 本切片开始时，必须重新确认 tracked 工作树干净、远端同步和容器状态；只有需要隔离 PostgreSQL 测试时才重新启动容器。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位为 0。

## 3. 固定实现顺序

同一时间只允许一个检查点进行，先证明复用，再补最小缺口：

1. **M4-3-0 现有闭环矩阵**：对照 M4-3 的 11 个动作，核对 `local-complete-flow.integration.test.ts`、ApplicationCase/Resume/Interview 集成测试和 Web 路由；标出“已有同一 Case 证据、只有分散证据、完全缺失”三类，不把分散的单模块通过冒充一岗候选。
2. **M4-3-1 合成候选夹具**：在随机隔离库中建立一个确定性的合成 public job/source/version、owner、已确认基础简历和证据；所有 URL 指向保留的合成 HTTPS 域名，不触网，不读取现有开发/Alpha 库。
3. **M4-3-2 单 Case API 链**：从创建/重开 Case 开始，按用户顺序完成要求、派生简历、Review 决定、DOCX、外链无副作用、显式 applied、Interview/Feedback/Debrief/确认回流和选择性删除；每一步断言同一 owner、Case、固定岗位版本、Resume/Evidence 修订与事件顺序。
4. **M4-3-3 全部删除终点**：对完成上述旅程的 owner 发起全部删除，运行删除 worker/状态检查；证明会话撤销、个人表清除、迟到任务拒绝、公共合成岗位仍存在且数据不会被重新读取。
5. **M4-3-4 Web 候选入口检查**：用现有页面状态/API view-model 测试补齐候选所需的错误映射与继续路径；不在 M4-3 重复 1280/320 完整视觉验收，不为测试建设生产 seed 或公共管理页。
6. **Gate 与决定**：运行 focused candidate、受影响包和全仓工程检查。只有一条自动化候选能从起点走到全部删除终点，且没有真实网络、并行旧写入或跨 owner 泄漏，才决定继续 M4-4。

## 4. 准备检查的代码入口

现有端到端与夹具：

- `apps/platform/src/local-complete-flow.integration.test.ts`
- `apps/platform/src/applications/routes.integration.test.ts`
- `apps/platform/src/resume-documents/routes.integration.test.ts`
- `apps/platform/src/interviews/routes.integration.test.ts`
- `apps/platform/src/profile/local-owner-flow.integration.test.ts`

聚合路由与服务：

- `apps/platform/src/applications/routes.ts`
- `apps/platform/src/applications/service.ts`
- `apps/platform/src/resume-documents/routes.ts`
- `apps/platform/src/interviews/routes.ts`
- `apps/platform/src/profile/routes.ts`
- `apps/platform/src/profile/deletion-service.ts`
- `apps/platform/src/workers/owner-task-worker.ts`

Web 候选与入口：

- `apps/web/src/App.tsx`
- `apps/web/src/api/career-os.ts`
- `apps/web/src/career-os/pages/CaseWorkspacePage.tsx`
- `apps/web/src/career-os/pages/CaseRequirementsWorkspace.tsx`
- `apps/web/src/career-os/pages/CaseResumeWorkspace.tsx`
- `apps/web/src/career-os/pages/CaseApplicationWorkspace.tsx`
- `apps/web/src/career-os/pages/CaseInterviewWorkspace.tsx`
- `apps/web/src/career-os/pages/CareerDataControlPage.tsx`

## 5. M4-3 退出条件

只有以下全部成立才可进入 M4-4：

1. 一个随机隔离库中的合成 public Case 以同一 owner、固定岗位版本和已确认 Evidence/Resume 修订贯通 Requirements → Resume/Review → DOCX → external handoff → applied → Interview/Debrief → backflow。
2. 打开/读取合成官方链接信息不产生 `applied` 或旧 `official_link_opened` 写入；只有显式命令改变投递状态和时间线。
3. Review 接受/编辑/拒绝状态、DOCX 输出、模板 Interview/Feedback 和逐项 Debrief 决定均可追溯到固定输入；不会生成新经历或调用真实 AI。
4. Case 选择性删除后，选择保留的资产仍可从数据范围发现；全部 owner 删除完成后，个人数据、会话和任务不能复活，公共合成岗位不受影响。
5. 异常路径至少覆盖一次 stale revision、跨 owner 404、session/CSRF 或删除后访问；不通过自动重放 mutation 隐藏冲突。
6. focused 与全仓工程检查通过，并记录继续 M4-4、修改、回退或停止之一。M4-3 只形成自动化本地候选，不冒充 M4-4 浏览器总 Gate。

## 6. 固定排除

- 不访问真实招聘来源、真实 JD、真实 AI、真实简历、邮件、服务器或参与者数据。
- 不实现邮箱验证码、手机号、账号认领、Knowledge、跨 Case 智能生成、语音/音视频面试、自动投递或站外通知。
- 不新增数据库、migration、Redis、向量库、第二套队列、第二套认证、新的 AI SDK、生产 seed 或公共管理页面。
- 不做 G4 前 contract migration，不删除无法证明已迁移的旧资产，不移除 `VITE_CAREER_OS_V2` 回退路径。
- 不读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地业务数据库、下载产物或本机截图。

## 7. 接手检查表

1. 按顺序读取 `AGENTS.md`、`README.md`、`docs/06-mvp-roadmap.md`、本文件和 `docs/plans/README.md`。
2. 检查分支、HEAD、`git status` 和最近提交；已有改动不得覆盖，`.claude/` 不得处理。
3. 确认路线图、当前交付计划和本交接都只指向 M4-3；归档计划和历史验收不得提供当前任务。
4. 先完成 M4-3-0 闭环矩阵，优先把已有分散测试串成一个候选，不为测试扩建未来架构。
5. 所有 PostgreSQL 测试使用随机隔离库；结束后按精确库名清理并关闭项目容器。
