# Aijob 本地产品化研究：首用配置、启动恢复与运行维护

研究日期：2026-10-12 至 2026-10-13（北京时间，跨零点完成）。研究范围：普通 Windows 用户安装 Aijob 后，通过界面填写配置即可获得岗位并持续刷新；沿用 React/Vite、Fastify、PostgreSQL、web-api / collector-worker / match-worker。本文为分析建议，不是已实施结果。

## 结论

最适合本轮目标的主参考其实是 coco 原先给出的 **RecruitOps 的本地运行时**，再分别借鉴 AnythingLLM / Open WebUI 的连接配置交互、Graphile Worker 的恢复语义。不要把 Dify、Tauri、pg-boss 等全部装进 Aijob。

建议把产品做成 **一个 Windows 安装入口 + 一个由 Aijob 管理的本地运行时 + 原有网页工作区**。安装包负责依赖，运行时负责 PostgreSQL 和三个业务进程的生命周期，网页负责方向、岗位、简历、配置和运行反馈。普通用户不接触 Docker、数据库端口、命令行或来源 JSON。

这需要真正承担本地 PostgreSQL 的打包、初始化和升级责任。简单加一个“启动全部”的脚本，或在网页外包一个桌面窗口，不能独立满足目标。Docker 启动器可作为当前开发工作区的短期便利，但不能作为“普通用户无需技术配置”的最终交付。

## 研究方法与证据边界

- 检索一手 GitHub 仓库、官方文档、发布 API；阅读了配置组件、桌面运行时、调度源码和许可证。
- 没有安装、运行或修改第三方项目，没有启动/停止 Aijob 服务，没有访问用户密钥。
- 对 RecruitOps 只核对到公开发行资产确实存在及源码实现；没有下载运行约 739 MB 的发行包，不能声称已验证干净 Windows 上的安装体验、签名或自动恢复效果。
- 版本使用研究时读取的提交快照，避免把之后变动的主分支当成永久事实。部分文档与代码有差异，以下明确标出。
- 当前 Aijob 事实来自主任务本次只读核对：5173 网页、3000 API、collector、match、8091 内部台和 55439 PostgreSQL 分开运行，尚无普通用户安装包/统一开机恢复。本文不把这些建议描述为现有能力。

## 一、项目筛选与适用性

| 项目 | 研究快照 / 许可证 | 最值得借鉴 | 不采用的部分 | 判断 |
|---|---|---|---|---|
| RecruitOps | `1584307eef66b7e3f839e55cd74dd7e12d7b876d`，主项目 MIT | 唯一启动入口、依赖随包、owned PG、就绪后开工作台、需迁移才备份、运行与停止状态 | Python / Codex / 邮箱 / 自动表单、照搬路径绑定的人工升级流程 | 本地运行时主参考 |
| AnythingLLM | `6100f0c8b995511439402ed36d95c9667cadff57`，核心 MIT；桌面 wrapper 不在此核心仓库 | 用户安装产品而非搭开发环境；连接向导、模型列表及手填回退 | 大量供应商平铺、向量库/嵌入设置、把核心 MIT 等同完整桌面源码许可 | 首用交互参考 |
| Open WebUI | `f8ae8a6c328946dc62cd0712961a0632574581bf`，现为附品牌限制的 Open WebUI License | OpenAI 协议优先、验证连接、普通/高级设置、停用不删配置 | 整体移植、公共管理面板、直接从浏览器调用供应商、复制所有参数 | 协议配置参考 |
| Dify | `8ac58b0e405c91cc058881928197e68c78a5fdcc`，修改版 Apache-2.0，附多租户与前端标识条件 | 依赖就绪再启动、健康检查、面向维护者的配置层级 | Agent 平台、Redis/向量库/插件服务等完整基础设施；把 Docker quickstart 当终端用户安装 | 反例与运行检查参考 |
| Electron / Forge | 官方当前文档；两个项目 MIT | Node 业务进程、托盘、单实例、安装/更新工具、Windows 本地密钥保护 | 自建招聘浏览器、重新写工作区、跨网站桌面自动化 | 若要原生外壳，优先短名单 |
| Tauri 2 | 核心 `d62e5d9c0878b6fb327543cc9be50aa1696ee23c`；插件 `c91a9e6af5e51d75d03ae289eb69534ef22fb923`；Apache-2.0 OR MIT | 小外壳、受控 sidecar、登录自启、签名更新 | 为小安装壳重写后端 Rust；认为 sidecar 自动解决 PG 维护 | 可行备选，不与 Electron 并用 |
| Graphile Worker / pg-boss | `4cda192c5df254392a1dff350e5d73f7d2c18a85` / `c91e31f51e00892b98be0610a25c5dd004e085b8`，均 MIT | PG 持久调度、稳定任务标识、补跑边界、故障重试、时区 | 替换已有队列、再建 scheduler 数据真源、套用无限补跑 | 对照现有队列补语义 |

