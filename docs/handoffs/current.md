# 当前项目交接：G2 已完成，G0 待启动

> 交接日期：2026-07-19
>
> 当前分支：`codex/g0-research-prototype`
>
> 动态事实源：[MVP 路线与当前决策面板](../06-mvp-roadmap.md)
>
> 工程证据：[G2 本地完整 MVP 工程验收记录](../evidence/g2/local-complete-mvp-engineering-2026-07-18.md)

## 1. 当前唯一目标

冻结已通过的 `G2 Local Complete MVP` 工程基线，等待 coco 明确启动 G0 的 2 人协议校准。6 人正式验证仍在 G0 之后；产品证据保持 `E0`。

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
- 三轴、32 个命名金标、确定性推荐、冻结核验时间、五态决定和官方链接交接已实现。
- AI 只能选择已确认 evidence/requirement ID，最终文本由服务端确定性组装；失败时安全降级为模板。
- 固定合成数据的真实 OpenAI-compatible 冒烟已通过；共享精确输出契约与 `resume-tailoring-selection-v2` 防止模型自创字段名，Schema 保持严格。
- 本地 AI 配置通过 `pnpm ai:configure` 写入 Git 忽略的后端文件；前端没有供应商配置接口，线上配置来源留待部署阶段替换。
- 逐段决定、复制、冻结后的 DOCX 和全部个人数据删除已跑通。
- 本地简历加密密钥首次启动时随机生成并保存在 Git 忽略的 `.data/`；`alpha/production` 必须显式配置，不再使用源码固定密钥。
- 用户任务的开始、成功和失败写入均在同一事务核对 owner、epoch、租约、心跳期限与 fencing token；租约接管和删除撤销后的旧 worker 不能写回业务表。
- 简历解析结果只持久化无正文元数据；完整候选仅在 active owner 和 24 小时 TTL 内从加密文本即时重建，确认、到期或失败会清除正文与原始文件名。
- 固定 owner 保留期到期会并发幂等地创建删除墓碑、撤销会话并清理全部个人数据；DOCX 密文 24 小时、结构化数据 30 天、无正文审计与删除墓碑 90 天的边界均有 PostgreSQL 集成覆盖。
- 简历确认与 owner 删除后会清理浏览器中的原文、画像、推荐和优化缓存；岗位详情不会展示属于其他岗位版本的旧匹配结果。
- 语义相同的新来源修订通过关联表复用不可变岗位版本；目录物化使用 PostgreSQL advisory lock 串行提交。
- 2026-07-19 全量结果：237 项测试、TypeScript、生产构建、197 文件 lint 和生产依赖审计全部通过。
- 320 px 下目录、详情、推荐、优化和数据控制无全局横向溢出。

## 3. 当前未完成项

1. G0 的 2 人协议校准尚未开始；只有 coco 明确启动后才招募、执行和记录，不以工程测试代替参与者。
2. G3 来源准入仍为 0/3，三个来源继续保持 `pending_review` 和仅限本机的 `local_mvp` 状态。
3. 公开 AI 仍未获批准，需要后续供应商、隐私、合规和至少 4/6 增量价值 Gate。

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
- 数据迁移：`packages/database/src/migrations/004_local_complete_mvp.ts` 至 `010_enforce_purged_resume_analysis_erasure.ts`

## 5. 本地恢复

```powershell
pnpm install
pnpm infra:up
pnpm db:migrate
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
[ ] 已确认 G2 已完成，但产品证据仍为 E0，G0/G1 未开始，G3 为 0/3
[ ] 已确认不会读取、打印或提交本机 AI 密钥
```
