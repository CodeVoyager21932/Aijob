# 当前项目交接：Aijob Career OS M2 专业简历闭环

> 交接日期：2026-08-09
>
> 当前分支：codex/career-os-phase-1
>
> 功能实现基线：`aa9761b feat(web): add traceable resume suggestion decisions`
>
> M2 Review 平台基线：`8ff8720 feat(platform): add deterministic resume review workflow`
>
> 平台 M1 基线：`27dd433 feat(platform): complete m1 case workflow contracts`、`8750211 fix(platform): preserve case display and revision conflicts`
>
> 文档提交后的精确 HEAD 以 `git log -1` 为准。
>
> 工作树预期只剩未跟踪 `.claude/`；不得读取、修改、暂存、覆盖或清理它。

动态事实源：[MVP 路线](../06-mvp-roadmap.md)

唯一活动计划：[Career OS 当前交付计划](../plans/career-os-current-delivery-plan.md)

后续 Gate：[Private Alpha 与上线就绪 Gate](../plans/private-alpha-readiness-gates.md)

计划索引：[docs/plans](../plans/README.md)

最近功能验收：[M1 真实 Case 工作台](../evidence/product/career-os-v2/m1-real-case-workspace-acceptance-2026-08-09.md)

## 1. 当前唯一目标

当前唯一里程碑是 **M2 专业简历闭环**：

```text
基础简历资产
→ 解析与用户事实确认
→ 结构化编辑和章节调整
→ 基于真实 Case 创建岗位派生简历
→ 逐条接受、编辑后采用或拒绝建议
→ 切换两种中文模板
→ DOCX/浏览器打印交接
```

M2 先复用已经存在的解析、Profile 确认、Resume V2、tailoring 和 DOCX 能力，再补当前界面真正缺少的最小契约。不得从历史 Phase 2B 验收继续启动 Interview/Debrief/Knowledge，也不得在 M2 偷跑 M3 投递或 M4 旧页面迁移。

## 2. 已通过工程基线

- M1 已完成真实公共/私有 Case 创建和重开、Case 列表/详情、Requirements 三态/备注/证据/问题，以及 Case-derived Resume 显式创建和只读恢复。
- M2-1 至 M2-4 已建立真实 `/resumes` 基础资产入口、V1 只读转换、Resume V2 结构化修订编辑器，并把同一编辑器与可追溯 Review 决策接入 Case-derived Resume；岗位简历和建议均固定创建时的内容、岗位与证据修订，不会漂移到当前证据。
- 公共 Case 展示固定岗位版本；私有 JD 仅 owner 可见，不进入公共目录、推荐或供给统计。
- 正常 Career OS 会话不再把静态 Case/Requirement/Resume 当业务真源；`VITE_CAREER_OS_V2` 关闭后旧壳层与旧岗位页面保持不变。
- M1 全仓基线为 config 17、contracts 62、database 54、platform 443、web 100，共 676/676；lint 402、typecheck、build、audit 与浏览器 Gate 通过。
- Web main chunk 为 548.24 kB，相对 Phase 1A 510.96 kB 增长约 7.3%；Requirements 和 Resume 仍是独立 lazy chunk。既有 main chunk 大于 500 kB warning 未消除。
- M2-4 build 的 Web main chunk 为 550.40 kB，相对 Phase 1A 增长约 7.7%；Review 随 `ResumeDocumentEditor` lazy chunk 加载，该 chunk 为 27.01 kB，岗位列表和 Case 列表不加载它。
- M2-4 focused Gate：contracts 15/15、platform unit 5/5、Resume Document PostgreSQL integration 3/3、web 11/11；contracts/database/platform/web typecheck、Web lint、build 与 `git diff --check` 通过。隔离 PostgreSQL 使用随机库，结束后已删除。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。

## 3. M2 串行执行清单

时间盒为 2–3 个有效开发日。同一时间只允许一个切片 `in_progress`；M2-0 至 M2-4 已完成，当前只执行 M2-5。

