# Aijob：可信官方岗位驱动的求职 OS

> 当前开发方式（2026-10-13）：继续使用现有本地网页开发版，PostgreSQL 仍由 Docker 运行。按 coco 最新决定，安装包同步、构建、安装测试和资料迁入暂缓，等产品终版确认后再处理；已生成候选保留为历史快照。最新范围见[路线图](docs/06-mvp-roadmap.md)和[当前交接](docs/handoffs/current.md)。

> 2026-09-13：K4 已完成40套原生中文版式与120组输出；K5 已完成本机主入口接管、业务库066/067升级和新建→编辑→换模板→下载→重开链路，形成本机候选。真实BYOK、独立导入盲测、实体设备和正式部署条件单列，不能等同于已发布。

本轮结果：[K4/K5交付记录](docs/evidence/resume-native-k4-k5-2026-09-13.md)；[当前运行与回退](docs/runbooks/resume-native-candidate.md)。下面 S0–S4 仅作历史记录，不用于原生核心验收。

Aijob 面向中国大陆本科、硕士、博士在校生，将机会发现、完整经历、简历编辑、投递和面试组织为连续工作区。简历和练习可以独立开始，具体申请用 Case 固定岗位与实际投递材料。岗位事实来自经过准入的企业官网与官方 ATS；用户最终回官方页面自行投递。

供给范围按已接受的 ADR-0035 包括在校生可投的实习、校招、应届与管培；未说明保留 unknown，不以规则补写。100家/1000岗和人工占比为报告项，城市/职能为观察指标；逐来源质量、权限与安全条件继续守门。产品成功指标是高质量投递决定，当前仍 E0，未验证真实用户增量价值。

## 替换前历史状态快照（不代表 K0–K5 已完成）

| 项目 | 当前值 |
|---|---|
| 主目录与分支 | `C:\Users\72998\Projects\Aijob` / `codex/job-fact-fidelity-handoff`，独立 Git |
| 工程路线 | 既有基础保留 → 简历质量 S0–S4 本地候选；真实发布条件独立 |
| 本轮实现 | 40套v3模板、实际内容纸张、连续表单、图库固定详情、导入保留布局、成对修订/保留导出、最终PDF内容校验 |
| 来源状态 | 34配置，0 approved；历史7个robots检查通过不等于完整访问政策或来源准入 |
| 业务数据 | 原有恢复保留，新增前向迁移065；未新增抓取。此前业务快照93岗/7家、公开0，不能当作实时供给监控 |
| 测试与构建 | 120组PDF/DOCX、40封面；专属PG21项；全仓及合同增量检查见证据；类型/lint/构建通过 |
| 外部条件 | Windows Chromium/WPS输出、离线Linux边界用例通过；新部署镜像拉取失败。BYOK、实体设备、SMTP/HTTPS及来源条件仍待实测 |

后续任务先读根目录 [AGENTS](AGENTS.md)、路线图、交接与计划索引，再检查当前分支和未提交工作。不要同时在新主目录、桌面副本和旧工作树开发。

## 当前已经能运行什么

仓库已经具备完整的本地纵向闭环：

```text
企业官方招聘 + 企业确认的官方 ATS
  （高校等二手来源仅提供企业发现线索）
  -> 来源策略、限速采集、快照、清洗、去重、要求拆解
  -> PostgreSQL
  -> 正式岗位目录、直接编辑简历、收藏与常用筛选
  -> 当前方向图谱、双分母/原句、完整经历对照与准备任务
  -> 经历/表达复用、用户自带 API 的 AI 或固定辅助、DOCX/离线中文PDF
  -> 官方投递、固定投递稿、日程/ICS、文字面试/复盘、个人数据删除
```

这条链路只证明本地工程可行，不代表来源获准公开或产品价值已验证。通过来源均为 `pending_review`，全部岗位只进入本机 `local_mvp`；数据库公共版本指针仍为 0，公共模式的 `/v1/jobs` 返回空列表。历史干净验收库曾返回22条内部岗位；历史开发库14条仅为旧运行记录，本轮未读取这些业务库。

### 本地启动

**当前体验联验：** 前端5173、API3000使用现有恢复业务环境；数据库已升级065。专属PG测试库在55443，仅含合成数据。启动前检查已有监听，按[本轮运行手册](docs/runbooks/resume-studio-quality-candidate.md)操作；下面Compose步骤描述历史全新初始化，不用于当前已恢复环境。

前置条件：Node.js 22+、pnpm 11 和 Docker Desktop。Docker 在这里仅用于在 coco 的电脑上运行 PostgreSQL，不需要购买云服务器。

```powershell
pnpm install
pnpm infra:up
pnpm local:bootstrap
pnpm dev
```

