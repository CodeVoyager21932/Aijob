# 当前项目交接：全部职能 100–200 岗位扩容进入 G2 重新验收

> 交接日期：2026-07-20
>
> 当前分支：`codex/g0-research-prototype`
>
> 动态事实源：[MVP 路线与当前决策面板](../06-mvp-roadmap.md)
>
> 工程证据：[G2 正确性重新验收记录](../evidence/g2/correctness-reacceptance-2026-07-20.md)、[验收反馈修正记录](../evidence/g2/acceptance-followup-2026-07-20.md)、[全部职能扩容离线基础验收](../evidence/g2/all-function-expansion-foundation-2026-07-20.md)

## 1. 当前唯一目标

原 31 岗位 `G2 Local Complete MVP` 已完成正确性修复和重新验收。coco 现按 ADR-0015 将本机假设扩展为全部职能 100–200 条实习岗位；新范围重新进入 G2 验收。当前不购买服务器、不招募或运行参与者任务，产品证据保持 `E0`。

2026-07-20 验收反馈修正：

- “简历与画像”和“数据控制”可查看、复用并重新选择确认后保留 30 天的结构化简历区块，不恢复已删除的原文件/临时原文。
- 经历证据匹配升级为有版本、可解释的能力词典；“用户调研—用户访谈”“数据分析—SQL/指标看板”可连接，但 SQL/Python/Figma 等明确工具仍必须原词命中。
- 推荐页直接解释资格、证据、偏好和排序逻辑；真实 31 岗位合成验收从统一 0/N 变为按实际要求出现 1/2、1/9、2/6、3/5 等覆盖。
- 当前 PostgreSQL 整库约 16 MB（扩容前实测约 15 MB）；扩至 100–200 条的瓶颈是官方来源审查与维护，不是存储。1000 条合成岗位已在同一 PostgreSQL 中完成目录筛选与确定性排序容量回归并回滚。
- 岗位目录的关键词、城市和岗位方向已统一基线，“查看岗位”移入独立操作区；已保存简历支持一键全选和清空，并在保存前显示 N/总数。

2026-07-20 已修复并重新验收：

- 31 个活动岗位统一读取 v4 活动要求集和唯一条件投影；解析器升级没有伪造岗位版本。
- “优先”局部化；目标美团学历在读、3 个月、4 天均为独立 `required` 原子要求。
- 有序 `ResumeDocumentRevision` 和 `ResumeEvidence v2` 建立单块引用；1612 字无换行文本拆为 4 块。
- 学历、专业、毕业年份、在校状态和技能候选补齐；真实浏览器发现的专业候选错位已修复。
- 不限城市语义、coverage、basisState、类型化 gaps、资格分组和 `decision-readiness-v2` 已落地。
- AI 返回单块真实建议稿和引用，未选区块原序保留；页面可逐条编辑、自动增高并导出真实章节 DOCX。
- 岗位详情加载竞态和 320 px 最终预览横向溢出已在真实浏览器中发现并修复。

当前闭环已经能在本机运行：

```text
三来源 31 条岗位
  -> 清洗、去重、结构化和来源追溯
  -> PDF / DOCX / 文本简历与隐私检查
  -> 事实、偏好和经历证据确认
  -> 三轴匹配与确定性推荐
  -> 受控 AI 选择或安全模板降级
  -> 逐段接受、拒绝或编辑
  -> ATS DOCX、官方投递链接和五态决定
  -> 删除全部个人数据
```

## 2. 已确认工程事实

