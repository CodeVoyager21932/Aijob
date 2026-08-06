# Phase 2A Forward Contract 与隔离原型验收证据

> 历史原型记录：身份前置后来已由 [migration 025](phase-2a-025-identity-account-email-expand-acceptance-2026-08-06.md) 正式注册。本文件中的“迁移链停在 024 / 025–027 尚未批准”只描述当时状态；023F/024F 仍未注册。

- 日期：2026-08-06
- 分支：`codex/career-os-phase-1`
- 范围：公共/私有岗位上下文、strict Case event、Resume Content/Layout/Review 分层契约、023F/024F 未注册原型与隔离 PostgreSQL 测试
- 决定：**修改**。保留已验证 contracts/原型；正式迁移前先完成 `Account + EmailIdentity / 长期 owner` 前向契约

## 交付内容

- `PublicJobReference | PrivateJobSnapshot` 形成版本化岗位上下文。私有快照可不提供官方 URL，但必须保留来源诚实性；当前 owner 由服务端响应固定，创建请求不能提交 owner、公开可见性或供给字段。
- 新增长期 `ApplicationCaseWithJobContext` DTO，不再把历史 `expiresAt` 暴露为新职业 Case 的默认生命周期；旧 `ApplicationCaseSchema` 和旧公共创建请求继续兼容读取。
- `ApplicationCaseEventSchema` 按 13 种 `eventType` 绑定 strict `case-event-v1` payload，只允许 ID、版本、状态、原因码和 URL hash。JD 正文、简历正文、回答、模型输入和未知字段全部拒绝。
- 未类型化历史事件只能转换为带 `legacyReadOnly: true` 的只读 DTO，不能混入新事件写入。
- 新 `ResumeSemanticContent` 的 block 只保存用户确认文本与 evidence ID，不再保存 `suggestionDecision`；旧 024 content DTO 保留只读兼容。
- 新 `ResumeLayoutSettings` 只接受版本、字号/间距/颜色 token 和分页策略；HTML、CSS、正文与 provider 配置不能进入新布局写入请求。
- 新增 `ResumeReviewRun`、`ResumeReviewFinding`、`ResumeReviewSuggestion`、`ResumeReviewDecision` 与决定请求契约。文字变更必须引用已确认证据；接受/编辑必须产生新 content revision，拒绝不能产生 content revision。
- 新增未注册的 023F/024F SQL 原型和 7 项隔离 PostgreSQL 集成测试；`kysely_migration` 最新版本仍为 024。

## 验证命令与结果

数据库测试只使用 loopback `aijob_test*` 临时库；测试后临时库强制删除。未读取 `.claude/`、`.data/`、密钥、令牌、简历原文、本地业务数据库或下载产物。

```text
pnpm --filter @aijob/contracts test       PASS (4 files, 37 tests)
pnpm --filter @aijob/contracts typecheck  PASS
pnpm --filter @aijob/contracts build      PASS
pnpm exec biome check <changed TS files>  PASS
Phase 2A isolated PostgreSQL prototype    PASS (7/7)
pnpm lint                                 PASS
pnpm typecheck                            PASS
pnpm test (serial engineering gate)       PASS (617/617)
pnpm build                                PASS
pnpm audit:ci                             PASS (1 high/1 moderate registered ignore)
git diff --check                          PASS
```

全仓工程门第一次被错误地并行执行，既有 1000 岗容量测试因资源争用超过 30 秒预算并使 `afterAll` 超时。该文件随后单独复跑 2/2 通过（总计约 23.2 秒），再串行执行全仓测试 617/617 通过；因此未修改容量断言或放宽测试预算，并把本切片工程门固定为串行执行。

## 契约与数据库证据

- 公共/私有岗位上下文互斥；私有 JD 可无官方 URL，跨 owner 和公私混合引用由数据库拒绝。
- 创建请求拒绝 owner、公开可见性以及旧字段与 `jobContext` 双写。
- 新 Case event 的类型与 payload 必须匹配，未知字段、错误类型和四类正文泄露字段失败；历史宽事件显式只读。
- 新 Resume 语义正文拒绝 `suggestionDecision`；旧 024 正文仍可读取。
- Layout settings 拒绝 CSS 与正文。
- Review 建议受 evidence 和 section/block target 约束；接受/编辑必须引用新 content revision，Decision 不自动移动正文当前指针。
- 用户选择保留的 Resume/Review 可先 detach，再删除 Case；collector 无私有/Review 权限，match-worker 不能创建 Review 聚合。
- 历史公共 Case、legacy event、Resume content/layout 行保持可读且未被原地改写。

## 发现的阻断与决定

023F/024F 可以取消 Case/Resume 自身的 30 天约束，但现有匿名 owner 仍由 `retention_expires_at` 控制：session、服务和 worker 会拒绝过期 owner，retention maintenance 会启动全部个人数据删除。因此这两个原型单独注册后仍无法实现 ADR-0031 的长期职业资产。

四选一决定为 **修改**，不是回退：

- 保留 contracts、023F/024F SQL 原型和 7 项数据库证据。
- 下一唯一切片先冻结长期 owner、Account、EmailIdentity、邮箱验证码挑战、匿名 owner 认领和删除兼容契约。
- 身份前置通过后，再按依赖顺序注册正式 additive migrations，并补全 owner 到期不误删、单项/全部删除、迟到任务和恢复不复活测试。

## 未包含的 Gate

- 023F/024F 仍是未注册原型，运行数据库仍停在 migration 024；025–027 尚未批准。
- Account/EmailIdentity、长期 owner、HTTP API、旧路由唯一真源、404/Problem Details、CSRF 和 `no-store` 仍属于后续纵向切片。
- 本次没有前端变化，不重复 Phase 1B 浏览器 Gate。
- 没有访问真实招聘来源、真实 AI、真实简历、服务器或云资源。产品证据仍为 `E0`，可信供给仍为 22 岗 / 3 家企业。
