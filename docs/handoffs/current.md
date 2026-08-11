# 当前项目交接：Aijob Career OS M3 投递与持续改进

> 交接日期：2026-08-11
>
> 当前分支：codex/career-os-phase-1
>
> M2 功能基线：`932ab65 feat(web): add resume templates and export controls`
>
> M2 验收修正：`6b33ffe fix(career-os): harden m2 acceptance edge cases`
>
> M2 测试稳定性：`d369dcb test(database): stabilize migration gate timeout`
>
> M3-1 平台提交：`34c6b61 feat(platform): record explicit case applications`
>
> M3-1 Web 提交：`73f3420 feat(web): add case application timeline`
>
> M3-2 平台提交：`e2a74fe feat(platform): add deterministic interview sessions`
>
> M3-2 Web 提交：`33b220b feat(web): add case interview workspace`
>
> M3-3 平台提交：`71edf98 feat(platform): add deterministic interview debrief`
>
> M3-3 Web 提交：`f8f9265 feat(web): show interview feedback and debrief`
>
> 文档提交后的精确 HEAD 以 `git log -1` 为准。
>
> 工作树预期只剩未跟踪 `.claude/`；不得读取、修改、暂存、覆盖或清理它。

动态事实源：[MVP 路线](../06-mvp-roadmap.md)

唯一活动计划：[Career OS 当前交付计划](../plans/career-os-current-delivery-plan.md)

后续 Gate：[Private Alpha 与上线就绪 Gate](../plans/private-alpha-readiness-gates.md)

计划索引：[docs/plans](../plans/README.md)

最近切片验收：[M3-3 反馈与复盘](../evidence/product/career-os-v2/m3-3-feedback-debrief-acceptance-2026-08-11.md)

## 1. 当前唯一目标

当前唯一里程碑是 **M3 投递与持续改进**：

当前唯一执行切片是 **M3-4 用户确认回流**；M3-1、M3-2 与 M3-3 已通过验收，下面的完整链路只用于说明 M3 终点，不得据此提前执行 M3-5 或 M4。

```text
岗位专属简历与官方投递入口
→ 用户在官方页面自行投递
→ 用户显式记录投递状态
→ 基于同一 Case 的确定性文字面试
→ 结构化反馈与复盘
→ 用户确认后回到证据或简历继续改进
```

打开官方链接绝不自动变成“已投递”。问题、回答、反馈和复盘必须固定同一 Case、岗位版本和用户已确认事实；系统只能指出表达问题、证据缺口和练习计划，不得创造经历或自动覆盖职业资产。

## 2. 已通过工程基线

