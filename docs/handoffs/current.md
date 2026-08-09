# 当前项目交接：Aijob 求职 OS 2.0 Phase 2B-4C

> 交接日期：2026-08-09
>
> 当前分支：`codex/career-os-phase-1`
>
> `Phase 2B-4B Resume Content/Layout Revision API` 的实现、migration 030、验收证据和本交接随同一个独立功能提交收口；提交后的精确基线以 `git log -1` 为准，实现前基线为 `c0cc1f6 feat(platform): add resume document aggregate API`。
>
> 提交后工作树预期只剩未跟踪 `.claude/`；不得读取、提交、覆盖或清理它。

动态事实源：[MVP 路线](../06-mvp-roadmap.md)

稳定主计划：[Private Alpha 严格开发总计划](../plans/career-os-v2-upgrade-plan-2026-08-04.md)

架构决定：[ADR-0031](../decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md)

Phase 2 API 设计：[领域契约与迁移设计](../plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md)

最近验收：[Phase 2B-4B Resume Content/Layout Revision API](../evidence/product/career-os-v2/phase-2b4b-resume-content-layout-revision-api-acceptance-2026-08-09.md)

## 1. 当前唯一目标

当前唯一工程阶段是 **Phase 2B-4C Interview/Debrief/Knowledge Service Boundary**：只把 migration 028 已冻结的三个领域聚合接入现有 owner-protected 模块化单体，并建立后续离线 PoC 所需的严格接口与 PostgreSQL 任务引用；不实现完整生成器、前端或真实 AI。

```text
Phase 2B-1 Case list/create/detail（已通过）
-> Phase 2B-2 Transition/Job Version（已通过）
-> Phase 2B-3 Requirement Service/API（已通过）
-> Phase 2B-4A Resume Document Aggregate API（已通过）
-> Phase 2B-4B Resume Content/Layout Revision API（已通过）
-> Phase 2B-4C Interview/Debrief/Knowledge Service Boundary（当前唯一目标）
-> 通过后再决定 Phase 3A、修改、回退或停止
```

为遵守每个实现切片 0.5–2 人日和单一 `in_progress`，2B-4C 内部固定顺序如下；开始时只允许 `2B-4C-1` 进入实现：

1. `2B-4C-1 Interview Session/Turn Boundary`：先冻结 session 列表/幂等创建/详情和追加式 turn 的 owner、固定输入与状态契约。
2. `2B-4C-2 Feedback/Debrief Boundary`：在 session 基线通过后才开放 feedback 只读结果、debrief 读取/修订与用户确认。
3. `2B-4C-3 Knowledge Clip Boundary`：最后实现引用式 clip、Case 关联和单项删除，不抓正文。
4. `2B-4C-4 Task/Deletion Closure`：只注册确定性离线任务引用、worker allowlist/payload、迟到任务和 owner 删除回归；不得调用真实 provider。

如果现有 migration 028、contracts 与任务表无法无损表达上述行为，必须先复现并记录“修改”，再做 additive forward repair；禁止在服务中用内存幂等、宽 JSON 或临时状态绕过 Schema。

## 2. 已通过基线

- migrations 025–030 已注册长期 owner、public/private Case、Requirement、Resume/Review、Interview/Debrief/Knowledge、strict Case event v2 与 Resume mutation receipts。
- Phase 2B-1/2/3 已完成 Case、状态/版本、固定要求、证据链接和问题服务。
- Phase 2B-4A/4B 已完成 Resume 聚合、V1 转换 GET 零写入、初始化已有空 base、不可变正文/布局历史、持久幂等回执、稳定 ID、owner/并发/删除和旧 V1 兼容。
- 最新隔离 PostgreSQL 串行全仓为 config 17、contracts 60、database 54、platform 442、web 91，共 664/664；lint 390、typecheck、build 与 audit 通过。audit 仍保留 1 个有明确移除条件的 dev-only high ignored，不能宣称已修复。
- 本轮没有前端变化；Phase 1B 的 1920/1280/768/320、200% 缩放、键盘和旗标回退继续作为 UI 基线。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。Phase 4 前不恢复真实供给扩容。

## 3. Phase 2B-4C 固定边界

### 固定输入与事实边界

