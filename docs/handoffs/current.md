# 当前项目交接：Aijob Career OS M1 真实 Case 工作台

> 交接日期：2026-08-09
>
> 当前分支：codex/career-os-phase-1
>
> 功能实现基线：7c68bb8 feat(platform): add resume content and layout revision API
>
> 本轮先独立提交计划体系清洗；提交后的精确 HEAD 以 git log -1 为准。
>
> 工作树预期只剩未跟踪 .claude/；不得读取、修改、暂存、覆盖或清理它。

动态事实源：[MVP 路线](../06-mvp-roadmap.md)

唯一活动计划：[Career OS 当前交付计划](../plans/career-os-current-delivery-plan.md)

后续 Gate：[Private Alpha 与上线就绪 Gate](../plans/private-alpha-readiness-gates.md)

计划索引：[docs/plans](../plans/README.md)

最近功能验收：[Phase 2B-4B Resume Content/Layout Revision API](../evidence/product/career-os-v2/phase-2b4b-resume-content-layout-revision-api-acceptance-2026-08-09.md)

## 1. 当前唯一目标

当前唯一里程碑是 **M1 真实 Case 工作台**：

~~~text
离线岗位或 owner 私有 JD
→ 创建/重开 Case
→ 刷新后恢复
→ 读取并修改 JD 要求
→ 打开对应 Case 派生简历
~~~

不继续旧计划中的 Phase 2B-4C Interview/Debrief/Knowledge Service Boundary。migration 028 和既有 contracts 保留，但没有当前界面调用前不得继续扩建其服务、任务或 API。

## 2. 已通过工程基线

- Phase 1A/1B 已完成统一壳层、Case 路由、JD 能力和定制简历静态交互。
- migrations 025–030 已注册长期 owner、公共/私有 Case、Requirement、Resume/Review、Interview/Debrief/Knowledge、strict Case event v2 与 Resume mutation receipts。
- Case list/create/detail、阶段/岗位版本、Requirement 状态/证据/问题、Resume Document 和 content/layout revision API 已完成。
- 最近全仓基线为 config 17、contracts 60、database 54、platform 442、web 91，共 664/664；lint 390、typecheck、build 与 audit 通过。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。

## 3. M1 执行清单

按顺序执行，单次只允许一个条目进入 in_progress：

1. 冻结前端所需的现有响应映射和查询键；不得为了方便创建第二套宽松 DTO。
2. 将 ApplicationsPage 的静态列表替换为 Case list，并提供从离线岗位或私有 JD 幂等创建/重开 Case 的入口。
3. 将 CaseWorkspacePage 改为按 URL caseId 加载 Case 详情，恢复公共/私有 JobContext、阶段和固定版本。
4. 将 CaseRequirementsWorkspace 接入 requirements read/write，覆盖三态、备注、证据链接、未知问题和 revision conflict。
5. 将 CaseResumeWorkspace 接入 Case-derived Resume Document 和当前 content/layout 读取；M1 不实现正文编辑。
6. 补齐 loading、empty、404、409、session expired、retry 与旗标关闭回退。
7. 运行针对性 Web/Platform 测试和隔离 PostgreSQL 集成测试。
8. 完成 1280/320、键盘、URL 前进/后退、检查器焦点和控制台验收。
9. 运行里程碑全仓 Gate，形成独立验收证据并更新路线图/交接。

## 4. 首轮代码入口

- apps/web/src/career-os/pages/ApplicationsPage.tsx
- apps/web/src/career-os/pages/CaseWorkspacePage.tsx
- apps/web/src/career-os/pages/CaseRequirementsWorkspace.tsx
- apps/web/src/career-os/pages/CaseResumeWorkspace.tsx
- apps/web/src/api/
- apps/platform/src/applications/routes.ts
- apps/platform/src/resume-documents/routes.ts
- packages/contracts/src/application-cases.ts
- packages/contracts/src/resume-documents.ts

优先复用现有接口；只有可复现地证明当前 API 无法支持 M1 用户任务时，才允许最小契约或 additive migration 修复。

## 5. M1 退出 Gate

- Case 能创建、幂等重开、列表和详情恢复；公共/私有 JobContext 都 fail closed。
- 刷新、深链、前进/后退和非法 Case 不回退到静态业务数据。
- Requirement 三态、备注、证据和问题写入具有 owner、CSRF、幂等/并发和错误回执。
- Case 派生 Resume 能幂等发现/创建并读取当前内容和布局；不在 M1 伪造编辑持久化。
- 1280/320、键盘、焦点和旗标回退通过；无新增控制台 warning/error。
- 相关测试、git diff --check、lint、typecheck、隔离 PostgreSQL 串行全仓、build 和 audit 均有明确退出码。

通过后只允许“继续 M2、修改、回退、停止”之一。

## 6. 明确排除

- 不实现 Interview、Debrief、Knowledge、真实 AI 或新的任务类型。
- 不恢复真实来源扩容，不访问真实 JD、真实简历、邮件、服务器或参与者数据。
- 不重做 Resume 编辑器、tailoring、DOCX 或旧页面迁移。
- 不读取、暂存或提交 .claude/、.data/、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机快照。