- 本地目录为 31 条：腾讯 14、南开就业网·好未来 7、美团 10。
- 三个来源均为 `pending_review`，只能进入本机 `local_mvp`；公开 `/v1/jobs` 保持 0 条。
- 正式 `/jobs/*`、简历、确认、推荐、优化、数据控制页面均由 PostgreSQL 和 `/v1` API 提供数据。
- localhost 匿名 owner、Origin/CSRF、owner epoch、不可变修订、TTL、删除墓碑和迟到任务拒绝已实现。
- PDF、DOCX、粘贴文本、5 MiB 限制、MIME/魔数、宏/加密/ZIP bomb/扫描 PDF 失败路径已有自动化覆盖。
- 三轴、32 个命名金标、coverage/basisState/类型化 gaps、确定性分组推荐、冻结要求集/画像/核验时间、五态决定和官方链接交接已实现。
- 当前 owner 可跨日读取确认后的 `ResumeDocumentRevision` 并只用当前 `sourceBlockId` 重选经历证据；每次保存生成新的不可变 evidence 修订。
- 经历证据规则为 `eligibility-rules-v3`、`zh-cn-internship-v3+capability-ontology-v2` 和 `three-axis-explanation-v3`；v2 增加全部职能的高精度能力词典，具体工具要求仍不使用能力域替代。
- AI 只能对单个已确认 `sourceBlockId` 返回建议稿，并引用已确认 evidence/requirement ID；服务端逐块校验，失败时安全降级为模板。
- 固定合成数据的真实 OpenAI-compatible 冒烟已通过；共享精确输出契约与 `resume-tailoring-selection-v2` 防止模型自创字段名，Schema 保持严格。
- 本地 AI 配置通过 `pnpm ai:configure` 写入 Git 忽略的后端文件；前端没有供应商配置接口，线上配置来源留待部署阶段替换。
- 逐段决定、复制、冻结后的 DOCX 和全部个人数据删除已跑通。
- 本地简历加密密钥首次启动时随机生成并保存在 Git 忽略的 `.data/`；`alpha/production` 必须显式配置，不再使用源码固定密钥。
- 用户任务的开始、成功和失败写入均在同一事务核对 owner、epoch、租约、心跳期限与 fencing token；租约接管和删除撤销后的旧 worker 不能写回业务表。
- 简历解析结果只持久化无正文元数据；完整候选仅在 active owner 和 24 小时 TTL 内从加密文本即时重建，确认、到期或失败会清除正文与原始文件名。
- 固定 owner 保留期到期会并发幂等地创建删除墓碑、撤销会话并清理全部个人数据；DOCX 密文 24 小时、结构化数据 30 天、无正文审计与删除墓碑 90 天的边界均有 PostgreSQL 集成覆盖。
- 简历确认与 owner 删除后会清理浏览器中的原文、画像、推荐和优化缓存；岗位详情不会展示属于其他岗位版本的旧匹配结果。
- 语义相同的新来源修订通过关联表复用不可变岗位版本；目录物化使用 PostgreSQL advisory lock 串行提交。
- 2026-07-20 重新验收结果：244 项测试、TypeScript、生产构建和 202 文件 lint 全部通过。
- 随后验收反馈修正结果：全量 247 项测试、TypeScript、生产构建和 203 文件 lint 通过；真实浏览器完成资料复访、3→2 段证据重选、31 条重新推荐和能力解释核对。
- 全部职能离线扩容基础结果：隔离数据库中 285 项测试、TypeScript、生产构建和 212 文件 lint 通过；1000 岗位容量用例、来源候选 CLI 和本机浏览器复核通过。
- `pnpm catalog:materialize` 离线返回 31 个 eligible revisions、0 个新岗位版本、0 个新要求集；31/31 活动岗位已有 v4 要求集和唯一投影。
- 真实浏览器用纯合成简历完成 31 条推荐、目标美团详情、逐块改写、9,125 字节 DOCX 和全部个人数据删除。
- 1280 px 与 320 px 下目录、详情、推荐和优化无全局横向溢出；优化文本框自动增高。

## 3. 当前未完成项

