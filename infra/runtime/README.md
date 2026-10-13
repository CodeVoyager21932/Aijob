# 产品主体运行包

这是候选运行配置，当前按 `docs/handoffs/current.md` 和 `docs/evidence/experience-upgrade-2026-09-07/README.md` 继续 U0–U6 联验。尚未完成的服务器、来源准入、邮件实投和真实 AI 检查不能由本文件代替。

## 运行拓扑

保留 PostgreSQL 与三个数据库权限边界。Web API 和 match-worker 作为独立非 root 主机服务运行；collector-worker 使用只读根文件系统的独立容器。解析器是无网络、短生命周期容器。现有静态页面由 HTTPS 反向代理提供，`/v1` 转发至仅监听回环地址的 API。内部供给台只通过本机或 SSH 隧道访问，不代理到公共站点。

1. 从同一候选版本执行 `pnpm install --frozen-lockfile`、`pnpm build`。主机服务使用 `tsx dist/...`，只为解析 workspace 包当前的 TypeScript exports；应用入口和静态页面使用本轮构建产物。
2. 用 `Dockerfile` 分别构建 `platform`、`resume-parser`、`web` targets；记录镜像 digest。解析器配置必须是 `repository@sha256:...`。platform 内的 workspace exports 由构建步骤转换为 dist，原仓库文件不改变。
3. 为 web、match、collector、ops、migrator 分别创建已有数据库 role 的登录成员；禁止把 migrator 登录发给运行服务。环境文件参照 `runtime.env.example` 拆分、填写，并置为仅服务账号可读。示例空值不能直接启动。
4. 个人数据加密钥只供 web/match。collector 全局配置所需的加密字段使用它自己的独立随机值，不能复用个人密钥；其数据库角色没有读取个人数据的权限。公开岗位采用规则路径；若未来显式启用公共 AI，预算和密钥单独提供，不复用用户个人 API。
5. Web API 的解析命令需使用该普通服务账号的 rootless 容器运行环境。不要给 Web 容器挂载 root Docker socket。当前解析子进程不继承 `DOCKER_HOST`；若 rootless socket 不是 Docker 默认端点，在受控 PATH 中提供由管理员维护的 `docker` 包装入口，固定 `--host unix:///run/user/<uid>/docker.sock` 后转发参数。用实际服务账号验证解析；未配置时 PDF/DOCX 上传不就绪。
6. 主机安装 Chromium 与可分发中文字体。镜像中的 `font.py` 从 Debian Noto Sans/Serif CJK 提取简体中文 OTF，修正已复现的 PDF 字符映射问题，并重命名为 Aijob Sans/Serif CJK。可从已构建镜像复制 `/opt/fonts` 到主机字体目录，连同许可证和 `font-provenance.json` 保留。Windows 测试字体不能作为发布资产。Linux 保持 Chromium sandbox 启用；内核 user namespace 不可用时先修运行环境。
7. 修改并安装两个 systemd 单元中的账号、pnpm 路径、目录和权限；运行目录与 `.data` 需允许相应账号读写。collector 使用 `collector.compose.yaml`，填写五个 `AIJOB_*` 路径/镜像变量。它不挂载 Docker socket、不暴露端口，`.data` 单独持久化。
8. 先保持定时采集与 AI 关闭。通过来源接入台核对已登记范围，启用来源后，再将 collector 环境中的 `COLLECTOR_AUTOMATION_ENABLED=true`。正常同范围更新不重复审批；暂停来源由内部台恢复。

