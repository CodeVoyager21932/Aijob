# M4-0 旧入口与一岗闭环差异审计

> 【历史归档】M4-0 及其后续 M4 切片均已完成。本文只保存当时的差距证据，不提供当前任务。

- 日期：2026-08-12
- 状态：**已完成，只读审计**
- 历史决定：**修改后继续 M4-1（已完成）**
- 当前事实源：[MVP 路线与当前决策面板](../../06-mvp-roadmap.md)、[当前交付计划](../career-os-current-delivery-plan.md)
- 稳定边界：[ADR-0030](../../decisions/0030-adopt-job-centric-career-os-and-interaction-first-integration.md)、[ADR-0031](../../decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md)

本审计只读取路由、前端调用、Platform 服务、迁移和既有测试，没有启动前后端、数据库或浏览器，没有修改业务行为，也没有访问真实招聘来源、真实 AI、真实简历、邮件或服务器。

## 1. 结论

M1–M3 建立的 Case、Resume V2、Review、投递、Interview 和 Debrief 不是无用重建；它们已经形成新的岗位闭环真源。M4 的问题不是“新系统方向错误”，而是旧入口仍与新闭环同时可写，且数据控制页面没有跟上 ADR-0031。

不能把旧入口统一重定向：

- `/resume` 与 `/resume/confirm/:analysisId` 仍是当前唯一的 PDF/DOCX/文本解析、事实确认和证据确认入口；`/resumes` 明确依赖其 V1 只读来源完成首次 V2 初始化。直接移除会切断新 OS 的基础简历入口。
- `/resume-tailorings/:runId` 可能包含用户已经接受、拒绝或编辑过的历史文本，不能因无法唯一关联 Case 而删除；V2 开启时应保留只读历史。
- `/recommendations` 与 `/insights` 没有形成 Case 或 Resume V2 的用户真源；V2 开启后可停止新增旧运行，但历史数据库行继续保留并由全部删除覆盖。

必须收口的冲突：

1. `/jobs/:jobId` 在 V2 开启时仍能写旧 Match、Job Decision、Resume Tailoring 和 official-link-opened；其中旧 Decision 会事务内同步已有 Case，成为 Case 工作区之外的第二个状态写入口。
2. `/resume-tailorings/:runId` 在 V2 开启时仍能修改旧 segment decision 并创建旧导出，与 Resume V2 Review/Content Revision 重复。
3. `/recommendations?start=1` 可在资料就绪后自动创建 Recommendation Run；`/insights` 仍可创建 Job Insight Run。它们虽然不覆盖 Case，但违反 ADR-0031 对旧路由“兼容入口或只读历史”的限制。
4. `/settings/data` 与 `/data-control` 复用同一旧组件。服务端全部删除已经覆盖 M1–M3 新表，但页面只统计旧 profile/decision，仍显示“最长 30 天”，也没有单项删除与 Case 选择性级联。
5. 当前本地和邀请匿名 owner 的运行事实仍是 `anonymous_ttl` 30 天；`account_managed` 才是长期保存。部分新页面直接写“默认长期保留”，旧数据页又写“最长 30 天”，两者都没有向用户说明当前实际模式。
6. 简历确认页依次写 facts、preferences、evidence 三个接口，不在同一事务；中间失败可能留下部分成功写入，但界面只显示整次失败。
7. 新壳层仍展示 `M1/M2/M3/Phase 1A/PoC` 等开发标签；`/interviews` 仍声称文字面试 PoC 未通过，`/knowledge` 作为未实现入口出现在主导航。

因此 M4-0 的决定不是直接按原时间盒继续，而是：保持 M4 产品目标不变，先隔离旧写入口，再接通已经设计好的删除/脱离契约和真实保留模式。不得用兼容跳转掩盖数据生命周期缺口。

## 2. 路由与真源处置矩阵

