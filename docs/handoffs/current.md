# 当前项目交接：供给准入扩容轨道（SA Track）阶段 0 进行中

> 交接日期：2026-08-28
>
> 当前分支：`codex/career-os-ux-convergence`
>
> 精确 HEAD、远端跟踪与工作树以 `git log -1`、`git status` 为准。

动态事实源：[MVP 路线图](../06-mvp-roadmap.md)

当前执行计划：[供给准入扩容轨道（SA Track）](../plans/supply-admission-scaleup-track.md)（进行中，阶段 0）

上一轨道计划：[Career OS 前后端同步改进计划](../plans/career-os-current-delivery-plan.md)（已收敛，OS-1–OS-7 全部关闭）

稳定实施契约：[Career OS 端到端体验与系统契约](../14-career-os-end-to-end-experience-contract.md)

当前追踪矩阵：[UX-0 页面—系统—证据追踪矩阵](../plans/career-os-ux-0-end-to-end-traceability-matrix.md)

本轮关闭证据：[OS-7 系统总 Gate 验收](../evidence/product/career-os-v2/os-7-system-gate-acceptance-2026-08-28.md)

过程检查点（已被取代）：[OS-7 暂停检查点](../evidence/product/career-os-v2/os-7-system-gate-checkpoint-2026-08-28.md)

## 0. 绿色基线

| 提交 | 性质 |
|---|---|
| OS-7 验收对应提交 | **当前绿色基线。** 五项状态全部通过；全仓 808/808、lint 485 files、typecheck、build（主包 401.33 kB）、audit、隔离 PostgreSQL、双库四视口浏览器 Gate 与 diff check 均通过 |
| `e56ceae feat(career-os): close os6 lifecycle and data control` | 上一绿色基线（OS-6，801/801）。注意：其记录的 typecheck 通过对 `apps/platform/src/resume-documents/routes.integration.test.ts` 并不成立，该缺口已在 OS-7 修复并登记 |
| `10f7451 chore(career-os): checkpoint paused os7 gate` | OS-7 中途暂停检查点，**不是**通过版本；已被 OS-7 验收取代 |

## 1. 当前决定

**OS-7 已完成（UX-0 与 OS-1–OS-7 全部关闭）。coco 于 2026-08-28 选择「供给准入扩容」为下一条轨道。SA Track 的 Phase A（零触网标准与机制）A1–A10 已全部完成。**

Phase A 交付了三份待审 ADR 与配套实现：

- [ADR-0032](../decisions/0032-reachability-first-supply-admission.md)（`proposed`）：以**可达岗位 ≥50% 可见岗位**取代 SME 比例作为结构门槛；冻结五项收录属性；用户可见岗位必须 `closure_detectable`。
- [ADR-0033](../decisions/0033-access-policy-basis-and-minimal-body-scope.md)（`proposed`）：以站点 `robots.txt` + 服务条款为 `accessPolicyAccepted` 判据；岗位正文限定在职责与任职要求原句（D1）。**转为 `accepted` 前建议取得法律意见。**
- [ADR-0034](../decisions/0034-two-layer-source-admission-and-reconciled-publication.md)（`proposed`）：来源准入拆为**厂商层／租户层**两层（单家成本 153 行 → 3–5 行）；**解除公开供给的结构性死锁**；发布由**双向资格对账**自动驱动。

### ADR-0034 的核心发现：公开供给恒为 0 是循环依赖，不是门槛太严

`eligible_for_alpha` 的条件里含 `AND publication_state = 'published'`，而 `NormalizedOfficialJob.publicationState` 是字面量类型 `"review"`，全仓无任何生产代码写过 `published`（只有测试夹具）。`materialize.ts` 又只在修订为 `published` 时设 `catalog.published_jobs.public_version_id`，而所有公开读取路径（`catalog/repository.ts`、`matching/service.ts`、`insights/service.ts`、`local-bootstrap.ts`）在非 local MVP 时都走该指针。

**要「已发布」才算「够格发布」，而发布只在「已发布」时发生。** 因此松开 `accessPolicyAccepted` 或任何上游门都不会让公开供给变成正数。数据库无障碍：migration 001 允许 `published`，`public_version_id` 可为空。

两条必须一起满足的实现约束：

