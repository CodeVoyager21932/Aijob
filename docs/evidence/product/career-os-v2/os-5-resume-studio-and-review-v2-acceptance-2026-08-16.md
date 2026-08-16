# OS-5 Resume Studio 与唯一 Review 写入验收（2026-08-16）

> 分支：`codex/career-os-ux-convergence`
>
> 起始 HEAD：`3158b0b feat(career-os): close os4 pinned case matching`
>
> 决定：**完成 OS-5，进入 OS-6 准备；OS-6 尚未实施，等待 coco 指令。**

## 1. 验收范围与五项状态

OS-5 只收敛基础/岗位简历、内容与布局修订、固定岗位 Requirements、Resume Review、逐建议决定、DOCX、打印和旧 Tailoring 历史承接。它同步完成 Contracts、PostgreSQL/Platform/Worker、Web 与真实隔离浏览器 Gate，没有进入 OS-6 的投递、面试、复盘和数据控制收敛，也没有启动真实 AI、真实招聘来源、邮件、服务器或参与者。

| 状态项 | 结果 | 证据 |
|---|---|---|
| Contract | **通过** | Review Run v1/v2 严格 union；template/controlled AI 请求 union；v2 provenance、failure/fallback、requirement citations；Current/Create 响应包含固定 Requirements |
| Database/Platform | **通过** | migration 033 expand-only；v1/v2 双读、双 handler、版本化任务与写入开关；public/private 固定要求和 owner epoch guard；模板与受控 AI 均写唯一 Review 聚合 |
| Web | **通过** | 左结构/中 A4 文稿/右要求与建议三栏 Studio；窄屏三模式；草稿导航保护；409、session 不重放、逐建议决定、DOCX/打印与 runtime parse |
| Integrated Gate | **通过** | 全新隔离 PostgreSQL、真实 Platform API/Worker、合成 public/private Case、1536/1280/768/320 浏览器 Gate；网络仅 loopback，无真实 AI 请求 |
| Evidence | **通过** | 本记录、README、路线图、当前交接、当前计划、计划/证据索引、稳定契约和追踪矩阵同步；只关闭 OS-5 |

## 2. Contract、migration 与兼容边界

`ResumeReviewRun` 现在是严格的 v1/v2 discriminated union。legacy v1 继续可读，且 provenance、failure、fallback 和 requirement IDs 不会被当前实现伪造成历史事实。v2 固定记录：

- `generationProvenanceVersion` 与 `templateVersion`；
- controlled AI 的本次 `privacyConsentAt`、provider adapter/model、prompt/output schema/safety/parameters 版本；
- `usedTemplateFallback`、稳定 `fallbackReasonCode` 与 terminal `failureCode`；
- Finding/Suggestion 对固定岗位要求的唯一 `requirementIds`。

创建请求只允许：

```ts
{ expectedRevision, mode: "template" }
{ expectedRevision, mode: "controlled_ai", privacyConsent: true }
```

缺少本次明确同意会返回 `CONTROLLED_AI_CONSENT_REQUIRED`，不能借历史同意或页面默认值启动受控 AI。

migration `033_resume_review_v2_expand` 只扩展现有 Review 聚合和任务类型，不新增第二套表、数据库、队列或服务。数据库约束同时验证：

- v1 provenance 必须为空；v2 provenance、mode、consent、fallback/failure 状态一致；
- public requirement ID 必须属于 Run 固定的 requirement set；private requirement ID 必须属于同 owner、同 owner epoch、同 snapshot revision；
- Run 生成输入 provenance 不可变，完成/失败结果不能被事后改写；failed retry 必须先清空旧 outcome；
- legacy finding/suggestion 的 requirement IDs 保持空数组，新 v2 引用经过固定要求 guard。

迁移为 expand-only，`down` 有意 no-op。一旦数据库存在 v2 Run，pre-v2 应用回滚不安全且被禁止，只允许前向修复。兼容部署顺序保持“先 migration 与双读/双 handler reader/Worker，再启用 v2 写入”。`resumeReviewV2WriteEnabled` 在 local/test 默认开启，在 alpha/production 默认关闭；关闭时 template 继续走 legacy v1，controlled AI fail closed。

## 3. Platform、Worker 与受控 AI

- 旧 `resume_review` 任务和 v1 handler 保留；新 `resume_review_v2` 由新 handler 领取。旧 Worker 的任务白名单不会领取 v2，滚动部署 fail closed。
- template 与 controlled AI 都从 Resume Run 固定的 public/private Requirements、不可变内容修订和确认证据生成；Web 不提交或拼接 requirement IDs。
- controlled AI 只复用既有 `OpenAiCompatibleProvider`、PII 去标识化和结构化输出校验，不调用旧 Tailoring service，也不恢复旧 Tailoring 新建、决定或导出写入。
- provider 调用发生在数据库事务外；写回前重新锁定 Run、重验 task lease、owner/epoch、状态和固定 Requirements hash，删除或迟到任务不能写回。
- AI 关闭、配置缺失、provider/schema/引用失败会使用确定性模板，并持久记录稳定 fallback code；只有模板本身也无法完成时 Run 才进入 failed。
- 受控 AI 输入只包含去标识化正文、固定 Requirements 和已确认证据。集成测试通过注入的 loopback `fetchImpl` 模拟 provider；浏览器 Gate 使用 `AI_DISABLED` 明示降级，没有真实 AI 请求。

## 4. Resume Studio 与交互结果

