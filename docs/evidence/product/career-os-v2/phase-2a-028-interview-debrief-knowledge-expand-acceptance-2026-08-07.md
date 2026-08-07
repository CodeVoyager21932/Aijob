# Phase 2A-028 Interview/Debrief/Knowledge Expand 验收

- 日期：2026-08-07
- 分支：`codex/career-os-phase-1`
- 基线：`ff9405e fix(security): patch pdf resume parser`
- 迁移：`028_interview_debrief_knowledge_expand`
- 产品证据：仍为 `E0`
- 四选一决定：**继续**到 `Phase 2B-1 ApplicationCase Service/API`

## 1. 目标与范围

本切片只把 Interview、Debrief 和 Knowledge 的长期领域契约注册为 additive migration 028，并补齐 public/private JobContext、owner/epoch、证据引用、Case 选择性脱离、角色权限和删除覆盖。没有注册业务 HTTP API，没有实现生成服务或前端，没有读取真实 JD/简历，没有调用真实 AI、真实招聘来源、邮件或服务器。

明确排除 `.claude/`、`.data/`、密钥、令牌、本地数据库文件、下载产物和真实个人材料。

## 2. 实现证据

### Contracts

- `InterviewSession` 固定 active/detached Case、public/private JobContext、evidence revision、可选 Case 派生 Resume semantic revision，以及 `template | controlled_ai` 生成元数据。
- `InterviewTurn` 只保存追加式 question/answer/follow-up；`InterviewFeedback` 使用 strict `interview-feedback-v1`，拒绝 ATS 分数、自由扩展字段和未确认事实引用。
- `Debrief` 只保存表达问题、证据缺口和练习计划；用户确认是独立追加记录，不直接创建或覆盖 Resume 内容。
- `KnowledgeClip` 只允许 HTTPS URL、标题、短摘要、适用场景、核验时间和用户笔记；strict contract 拒绝正文、HTML 或快照字段。

### PostgreSQL

- 在既有 `application` schema 新增 `interview_sessions/turns/feedback`、`debriefs/confirmations`、`knowledge_clips/knowledge_clip_case_links` 七张表，没有新增数据库、Schema、认证或队列。
- Session/Debrief 固定生成时 JobContext；Case 当前指针变化不会漂移历史材料。private JobContext、Resume 和 evidence 必须属于同一 owner。
- Turn、Feedback、Confirmation 和 Case Link 为追加式；Feedback 中的 turn、requirement 和 evidence 必须来自同一 Session/Case/已确认 evidence revision。
- Debrief 只有用户 Confirmation 才能从 draft 投影为 confirmed；worker 无权创建 Debrief、Confirmation、Knowledge Clip 或 Session。
- Case 删除前可显式把 Session/Debrief 从 `case_id` 脱离到 `detached_from_case_id`；Knowledge Case Link 随 Case 删除，Clip 本体保留。
- owner epoch 变化后拒绝 Interview/Debrief/Knowledge 迟到写入；collector 无访问权，web/match/ops/migrator 按职责最小授权。
- owner 全量删除服务按 Feedback → Turn → Confirmation → Debrief → Session → Clip Link → Clip 顺序清除，再删除 Resume、Case 和 evidence；migration `down` 为非破坏性 no-op。

### 安全 Gate 修复

- 验收期间 `pnpm audit:ci` 新发现 `pdfjs-dist 6.1.200` 的恶意 PDF JavaScript 执行高危漏洞 `GHSA-hq66-cqwq-w95j`。
- 直接依赖已独立升级到首个修复版本 `6.2.108`；Node 要求与仓库 Node 22 基线兼容。
- PDF/DOCX 解析、简历隐私持久化、全仓测试和生产构建重跑通过；审计恢复到仓库已登记的 1 high ignored / 1 moderate 基线。

## 3. 自动化结果

| 检查 | 结果 |
|---|---|
| Interview/Debrief/Knowledge contracts | 8/8，通过 |
| contracts 全包 | 53/53，通过 |
| migration 028/Phase 2A 隔离 PostgreSQL | 12/12，通过 |
| database 全包（隔离 PostgreSQL） | 50/50，通过 |
| owner 删除/retention 回归 | 2/2，通过 |
| 串行全仓测试 | config 17 + contracts 53 + database 50 + web 91 + platform 434 = 645/645，通过 |
| `pnpm lint` | 380 files，通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过；Web 主包 536.40 kB，仅有既有 chunk warning |
| `pnpm audit:ci` | 按仓库策略通过；新增 PDF 高危项已修复，余 1 high ignored / 1 moderate 为既有登记项 |
| `git diff --check` | 通过，仅有工作区换行提示 |

隔离 PostgreSQL 覆盖空库 `001 -> 028`、含 public/private Case/requirement/Resume/Review 的历史 fixture 升级、026–028 非破坏回退、strict feedback/debrief Schema、已确认证据、Case 脱离、Clip 保留、单项删除外键、角色权限、owner 全量删除与迟到写入。

## 4. 人工与视觉检查

本切片没有前端交互或样式变化，不重复宣称新的浏览器价值证据；Phase 1B 的 1920/1280/768/320 响应式结果仍为 UI 基线。Web 主包相对 Phase 1A 基线的增量未达到 10% 拆包门。

## 5. 风险与后续边界

- migration 028 只建立领域和权限边界；尚无 Interview/Debrief/Knowledge HTTP API、任务类型、生成服务或前端，不能把数据库可写等同于用户闭环可用。
- Debrief Confirmation 只确认复盘，不会自动生成经历事实；后续转成 Resume 表达仍需独立用户操作和 evidence 校验。
- 单项删除的数据库引用行为已固定，但面向用户的删除选择和冲突提示仍属于后续 service/API。
- `controlled_ai` 当前只是冻结模式契约；没有接入真实供应商，Private Alpha 默认模板模式的边界未改变。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。

## 6. 决定

决定：**继续**。

唯一下一目标为 `Phase 2B-1 ApplicationCase Service/API`：只实现稳定游标列表、public/private 幂等创建和同 owner 详情，复用既有 owner session、CSRF、`no-store` 和 Problem Details。阶段流转、岗位版本差异/升级、requirement 写入、旧决定兼容、前端接入、真实 AI 和真实来源均不进入该切片。