1. `revision_content_hash` 的输入包含 `publicationState`，因此**改写 `revision.publication_state` 会破坏不可变性与可复现性**（ADR-0029 §11）。发布只能表达在 `public_version_id`。
2. **自动发布必须配自动撤回。** 指针是持久化的，来源被自动 `paused`、岗位过期、新鲜度过期、职责或要求被清空、复核项打开，都会使资格失效而指针滞留，产生对外可见漂移。只做单向发布比完全不发布更糟。

保留的人工动作仅三项，且都是逐来源一次、不随岗位数量增长：来源准入（`policy.status → approved`）、运行范围提升（`runtime_scope → alpha`）、强制下架（履行「异议即停」）。

三份 ADR 已于 2026-08-29 由 coco **审定通过**（状态 `accepted`）。ADR-0033 未取得法律意见即被审定，这一点按原样记录在该 ADR 的前置条件里。

### ADR-0034 §一+§二+§四 已落地（零触网）

- 迁移 **035** 重建 `catalog.job_version_eligibility`：去掉 `publication_state = 'published'`，新增 `publication_suppressed` 条件；`catalog.published_jobs` 增加 `publication_suppressed_at` / `publication_suppressed_reason`（CHECK 要求成对）；新增 `catalog.publication_events` 并逐角色授权。
- `materialize.ts` 不再设置 `public_version_id`，只负责 `current_version_id`。
- 新增 `catalog/publication-reconciliation.ts`：`reconcilePublication` 做双向对账（合格即发布、失格即撤回、指针前移至最新合格版本），`suppressJobPublication` / `releaseJobPublicationSuppression` 提供人工强制下架与解除。CLI 加 `catalog-reconcile-publication`、`catalog-suppress-job`、`catalog-release-job-suppression`。
- 删除 `publicationAllowed`（含 36 份配置各一行），`candidateStatus` 与 `completion` 放宽为枚举。

**落地时发现的最重要事实：循环依赖不止一处。** `publication_state = 'published'` 除资格视图外，还散布在 **6 处生产读取路径**：`catalog/repository.ts` 公开查询、`matching/service.ts` 三处（`getMatchRun`、快照查询、推荐候选查询与其 TS 守卫）、`local-bootstrap.ts` 的 `publicJobs` 统计、`insights/service.ts` 的行过滤。这些位置的公开分支**本来就已带指针条件**，那句是冗余且致死的，已统一改为 `IN ('review','published')`（与 `PUBLICATION_NOT_REVIEWABLE` 同义，仍挡住 `draft`/`suppressed`/`archived`）。另外 `catalog/repository.ts` 的 `displayStatus` / `isInternal` 由 `publication_state` 推导，若不处理会把每个公开岗位标成 `pending_review`、`isInternal` 恒真，因此公开查询改为按指针派生该列。

只改视图不足以解除死锁——这是本轮最容易漏掉的一点。

### 待办：ADR-0034 §三 两层 schema

改 `source-config.ts` 拆成厂商层与租户层，并迁移 34 份既有配置到新形状。改动较大，与已落地部分解耦。

### 触网边界按 `AGENTS.md` 原文，不额外加严

先前交接把这里写成「任何触网步骤须 coco 逐批明确 live 授权」。**那比 `AGENTS.md` 严，是多加的约束，已撤回。** 规则原文只把四件事留给人工明确操作：首次启用、扩大请求范围、恢复暂停来源、浏览器快照；并明确「按 ADR-0026 在配置中显式启用的确定性来源可由本机 `collector-worker` 定时刷新」。

因此当前 9 个 `crawlInterval.enabled` 来源里，**7 个 `public_api` 确定性来源可直接按周期刷新，无需逐批点头**；剩余 2 个是 `browser_required`，属浏览器快照，仍需人工操作。8 个 `paused` 来源的恢复、17 个未启用来源的首次启用，同样仍需人工操作。

不变的硬边界：不抓 BOSS/实习僧/牛客等综合平台与第三方聚合站；不绕过登录、验证码、访问控制、付费墙或明确禁止的访问政策；逐来源网络预算与白名单不放宽；CI、构建、Alpha、Production 不访问真实招聘站。仍不得自动进入 Private Alpha、不得启动服务器就绪工作、不得从 [Private Alpha 就绪 Gate](../plans/private-alpha-readiness-gates.md) 生成任务。