容器 seccomp 文件基于 [Playwright 官方配置](https://github.com/microsoft/playwright/blob/main/utils/docker/seccomp_profile.json)，获取日期 2026-09-06；额外放行 Chromium 在子用户命名空间中的 `chroot` 系统调用，宿主能力仍全部移除。与非 root 用户和 no-new-privileges 一起，已完成 Linux 中文 PDF 沙盒冒烟；实际服务器仍需重验。所复用的seccomp配置许可参见[本地Apache-2.0许可证](licenses/playwright-Apache-2.0.txt)与[上游许可证](https://github.com/microsoft/playwright/blob/main/LICENSE)。

## 数据升级与回滚

先停止入口写入与三个 worker，备份数据库和所需加密配置；在新建的恢复库中执行 `pg_restore`，再用 migrator 执行前向迁移。确认旧 Case 固定版本、投递快照、owner 隔离、删除和迟到任务检查通过后，才切换实际业务库。本轮已对已恢复业务库完成038→053升级：先保存独立dump/密钥备份，升级后检查历史内容散列与本机目录/图谱；实测记录见 `docs/evidence/product-core-upgrade-2026-09-06/recovered-database-upgrade.json`。原业务库没有个人Case样本，其升级语义由专属夹具验证。

当前新代码依赖061。054–061已在专属测试/浏览器库验证；2026-09-08业务恢复库在备份与克隆演练后也已升级061，80张旧表原有字段一致。本轮证据为 `docs/evidence/experience-upgrade-2026-09-07/business-upgrade.json`，此前038→053证据仍只说明上一轮。

039–061 为前向迁移，不执行破坏性 down。升级后若应用故障，先停止写入；代码回切只在旧版读取兼容已验证时使用。需要恢复旧 schema 时，从升级前备份恢复到另一个数据库，切换连接并保留故障库。升级后已有新写入时，先导出和核对差异，不能直接覆盖丢弃。至少完成一次隔离恢复演练，再记 RPO/RTO 达标。

## 启动验收与监控

- HTTP：`/health/live`、`/health/ready`；未准入来源的公开目录应为空。检查 HTTPS、origin、会话绑定、真实邮件验证码、CSRF、跨 owner、删除后重试。
- 完整旅程：无简历浏览 → 原句 → 收藏/准备 → 直接导入或编辑材料 → 实际投递稿 → 日程/ICS → 面试/复盘；无岗位也能从简历和练习开始。真实 PDF 核对中文、分页、可复制文本和离线渲染；实际解析容器核对无网络与资源限额。
- 每分钟采样目录/图谱/Case 延迟与错误率，记录实例 CPU/RSS、数据库连接、队列最老待执行时间、重试/死信数量、PDF 忙碌与超时、AI 预算/失败。日志不能含简历正文、邮件验证码或凭据。
- 每轮保留采集任务与错误分母，报告全部计划刷新自动成功率、人工介入、恢复时长、新鲜度及首次接入耗时。没有真实连续观察时填“未测”，不按离线夹具填写自动化成功率。
- 供给企业/岗位数与分布继续如实报告，不能重新设回 100/1000 数量硬门槛。

正式发布需要真实域名、HTTPS、邮件、用户BYOK连接能力，以及已准入来源的连续更新证据。部署方不必提供模型；真实用户配置的模型效果单独评价。当前提供的是可检查的运行配置和构建路径，不代表已经部署。

## 用户自带 API 与本轮材料运行条件

个人 AI 使用当前账户的连接配置，不回退到运营方 `AI_API_KEY`。部署方无需选供应商或提供个人模型服务。首版支持 Chat Completions 兼容协议，用户在 `/settings/ai` 配置 URL、模型、密钥、JSON 模式、超时与个人预算；连接测试由 match-worker 执行。平台仍需提供后台任务执行环境和稳定的 `RESUME_ENCRYPTION_KEY`，否则无法解密用户自行保存的密钥和原件。

`ENABLE_AI=false` 和运营方空模型变量可保留。用户级连接及预算独立存储，不能把运营方 `PERSONAL_AI_*` 的旧默认值当作 BYOK 开关。反向代理只暴露应用 API，不将内部采集台对外开放。用户请求地址由服务端网络策略校验，不允许访问内网或云元数据。

原件与临时解析存储分离，旧清理任务不能擦除 `resume_originals`。资料随用户主动删除而删除，新访客会话过期不等于资料到期。备份应同时保留数据库及对应加密配置；更换随机密钥会使旧原件/API 配置不可读。

中文 PDF 运行环境设置 `PDF_BROWSER_EXECUTABLE`、`PDF_FONT_PATH`（无衬线）、`PDF_SERIF_FONT_PATH`（衬线）。镜像中的 `font.py` 同时提取 Noto Sans/Serif CJK 简体中文字体；Windows SimHei/SimSun 只作本地验证，不能随发布包分发。渲染拒绝外网访问，DOCX 和 PDF 分别验收，不能假定页数一致。

2026-09-08 的 Linux 实测发现：直接提取的 Noto CFF 字体会在 Chromium 的 Type3 PDF 中把部分普通汉字映射为兼容部首，把邮箱中的 `fi` 映射为连字。当前字体脚本只去掉指向同一字形的冗余兼容别名，并关闭可选连字；不改简历正文，也不删独立字形或必要字形替换。生成字体使用新名称，保留上游许可、来源及输出 SHA-256。修改后的字体必须连同 `LICENSE-Noto.txt` 分发。不能只靠页面外观通过验收；需要原始字符和实际解析器读回检查，复现脚本在 `docs/evidence/runtime-continuation-2026-09-08/linux-export/`，容器解析验证入口为 `infra/runtime/verify-container-parser.mts`。

本轮需在部署候选上重验：原件上传/下载、独立解析容器、用户 API 连接与五类任务、中文多页 PDF、后台任务并行、备份恢复和账号邮件。无真实供应商凭据时协议夹具通过只能证明接入路径，不能证明模型回答质量。

2026-09-09队列更新：`OWNER_TASK_INTERACTIVE_CONCURRENCY`控制**每个match-worker进程**的助手和API连接检查槽位，范围1–16，默认8；解析、后台各保留1条通道，另有独立维护循环。设置2可恢复低资源配置；多个worker实例的容量相加，数据库连接及每个用户的API并发/预算仍独立约束。此参数由部署方配置，不增加学生的操作步骤，不启用运营方模型。

个人API并发暂满时，任务1秒后重新排队，不扣调用预算、不耗尽失败重试；真实请求失败、预算耗尽及配置变更仍明确报错。用户可以区分排队与已领取处理状态；过期租约不显示为处理中。

默认空闲轮询保持500ms。同一台16GB开发机的120次/12秒合成突发，2→8槽位（同为50ms测试轮询）排队p95由63.39秒降至7.35秒；8槽位/默认500ms独立复测7.02秒，全部完成。短时夹具不能证明真实慢供应商、数小时运行或生产容量。完整分母、解析、取消与内存证据见`docs/evidence/interactive-queue-2026-09-09/README.md`。
