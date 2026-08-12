# PA-1 离线身份与解析隔离候选验收（2026-08-12）

> 后续状态：PA-1 已完成并归档；本文的“等待下一项 Private Alpha 准备工作”准确记录当时决定，但已被 coco 后续批准的[Career OS 前台体验收敛计划](../../../plans/career-os-current-delivery-plan.md)取代。当前不得从本验收生成邮件、服务器、解析镜像或其他 PA 任务。

## 1. 当时决定

**当时决定为：完成 PA-1 离线候选，等待 coco 决定下一项 Private Alpha 准备工作。该等待状态现已被文首所述 UX 决策取代。**

这个决定只确认：在不访问真实邮件、真实招聘来源、真实 AI、真实简历和服务器的前提下，受邀邮箱身份、匿名 owner 认领和简历解析容器边界已经形成可测试候选，并通过合成数据工程与浏览器 Gate。

它不表示服务器就绪 Gate、Private Alpha、G0/G1 或 G4 已通过。真实邮件投递供应商尚未接入；本机没有获准取得的 digest 固定解析镜像，因此没有把“容器参数与失败关闭通过”写成“真实解析镜像已经运行”。

## 2. 固定范围与离线边界

- 只复用 migration 025 已有的 `accounts`、`email_identities` 和 `email_verification_challenges`，没有新增数据库或 migration。
- 只使用合成邮箱、固定测试验证码、合成 owner/职业资产和名称匹配 `aijob_*_test_*` 的隔离 PostgreSQL。
- 没有访问真实邮件服务、招聘站、AI、简历、业务数据库或远程服务器；没有新增 SDK、Redis、向量库、第二套队列或第二套认证。
- `fixture` 邮件投递只存在于 local/test，并被配置校验明确禁止用于 Alpha/Production；未接真实供应商时远程邮件投递保持关闭。
- Alpha/Production 必须显式提供独立身份主密钥；解析器只能选择容器模式和 `image@sha256:<digest>`。本地密钥派生与进程解析回退都在远程环境被拒绝。

## 3. 身份候选

- 共享邀请码不再被解析或用于访问控制；Private Alpha 入口改为受邀邮箱两步验证。
- 规范化邮箱通过 backend-only master key 做 HMAC 查找；数据库不保存可搜索的邮箱明文。邮箱可恢复值使用 AES-256-GCM 密文、随机 nonce 和认证标签；验证码和幂等请求均只保存 keyed hash。
- Challenge 使用 PostgreSQL 持久化状态、过期时间、重试时间、错误次数和锁定状态；错误次数在进程重启后仍保留，同一 challenge 只允许消费一次，并发完成只有一个成功。
- 未受邀邮箱与受邀邮箱创建 challenge 均返回同形 202，未受邀地址不进入投递夹具，避免直接暴露邀请名单。
- 登录和认领成功后撤销旧会话并轮换 session/CSRF token；Alpha Cookie 使用 `Secure`、`HttpOnly`（session）和 `SameSite=Strict`；mutation 继续要求精确 Origin 和 CSRF。
- 匿名 owner 可在“数据与设置”验证邮箱并认领；认领保持同一 owner/epoch 和既有职业资产，只把 retention mode 改为 `account_managed`。
- `change_email` 明确返回尚未开放，没有在本切片偷偷扩展。

## 4. 解析隔离候选

容器命令边界固定包含：

- `--network none`、`--read-only`、`--user 65532:65532`；
- `--cap-drop ALL`、`no-new-privileges`；
- 256 MiB memory/memory-swap、0.50 CPU、32 pids；
- 只有 16 MiB、`noexec,nosuid,nodev` 的临时目录；
- 无 volume/mount，简历 bytes 只经 stdin 输入，输出仍受 1 MiB 上限、超时和 abort 控制；
- 子进程环境只保留最小系统变量，不继承数据库、AI 或简历加密密钥；
- runtime 或 digest 镜像缺失时失败关闭，不回落到宿主进程解析。

本轮没有外部拉取或构建真实解析镜像，所以只验收配置强制、容器参数、秘密隔离和失败关闭；实际镜像供应链与运行证明仍属于后续服务器 Gate。

## 5. 浏览器证据

两个 Gate 都使用本机 loopback、合成邮箱和内存 fixture delivery：

1. Alpha 受邀登录：1280 px 下完成受邀邮箱、错误验证码、正确验证码、会话刷新；错误后焦点返回验证码输入框。切换 320 px 后无水平溢出，键盘焦点有效；所有请求只到 `127.0.0.1`/`localhost`，成功路径控制台和页面错误为空。
2. 匿名 owner 认领：从 `/settings/data` 建立本机匿名 owner，验证合成邮箱后会话 token 轮换；刷新后仍为“长期账号管理”，认领入口消失；请求仍只有 loopback。

浏览器脚本：

- `apps/web/scripts/pa1-browser-gate.cjs`
- `apps/web/scripts/pa1-owner-claim-browser-gate.cjs`

## 6. 最终工程 Gate

最终回归使用全新隔离库 `aijob_pa1_release_test_20260812`：

| Gate | 结果 |
|---|---|
| Config | 20/20 |
| Contracts | 79/79 |
| Database | 54/54 |
| Platform | 461/461 |
| Web | 142/142 |
| 合计 | **756/756** |
| `pnpm lint` | 通过，451 files |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm audit:ci` | 退出码 0；1 个既有 high 继续由已提交审计基线忽略，本切片未新增依赖 |
| `git diff --check` | 通过 |

Web 生产 main chunk 为 566.69 kB（gzip 162.67 kB），相对 M4 的 564.42 kB 增长 2.27 kB，约 0.40%。Resume Editor 29.23 kB、Interview 23.51 kB、数据设置 12.05 kB，继续保持独立 lazy chunk；既有大于 500 kB warning 仍是技术债。

## 7. 未通过与后续约束

- 真实邮件投递、退信/投诉处理和供应商合规未开始。
- digest 固定解析镜像的构建、签名/来源证明和真实容器解析未开始。
- 私有 HTTPS 部署、密钥引用、数据库最小运行角色实跑、备份恢复、监控、回滚和 20 并发负载未开始。
- 可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位仍为 0；产品证据仍为 E0。

因此服务器就绪 Gate 仍未通过；不得启动参与者测试或把本证据描述为生产就绪。