产品阶段未变：产品证据仍为 **E0**，可信供给仍为 **22 岗 / 3 家企业 / 3 官方 ATS**，公开 `/v1/jobs` 仍为 0（正确行为）。Phase A 一条可见岗位都没有增加。

产品阶段未变：产品证据仍为 **E0**，可信供给仍为 **22 岗 / 3 家企业 / 3 官方 ATS**。飞书线索表与本轮提取的 389 域名清单只是发现线索，不构成供给证据。

## 2. 五项状态

| 状态项 | 当前状态 |
|---|---|
| Contract | 通过 |
| Database/Platform | 通过 |
| Web | 通过 |
| Integrated Gate | 通过（`passed: true`） |
| Evidence | 通过 |

工程基线：Config 20、Contracts 86、Database 54、Platform 466、Web 182，共 **808/808**，一次跑通无 flake。前端主包 **401.33 kB（gzip 117.04 kB）**，上限 411.31 kB。

产品证据仍为 **E0**；可信供给仍为 **22 岗 / 3 家企业 / 3 个官方 ATS**，公共与 Alpha 岗位均为 0。工程与视觉通过不得冒充用户价值、真实供给、Private Alpha 或生产就绪。

## 3. 本轮代码改动

仅 4 个文件，无 migration、无依赖变更、无新服务，未移除 `VITE_CAREER_OS_V2`：

- `apps/web/src/career-os/career-os.css`：`small/sub/sup` 12px 下限；旧 `styles.css` meta 标签抬到 12px；三处标题改回 `var(--co-title-lg)`；新增 `.product-app.career-os` 前缀块修正旧 hero 标题上限的特异性失效。
- `apps/web/src/career-os/visual-contract.test.ts`：新增“不得超过 32px 上限”静态断言（5/5）。
- `apps/web/scripts/os7-browser-gate.cjs`：Case overview 标题改非 exact 匹配；flag-off 资源断言收紧为只禁 Career OS 外壳/页面/组件/样式表。
- `apps/platform/src/resume-documents/routes.integration.test.ts`：修复预先存在的 `noUncheckedIndexedAccess` 类型错误。

`apps/web/src/styles.css` **未修改**，因此 `VITE_CAREER_OS_V2=false` 回退外观完全不变。

## 4. 下一任务接手要点（SA Track Phase B）