| 路由 / 用户任务 | 当前读写与事实真源 | 冲突或缺口 | V2 开启后的固定处置 | V2 关闭 |
|---|---|---|---|---|
| `/jobs`：发现与筛选岗位 | 只读 `catalog` 公共/本地准入投影 | 无 Case 写入；仍是岗位发现真源 | **保留当前新入口** | 保持旧页面 |
| `/jobs/:jobId`：看岗位并决定是否进入求职项目 | 读 Job/Profile；可写 Match、Job Decision、Tailoring、official-link-opened 和 ApplicationCase | 旧 Decision 可同步 Case；旧 Tailoring 与 Resume V2 Review 重复 | **保留岗位事实、外链和幂等创建/重开 Case；停止旧 Match/Decision/Tailoring/外链跟踪写入，引导到 Case** | 全部旧能力保持不变 |
| `/resume`：解析新简历或调整已确认的证据选择 | 读 V1 `profile.resume_document_revisions` 与 evidence；写 Resume Analysis 或新 evidence revision | 文案与按钮仍指向旧推荐流程；但该入口本身不可删除 | **保留为 `/resumes` 的受控导入/更新子流程；所有完成出口回到 `/resumes`** | 保持旧推荐出口 |
| `/resume/confirm/:analysisId`：确认事实、偏好、证据 | 读 analysis/profile；顺序写 facts、preferences、evidence | 三次写入非原子；部分完成时没有准确恢复说明；若结果已清理仍固定链接推荐 | **保留受控确认入口；M4-1 修复出口，M4-2B 补原子确认或明确可恢复状态** | 保持旧推荐出口 |
| `/resumes`、`/resumes/:documentId`：基础简历资产、结构/布局/Review/导出 | `profile.resume_documents`、不可变 content/layout revision、Resume Review | 无旧真源竞争；依赖 `/resume` 提供首次 V1 来源 | **保留为基础简历唯一真源** | 路由不存在，回到旧壳层 404 |
| `/applications/:caseId/resume`：岗位派生简历 | Case-derived Resume Document、固定 Case/岗位/基础简历/证据修订 | 与旧 Tailoring 页面功能重复 | **保留为岗位简历唯一可写真源** | 路由不存在 |
| `/recommendations`：按确认资料生成跨岗位推荐 | 读 Catalog/Profile，写 Recommendation/Match Runs；运行 ID 主要存浏览器 journey state | 不属于 Case；直接或 `start=1` 可继续生成旧运行 | **改为不发请求的兼容说明，进入 `/jobs` 或 `/applications`；不删除历史行** | 保持完整旧推荐流程 |
| `/insights`：跨岗位要求聚合 | 读 evidence，写 Job Insight Run；结果只保留在当前组件状态 | 没有 Case 上下文，刷新不恢复；与逐 Case Requirements 容易混淆 | **改为不发请求的兼容说明，进入岗位目录或具体 Case Requirements** | 保持旧洞察流程 |
| `/resume-tailorings/:runId`：读取并决定旧逐段建议 | 读写旧 Tailoring Segment，创建旧 Resume Export | 用户编辑文本不可丢；但继续写会产生第二套简历优化真源 | **只读历史：允许查看/复制和读取仍有效的既有下载，不允许新决定或新导出；引导到 Case Resume** | 保持完整旧优化流程 |
| `/applications`、`/applications/:caseId/requirements` | ApplicationCase、固定 JobContext、Requirement state/evidence/question | 无旧数据回退；正常路径已是真实 API | **保留当前新入口** | 路由不存在 |
| `/applications/:caseId/application` | Case events 与显式 `manual_application_recorded` | 只支持确认已投递；完整阶段/结果操作尚无 Web 入口 | **保留为投递与时间线真源；旧 Decision 不再补充写入** | 路由不存在 |
| `/applications/:caseId/interview`、`debrief` | 固定 Case/岗位/Resume/evidence 的 Session、Turn、Feedback、Debrief 与逐项决定 | 单项删除尚无 API/UI；跨 Case `/interviews` 仍是过期占位 | **保留为当前面试与复盘真源；跨 Case 页只作明确导航，不伪装未通过 PoC** | 路由不存在 |
| `/settings/data` | 复用旧 DataControl；全部删除调用 `DELETE /v1/profile` | 摘要漏掉 Case/Resume V2/Interview/Debrief；保留期文案不按实际 owner 模式；只有全部删除 | **成为数据控制唯一入口，展示真实模式并接单项删除/选择性级联** | 路由不存在 |
| `/data-control`、`/data-control/deletion` | 与新设置页共用旧组件/删除回执 | V2 URL 和面包屑回到旧信息架构 | **兼容转到 `/settings/data`、`/settings/data/deletion`** | 保持旧入口 |
| `/today`、`/interviews`、`/knowledge` | Today 读真实 Case；后两者为 Phase 1A 占位 | 用户可见开发标签；Knowledge 未实现却进入主导航 | **清理开发标签；Interview 明确进入 Case；Knowledge 在实现前不进入主导航** | 不存在 |