1. 全部职能契约、配置驱动来源、来源/适配器解耦、请求预算、候选批次登记、能力词典 v2 和 1000 岗位容量回归已完成；真实优先来源评估、100–200 条目录和人工抽检尚未完成，现有快照不能伪造扩容。
2. 真实招聘站低频探测仍需 coco 按批次明确启动；未批准批次不能访问。
3. G0 的 2 人协议校准尚未开始；扩大后的 G2 通过后才招募、执行和记录，不以工程测试代替参与者。
4. G3 来源准入仍为 0/3，三个来源继续保持 `pending_review` 和仅限本机的 `local_mvp` 状态。
5. 公开 AI 仍未获批准，需要后续供应商、隐私、合规和至少 4/6 增量价值 Gate。

真实 AI 冒烟不是公开启用批准。公开 AI 仍需供应商、隐私、合规和至少 4/6 增量价值 Gate。

## 4. 关键实现位置

- 岗位目录：`apps/platform/src/catalog/`、`apps/web/src/pages/JobListPage.tsx`
- 三来源：`apps/platform/src/sources/`、`config/sources/`
- 匿名 owner 与安全：`apps/platform/src/identity/`、`apps/platform/src/profile/`
- 简历：`apps/platform/src/resume/`、`apps/web/src/pages/ResumePage.tsx`
- 匹配与推荐：`apps/platform/src/matching/`、`apps/web/src/pages/RecommendationsPage.tsx`
- 优化与 DOCX：`apps/platform/src/tailoring/`、`apps/platform/src/ai/`、`apps/web/src/pages/ResumeTailoringPage.tsx`
- 本地 AI 配置：`apps/platform/src/ai/local-provider-config.ts`、`apps/platform/src/config/platform-config.ts`、`pnpm ai:configure`
- 决定与删除：`apps/platform/src/decisions/`、`apps/web/src/pages/DataControlPage.tsx`
- 数据迁移：`packages/database/src/migrations/004_local_complete_mvp.ts` 至 `013_enforce_correctness_projection_ownership.ts`

## 5. 本地恢复

```powershell
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm source:candidates
pnpm source:assess
pnpm source:probe
pnpm catalog:materialize
pnpm dev
```

`source:probe` 会低频访问三个真实官方来源，只能由维护者明确运行；日常测试和 CI 不应调用它。产品入口：

- <http://127.0.0.1:5173/jobs>
- <http://127.0.0.1:5173/resume>
- <http://127.0.0.1:5173/recommendations>
- <http://127.0.0.1:5173/data-control>

日常工程门：

```powershell
$env:AIJOB_TEST_DATABASE_URL='postgresql://aijob:aijob@127.0.0.1:5432/aijob'
pnpm test
pnpm typecheck
pnpm build
pnpm lint
```

## 6. 不得改变的边界

- 不抓 BOSS、实习僧、牛客等综合平台，不绕过登录、验证码或访问控制。
- 未说明字段保持 `unknown`；资格、证据、偏好分开；不显示匹配百分比或自动劝退。
- `pending_review` 只允许本机目录，不得写成获准公开或 G3 已通过。
- AI 不修改三轴、不创造经历、不调用工具；原文件不发送给模型。
- 不自动填写、模拟登录、批量投递或替用户提交。
- 不引入 Redis、向量库、独立搜索、消息总线、生产 Playwright 或公共管理后台。
- 不提交 `.data/`、密钥、令牌、简历原文、本地数据库或下载的 DOCX。

## 7. 新任务接手检查

```text
[ ] 已读 AGENTS.md、README.md、docs/06-mvp-roadmap.md 和本交接
[ ] 已检查分支、git status、最近提交和未提交差异
[ ] 已确认目录是 31 条 local_mvp 岗位，三个来源仍 pending_review
[ ] 已确认产品证据仍为 E0，G0/G1 未开始，G3 为 0/3
[ ] 已确认 G2 已于 2026-07-20 重新通过，但产品证据仍为 E0，G0/G1 未开始，G3 为 0/3
[ ] 已确认不会读取、打印或提交本机 AI 密钥
```