1. **M2-0 基线与复用矩阵（已完成）**：复用结论、契约缺口、删除影响与 focused 基线见 [M2 简历集成边界](../plans/career-os-m2-resume-integration-boundary-2026-08-09.md)；M2-0 本身没有修改业务行为。其“无需 migration”初始假设已由同一记录中的 M2-4 权限冲突修正，不得继续沿用。
2. **M2-1 基础简历资产入口（已完成）**：`/resumes` 已读取真实 base Resume Document、只读 V1 来源和迁移归属；用户显式初始化 V2，中断后可继续，旧确认页已对齐长期保留政策。实现提交为 `6ebea2d`。
3. **M2-2 结构化编辑器（已完成）**：共享编辑器已支持 section/block 正文、增删、证据关联和可访问的上移/下移；正文与布局分别生成不可变修订，并发冲突保留本地草稿。实现提交为 `5458d6c`。
4. **M2-3 岗位派生编辑器（已完成）**：Case `resume` 已复用真实 Resume V2 编辑器，固定 Case、岗位版本、基础修订和证据修订；刷新、深链与 revision conflict 不静默覆盖。实现提交为 `8af6665`。
5. **M2-4 建议决策（已完成）**：web-api 幂等创建固定版本的 pending Review，既有 PostgreSQL owner task queue 交给 match-worker 生成确定性模板 findings/suggestions；逐条接受或编辑形成新内容修订，拒绝只记不可变决定，冲突不覆盖草稿。migration 031 只扩展既有任务类型约束，没有新表、队列或依赖。实现提交为 `8ff8720`、`aa9761b`。
6. **M2-5 模板与导出（当前）**：统一中文经典单栏、中文紧凑技术、A4 浏览器预览、现有 DOCX DTO 和打印；换模板不得修改正文或 evidence ID。
7. **M2-6 工程与浏览器 Gate**：覆盖 owner、CSRF、幂等、并发、删除、空/错误、1280/320、200% 等效视口、键盘、包体、旗标回退和全仓检查，形成 M2 独立验收证据。

任何切片超过其预计边界时，先证明缺口属于当前用户任务，再允许最小 additive repair；不得用扩建未来后端延长 M2。

## 4. M2-0 首轮代码入口

- `apps/web/src/pages/ResumePage.tsx`
- `apps/web/src/pages/ResumeConfirmPage.tsx`
- `apps/web/src/pages/ResumeTailoringPage.tsx`
- `apps/web/src/career-os/pages/CaseResumeWorkspace.tsx`
- `apps/web/src/career-os/resume-suggestion-state.ts`
- `apps/platform/src/resume/routes.ts`
- `apps/platform/src/resume/analysis-service.ts`
- `apps/platform/src/resume/export-docx.ts`
- `apps/platform/src/profile/routes.ts`
- `apps/platform/src/tailoring/routes.ts`
- `apps/platform/src/tailoring/service.ts`
- `apps/platform/src/resume-documents/service.ts`
- `apps/platform/src/resume-documents/revision-service.ts`
- `apps/platform/src/resume-documents/review-service.ts`
- `apps/web/src/career-os/components/ResumeDocumentEditor.tsx`
- `apps/web/src/career-os/components/ResumeReviewPanel.tsx`
- `apps/platform/src/resume/export-docx.ts`
- `packages/contracts/src/profile.ts`
- `packages/contracts/src/tailoring.ts`
- `packages/contracts/src/resume-documents.ts`

M2-0 只读检查这些入口及其直接测试和稳定规范。只有可复现地证明既有契约无法支持 M2 用户任务时，才允许进入契约修改；不得读取真实简历或本地业务数据。

## 5. M2 退出 Gate

- `/resumes` 与 Case `resume` 使用同一 Resume Document/Revision 真源，不存在第二套写入模型。
- V1 保持只读兼容，第一次编辑生成 V2；section/block ID、正文、布局和 evidence 引用在修订间可追溯。
- 章节增删/排序、正文编辑、建议三决策、两模板、A4 预览、DOCX 和打印完成一条合成简历闭环。
- AI 不可用时仍能编辑、模板建议和导出；模拟 provider 的超时、限流、无效 Schema 与无效证据引用 fail closed。
- owner、CSRF、幂等、revision conflict、墓碑与删除无复活通过；跨 owner 继续不可枚举 404。
- 1280/320、200% 等效视口、键盘、焦点、刷新/历史、包体与旗标回退通过；无新增控制台 warning/error。
- `git diff --check`、lint、typecheck、随机隔离 PostgreSQL 串行全仓、build 和 audit 均有明确退出码。

通过后只允许“继续 M3、修改、回退、停止”之一。

## 6. 明确排除

- 不实现 Interview、Debrief、Knowledge、投递状态界面；除 M2-4 已批准并复用现有队列的 `resume_review` 外，不增加其他后台任务类型。
- 不恢复真实来源扩容，不访问真实 JD、真实 AI、真实简历、邮件、服务器或参与者数据。
- 不迁移或删除 `/resume`、`/recommendations`、`/insights` 等旧入口；兼容收口属于 M4。
- 不新增数据库、Redis、队列、向量库、第二套认证、通用富文本编辑器或服务器 PDF 服务。
- 不读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机截图。
