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
> 文档提交后的精确 HEAD 以 `git log -1` 为准。
>
> 工作树预期只剩未跟踪 `.claude/`；不得读取、修改、暂存、覆盖或清理它。

动态事实源：[MVP 路线](../06-mvp-roadmap.md)

唯一活动计划：[Career OS 当前交付计划](../plans/career-os-current-delivery-plan.md)

后续 Gate：[Private Alpha 与上线就绪 Gate](../plans/private-alpha-readiness-gates.md)

计划索引：[docs/plans](../plans/README.md)

最近功能验收：[M2 专业简历闭环](../evidence/product/career-os-v2/m2-professional-resume-acceptance-2026-08-11.md)

## 1. 当前唯一目标

当前唯一里程碑是 **M3 投递与持续改进**：

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
- 本轮旗标关闭人工复验因浏览器控制后端重置未形成新 DOM 证据；M1 人工证据、环境自动化测试和 M2 结构检查仍有效，M3/M4 浏览器 Gate 须在控制器可用时重跑。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- 前后端服务、PostgreSQL 容器与 Docker Desktop 当前均已停止；M3 数据测试继续使用随机命名隔离库。

## 3. M3 串行执行清单

时间盒为 2–3 个有效开发日。同一时间只允许一个切片 `in_progress`；超过时间盒必须停下复盘，不得用扩建未来后端延长 M3。

1. **M3-0 复用矩阵与基线（已完成）**
   - 检查既有 legacy decisions、Case transitions/events、migration 028、Interview/Debrief contracts 和 Career OS 占位页。
   - 明确哪些字段已可表达当前用户任务，哪些只需最小 additive repair；先跑 focused tests。
   - 不实现没有当前界面消费者的未来服务。
2. **M3-1 显式投递记录（当前）**
   - 从 Case 打开官方链接只产生本地交接动作，不改变阶段。
   - 用户明确确认后才记录已投递或其他可表示结果，并展示真实 Case 时间线。
   - 兼容旧 decision 只能走已有无损映射；不可表示时明确冲突，不静默丢失。
3. **M3-2 确定性文字面试**
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

## 4. M3-0 首轮代码入口

- `packages/contracts/src/decisions.ts`
- `packages/contracts/src/application-cases.ts`
- `packages/contracts/src/interview-debrief-knowledge.ts`
- `packages/contracts/src/interview-debrief-knowledge.test.ts`
- `packages/database/src/migrations/028_interview_debrief_knowledge_expand.ts`
- `packages/database/src/forward-contract/023f_application_case_long_lived.ts`
- `apps/platform/src/decisions/routes.ts`
- `apps/platform/src/decisions/service.ts`
- `apps/platform/src/decisions/service.integration.test.ts`
- `apps/platform/src/applications/routes.ts`
- `apps/platform/src/applications/service.ts`
- `apps/platform/src/applications/routes.integration.test.ts`
- `apps/web/src/api/career-os.ts`
- `apps/web/src/career-os/pages/CaseWorkspacePage.tsx`
- `apps/web/src/career-os/pages/CareerOsPlaceholderPage.tsx`
- `apps/web/src/career-os/components/CaseTabs.tsx`
- `apps/web/src/career-os/components/CaseHeader.tsx`

只读检查这些入口及其直接测试和稳定规范。先证明现有模型无法表达 M3 当前界面行为，再允许最小契约或 migration 修正。

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
5. 从 M3-1 开始实现 Case 真源上的显式投递记录；不得直接从旧 Phase 2B-4C 开始铺服务。