- Interview Session 必须固定同 owner/epoch 的 Case、创建时 JobContext、requirement context、已确认证据 revision，以及可选 strict Resume content revision；后续 Case、岗位、证据或简历变化不级联改写旧 Session。
- template 模式不携带 provider/model；controlled AI 仅保留 contracts 与任务边界，本阶段不发出真实调用。
- 问题、回答、追问和反馈只能引用同一 Session 已固定的要求与已确认事实；不得生成新经历、隐含技能或未确认资格结论。
- Debrief 只保存表达问题、证据缺口和练习计划；只有用户显式确认后，才能在未来切片转换为经历表达。
- Knowledge Clip 只保存 HTTPS URL、标题、短摘要、适用场景、核验时间和用户笔记；不抓全文、不做社区、不跨 owner 分享私有 JD 或职业资产。

### 接口与写入纪律

- 全部接口继续使用 owner session、Origin/CSRF、Problem Details、`no-store`、不可枚举 404、`Idempotency-Key` 与 `expectedRevision`；不创建第二套认证、数据库、队列或 AI SDK。
- Session/Turn/Feedback 只允许追加或受控状态推进；不可变问题、回答和反馈不得原地覆盖。
- Debrief 和 Knowledge 的更新必须保留修订/并发语义；单项删除、Case 选择性脱离、owner 全量删除和恢复不复活必须有 PostgreSQL 证据。
- 任务 payload 只允许 `caseId/sessionId/debriefId/runId/requestHash` 等 ID，不得保存 JD、简历、回答、反馈、提示词、模型输入或联系方式正文。
- 任务继续复用 `task_queue.tasks`、租约、心跳、fencing token、有限重试和 owner epoch；worker 完成写入前必须重新校验 owner、租约和固定输入。

### 明确排除

- 不实现问题生成器、反馈生成器、复盘生成器或推荐算法。
- 不调用真实 AI，不接国产模型、不接中转站，不保存 provider 正文。
- 不做语音、录音、视频、OCR、向量库、自动投递、浏览器代填或站外通知。
- 不实现前端路由、页面、视觉或浏览器 PoC；这些属于 Phase 3。
- 不访问真实招聘来源、真实 JD、真实简历、邮件、服务器或参与者数据。

## 4. 首轮代码入口

按顺序检查：

1. `packages/contracts/src/interview-debrief-knowledge.ts` 与测试：复核 strict DTO、public/private JobContext、固定证据、状态、确认和 Knowledge 最小字段。
2. `packages/database/src/migrations/028_interview_debrief_knowledge_expand.ts` 与 `packages/database/src/types.ts`：逐表核对唯一键、复合 FK、不可变 trigger、状态/时间、owner epoch、删除和角色权限。
3. `docs/plans/career-os-phase-2-domain-contract-and-migration-design-2026-08-05.md` 7–11 节：把稳定设计映射为 2B-4C 子切片，不临时增加第二套路径。
4. `apps/platform/src/applications/` 与 `apps/platform/src/resume-documents/`：复用 owner、Case/JobContext 固定、幂等、并发、错误映射和 `no-store` 实现习惯。
5. `apps/platform/src/workers/owner-task-worker.ts`、`owner-task-lease.ts` 及测试：检查当前 allowlist/payload 是否支持离线任务引用；未支持时先记录可复现 Schema/worker 冲突。
6. `apps/platform/src/profile/deletion-service.ts`、retention 与 forward-contract 集成测试：验证单项删除、选择性脱离、owner 删除、墓碑和迟到任务。

## 5. 退出 Gate

至少证明：

- Interview/Debrief/Knowledge 三域均有 strict owner-protected 读写边界，不依赖前端、真实 AI 或真实来源。
- public/private Case、固定 requirement/evidence/Resume 输入、跨 owner、错误 epoch、墓碑和 Case 脱离 fail closed。
- 幂等创建、同键不同请求、stale `expectedRevision`、追加顺序、非法状态、不可变行与 no-op 有稳定结果。
- 任务类型、payload、租约、fencing、超时/失败、owner 删除和迟到完成不复活均由隔离 PostgreSQL 验证。
- Knowledge 不抓正文、不共享私有内容；Debrief 不绕过用户确认创造经历。
- `git diff --check`、`pnpm lint`、`pnpm typecheck`、隔离 PostgreSQL 串行全仓测试、`pnpm build`、`pnpm audit:ci` 均有明确退出码。

2B-4C 每个内部切片独立记录证据；全部通过后只作“继续 Phase 3A、修改、回退、停止”之一决定。没有前端变化时不重复伪造浏览器验收或产品价值证据。

## 6. 排除项

不得读取、暂存或提交 `.claude/`、`.data/`、密钥、令牌、简历原文、本地数据库、下载 DOCX 或本机快照；不得访问真实招聘来源、真实 AI、邮件或服务器。已有改动属于 coco；冲突必须记录并复现，不能静默覆盖。