`pnpm local:bootstrap --confirm-live` 按迁移、来源登记、获准低频探测、目录物化和健康检查顺序恢复本地目录。它只读取 Git 已忽略的 `.data/local-bootstrap.json` 清单；清单、来源或明确确认缺失时会 fail-closed，不会用空目录冒充成功。当前清单已校准为先临三维 9、卧安机器人 5、灵明光子 8，预期 22 岗/3 家/公共 0；`aijob_alpha` 已升级至迁移 022 并恢复出相同目录。首次准备清单和隔离库演练方式见 [本地空库恢复手册](docs/runbooks/local-bootstrap.md)。

**迁移旧业务数据时先保留原密钥与数据库的对应关系，不要用新生成密钥替代旧材料。** 第一次全新本地启动时，Aijob 会自动生成随机的 32-byte 简历加密密钥，并复用 Git 已忽略的 `.data/resume-encryption.key`；不需要手工配置，也不会把密钥写入日志。不要在仍需读取临时简历或 DOCX 导出时删除该文件。测试环境可以通过 `RESUME_ENCRYPTION_KEY` 显式使用固定测试密钥；`alpha` 和 `production` 环境必须通过该环境变量提供独立随机密钥，不会回退到本地文件。

个人 AI 在前端 `/settings/ai` 配置：用户填写自己的兼容 API 地址、模型和密钥，设置用量上限后可检查连接。平台不提供模型；配置按账户加密存储，密钥不能读回。连接检查发送无个人内容的测试请求，日常 AI 操作由用户主动发起。`ENABLE_AI=false` 关闭的是运营方配置，不是用户自带 API；没有用户配置时保留手工编辑和明确标记的固定提示。

旧 `pnpm ai:configure`、`.data/ai-provider.local.json` 属于运营工具兼容路径，不能作为新的个人 AI 接入说明。公共岗位处理继续使用规则；不要求运营方购买模型。

旧 `ProductShell` 仍由 `VITE_CAREER_OS_V2=false` 保留为紧急回退，不是当前同步改进目标。正式工作区以 `/resumes` 和 `/resumes/:id` 承接三种开始方式与直接编辑，旧导入入口兼容跳转。岗位页收拢收藏和常用筛选，材料页收拢经历与表达；`/applications` 和详情页承接准备、成对投递版本、日程与统一面试助手。旧规则核对和面试历史可展开查看。统一助手的修改通过对应材料服务采用，不再要求先完成旧 Resume Review 或证据确认。OS-7 已完成，但不代表真实供给或发布验收已完成。

`VITE_CAREER_OS_V2` 回退旗标继续保留。进行当前 UX 基线或实现验收时，在启动开发进程前显式开启它，即可从 <http://127.0.0.1:5173/today> 进入当前 Career OS；正常会话使用真实本地 Case API，不回退到仓库静态 Case，也不会访问真实招聘来源或真实 AI：

```powershell
$env:VITE_CAREER_OS_V2 = "true"
pnpm dev
```

未设置或设置为其他值时继续使用旧 `ProductShell` 回退；有效开启值只有 `1`、`true` 和 `on`（忽略大小写与首尾空格）。

`source:probe` 仍用于来源首次核验、范围变化和暂停恢复等人工操作。按 ADR-0026 显式配置的确定性来源可在本机自动刷新：首次运行 `pnpm source:refresh-enable` 开启本地总开关，`pnpm source:refresh-status` 查看最近运行、下次到期、失败、快照待办和小时容量，`pnpm source:refresh-now [source-key]` 按同一队列和预算安排一次到期任务，`pnpm source:refresh-disable` 立即停止创建新网络任务。Worker 和状态命令只认 Git 中显式配置的来源键，开发库孤立测试记录不会进入调度。当前任一活动来源仍采用 24/168 小时策略时，小时上限保持 3；达到 `40/400` 并把全部活动确定性来源统一切换为 12 小时后，小时上限才按 `min(12, max(3, ceil(来源数 / 12) + 1))` 动态计算。110 个虚拟来源的离线验证上限为每小时 11 家，仍保持全局单并发和逐来源安全预算。日常测试、CI、构建、Alpha 和 Production 不调用真实招聘站。停止本地数据库可运行 `pnpm infra:down`。

扩容规划使用两个零网络命令：`pnpm source:batch-plan --milestone 40` 输出当前/投影分母、结构缺口和批次；`pnpm source:candidate-audit --milestone 40` 按来源族汇总容量证据与暂停原因。命令为空表示没有候选满足准入，不代表应退回抓取综合平台或批量浏览器快照。

`browser_required` 来源不进入 `source:probe` 或自动网络刷新。来源到期后只在 Worker 日志和 `source:refresh-status` 中生成快照提醒。coco 明确批准的人工浏览器或认证公众号快照只能保存在 Git 忽略的 `.data/browser-imports/`，再用 `pnpm source:import-browser-snapshot <source-key> --file <path>` 离线导入；成功导入新快照会清除提醒并更新下次到期时间，该命令没有招聘站网络请求能力。岗位范围按ADR-0035的在校生可投判据；官方投递方式仍须通过白名单与来源证据校验，不接受个人邮箱、二维码-only或绕过访问控制。企业认证公众号和高校页面仅能提供发现线索，不能因此获得公共目录准入。