## 3. 写入调用图

### 3.1 V2 应保留的写入

```text
/resume + /resume/confirm
  → resume analysis
  → confirmed facts/preferences/evidence（共享输入真源）
  → /resumes 初始化 V2

/jobs/:jobId
  → ApplicationCase create/reopen only

/applications/:caseId/*
  → Requirement / Question / Case event
  → Case-derived Resume / Review / Content / Layout
  → Manual application / Interview / Debrief
```

### 3.2 V2 必须停止的新旧并行写入

```text
/jobs/:jobId
  -X→ legacy Match Run
  -X→ legacy Job Decision → Case 同步
  -X→ legacy Resume Tailoring
  -X→ legacy official-link-opened

/recommendations
  -X→ Recommendation Run / Match Run

/insights
  -X→ Job Insight Run

/resume-tailorings/:runId
  -X→ Segment Decision / new Resume Export
```

数据库行不因停止新写入而删除；旗标关闭后旧 ProductShell 仍可恢复旧流程。G4 前不做 contract migration。

## 4. 删除、保留与异常差异

| 项目 | 当前可复核事实 | M4 处置 |
|---|---|---|
| 全部删除 | `DELETE /v1/profile` 先撤销 owner epoch，再异步物理删除旧 Match/Tailoring/Decision、Resume Review、Interview/Debrief/Knowledge、Resume V2、Case/私有 JD、Profile 与任务；删除回执可查询 | 保留服务；新设置页准确展示范围并使用新 URL |
| 单项删除 | Case、Resume Document、Interview Session、Debrief 均已有 `deleted_at`；Resume/Interview/Debrief 已有 `detached_from_case_id` 与数据库 guard，但没有公开 Service/API/UI | M4-2A 接最小 owner-protected 删除命令，不新增迁移；Case 删除必须显式选择派生资产“删除或脱离” |
| 当前保留模式 | `createAnonymousSession` 固定 30 天 `anonymous_ttl`；只有已绑定活动 Account 的 `account_managed` owner 才无自动到期 | M4-2B 让会话/数据摘要返回实际 retention mode/expiry；匿名本地测试诚实显示兼容期限，不冒充长期账号 |
| 目标生命周期 | ADR-0031 要求职业资产默认长期、用户主动单项或全部删除；原文件/解析临时物最长 24 小时 | 邮箱账号仍由 Private Alpha Gate 实现；M4 不实现邮箱，但不得显示与当前 owner 不符的承诺 |
| 404 | Case、Resume V2、Interview 服务按 owner 不可枚举 404；新详情页已有明确状态 | 兼容页不读取旧资源；旧 Tailoring 只读页保留真实 404 |
| 409 | Requirements、Resume V2、Application、Interview/Debrief 已有 revision conflict 重读或草稿保留 | 保留；新增删除也要求 expected revision，不自动重放 |
| 简历确认部分写 | facts → preferences → evidence 顺序请求，任一步失败不回滚前一步 | M4-2B 改为单事务确认命令，或在无法完成时显示逐项持久化结果并安全续传；优先单事务 |
| 会话失效 | AlphaAccessGate 只在首次挂载检查；运行中 API 401/403/`OWNER_EPOCH_STALE` 作为普通页面错误显示 | M4-2B 增加集中会话失效状态，保留未提交草稿并提示重新建立会话，不无限自动重试 |

## 5. M4 修正后的串行切片

M4-0 发现的缺口都属于既有产品边界，不是未来功能扩建。修正后剩余工作按以下顺序执行：