- M1 已完成真实公共/私有 Case、Requirements 三态/备注/证据/问题，以及 Case-derived Resume 创建和恢复。
- M2 已完成基础 Resume V2、V1 只读转换、结构编辑、岗位派生编辑、确定性 Review 三决策、两种中文模板、A4 预览、隔离打印与精确修订 DOCX。
- `/resumes` 与 Case `resume` 复用同一 Resume Document/Revision 真源；岗位派生简历固定 Case、岗位、基础内容和证据修订。
- M2 全仓串行 Gate：config 17、contracts 65、database 54、platform 451、web 114，共 701/701；lint 418 files、typecheck、build、audit 与 `git diff --check` 通过。
- Web main chunk 为 551.19 kB，相对 Phase 1A 510.96 kB 增长约 7.9%；`ResumeDocumentEditor` 为 29.23 kB 独立 lazy chunk。
- M2 浏览器主路径在合成数据和隔离 PostgreSQL 上通过 1280/320、200% 等效视口、刷新/深链、键盘、并发草稿和控制台检查。
- M3-1 已完成 owner-protected Case event 列表和显式投递命令；公共 Case 无损投影旧 decision，私有 Case 不进入旧岗位决定。
- M3-1 受影响包完整回归为 Contracts 66/66、Platform 452/452、Web 119/119；lint 421 files、typecheck、build、audit 与 `git diff --check` 通过。
- M3-1 浏览器已通过合成私有 JD → 投递二次确认 → Case 时间线、刷新、历史、320/640 CSS px 和控制台检查；`VITE_CAREER_OS_V2=false` 已恢复旧壳层并确认无 Career OS 新入口，M2 旗标关闭证据缺口已补齐。
- Web main chunk 为 551.87 kB；`CaseApplicationWorkspace` 为 8.43 kB 独立 lazy chunk，相对 Phase 1A 主包增长仍约 8.0%。
- M3-2 已完成 owner-protected Interview Session 列表/创建/详情/回答 API，以及 Case `面试`真实工作区；Session 固定 Case、岗位上下文、Case-derived Resume content revision 与 evidence revision，回答以不可变 Turn 追加。
- M3-2 全仓串行 Gate 为 Config 17、Contracts 69、Database 54、Platform 456、Web 122，共 718/718；lint 428 files、typecheck、build、audit 与 `git diff --check` 通过。
- M3-2 浏览器已通过合成私有 JD/Resume/evidence 的前置条件、显式创建、两题回答、完成、刷新、深链和历史恢复；1280 CSS px 无水平溢出且控制台无新增 warning/error。真实 320px、200%、键盘与焦点复验明确留在 M3-5，不得误写为已通过。
- Web main chunk 当前为 553.92 kB；`CaseInterviewWorkspace` 为 9.21 kB 独立 lazy chunk，相对 M3-1 主包只增加约 0.37%，相对 Phase 1A 仍低于 10%。
- M3-3 已完成 owner-protected Feedback/Debrief GET/PUT API；用户显式生成后，Feedback 与 draft Debrief 在同一事务固定同一已完成 Session、岗位上下文和 evidence revision。一个 Case 只允许一份活动复盘，打开/刷新不写入，另一 Session 不会覆盖。
- M3-3 确定性生成器只检查可观察的回答长度、结构信号和显式证据关联；不判断事实真伪、ATS 得分、匹配分或录用概率，也不创造经历。没有新增 migration、依赖、队列或 AI provider。
- M3-3 最终全仓串行 Gate 为 Config 17、Contracts 70、Database 54、Platform 458、Web 124，共 723/723；lint 430 files、typecheck、build、audit 与 `git diff --check` 通过。
- M3-3 浏览器已验证点击前数据库 Feedback/Debrief 为 0/0、点击后为 1/1、confirmation 为 0；刷新恢复同一只读草稿，第二 Session 只提示并返回原复盘。1280 CSS px 无水平溢出且控制台无 warning/error；320px、200%、键盘和焦点仍由 M3-5 总 Gate 复验。
- Web main chunk 当前为 554.99 kB；`CaseInterviewWorkspace` 为 15.56 kB 独立 lazy chunk，相对 M3-2 主包增加约 0.19%，相对 Phase 1A 仍低于 10%。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- 前后端进程与项目 PostgreSQL 容器当前均已停止，端口 3000、5173、5432 未监听；M3 数据测试继续使用随机命名隔离库，不以 Docker Desktop 进程状态冒充项目服务状态。

## 3. M3 串行执行清单

时间盒为 2–3 个有效开发日。同一时间只允许一个切片 `in_progress`；超过时间盒必须停下复盘，不得用扩建未来后端延长 M3。

1. **M3-0 复用矩阵与基线（已完成）**
   - 检查既有 legacy decisions、Case transitions/events、migration 028、Interview/Debrief contracts 和 Career OS 占位页。
   - 明确哪些字段已可表达当前用户任务，哪些只需最小 additive repair；先跑 focused tests。
   - 不实现没有当前界面消费者的未来服务。
2. **M3-1 显式投递记录（已完成）**
   - 从 Case 打开官方链接只产生本地交接动作，不改变阶段。
   - 用户明确确认后才记录已投递或其他可表示结果，并展示真实 Case 时间线。
   - 兼容旧 decision 只能走已有无损映射；不可表示时明确冲突，不静默丢失。
   - 验收证据：[M3-1 显式投递记录与 Case 时间线](../evidence/product/career-os-v2/m3-1-explicit-application-acceptance-2026-08-11.md)。
3. **M3-2 确定性文字面试（已完成）**
   - 建立最小 Interview Session/Turn API 与 Case 界面。
   - 会话固定 Case、岗位版本、Resume/证据修订；模板问题只来自已固定 JD 要求与已确认事实。
   - M3 不接真实 AI；异常时仍可用确定性模板完成。
   - 验收证据：[M3-2 确定性文字面试](../evidence/product/career-os-v2/m3-2-deterministic-interview-acceptance-2026-08-11.md)。