- 宽屏形成左侧结构/版本/证据、中间 A4 文稿、右侧岗位要求/引用/建议的统一工作室；Review 不再堆在编辑器下方。
- 1023px 以下使用 URL 可恢复的“结构 / 文稿 / 建议”模式，一次只显示一个主要区域；`studio`、`requirement`、`block` 支持刷新、深链、返回和前进。
- 基础简历明确没有岗位 Review；岗位简历只显示对应固定 public/private Requirements，不生成匹配分或“匹配良好/中/差”。
- 建议只允许接受、编辑后采用或拒绝；requirement/evidence 引用分别展示，任何建议都不会自动写正文。
- 未保存正文、章节顺序或模板变更会保护站内导航和浏览器后退；对话框有焦点约束、可见初始焦点、Escape 和关闭后返焦。
- revision 409 保留本地草稿；session 403 恢复后不重放 mutation，并在 Shell 中持续提示用户重新确认。失败命令的 Review 幂等键跨页面 remount 保持同一身份；成功后释放，下一次明确审阅生成新命令而不是回放旧 Run。
- touched Resume API 使用共享 runtime parser；畸形成功响应不会被 TypeScript 断言静默接受。
- 旧 `/resume-tailorings/:runId` 继续历史只读；`VITE_CAREER_OS_V2=false` 继续使用旧 `ProductShell` 与旧岗位页。

## 5. 真实隔离浏览器 Gate

浏览器 Gate 使用：

- 精确隔离库：`aijob_os5_test_20260816_f057_browser`；
- loopback Platform `127.0.0.1:3000`、V2 Web `127.0.0.1:5173`、flag-off Web `127.0.0.1:5174`；
- 只含合成公共/私有岗位上下文、合成 owner、合成简历、确认证据和 `.example.test` 链接；
- 真实 Platform API、PostgreSQL、本地 Worker 与浏览器；没有访问真实招聘来源、AI、邮件或服务器，没有生成截图。

通过项：

1. public/private Requirements 与三栏 Studio 从同一 Case/Resume 深链可恢复。
2. 内容保存 revision 409 后草稿保留；未保存草稿拦截站内导航与浏览器后退。
3. mutation 403 后 session 恢复但不重放，用户再次确认沿用同一命令幂等身份；成功后再次明确审阅使用新的幂等键。
4. template Review v2 完成，并覆盖接受、编辑后采用和拒绝三种决定。
5. controlled AI 必须逐次明确同意；AI 关闭时结果完成并持久显示 `AI_DISABLED` 模板降级。
6. 可恢复 API 503 与显式重试、非法/跨 owner 404、删除后不可读均通过。
7. DOCX 返回有效 ZIP/DOCX；浏览器打印可用。
8. 1536、1280、768（200% 等效边界）和 320 均无页面级水平溢出；键盘、可见焦点、对话框返焦和长文本通过。
9. 岗位/Case 首屏不加载 Resume Editor 或 Interview；Resume Editor 只在进入简历工作室后 lazy load。
10. flag-off 旧壳与岗位页可用；控制台无新增 warning/error，除刻意 503/403/409/404 外无异常响应，所有请求只到 loopback。

最终脚本返回 `passed: true`、`decisions: 3`、`controlledAiFallback: "AI_DISABLED"` 和 `viewports: [1536, 1280, 768, 320]`。

脚本：`apps/web/scripts/os5-browser-gate.cjs`。

## 6. 最终工程 Gate

最终代码使用全新 `aijob_os5_test_20260816_f057_final` 隔离库从零迁移并完成完整回归：

| Gate | 结果 |
|---|---|
| Config | 20/20 |
| Contracts | 86/86 |
| Database | 54/54；空库 migration 033 与 forward-contract 通过 |
| Platform | 466/466 |
| Web | 165/165 |
| 合计 | **791/791** |
| `pnpm lint` | 通过，480 files |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm audit:ci` | 标准命令在本轮同一未变依赖图上退出码 0；1 个既有 high 由已提交审计基线忽略，本切片未新增依赖 |
| `git diff --check` | 通过 |

最终 Web production main 为 400.47 kB（gzip 116.74 kB），相对 OS-4 的 397.80 kB 增加 2.67 kB，低于 10 kB 增量守门。Resume Document Editor 为 40.79 kB（gzip 12.57 kB）、Case Resume Workspace 6.21 kB、Interview 23.76 kB，重工作区继续独立 lazy load。

最终复验曾尝试给 `pnpm audit` 附加其不支持的 `--offline` 参数，CLI 在执行审计前即拒绝；该参数错误没有被计为通过，也没有替代上表已经成功的标准 `audit:ci`。依赖文件与依赖图在两次检查之间没有变化。

## 7. 清理、剩余边界与决定

验收结束后只删除两个 OS-5 精确测试库和任务临时运行目录，停止 Platform、V2 Web、flag-off Web 与项目 PostgreSQL，并确认 3000、5173、5174、5432 不再监听。没有读取或修改 `.claude/`、`.data/`、密钥、令牌、真实简历原文、本地业务数据库、下载产物或截图。

以下事实没有因 OS-5 改变：

- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- OS-6 投递/面试/复盘/数据控制收敛与 OS-7 系统总 Gate 尚未完成。
- 真实 AI、真实招聘来源、真实邮件、解析镜像、服务器、参与者和 Private Alpha 均未启动。
- 工程、合成浏览器和视觉通过不等于用户价值、生产或 Private Alpha 就绪。

因此本轮决定是：**完成 OS-5，进入 OS-6 准备；不自动开始 OS-6，等待 coco 的下一条指令。**