1. **M4-1 兼容入口与写边界（当前，0.5 日）**
   - V2 下停止 JobDetail 的旧 Match/Decision/Tailoring/外链跟踪写入，只保留岗位事实、外链与 Case 创建/重开。
   - `/recommendations`、`/insights` 使用零请求兼容说明；旧 Tailoring 切只读；旧数据 URL 转新设置 URL。
   - `/resume` 与确认页保留，但所有 V2 完成/异常出口回到 `/resumes`；旗标关闭行为不变。
   - 增加静态/组件测试证明 V2 正常路由不再引用旧 mutation，且不会删除历史内容。
2. **M4-2A 单项删除与选择性级联（1–1.5 日）**
   - 复用现有 `deleted_at`、detach guard、owner epoch 和 PostgreSQL 事务，增加 Case、Resume、Interview、Debrief 的最小删除契约/服务/UI。
   - Case 删除对派生 Resume、Interview、Debrief 分别要求用户选择“同时删除”或“保留为脱离资产”；私有 JD 随唯一 Case 删除。
   - 覆盖跨 owner 404、stale revision、幂等重放、迟到任务拒绝、删除后刷新/重登不复活。
3. **M4-2B 数据真相与错误恢复（0.5–0.75 日）**
   - `/settings/data` 展示 Case、Resume V2、Interview/Debrief 与当前 owner 的真实保留模式；去除固定 30 天/固定长期的互相矛盾文案。
   - 补简历确认原子提交或明确恢复；集中处理会话过期；清理用户可见的 M1/M2/M3/Phase/PoC 标签和未实现主导航。
4. **M4-3 一岗本地测试候选（0.5 日）**
   - 使用合成 Case 贯通要求、岗位简历、Review、DOCX/打印、外链、显式投递、模板面试、复盘回流、选择性删除和全部删除。
5. **M4-4 工程与浏览器 Gate（0.25–0.5 日）**
   - 全仓、1280/320、200% 等效、键盘/焦点、刷新/历史、旗标回退、控制台、包体、删除恢复和独立证据。

修正后 M4 剩余工作量为约 2.75–3.25 个有效开发日。该调整没有新增数据库、认证、AI、来源或未来 OS 模块；它把原本被低估的删除与真实性要求显式化，减少后期返工。

## 6. M4-1 精确代码入口与退出条件

代码入口：

- `apps/web/src/App.tsx`
- `apps/web/src/pages/JobDetailPage.tsx`
- `apps/web/src/pages/ResumePage.tsx`
- `apps/web/src/pages/ResumeConfirmPage.tsx`
- `apps/web/src/pages/RecommendationsPage.tsx`
- `apps/web/src/pages/JobInsightsPage.tsx`
- `apps/web/src/pages/ResumeTailoringPage.tsx`
- `apps/web/src/pages/DataControlPage.tsx`
- `apps/web/src/pages/DeletionStatusPage.tsx`
- `apps/web/src/career-os/navigation.ts`
- `apps/web/src/career-os/pages/CareerOsPlaceholderPage.tsx`
- `apps/web/src/career-os/runtime-boundary.test.ts`
- 相关 page/environment/navigation tests。

M4-1 退出条件：

1. `VITE_CAREER_OS_V2=true` 时，旧 Recommendation/Insight 不执行读写请求，旧 Tailoring 不产生写入，JobDetail 不再调用旧 Match/Decision/Tailoring/official-link-opened mutation。
2. `/resume` 与确认仍能建立共享事实和证据，并回到 `/resumes`；没有循环重定向或丢失 V1 来源。
3. 旧 Tailoring 的用户编辑历史仍可 owner-scoped 只读访问；无法唯一关联的内容没有被伪造 Case 归属。
4. `/data-control*` 无损进入 `/settings/data*`；旗标关闭时旧路由、ProductShell 和旧写入全部保持原状。
5. focused tests、lint、typecheck、build 和 `git diff --check` 通过，再决定继续 M4-2A、修改、回退或停止。

## 7. 明确排除

- 不在 M4-1 实现邮箱账号、真实长期登录、真实 AI、真实来源、服务器或 Knowledge。
- 不删除旧数据库表、旧运行、旧决策或旧路由代码；G4 前不做 contract migration。
- 不把 Recommendation/Insight/Tailoring 历史猜测绑定到 Case。
- 不用“页面隐藏”冒充单项删除已经完成；删除只能由 M4-2A 的真实 owner-protected 服务与测试证明。
- 不读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、真实简历、本地业务数据库、下载产物或截图。
