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
> 文档提交后的精确 HEAD 以 `git log -1` 为准。
>
> 工作树预期只剩未跟踪 `.claude/`；不得读取、修改、暂存、覆盖或清理它。

动态事实源：[MVP 路线](../06-mvp-roadmap.md)

唯一活动计划：[Career OS 当前交付计划](../plans/career-os-current-delivery-plan.md)

后续 Gate：[Private Alpha 与上线就绪 Gate](../plans/private-alpha-readiness-gates.md)

计划索引：[docs/plans](../plans/README.md)

最近切片验收：[M3-1 显式投递记录与 Case 时间线](../evidence/product/career-os-v2/m3-1-explicit-application-acceptance-2026-08-11.md)

## 1. 当前唯一目标

当前唯一里程碑是 **M3 投递与持续改进**：

当前唯一执行切片是 **M3-2 确定性文字面试**；M3-1 已通过验收，下面的完整链路只用于说明 M3 终点，不得据此并行实现后续反馈或复盘。

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
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- 前后端服务、PostgreSQL 容器与 Docker Desktop 当前均已停止；M3 数据测试继续使用随机命名隔离库。

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
3. **M3-2 确定性文字面试（当前）**
   - 建立最小 Interview Session/Turn API 与 Case 界面。
   - 会话固定 Case、岗位版本、Resume/证据修订；模板问题只来自已固定 JD 要求与已确认事实。
   - M3 不接真实 AI；异常时仍可用确定性模板完成。
4. **M3-3 反馈与复盘**
   - 保存结构化反馈、证据引用、表达问题、证据缺口和练习计划。
   - 回答不足时标记未知或待补，不推断用户没有提供的经历。
5. **M3-4 用户确认回流**
   - 用户可选择采用、编辑后采用、拒绝或稍后处理。
   - 只有用户确认的内容才能生成新的证据或 Resume revision；不得直接覆盖原事实或原简历。
6. **M3-5 工程与浏览器 Gate**
   - 覆盖 owner、CSRF、幂等、固定版本、revision conflict、墓碑/删除、空/错误、旗标回退和包体。
   - 使用合成数据验证 1280/320、200% 等效视口、键盘、焦点、刷新/历史与控制台。
   - 形成 M3 独立验收证据，只作继续 M4、修改、回退或停止决定。

## 4. M3-2 当前代码入口

- `packages/contracts/src/interview-debrief-knowledge.ts`
- `packages/contracts/src/interview-debrief-knowledge.test.ts`
- `packages/database/src/migrations/028_interview_debrief_knowledge_expand.ts`
- `packages/database/src/types.ts`
- `apps/platform/src/applications/routes.ts`
- `apps/platform/src/applications/service.ts`
- `apps/platform/src/profile/routes.ts`
- `apps/platform/src/profile/revision-repository.ts`
- `apps/platform/src/resume-documents/routes.ts`
- `apps/platform/src/resume-documents/service.ts`
- `apps/platform/src/app.ts`
- `apps/web/src/api/career-os.ts`
- `apps/web/src/career-os/pages/CaseWorkspacePage.tsx`
- `apps/web/src/career-os/components/CaseTabs.tsx`

先只读确认 migration 028、现有 Case 固定输入、Profile evidence 和 Resume current revision 能否直接支撑 Session/Turn。默认不新增 migration；只有可复现约束缺口才能做最小 additive repair。当前切片只实现确定性模板 Session/Turn 及 Case `interview` 标签，不提前创建反馈、Debrief、Knowledge、真实 AI provider 或第二套事实写入模型。

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
5. 从 M3-2 开始实现固定 Case/岗位/Resume/证据修订的确定性 Session/Turn；不得从旧 Phase 2B-4C 批量铺设 Interview/Debrief/Knowledge 服务。
