# M4-2B 数据真相与错误恢复验收

> 日期：2026-08-12
>
> 结论：**通过 M4-2B 工程验收，决定继续 M4-3 一岗本地测试候选**
>
> Contracts / Platform：`b7f9354 feat(platform): expose career data truth atomically`
>
> Web：`edbdb69 feat(web): surface real career data boundaries`

## 1. 用户可见结果

- Career OS 的 `/settings/data` 不再复用写死“匿名 30 天”的旧页面，而是读取当前 owner 的真实保留模式、职业资产到期时间和会话到期时间。匿名模式不会伪装成长期账号；`account_managed` 模式不会显示固定自动到期日。
- 数据范围覆盖当前 Facts、Preferences、Evidence、简历内容修订、解析元数据/待清除内容、Cases、私有 JD、Resume Documents/Reviews、Interviews、Debriefs、Knowledge、旧流程兼容记录和删除状态审计。
- Case 删除后保留的岗位简历可前往 `/resumes` 管理；脱离的 Interview/Debrief 在设置页列出固定岗位上下文，并复用既有 owner-protected 单项删除命令。
- 顶层导航只保留已有真实页面的今日、岗位、我的求职和简历资产；尚无跨 Case 索引的 Interview/Knowledge 占位入口已移除，Case 内现有面试与复盘不受影响。
- 用户可见的 M1/M2/M3/Phase/PoC 开发标签已从正常 Career OS 页面移除；旧离线夹具中的历史注释不参与运行时界面。

## 2. 数据、事务与会话边界

新增两个 owner-protected 接口：

```text
GET /v1/profile/data-scope
PUT /v1/profile/confirmation
```

- 数据范围使用一个聚合计数查询和两个有界的脱离资产查询，全部按 `owner_id + owner_epoch` 隔离。私有岗位标题按 Interview/Debrief 固定的 `job_context_revision` 读取，不会偷换成私有快照的最新修订；删除审计也只统计当前 owner epoch。
- 简历确认把 Facts、Preferences、结构化 Document/Evidence 与解析原文清除放入同一个 PostgreSQL 事务。锁顺序固定为 Preferences → Facts → Evidence；任一 expected revision 冲突或 Evidence 写入失败时，先前插入和原文清除全部回滚。
- 旧的三个独立 Profile PUT 继续兼容其他既有调用，但 `ResumeConfirmPage` 只调用新的原子命令；成功后一次更新三类查询缓存并立即移除已确认解析内容缓存。
- `GET /v1/session` 与 Alpha 会话创建统一返回可校验的公开 owner/session 投影，不包含 cookie、token、CSRF hash 或邀请凭证。owner-protected 响应增加不含凭证的 owner epoch 边界头，供前端识别本机身份更换。
- 读取请求和 DOCX 下载在 `SESSION_REQUIRED`/`CSRF_REJECTED` 后最多安全恢复一次；mutation 永不自动重放，改为返回 `SESSION_RECOVERED_RETRY_REQUIRED`，要求用户核对草稿后再次明确提交。
- owner 变化时清除旧 React Query 查询缓存和 journey ID，但保留 mutation/local component 草稿；全量删除仍清除查询与 mutation 缓存。本切片没有新增 migration、依赖、认证、数据库或队列。

## 3. 自动化与工程 Gate

- Contracts 全包：79/79，新增 owner/session 判别联合、数据范围和原子确认严格契约。
- Platform focused：4/4，覆盖 localhost/Alpha 会话、公开投影与边界头、原子成功/迟到冲突回滚、真实数据范围、脱离资产、固定私有岗位修订和 `no-store`。
- Web focused：25/25，覆盖数据真相页、匿名/账号模式、会话边界通知、读取/下载一次恢复、mutation 不重放、旧 owner 查询清理和导航收口。
- 使用全新隔离库 `aijob_m42b_test_0f2cbb5b1c9149c586c8e60a917e56e3` 运行全仓回归：Config 17、Contracts 79、Database 54、Platform 458、Web 141，共 749/749。
- `pnpm lint`：444 files，通过；`pnpm typecheck`、`pnpm build` 与 `git diff --check` 均通过。
- `pnpm audit:ci` 退出码 0；报告的 1 个 high 属于仓库已批准忽略的既有审计基线，本切片没有新增依赖。
- 本轮两个精确命名的 M4-2B 隔离测试库已删除，项目 PostgreSQL 容器与网络已关闭。

## 4. 加载、浏览器与证据边界

- Web main chunk 为 564.42 kB；相对 M4-2A 的 562.16 kB 增长 2.26 kB，约 0.40%，未超过 10% 边界。
- 数据设置页为 9.15 kB 独立 lazy chunk；Resume Editor 29.23 kB、Interview 23.51 kB 等重工作区仍保持独立，没有进入岗位列表首屏。
- 本切片没有重复 M4 完整浏览器总验收。1280/320、200% 等效、键盘/焦点、刷新/历史、控制台、打印和旗标回退统一由 M4-4 守门；本记录只证明工程、契约和 SSR/状态行为。
- 没有访问真实招聘来源、真实 JD、真实 AI、真实简历、邮件、服务器或参与者数据；没有读取、修改、暂存或提交 `.claude/`、`.data/`、密钥、令牌、本地业务数据库、下载产物或截图。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位仍为 0。

决定为 **继续**：当前唯一切片切换为 `M4-3 一岗本地测试候选`。下一切片只使用合成岗位和合成职业材料，把已有 Requirements、Resume/Review、DOCX/打印、外链交接、显式投递、模板面试、复盘回流、选择性删除和全部删除串成同一个可重复候选；不得借机扩建邮箱账号、Knowledge、真实 AI、真实来源或服务器。