许可证原文：[RecruitOps](https://github.com/849879772/recruitops-agent/blob/1584307eef66b7e3f839e55cd74dd7e12d7b876d/LICENSE)、[AnythingLLM](https://github.com/Mintplex-Labs/anything-llm/blob/6100f0c8b995511439402ed36d95c9667cadff57/LICENSE)、[Open WebUI](https://github.com/open-webui/open-webui/blob/f8ae8a6c328946dc62cd0712961a0632574581bf/LICENSE)、[Dify](https://github.com/langgenius/dify/blob/8ac58b0e405c91cc058881928197e68c78a5fdcc/LICENSE)、[Electron](https://github.com/electron/electron/blob/main/LICENSE)、[Forge](https://github.com/electron/forge/blob/main/LICENSE)、[Tauri](https://github.com/tauri-apps/tauri/blob/d62e5d9c0878b6fb327543cc9be50aa1696ee23c/Cargo.toml)、[Graphile Worker](https://github.com/graphile/worker/blob/4cda192c5df254392a1dff350e5d73f7d2c18a85/LICENSE.md)、[pg-boss](https://github.com/timgit/pg-boss/blob/c91e31f51e00892b98be0610a25c5dd004e085b8/LICENSE)。设计参考不等于复制源代码；如复用具体代码再按对应文件及依赖许可处理。

## 二、深入项目核对

### 1. RecruitOps：不只是 README 里的“本地运行”

**核实到的事实：** GitHub Releases 实有 v0.1.7（2026-10-07）的 `RecruitOps-v0.1.7.zip`，738,771,245 字节，另有 SHA256 文件。它是需要完整解压的便携目录，里面的 EXE 是唯一启动入口，**不是所有组件压成一个独立 EXE**。README 明确随包带 Python、Node、Chromium、PostgreSQL，不要求先装 Docker。已有发行资产比“仓库有 build 脚本”证据更强，但仍不等于我们运行过发行包。[发布页](https://github.com/849879772/recruitops-agent/releases/tag/v0.1.7)、[便携包说明](https://github.com/849879772/recruitops-agent/blob/1584307eef66b7e3f839e55cd74dd7e12d7b876d/apps/desktop/packaging/README-PORTABLE.txt)

**已读核心实现：** `Supervisor.start` 获取实例锁、核验组件、租用端口，新实例才 initdb，启动绑定 loopback 的 PG，等待数据库，检查迁移，仅已有库且确有待执行迁移时备份，再启 API 并等待就绪。`tick` 在超过 30 秒心跳间隙后重新探测。`stop` 按自己持有的进程句柄退出 API/PG，记录停止结果。WindowsTree 用 Job Object 管控自己创建的进程，避免通配杀死用户其他数据库。[supervisor.py](https://github.com/849879772/recruitops-agent/blob/1584307eef66b7e3f839e55cd74dd7e12d7b876d/packages/desktop_runtime/supervisor.py)、[windows.py](https://github.com/849879772/recruitops-agent/blob/1584307eef66b7e3f839e55cd74dd7e12d7b876d/packages/desktop_runtime/windows.py)

**交互层也有实际实现：** 桌面 `main.ts` 注释并实现了运行时到 ready 后才打开工作台，避免端口已公布但 API/迁移未就绪造成首屏永久失败；源码也处理 Windows 关机不保证普通 quit 事件的差异。[main.ts](https://github.com/849879772/recruitops-agent/blob/1584307eef66b7e3f839e55cd74dd7e12d7b876d/apps/desktop/src/main.ts)、[packaged-runtime.ts](https://github.com/849879772/recruitops-agent/blob/1584307eef66b7e3f839e55cd74dd7e12d7b876d/apps/desktop/src/packaged-runtime.ts)

**不能照搬：** 其数据在 EXE 旁 `.data`；升级指南要求同电脑、同 Windows 用户、最终同绝对路径，人工完整复制 `.data`，不能只复制数据库或直接换路径。Aijob 应借运行时编排，避免把这套维护步骤交给普通用户。源码构建记录还会标为 unsigned integration candidate，公开资产存在不能推导系统签名、干净机测试或无痛升级均完成。[升级指南](https://github.com/849879772/recruitops-agent/blob/1584307eef66b7e3f839e55cd74dd7e12d7b876d/docs/UPGRADE_EXISTING_DATA.md)、[build.cjs](https://github.com/849879772/recruitops-agent/blob/1584307eef66b7e3f839e55cd74dd7e12d7b876d/apps/desktop/packaging/build.cjs)

**对 Aijob 的具体映射：** 把 Python supervisor 的职责改为 Aijob 自己的小型运行管理层，启动现有 TypeScript 构建产物；保留三个进程和三个 DB role，不能为了方便把所有后台逻辑塞进高权限 API。将 built Web 作为发布资源，终端用户不运行 Vite dev server。运行管理层只负责生命周期，不负责岗位业务。

### 2. AnythingLLM：安装体验与核心开源范围要分清

官方 Windows 文档确有下载、双击安装、桌面入口，要求当前用户安装，并说明首次启动可能较慢、关闭可进入托盘。[Windows 安装文档](https://docs.anythingllm.com/installation-desktop/windows)

但其贡献文档明说：`server` / `frontend` / `collector` 是核心，桌面 app 把核心装进 Electron wrapper，而 wrapper 不属于该核心仓库。**不能因主仓库 MIT，就写成“完整桌面启动器可直接拿来”。**[CONTRIBUTING](https://github.com/Mintplex-Labs/anything-llm/blob/6100f0c8b995511439402ed36d95c9667cadff57/CONTRIBUTING.md)

实际 React 组件 `GenericOpenAiOptions` 接收 Base URL/Key，调用 `System.customModels`；成功列出模型，没拿到列表就回退到自由输入模型 ID。这正好解决“我不知道模型名怎么选”和中转站不实现 `/models` 两种情况。[连接组件](https://github.com/Mintplex-Labs/anything-llm/blob/6100f0c8b995511439402ed36d95c9667cadff57/frontend/src/components/LLMSelection/GenericOpenAiOptions/index.jsx)

它的 LLM 向导仍有大量供应商列表，并带上下文窗口/Max Tokens 等字段，不能照抄为求职用户的第一屏。其流程源码还在 `handleForward` 中先调用 onboarding complete 再触发表单保存，因此不能仅凭“有向导”推断所有顺序都值得复制。Aijob 应以能力实际可用状态驱动完成标记，不以走完页面为准。[LLMPreference](https://github.com/Mintplex-Labs/anything-llm/blob/6100f0c8b995511439402ed36d95c9667cadff57/frontend/src/pages/OnboardingFlow/Steps/LLMPreference/index.jsx)

**采用：** 按任务组织配置，模型自动获取+手填回退，失败留在当前步骤。**不采用：** 向量数据库、本地模型下载、供应商大目录、要求用户了解 Token 参数。

### 3. Open WebUI：兼容协议比供应商菜单更重要

官方说明把 OpenAI-compatible 协议作为统一入口，`/chat/completions` 是基础，`/models` 为推荐而非必需；无模型列表时可手动填模型。连接可停用而不删除。Aijob 可提供 DeepSeek 官方预设与“OpenAI 兼容/中转”两种常见入口，底层仍走既有协议。[OpenAI-compatible 文档](https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/starting-with-openai-compatible/)

`AddConnectionModal.svelte` 有 `showAdvanced=false`、验证动作、模型列表、启停；`openai.py` 的 verify 路由主要访问 `/models`，具有模型列表超时。**这只证明连接/列表能力，不证明指定模型能完成 Aijob 所需 JSON 输出。** Aijob 的连接检查应保留一次短的真实生成验证；不能只拿 `/models` 成功当全部通过。[前端组件](https://github.com/open-webui/open-webui/blob/f8ae8a6c328946dc62cd0712961a0632574581bf/src/lib/components/AddConnectionModal.svelte)、[后端连接验证](https://github.com/open-webui/open-webui/blob/f8ae8a6c328946dc62cd0712961a0632574581bf/backend/open_webui/routers/openai.py)

它有管理连接与用户 direct connections 等多种配置层级，PersistentConfig 也区分环境默认和数据库保存值。对 Aijob 的提醒是：**设置页显示的必须是当前有效配置和其作用范围**，不要让用户改了网页又被 `.env` 静默覆盖。Aijob 不需要复制复杂连接治理平台。[环境配置](https://docs.openwebui.com/reference/env-configuration/)

### 4. Dify：值得借依赖就绪，不值得借部署重量

官方 Docker quickstart 对 Windows 明确要求 WSL2 + Docker Desktop，之后还要 clone、复制 env、compose 启动。它将自托管平台交给管理员维护，不是普通用户安装包。[官方 Docker 部署](https://docs.dify.ai/en/self-host/deploy/quick-start/docker-compose)

代码快照中 `docker/docker-compose.yaml` 已为 API、worker、worker_beat 配置 healthcheck，并使用 `service_healthy` 等条件；不能引用旧 GitHub issue 继续说这些检查不存在。可借鉴“数据库可连接不等于业务 worker 在工作”这一状态分层，不能照抄完整 Redis、sandbox、插件服务、向量库依赖树。[compose 源码](https://github.com/langgenius/dify/blob/8ac58b0e405c91cc058881928197e68c78a5fdcc/docker/docker-compose.yaml)

本轮不选择 Dify 作为 Aijob 的后台平台：它解决通用 LLM 应用编排，而当前缺口是用户首次拿到岗位、可靠运行和恢复。引入它会扩大安装和维护成本，而且触及既定 PG-only、三角色边界。

### 5. Electron / Tauri：都是工具，不是方案本身

**Electron 的匹配点：** Aijob 已是 TypeScript/Node 后端。官方 `utilityProcess.fork` 能运行 Node 子进程、接收进程退出、stdout/stderr 和消息；app API 提供启动/退出生命周期。可以做极薄壳：启动状态、托盘、打开工作区、退出，业务仍在原 Fastify/worker。[utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)、[app API](https://www.electronjs.org/docs/latest/api/app)

**成本：** 包含 Chromium，安装体积与补丁维护成本更高；原生依赖需检查打包路径。Forge 提供打包、签名/发布的流程工具，但不会替 Aijob 管理 PostgreSQL 或数据库迁移，也不会自动让采集程序跨站可靠。[Forge 说明](https://www.electronforge.io/core-concepts/why-electron-forge)、[原生依赖打包](https://www.electronforge.io/config/plugins/auto-unpack-natives)

**Tauri 的匹配点：** sidecar 支持把 API server 等可执行文件随包，明确到目标平台二进制、启动权限和参数；autostart 插件源码中 `enable/disable/is_enabled` 管理登录启动；updater 需要签名。[sidecar](https://v2.tauri.app/develop/sidecar/)、[autostart](https://v2.tauri.app/plugin/autostart/)、[autostart 源码](https://github.com/tauri-apps/plugins-workspace/blob/c91a9e6af5e51d75d03ae289eb69534ef22fb923/plugins/autostart/src/lib.rs)、[updater](https://v2.tauri.app/plugin/updater/)

**成本：** 仍须自行捆绑 Node 与 PG；增加 Rust 构建及 Windows WebView2 处理，不会因为壳小就让整体维护更简单。其 Windows installer 文档覆盖 WebView2 分发选择，也说明不能只看一个空壳体积。[Windows 安装包](https://v2.tauri.app/distribute/windows-installer/)

**建议：** 如果要桌面窗口，优先用薄 Electron 壳验证现有 Node 运行兼容，Tauri 作为有明确包体约束时的备选，不同时接入。若当前网页体验可继续用浏览器，原生启动器也可只开默认浏览器；核心交付仍是“打包的运行时”，不是必须新做桌面 UI。最终工具在一次针对现有 Native modules / PDF / 受控 browser 的打包小验证后确定，不开启框架比较长跑。

### 6. Graphile Worker / pg-boss：调度恢复语义，不换现有队列

Graphile Worker 的 cron 文档明确：以固定 identifier 去重；可为已知任务设补跑时间窗；新增任务不补发之前所有周期；定时器宜少量创建按用户拆分的任务。`src/cron.ts` 真正写 `_private_known_crontabs`，用 `last_execution` 和冲突条件锁定一次计划创建，并在新周期前做补跑。[cron 文档](https://worker.graphile.org/docs/cron)、[cron 实现](https://github.com/graphile/worker/blob/4cda192c5df254392a1dff350e5d73f7d2c18a85/src/cron.ts)

文档也指出，补跑时间窗内会补所有匹配周期，额外限制需执行器处理。Aijob 不应把“关机 7 天后恢复”变成 7 次重复搜索或 7 轮来源抓取；任务按方向/来源合并为一次到期刷新，保留预算、事件和订阅版本。时区存 IANA 名称，展示本地日历日期，执行比较用明确 UTC。[Graphile 配置](https://worker.graphile.org/docs/config)

pg-boss 的 `timekeeper.ts` 则有数据库时钟、timezone 校验、稳定 schedule key、missed policy、时钟偏移监测和停止等待等实现。可用来对照 Aijob 是否存在“进程看似活着但调度循环已停”的问题，不能用 README 的 exactly-once 字样代替业务侧幂等。[timekeeper](https://github.com/timgit/pg-boss/blob/c91e31f51e00892b98be0610a25c5dd004e085b8/src/timekeeper.ts)、[调度 API](https://github.com/timgit/pg-boss/blob/c91e31f51e00892b98be0610a25c5dd004e085b8/docs/api/scheduling.md)

两者不替换 Aijob 现有持久队列。当前已有租约、fencing、有限重试和事件机制，应补可见状态和恢复策略，避免为了借鉴再造任务系统。

## 三、推荐的 Aijob 本地形态

### 3.1 两层必须区分

| 形态 | 普通用户前置 | Aijob 要维护什么 | 建议用途 |
|---|---|---|---|
| 开发工作区统一启动器 | 已有 Node/pnpm、构建环境、Docker Desktop/WSL、现有 PG 容器 | 启动探测、进程与容器状态 | coco 当前工作区过渡工具，可快速减少手动操作 |
| Docker Compose 分发 | Docker Desktop、WSL/虚拟化、镜像下载和系统条件 | 镜像版本、卷和 Compose、Docker 运行故障 | 面向技术维护者，可保留但不作为普通用户默认 |
| Aijob 本地安装包 | 支持的 Windows 与网络，用户不装开发工具 | 固定版 Node/PG/必要采集浏览器、安装签名、进程恢复、数据迁移 | **符合用户已确认目标，推荐最终本机形态** |
| 托管网页 | 账户和网络 | 服务器、合规准入、多用户、运维和持续成本 | 本轮只比较，不扩为实施 |

Docker Windows 官方要求包括 WSL2、受支持系统和虚拟化等，不能把 `docker compose up` 的简短命令描述为无成本安装。[Docker 官方要求](https://docs.docker.com/desktop/setup/install/windows-install/)

### 3.2 安装与数据布局（建议，不是现有实现）

- 程序目录：版本化只读资源，含已构建 Web、Fastify/worker JS、固定运行时、经过核验的预置来源包。
- 数据目录：固定到当前 Windows 用户的应用数据目录，独立于安装版本，含业务库、原件、产物、加密配置和有限日志。不要迫使用户为了升级去复制 `.data` 或记原绝对路径。
- 首次运行：新实例才初始化 PG；生成内部凭据、创建三角色及迁移。PG 绑定 loopback，不安装系统全局 PostgreSQL 服务、不接管用户其他实例。
- 已有 coco 工作区：保持原库和未提交文件，安装包试验使用独立干净实例；现有数据迁移要由明确的一次迁移步骤完成，不把“打包”变成自动重建业务库。
- PostgreSQL 使用与现有兼容的固定 major；普通版本只做应用 schema 的前向增量迁移。不要顺带升级 PG major，也不切 SQLite/PGlite。
- 可在预发布制品阶段先提供完整便携目录+一个启动入口，再加标准安装器；便携目录仍必须在干净 Windows 用户环境证明没有外部开发工具依赖，不能只在本机源码环境启动。

PG 的 `pg_ctl` / `initdb` 本身可以管理本地 server；但生命周期与数据迁移仍由应用负责。PG major 升级和普通应用 schema 迁移是不同操作，不能靠替换二进制自动承诺兼容。[pg_ctl](https://www.postgresql.org/docs/current/app-pg-ctl.html)、[pg_upgrade](https://www.postgresql.org/docs/18/pgupgrade.html)、[PostgreSQL 许可](https://www.postgresql.org/about/licence/)

### 3.3 运行管理层只做六件事

1. 单实例：重复点图标打开已有工作区，不再生成第二组 worker 和数据库。
2. 按依赖启动：实例锁 → PG → 必要迁移 → web-api → collector/match → 业务健康满足后显示工作区。生产 Web 由构建资源提供，不保留开发 Vite 端口为用户依赖。
3. 记录真实健康：每个 worker 的最后心跳、最后成功周期、当前任务、下一次计划；API能访问只是其中一项。
4. 有限恢复：网络恢复、睡眠唤醒后探测；进程崩溃有限退避重启。重复崩溃时停止循环，显示可操作错误，不无限刷屏或反复重建库。
5. 正常退出：先停止领新任务，释放/等待现有任务，停止业务进程，最后正常关闭自有 PG；意外退出依靠既有租约和幂等恢复。
6. 原有界面就能查看状态、重试对应项、导出不含密钥与简历正文的诊断，普通用户无须8091或CLI。

Windows 系统关机/注销不保证触发 Electron 的普通退出事件，因此必须保留 PG 事务和任务租约恢复，不能只依赖关窗口时保存。[Electron app 生命周期](https://www.electronjs.org/docs/latest/api/app)

### 3.4 关闭、登录启动、离线补跑

- “关闭窗口”与“退出 Aijob”清晰区分。若选择后台刷新，关窗口进入托盘；托盘提供打开、暂停自动寻找、退出。首用可勾选登录 Windows 后启动，并可在设置修改。
- “登录自启”不等于开机未登录也工作，更不等于电脑关机仍工作。普通用户版不默认安装 Windows 系统服务。
- 休眠、关机、断网期间不宣称持续抓取；重新打开后按实际预算合并到期任务，提供“已恢复，正在补齐上次离线后的变化”。
- 多日离线不逐日重放重复网络请求。每个来源至多一项待刷新任务；方向查询继续24小时共享缓存，仍计全球网络尝试额度；摘要可形成一次合并变化并明确覆盖区间。
- 这里的补跑必须沿用当前任务与摘要合同，不能擅改已生成的历史摘要或把初始存量算新增。

## 四、首次配置应围绕用户目标，而非 API 名词

建议一条连续路径：

`打开 Aijob → 自动启动完成 → 选“上海/杭州·产品实习” → 显示当前真实机会和覆盖情况 → 选择持续寻找 → 配置新网站搜索 → 后台首次运行 → 今日出现结果`

模型配置在写作/智能分析首次需要时引导，亦可在一个统一“连接与运行”页配置。不能因用户尚无 DeepSeek Key 把规则筛选、官方来源刷新、简历手动编辑与导出锁死。

### 4.1 首页配置卡片建议

| 卡片名称 | 用户看到的作用 | 最少输入 | 未配置时 |
|---|---|---|---|
| 已接入岗位每日更新 | 从已支持的官方来源获取最新岗位 | 方向、城市、实习等类型 | 无须外部 Key 仍可用 |
| 寻找更多招聘网站 | 搜索尚未接入的企业及官方入口 | 默认 Tavily，填一个搜索 Key | 保留已有来源刷新，显示“新网站搜索未开启” |
| 简历与求职助手 | 根据个人材料起草、审阅、解释岗位 | 官方预设或兼容接口，Key、模型 | 保留手动写作、模板与导出 |

这里的两个 Key 是“搜索服务”和“模型服务”，不是两个模型。没有自建托管搜索服务时，不能靠包装名称省去实际搜索账单与 Key；若未来某模型供应商明确提供联网工具，须作为另一个独立搜索适配能力核验，不能假定 OpenAI-compatible 就自带搜索。

### 4.2 模型页的具体交互

- 常见服务商预设自动填地址；选择“兼容接口/中转”才展示自定义 Base URL。保留对用户已用中转站的支持，不跟随 RecruitOps 最新版改成 DeepSeek 独占。
- 模型优先拉取可用列表；不支持列表时显示“填写服务商给出的模型 ID”，而不是报整个连接不可用。不得自动把界面显示名当 ID。
- 连接验证只做一次有意义的小请求：必要时 `/models` 获取列表，再用用户选中模型做短生成/结构验证。先保存草稿或明确未验证状态；不要用户每次重开都消耗一次 Token。
- 把协议、原生 JSON、最大 Token、并发和超时收进“高级设置”；给可用默认，不要求用户选择陌生的返回格式。
- 展示“已保存 / 连接可用 / 支持本任务 / 最近失败原因”，这些状态不混成一个绿色勾。
- 页面只回显 masked Key 及已保存状态；空输入表示保留原密钥或明确替换动作，不因切换配置意外删 Key。
- 无需复制第三方项目全套 provider catalog；一个标准适配器+少量预设即可。

### 4.3 权限与运行范围必须沿用，不偷偷扩大

- 个人 AI Key 仍受个人任务、个人材料与预算边界控制，不能为了让“自动找岗位”看起来智能，把所有后台抓取暗中绑到个人 AI 凭据。
- 持续发现、规则分类、现有来源解析默认走确定性逻辑。若以后增加后台模型辅助，需独立说明用途、外发数据和预算并取得适用授权，而不是复用“已启用我的 AI 接口”的勾选。
- 来源维护属于维护层。普通用户可看“已接入 / 正在处理 / 当前无法接入”，不承担接口参数、访问条款判断或 `reviewedHash`。
- 预置来源包必须含经过维护确认的配置版本与范围，而非打包一堆搜到的网址。增加来源与扩大网络范围仍留明确维护者启用记录，不能把“自动检测成功”当公开资格。

## 五、运行反馈应该让用户知道下一步

“健康检查中心”不是再造一张技术仪表盘。普通用户只需看到当前任务、结果和需要自己处理的事项，详情折叠。

| 情况 | 正常用户文案要回答什么 | 主动作 | 谁处理 |
|---|---|---|---|
| 搜索 Key 无效 | 新网站搜索暂停；原有岗位仍在更新 | 修改搜索配置 | 用户 |
| 搜索额度耗尽 | 今天/本月额度已用完；明确下次恢复时间 | 查看额度；无需重复重试 | 系统按预算恢复 |
| 模型不支持原生 JSON | 当前接口能生成，但该输出方式不可用 | 自动选已实现兼容模式，或保留手动编辑 | 产品适配 / 用户可选 |
| 没有匹配岗位 | 刷新成功，当前没有明确匹配；不是 Key 故障 | 调整方向/城市；保留订阅 | 用户 |
| 招聘网站改版 | 该来源暂时无法更新，其他来源继续，旧数据标最后核验时间 | 查看来源状态 | 维护者 |
| 部分网站失败 | 显示成功/失败来源，保留本次有效新增 | 查看本次结果 | 系统+维护者 |
| 后台进程退出 | 自动尝试恢复，已保存材料不受影响 | 重试后台；失败时导出诊断 | 运行管理层 |
| 本机数据库无法打开 | 原始数据保留；具体为端口/权限/迁移等可解释原因 | 重新尝试 / 查看帮助 | 产品维护者，不能默认重建 |
| 电脑离线后恢复 | 上次运行何时；本次补齐区间和下一次计划 | 等待当前刷新或暂停 | 系统 |

普通状态卡建议直接显示：“上海/杭州 · 产品实习：2 条明确匹配；已接入来源 2 个；上次成功 22:45；下次摘要明早 09:00；另有 X 个网站待接入。”不要用“发现 10 个网站”充当“新增 10 个岗位”，也不要把未知方向岗位算产品岗位。

## 六、更新、密钥保留与迁移

- 安装版本与业务目录分开，程序更新不覆盖密钥、原件或业务库。配置保存只有一个有效真源，避免 env / 网页 / 桌面三套互相覆盖。
- 首次交付先支持受控手动安装新版；在线自动更新可后置。若启用自动更新，用签名、版本与完整制品校验；不要自行实现未签名远程脚本执行。
- 新版本发现有应用迁移时，先一次必要 PG 备份并核验可读，再前向迁移；无迁移的普通重启不重复全库备份。失败保留旧程序、原数据与诊断，不自动清空重建。
- 应用回退和数据库回退不能混为一谈。已执行不可逆 schema 迁移后，不能保证旧二进制能直接使用新库；兼容范围应随制品记录。
- 密钥继续服务端加密存放，可由 Windows 本地保护机制保护主加密材料。Electron safeStorage 在 Windows 使用 DPAPI；这保护不同 OS 用户之间的数据，不等于能抵御同用户下所有恶意程序。[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- 当前密钥无需为“接新壳”重新明文导出或让用户再次填。必要迁移在本机完成，日志不包含 Key。导出备份含个人数据时给明确用户入口，普通诊断包默认排除秘密与材料正文。
- Windows 用户/设备绑定加密不应被伪装成可任意复制迁移：换设备时可迁移业务资料，连接密钥需要受支持的安全恢复或重新填写。

## 七、建议落地顺序与有限验收

### R1：先统一运行契约，不立刻改 UI 框架

交付：一个运行状态模型和启动器，能复用当前工作区、按依赖启动、显示失败、正确退出。暂时仍依赖现有 Docker 的版本应明确叫开发/本机维护启动器。

必要验证：现有环境一次冷启动、一次重复启动、一次正常退出重开；仅模拟一次 worker 退出检查恢复。不要复制旧 HEAD 或重建数据库。

### R2：普通用户制品

交付：预编译产物+固定 Node/PG/必要浏览器，单入口、固定业务数据目录、三角色运行。优先选择薄 Electron 或仅托盘启动器，保留现有 React 页面；一次小验证决定壳，不研究第三套替代。

必要验证：在一个没有 Node/pnpm/Docker/PostgreSQL 的干净 Windows 用户环境，完整安装并首次启动。检查实际无隐藏开发机路径；这是一次必要产品验证，不是扩大成所有设备矩阵。不能在当前开发机启动成功后直接宣布达成。

### R3：首用一条路径与真实结果

交付：选方向→看当前来源覆盖→配搜索→一次真实搜索→正常范围刷新→看到岗位与下一份摘要时间；模型可后配。已有 Key 不重复测试；本阶段只对改变过的连接/配置行为验证一次。

必要验证：普通界面完成，不执行临时脚本、不手改来源配置。真实新站如仍需维护者，则页面准确说明待接入，预置来源必须独立给出当前可用结果。首用完成判定不能只看向导完成。

### R4：恢复与更新

交付：登录启动可选、关窗托盘、退出暂停、睡眠/离线后预算内合并恢复；程序更新保留原资料和 Key。

必要验证：一次退出重开、一次离线/时间推进夹具验证合并任务、一次有迁移的升级与数据保留。真实网络不反复抓；无迁移重开不重复备份。数据库测试扩展已有相关用例，现有队列已经通过的部分不重建同义套件。

### 本主题完成判定

普通用户在没有开发者陪同的情况下，下载安装、通过正常界面配置、拿到真实岗位；第二天重新打开还能恢复方向和任务，看到上次成功与新变化；未配置/失败/待接入各自有明确解释。没有源代码编辑、终端操作或 Agent 临时辅助才算完成。

这一判定服务于“自动获得可用岗位并继续准备材料”。它不要求本轮做邮箱、云同步、全天候托管、桌面表单填充，也不要求增加模型或来源数量来替代实际可用性。