日常代码检查：

```powershell
pnpm check
pnpm build
```

## 核心链路

```text
34 个已登记来源配置中的本地岗位
  -> 快照、清洗、去重、结构化和来源追溯
  -> 空白 / 导入 PDF、DOCX、文本 / 使用已有经历
  -> 直接编辑简历，首次自动收录完整经历，原件可找回
  -> 岗位原句与方向图谱，联系个人经历和准备任务
  -> 用户 API 驱动的动态帮助，或明确标记的固定辅助
  -> 多模板简历 / 常用表达 / PDF、DOCX 与打印
  -> 收藏独立保存；主动准备或投递后记录申请和实际投递稿
  -> 日程 / 面试练习 / 反馈回到材料
  -> 前往官方页面自行投递
  -> 删除全部个人数据
```

资格只使用“未发现明确冲突 / 存在明确冲突 / 需补充信息”；经历证据只使用“有明确证据 / 部分证据 / 简历暂未体现 / 信息不足”；偏好只使用“符合 / 不符合 / 未设置”。产品不输出匹配度百分比，也不自动劝退或隐藏岗位。

## 阅读顺序

1. [项目协作约束](AGENTS.md)、[MVP 路线](docs/06-mvp-roadmap.md) 与 [当前项目交接](docs/handoffs/current.md)：恢复当前事实和唯一目标。
2. [计划索引](docs/plans/README.md)、[U0–U6修正版](docs/plans/product-experience-system-upgrade-2026-09-07.md)与[ADR-0038](docs/decisions/0038-resume-workspace-and-direct-import.md)：确认当前范围、系统归属、Contracts/Platform/DB/Web 顺序与退出条件；旧交付计划不得提供下一任务。
3. [产品定义](docs/00-product-definition.md)：产品是谁、解决什么决策问题，以及明确不做什么。
4. [当前 PRD v0.2](docs/01-prd-v0.2.md)：定义岗位、简历、匹配推荐、AI 优化、DOCX 和删除的现有本地能力基线。
5. [产品发现与实验](docs/09-product-discovery.md)：历史研究方法参考；固定人数研究不是当前开发或发布的前置步骤，反馈随交付收集。
6. [集中式体验规范](docs/13-experience-design.md)：P0 旅程、三轴结果、决策队列、异常状态和可访问性。
7. [来源、岗位数据与采集](docs/02-data-and-ingestion.md)、[匹配设计](docs/03-matching-design.md)、[安全威胁模型](docs/04-security-threat-model.md)、[系统架构](docs/05-system-architecture.md)：数据、判断、安全和运行契约。
8. [Private Alpha 与上线就绪 Gate](docs/plans/private-alpha-readiness-gates.md)：未来真实参与者和推广上线前不能遗漏的条件，不是当前任务队列。
9. [验证与质量策略](docs/12-validation-and-quality-strategy.md) 与 [工程交付规范](docs/10-engineering-delivery.md)：产品证据和工程质量门。
10. [合规与公开上线门](docs/11-compliance-and-public-launch.md)：从邀请测试走向公开服务前的边界。

稳定流程规范见 [从 0 到 1 的产品工程流程](docs/08-zero-to-one-lifecycle.md)。重要架构决定见 [ADR 索引](docs/decisions/README.md)，执行记录入口见 [项目模板](docs/templates/README.md)。

## 参考资料

- [方法与工程调研依据](docs/07-method-research.md)：竞品、公共服务、体验研究和工程方法的参考，不是当前产品路线或技术选型的事实源。

## 已锁定原则

- 供给范围按 ADR-0035 为在校生可投岗位，包含实习、校招、应届与管培，unknown 保留。
- 100家/1000岗、运营缓冲及人工占比为报告项；职能/城市为观察指标。ADR-0036取消单家公司岗位上限，逐来源质量和逐岗位资格继续核验。
- localhost 自动建立匿名 owner，并可用邮箱认领同一 owner；邀请环境使用受邀邮箱验证码候选，不再使用共享邀请码。真实邮件供应商仍需单独授权，手机号短信只有在 coco 重新授权供应商与成本后才评估。
- 简历原文在证据确认后立即删除，任何情况下最长不超过 24 小时；确认后的有序简历区块、结构化事实、偏好和原子证据默认长期保留，由用户主动删除。长期资产生命周期以 [ADR-0031](docs/decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md) 为准。
- 规则与模板必须在 AI 不可用时独立完成资格、匹配和推荐；本地 MVP 实现受控 AI 简历优化，公开启用仍需供应商、合规与至少 4/6 用户增量 Gate。
- 不抓取 BOSS、实习僧、牛客等综合招聘平台，不绕过登录、验证码、访问控制或明确禁止的边界。
- 不自动填写、批量投递或模拟登录；用户始终在官方页面完成申请。
