# 【历史归档】项目交接：PA-1 离线候选已完成

> 归档日期：2026-08-12。本文只保留 PA-1 完成时的工程事实，不提供当前任务。当前执行见[现行交接](../current.md)。

> 交接日期：2026-08-12
>
> 当前分支：`codex/career-os-pa-1`
>
> 分支起点：`aa4cf75 test(web): accept m4 engineering browser gate`
>
> 精确 HEAD 以 `git log -1` 为准。

动态事实源：[MVP 路线图](../../06-mvp-roadmap.md)

最新验收：[PA-1 离线身份与解析隔离候选](../../evidence/product/career-os-v2/pa-1-offline-identity-parser-candidate-acceptance-2026-08-12.md)

后续守门清单：[Private Alpha 与上线就绪 Gate](../../plans/private-alpha-readiness-gates.md)

## 1. 当前决定

M1–M4 已完成；coco 授权的 PA-1 已在严格离线边界内形成身份与解析隔离候选。

**完成 PA-1 离线候选，等待 coco 决定下一项准备工作。**

这不是服务器就绪或 Private Alpha 就绪：真实邮件供应商、实际 digest 解析镜像、HTTPS 部署、备份恢复、监控和负载仍未通过。

## 2. 已通过工程基线

- 共享邀请码不再用于访问控制；受邀邮箱 challenge 使用 PostgreSQL 持久化过期、重试、错误次数与一次消费状态。
- 邮箱查找值、验证码、幂等请求和 session/CSRF 只保存 keyed hash；邮箱可恢复值使用 AES-256-GCM 加密，不进入普通日志或响应。
- 匿名 owner 可在数据设置验证邮箱并认领；同一 owner/epoch 和已有职业资产保持不变，会话 token 轮换，保留模式改为 `account_managed`。
- Alpha Cookie 为 Secure/HttpOnly（session）/SameSite=Strict；mutation 保持精确 Origin 与 CSRF；未受邀邮箱返回同形响应但不投递。
- Alpha/Production 解析配置只接受 digest 固定容器；命令边界无网络、只读、非 root、丢弃 capabilities、限制内存/CPU/pids、无 mounts，缺少 runtime/image 时失败关闭。
- 浏览器通过受邀登录、错误码焦点恢复、刷新会话、320 px 无横向溢出、键盘焦点、匿名 owner 认领与 token 轮换；所有请求只到 loopback。
- 最终全仓：Config 20、Contracts 79、Database 54、Platform 461、Web 142，共 **756/756**。
- `pnpm lint` 451 files、`pnpm typecheck`、`pnpm build`、`pnpm audit:ci` 和 `git diff --check` 通过。
- Web main 566.69 kB；Resume Editor 29.23 kB、Interview 23.51 kB、数据设置 12.05 kB，重工作区继续 lazy load。

## 3. 主要代码入口

- `apps/platform/src/identity/email-verification-service.ts`：challenge、邀请资格、错误次数、认领/登录与一次消费。
- `apps/platform/src/identity/email-crypto.ts`：邮箱 HMAC、验证码/request hash 与 AES-GCM。
- `apps/platform/src/identity/fastify.ts`：Cookie、Origin、CSRF、Alpha 未登录边界与身份路由。
- `apps/platform/src/resume/parse.ts`：解析器容器参数、最小环境、超时/abort 与失败关闭。
- `apps/web/src/components/AlphaAccessGate.tsx`：受邀邮箱两步访问入口。
- `apps/web/src/career-os/components/OwnerClaimPanel.tsx`：匿名 owner 认领入口。
- `apps/web/scripts/pa1-browser-gate.cjs` 与 `pa1-owner-claim-browser-gate.cjs`：离线浏览器 Gate。

## 4. 未通过与风险

- 真实邮件投递、退信/投诉处理和供应商合规未开始；远程 delivery 当前为 disabled。
- 本机没有获准取得的 digest 固定解析镜像；只证明容器命令、安全参数、配置强制和失败关闭，未证明实际镜像解析。
- 服务器最小角色实跑、HTTPS、密钥引用、备份恢复、监控、回滚与 20 并发负载未开始。
- 产品证据仍为 E0；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位均为 0。
- main chunk 既有大于 500 kB warning 仍存在；审计仍有 1 个已登记忽略的开发链 high。

## 5. 固定排除与数据安全

- 未经新授权，不接真实邮件/AI/招聘来源/服务器/参与者，不获取外部解析镜像，不使用真实简历或业务数据库。
- 不新增数据库/migration/Redis/向量库/第二套队列/第二套认证/AI SDK；不做 G4 前 contract migration，不移除 `VITE_CAREER_OS_V2`。
- 不读取、修改、暂存、覆盖、清理或提交 `.claude/`、`.data/`、密钥、令牌、真实简历原文、下载产物或截图。
- 自动化测试、构建和 Alpha/Production 不访问真实招聘站；公共目录在来源准入前保持为空是正确行为。

## 6. 下个任务接手清单

1. 依次阅读 `AGENTS.md`、README、路线图、本交接、计划索引、当前交付计划与 PA-1 证据。
2. 核对实际分支、HEAD、远端、工作树、容器和 3000/5173/5432 端口；冲突先报告。
3. 当前没有自动下一任务；只有 coco 明确授权后才创建独立 `codex/` 分支继续。
4. 新测试仍使用全新且匹配 `aijob_*_test_*` 的隔离库，只写合成数据，结束后精确清理并停止服务。