1. 依次读取 `AGENTS.md`、README、路线图、本交接、[SA Track 计划](../plans/supply-admission-scaleup-track.md)、Private Alpha 就绪 Gate 与相关 ADR（0026/0027/0028/0029/0030/**0032**/**0033**/**0034**）。
2. `git fetch` 核对分支/远端/工作树；`codex/g2-1000-alpha-supply`（capacity 感知规划、可复用 ATS 来源族、Private Alpha 信任边界）已完整合入本分支（`merge-base` 即其 tip，left/right = 80/0），无撞车风险；其 worktree 的未提交改动属于 coco，不动。
3. **先确认 ADR-0032、ADR-0033 与 ADR-0034 是否已被 coco 审定**。未审定前不得据其提升任何来源状态，也不得据 ADR-0034 改动资格视图或发布路径。
4. Phase B 的剩余步骤（第 1 步「解除循环依赖」**已完成**，见上文）：
   1. ~~落地 ADR-0034 §一 + §二~~ **已完成**，零触网。
   2. 恢复 9 个 `crawlInterval.enabled` 来源按周期跑 7 天。
   3. 逐来源抓 robots + 核 ToS 并重评 `accessPolicyAccepted`。
   4. 凭运行证据翻转 `stableIdentityAndFields`。
   5. 提 `policy.status → approved` + `runtime_scope → alpha`，然后跑 `pnpm source:*` 之外的 `catalog-reconcile-publication`，由对账自动发布使公开 `/v1/jobs` 非 0。
5. 触网边界按 `AGENTS.md` 原文：配置中已显式启用的确定性来源可由本机 `collector-worker` 定时刷新；只有首次启用、扩大请求范围、恢复暂停来源和浏览器快照需人工明确操作。不复用 OS-1–OS-7 切片模板，不启动服务器就绪工作。
6. 对账必须**周期性运行**才能保证撤回及时。当前只有 CLI 入口，尚未接进 `collector-worker` 的刷新周期；接线前，来源被暂停到指针被撤回之间存在时间窗，需依赖 `catalog-suppress-job` 兜底。

### 接 ADR-0033 访问政策复核的顺序陷阱（务必先读）

`decideAccessPolicyRecheck` 目前**零生产调用**，看起来只差一步接线。但它在 `recordedEvidence === null` 时返回 `pause`，而**34 份配置的 `policy.accessPolicyEvidence` 全部为 `null`**。因此直接把它接进 `collector-worker` 的刷新前置，会让每个来源一到刷新就被 `ACCESS_POLICY_EVIDENCE_MISSING` 暂停——**目前 7 个能自动跑的确定性来源会全部熄火**，比不接更糟。

正确顺序是两步，不可颠倒：

1. 先建**首次取证**通路：按已登记 fetch target 的每个不同主机取 `https://<host>/robots.txt`，连同服务条款结论写入 `policy.accessPolicyEvidence`。注意 `/robots.txt` 不在任何来源的路径白名单内，需要先决定它的处理方式（在已白名单主机上视为隐含允许，或逐来源把该路径加进 fetch target）——按 `AGENTS.md` 的白名单要求，这一点必须显式决定，不能默认放行。
2. 再把复核接进刷新前置，判定转禁止时自动暂停。

第 1 步是触网动作，但只读 `/robots.txt`，是行为最保守的一次请求；拒绝读 robots 却继续抓其他路径反而更差。
6. 已登记的残留缺口：`university-employment-adapter` 的 `splitRequirements` 无职责锚点（会把公司简介带入职责）。当前高校来源全为 `discovery_only` 不进目录，但高校线重启前必修。

## 5. 复现浏览器 Gate 所需的环境事实

若需再次运行 `os7-browser-gate.cjs`，以下为本轮实测的可复现条件：

- 本工作区是原 Codex worktree 的副本，`node_modules/.modules.yaml` 的 virtual store 指向旧路径，pnpm 会拒绝执行脚本。用 `pnpm install --frozen-lockfile` 修复（本地 store 命中，无网络下载，锁文件不变）。
- 脚本需要 Playwright。仓库不声明该依赖，通过既有 `CODEX_NODE_MODULES` 环境变量从仓库外目录加载即可，不要把它加进 `package.json`。
- Chromium 官方 CDN 在本机不可达（`ECONNRESET`）。用 `OS7_BROWSER_EXECUTABLE` 指向本机 Chrome 即可，无需下载浏览器。
- `OS7_PNPM_EXECUTABLE` 必须给 `pnpm.cmd` 的完整路径，脚本的 Windows shell 分支依赖 `.cmd` 后缀。
- **Web 必须用 `WEB_API_ORIGIN` 控制 Vite 的 `/v1` 代理，页面保持相对同源请求。设置 `VITE_API_BASE_URL` 会跨源直连 Platform 并破坏同源 CSRF，导致 `403 CSRF_REJECTED`。**
- 5 个 loopback 进程：Platform 3000（满态库）、3001（空库）；Web 5173（V2 满态）、5174（V2=false 回退，连 3000）、5175（V2 空态，连 3001）。
- Platform 需显式 `RESUME_ENCRYPTION_KEY`、`ENABLE_AI=false`、`ACCEPTED_ORIGINS` 含 5173/5174/5175，`SNAPSHOT_DIR` 指向临时目录，避免触碰 `.data/`。
- 每次完整运行前必须新建一对空的 `aijob_ux_full_test_*` / `aijob_ux_empty_test_*` 库并迁移到 033；失败后重跑不能复用已被 seed 过的库。
- 已知环境敏感项：PostgreSQL 容器时钟领先宿主机约 280ms，会让 `024_resume_document_v2_expand` 的 1 秒时间余量在慢负载下失效。未修改生产约束或该测试。

## 6. 固定排除与数据安全

- 不访问真实招聘来源、真实 AI、真实邮件、服务器、参与者或真实简历，不获取外部解析镜像。
- 不新增第二套数据库、BFF、Redis、向量库、消息总线、认证或 AI SDK，不移除 `VITE_CAREER_OS_V2`。
- 不读取、修改、暂存、覆盖、清理或提交 `.claude/`、`.data/`、密钥、令牌、真实简历原文、本地业务数据库、下载产物或截图。
- 测试数据库必须全新且匹配 `aijob_*_test_*`，只写合成数据；浏览器和服务只允许 loopback。
- Private Alpha Gate 只用于守门，不得从中生成当前任务。