4. **M3-3 反馈与复盘（已完成）**
   - 保存结构化反馈、证据引用、表达问题、证据缺口和练习计划。
   - 回答不足时标记未知或待补，不推断用户没有提供的经历。
   - 验收证据：[M3-3 反馈与复盘](../evidence/product/career-os-v2/m3-3-feedback-debrief-acceptance-2026-08-11.md)。
5. **M3-4 用户确认回流（当前）**
   - 复用 migration 028 的 Debrief Confirmation revision guard；只有用户显式确认才能把 draft 标记为 confirmed。
   - 确认后只提供“去补证据”“去修改岗位简历”“暂不处理”三条受控路径；确认本身不得创建经历、修改证据或覆盖 Resume revision。
   - 若现有 confirmation 只能表达整份复盘确认而不能表达细粒度建议决定，先形成最小契约判断；不得未经证据扩建第三套事实或简历写入模型。
6. **M3-5 工程与浏览器 Gate**
   - 覆盖 owner、CSRF、幂等、固定版本、revision conflict、墓碑/删除、空/错误、旗标回退和包体。
   - 使用合成数据验证 1280/320、200% 等效视口、键盘、焦点、刷新/历史与控制台。
   - 形成 M3 独立验收证据，只作继续 M4、修改、回退或停止决定。

## 4. M3-4 当前代码入口

- `packages/contracts/src/interview-debrief-knowledge.ts`
- `packages/contracts/src/interview-debrief-knowledge.test.ts`
- `packages/database/src/migrations/028_interview_debrief_knowledge_expand.ts`
- `packages/database/src/types.ts`
- `apps/platform/src/interviews/debrief-service.ts`
- `apps/platform/src/interviews/routes.ts`
- `apps/platform/src/interviews/routes.integration.test.ts`
- `apps/platform/src/app.ts`
- `apps/web/src/api/career-os.ts`
- `apps/web/src/career-os/interview-view.ts`
- `apps/web/src/career-os/pages/CaseInterviewWorkspace.tsx`
- `apps/web/src/career-os/pages/CaseRequirementsWorkspace.tsx`
- `apps/web/src/career-os/pages/CaseResumeWorkspace.tsx`
- `apps/web/src/career-os/pages/CaseWorkspacePage.tsx`

先只读确认 migration 028 的 `debrief_confirmations` 唯一键、revision guard、projection trigger 与不可变约束，再核对 M3-3 当前 GET/PUT 的幂等和 owner 锁顺序。默认不新增 migration；只有“采用/拒绝/暂不处理”存在无法由当前模型安全表达且确属当前用户闭环的可复现缺口，才能提出最小 additive repair。当前切片只实现用户显式确认和返回 M1 Requirements/M2 Resume 编辑器的受控入口；不自动写入事实、证据、简历，不实现 Knowledge 或真实 AI。

## 5. 明确排除

- 不实现 Knowledge、跨 Case 智能生成、语音/录音/音视频面试、自动投递、站外通知或社区。
- 不访问真实招聘来源、真实 JD、真实 AI、真实简历、邮件、服务器或参与者数据。
- 不迁移或删除 `/resume`、`/recommendations`、`/insights` 等旧入口；兼容收口属于 M4。
- 不新增数据库、Redis、向量库、第二套队列、第二套认证、通用富文本编辑器或新的 AI SDK。
- 不读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地业务数据库、下载产物或本机截图。

## 6. 接手检查表

1. 按顺序读取 `AGENTS.md`、`README.md`、`docs/06-mvp-roadmap.md`、本文件和 `docs/plans/README.md`。
2. 检查分支、HEAD、`git status` 和最近提交；不得处理 `.claude/`。
3. 确认路线图与本交接都只指向 M3；归档计划和历史验收不得提供下一任务。
4. 确认本地服务与容器默认关闭；需要 PostgreSQL 时新建随机隔离测试库。
5. 从 M3-4 开始实现 Debrief 显式确认与受控回流；不得从旧 Phase 2B-4C 批量铺设 Knowledge、真实 AI、未来服务或第三套事实写入模型。
