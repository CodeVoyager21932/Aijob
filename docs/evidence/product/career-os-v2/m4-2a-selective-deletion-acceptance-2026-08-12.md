# M4-2A 单项删除与选择性级联验收

> 日期：2026-08-12
>
> 结论：**通过 M4-2A 工程验收，决定继续 M4-2B 数据真相与错误恢复**
>
> Platform/Contracts：`e1ede50 feat(platform): add selective career asset deletion`
>
> Web：`9cfe889 feat(web): add explicit career asset deletion controls`

## 1. 用户可见结果

- Case、基础/岗位简历、Interview Session 与 Debrief 均有明确的 owner 单项删除入口；删除是用户主动操作，不由 TTL 文案推动。
- 删除 Case 前必须分别决定岗位简历、面试练习和复盘是“同时删除”还是“保留并脱离”；三项均无默认选择，未完成选择时不能提交。
- 保留的岗位简历可继续从简历资产列表发现并单项删除；它保留固定岗位版本、基础简历与证据来源，不会伪造成新的 Case。
- 删除面试不会擅自删除已形成的复盘；复盘继续具有自己的删除入口。关闭确认框、Escape 与成功后的导航均有明确焦点/状态处理。
- 私有 JD 只要仍被活动 Case、Resume、Interview 或 Debrief 引用就继续仅对 owner 可见；最后一个活动引用删除后，私有快照被墓碑化，不进入公共岗位目录。

## 2. 契约与数据动作

新增四个 owner-protected 命令：

```text
DELETE /v1/application-cases/:caseId
DELETE /v1/resume-documents/:documentId
DELETE /v1/interview-sessions/:sessionId
DELETE /v1/debriefs/:debriefId
```

- 每个请求均要求 `expectedRevision`；Case 请求还要求三类关联资产的 `delete | detach` 决定。跨 owner、已删除且无法证明是同一重放的资源统一不可枚举 404，stale revision 返回 409。
- 删除服务在单个 PostgreSQL 事务中锁定 owner epoch 与目标资产。聚合使用既有 `deleted_at` 墓碑；Case 的要求状态、备注/问题、证据连接与知识连接按既有删除顺序移除；Resume Review 先墓碑化再墓碑化 Resume。
- 同一 `expectedRevision` 与同一选择的删除请求可在墓碑后自然重放并返回同一投影；同一 Case 以另一组删除/脱离选择重放时返回 `APPLICATION_CASE_DELETION_REPLAY_CONFLICT`。
- 本切片没有新增删除回执表，因此没有宣称或伪造稳定 `Idempotency-Key` 收据；重放安全由 revision、墓碑和选择投影共同保证。Case revision 递增一次，但没有为不存在于既有枚举中的“删除事件”伪造 Case event。
- 所有路由保持 CSRF、`no-store`、owner epoch 与现有迟到写入 guard；没有新增 migration、物理级联、删除队列、认证或依赖。

## 3. 自动化与工程 Gate

- Contracts focused：删除请求、三类选择、响应与严格解析通过；Contracts 全包 74/74。
- Platform 删除集成：9/9 通过，覆盖单项删除、Case 删除/脱离、重放冲突、私有快照最后引用、跨 owner 404、CSRF 和 `no-store`；Platform 全包 458/458。
- Web 删除组件/API focused：10/10；Web 完整回归 133/133。
- 使用全新隔离库 `aijob_m42a_test_5ba3d3f20ef24c6fa40daeda95194846` 运行标准 `pnpm test`：Config 17、Contracts 74、Database 54、Platform 458、Web 133，共 736/736。
- `pnpm lint`：439 files，通过；`pnpm typecheck`、`pnpm build`、`git diff --check` 均通过。
- `pnpm audit:ci` 退出码 0；报告的 1 个 high 属于仓库已批准忽略的既有审计基线，本切片没有新增依赖。
- 为消除全包顺序下的偶发测试抖动，路由注册测试改为 Fastify `hasRoute`，大目录夹具在装载/清理后显式 `ANALYZE`，三个既有重集成用例使用更诚实的 30 秒上限；没有放宽业务断言。
- 本轮创建的 9 个精确命名隔离测试库已逐项删除，项目 PostgreSQL 容器与网络已关闭。

## 4. 加载、浏览器与证据边界

- Web main chunk 为 562.16 kB；相对 M4-1 的 560.59 kB 增长 1.57 kB，约 0.28%，未超过 10% 边界。
- 删除确认组件为 5.45 kB；Resume、Requirements、Interview 等重工作区仍为独立 lazy chunk，没有进入岗位列表首屏。
- 本切片没有重复 M4 完整浏览器总验收。1280/320、200% 等效、键盘全流程、控制台、刷新/历史和旗标回退统一由 M4-4 守门；本记录只证明组件焦点/键盘测试和工程行为，不冒充视觉 Gate。
- 脱离后的 Interview/Debrief 已安全保留，但当前没有跨 Case 的用户资产索引；M4-2B 必须在真实数据范围中展示并提供可管理入口，不能把“底层保留”冒充“当前已方便发现”。
- 没有访问真实招聘来源、真实 JD、真实 AI、真实简历、邮件、服务器或参与者数据；没有读取、修改、暂存或提交 `.claude/`、`.data/`、密钥、令牌、本地业务数据库、下载产物或截图。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位仍为 0。

决定为 **继续**：当前唯一切片切换为 `M4-2B 数据真相与错误恢复`。下一切片只处理真实 owner 保留模式/到期时间和完整资产范围、简历确认原子提交、会话失效恢复、用户可见开发标签及未实现主导航；不得扩展邮箱账号、真实 AI、Knowledge、真实来源或服务器。
