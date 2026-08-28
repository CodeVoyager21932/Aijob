# Aijob：可信官方岗位驱动的求职 OS

> 2026-08-28：M1–M4、PA-1、UX-0 与 OS-1–OS-7 已全部完成，Career OS 前后端同步改进阶段收敛结束。OS-7 双库浏览器 Gate 输出 `passed: true`，全仓 808/808、lint 485 files、typecheck、build（主包 401.33 kB）、audit 与 diff check 通过。当前以[OS-7 验收证据](docs/evidence/product/career-os-v2/os-7-system-gate-acceptance-2026-08-28.md)和[current handoff](docs/handoffs/current.md)为准；真实邮件、解析镜像、服务器、供给和参与者 Gate 仍未通过，下一条轨道需 coco 明确授权。

这是一个待验证的产品项目，面向**未来 30 天真实投递实习岗位、已有中文简历、近期使用过多个官方渠道的中国大陆在校生**。它只把企业官方招聘网站和经企业官网确认的官方 ATS 中当前存在的具体岗位整理为可追溯信息；高校就业网站、政府页面、公众号和其他二手页面只用于发现企业及其官网方向。系统依据用户确认过的约束与经历证据，帮助用户完成投递、暂缓或放弃的高质量决定，最终回到企业官网或官方 ATS 投递。

它不是追求岗位数量的招聘信息流，也不以“官方来源”暗示绝对真实。项目需要证明的增量是：跨来源的资格核对、经历证据解释和轻量决策管理，是否能让目标用户更准确、更高效地决定要不要投。

## 当前状态快照

| 项目 | 当前值 |
|---|---|
| 快照日期 | 2026-08-28 |
| 当前阶段 | Career OS 前后端同步改进已收敛：UX-0 与 OS-1–OS-7 五项 Gate 全部关闭。M1–M4 与 PA-1 保留为工程基线，真实邮件、解析镜像与服务器 Gate 通过前，G0/G1 继续暂停 |
| 当前范围 | 干净验收库 `aijob_alpha` 为 22 条可信可见活动岗位、3 家企业、3 个官方 ATS 来源；距离硬门槛仍缺 978 岗、97 家。SME 为 2/3 家、14/22 岗，人工来源为 0；Alpha 与公共岗位均为 0。开发库 14/2 及纠偏前 231/149/29 只保留为历史运行事实 |
| 协议校准 | 尚未开始；供给硬门槛和服务器就绪 Gate 通过后，只有 coco 明确启动才做 2 人校准；历史可核验记录仍为 0/2 |
| 正式实验 | 暂停；供给硬门槛、服务器就绪 Gate 与 G0 通过后再做 6 人正式任务和 72 小时回访 |
| 历史研究样本 | 5 条本地产品/运营岗位；不等于完整 MVP 目录 |
| 当前证据 | E0：尚无可复核目标用户行为证据，两个产品假设均未判定 |
| 当前实现策略 | 不默认后端已匹配，也不无依据重做。UX-0 已把每个用户动作绑定到 Contracts、Platform 模块、PostgreSQL 事实、权限/并发/删除语义和真实测试；OS-1–OS-7 已按纵向切片同步修改 Platform 与 Web，并在触达边界补齐运行时契约。三张概念图作为布局、信息层级和交互关系的高保真目标；Recommendation、Insights、申请看板、Case 固定版本三轴核对、Resume Review、显式投递、模板面试、复盘和数据控制已从规范路径可用；不因此启动真实 Alpha |
| 来源发现进度 | 已按 ADR-0019 完成 1000/1000 家企业/机构审查记录；34 个来源配置中 12 个为 canonical（7 个活动确定性、2 个浏览器提醒、3 个硬冲突暂停），22 个高校等来源均降级为 `discovery_only`。当前审计没有 `capacity` 就绪候选 |
| 工程切片 | 可信完成基线为 OS-7：Config 20、Contracts 86、Database 54、Platform 466、Web 182，共 **808/808**，一次跑通无 flake；lint 485 files、typecheck、build（主包 401.33 kB / gzip 117.04 kB，上限 411.31 kB）、audit 与 diff check 通过；双库四视口浏览器 Gate 输出 `passed: true`。上一基线 OS-6 为 801/801（`e56ceae`）。真实邮件/解析镜像/服务器、真实 AI 与真实来源仍未实施，公共版本仍为 0 |
| AI 状态 | Review、Interview、Feedback 与 Debrief 均必须与用户确认事实分离；公开环境继续关闭，M4 沿用确定性模板，不调用真实 AI |

以上内容只用于帮助首次阅读者定位本次文档基线。后续动态阶段、样本进度、Gate 状态和下一决策日期只更新到 [MVP 路线与当前决策面板](docs/06-mvp-roadmap.md)；如有差异，以该面板为准。

从新的 Codex 任务继续推进时，必须先读项目根目录的 [协作约束](AGENTS.md) 和 [当前项目交接](docs/handoffs/current.md)，再检查当前分支与工作区。交接文档负责保存最近工程事实和下一项唯一总目标，避免依赖长对话上下文。

## 当前已经能运行什么

仓库已经具备完整的本地纵向闭环：

```text
腾讯官方招聘 + 南开就业网公开招聘页 + 美团官方招聘 + 百度官方实习招聘 + 京东校园招聘 + 字节校园招聘人工快照
  + 帆软实习生招聘 + 慧策/灵明光子/普渡北森官方门户
  -> 来源策略、限速采集、快照、清洗、去重、要求拆解
  -> PostgreSQL
  -> 正式岗位目录、简历确认、三轴推荐
  -> 按方向生成有样本门槛的 JD 洞察与个人证据对照
  -> 受控 AI 选择或模板降级、逐段修改、DOCX
  -> 官方投递链接、五态决定、全部个人数据删除
```

这条链路只证明本地工程可行，不代表来源获准公开或产品价值已验证。通过来源均为 `pending_review`，全部岗位只进入本机 `local_mvp`；数据库公共版本指针仍为 0，公共模式的 `/v1/jobs` 返回空列表。当前干净验收库返回 22 条内部岗位；开发库保留 14 条可信岗位及历史修订，不再作为验收分母。

### 本地启动

前置条件：Node.js 22+、pnpm 11 和 Docker Desktop。Docker 在这里仅用于在 coco 的电脑上运行 PostgreSQL，不需要购买云服务器。

```powershell
pnpm install
pnpm infra:up
pnpm local:bootstrap
pnpm dev
```

`pnpm local:bootstrap --confirm-live` 按迁移、来源登记、获准低频探测、目录物化和健康检查顺序恢复本地目录。它只读取 Git 已忽略的 `.data/local-bootstrap.json` 清单；清单、来源或明确确认缺失时会 fail-closed，不会用空目录冒充成功。当前清单已校准为先临三维 9、卧安机器人 5、灵明光子 8，预期 22 岗/3 家/公共 0；`aijob_alpha` 已升级至迁移 022 并恢复出相同目录。首次准备清单和隔离库演练方式见 [本地空库恢复手册](docs/runbooks/local-bootstrap.md)。

第一次本地启动时，Aijob 会自动生成随机的 32-byte 简历加密密钥，并复用 Git 已忽略的 `.data/resume-encryption.key`；不需要手工配置，也不会把密钥写入日志。不要在仍需读取临时简历或 DOCX 导出时删除该文件。测试环境可以通过 `RESUME_ENCRYPTION_KEY` 显式使用固定测试密钥；`alpha` 和 `production` 环境必须通过该环境变量提供独立随机密钥，不会回退到本地文件。

需要测试真实 AI 接口时，使用后端命令填写配置，不需要编辑 `.env`：

```powershell
pnpm ai:configure
```

该命令只填写接口地址、模型和 API Key；配置保存在 Git 已忽略的 `.data/ai-provider.local.json`。填写或替换配置后重启 `pnpm dev`。需要验收真实接口时再运行 `pnpm ai:smoke`，这不是日常配置步骤。前端没有读取或修改供应商配置的接口；未来线上部署只替换后端配置来源，不改岗位推荐和简历优化链路。

旧 `ProductShell` 仍由 `VITE_CAREER_OS_V2=false` 保留为紧急回退，不是当前同步改进目标。V2 已由 `/resumes/import*` 承接简历解析与确认，由 `/jobs/recommended*` 和 `/jobs/insights*` 承接规范推荐与市场洞察，由 `/applications` 承接服务端完整集合看板、Peek 与显式阶段命令，并由 `/applications/:caseId/*` 承接固定岗位版本、Requirements、三轴核对、显式版本升级、岗位简历工作室、显式投递、模板面试和复盘；`/today`、`/settings/data*` 与兼容 `/data-control*` 已接入同一运行与删除边界。旧 Tailoring 继续只读，Resume Review 是模板与受控 AI 的唯一新写入所有者。OS-6 的完成不代表 OS-7、真实供给或 Private Alpha 已完成。`/research/*` 与 `/internal-preview/*` 是内部或历史页面，不进入本轮用户旅程收敛。

`VITE_CAREER_OS_V2` 回退旗标继续保留。进行当前 UX 基线或实现验收时，在启动开发进程前显式开启它，即可从 <http://127.0.0.1:5173/today> 进入当前 Career OS；正常会话使用真实本地 Case API，不回退到仓库静态 Case，也不会访问真实招聘来源或真实 AI：

```powershell
$env:VITE_CAREER_OS_V2 = "true"
pnpm dev
```

未设置或设置为其他值时继续使用旧 `ProductShell` 回退；有效开启值只有 `1`、`true` 和 `on`（忽略大小写与首尾空格）。

`source:probe` 仍用于来源首次核验、范围变化和暂停恢复等人工操作。按 ADR-0026 显式配置的确定性来源可在本机自动刷新：首次运行 `pnpm source:refresh-enable` 开启本地总开关，`pnpm source:refresh-status` 查看最近运行、下次到期、失败、快照待办和小时容量，`pnpm source:refresh-now [source-key]` 按同一队列和预算安排一次到期任务，`pnpm source:refresh-disable` 立即停止创建新网络任务。Worker 和状态命令只认 Git 中显式配置的来源键，开发库孤立测试记录不会进入调度。当前任一活动来源仍采用 24/168 小时策略时，小时上限保持 3；达到 `40/400` 并把全部活动确定性来源统一切换为 12 小时后，小时上限才按 `min(12, max(3, ceil(来源数 / 12) + 1))` 动态计算。110 个虚拟来源的离线验证上限为每小时 11 家，仍保持全局单并发和逐来源安全预算。日常测试、CI、构建、Alpha 和 Production 不调用真实招聘站。停止本地数据库可运行 `pnpm infra:down`。

扩容规划使用两个零网络命令：`pnpm source:batch-plan --milestone 40` 输出当前/投影分母、结构缺口和批次；`pnpm source:candidate-audit --milestone 40` 按来源族汇总容量证据与暂停原因。命令为空表示没有候选满足准入，不代表应退回抓取综合平台或批量浏览器快照。

`browser_required` 来源不进入 `source:probe` 或自动网络刷新。来源到期后只在 Worker 日志和 `source:refresh-status` 中生成快照提醒。coco 明确批准的人工浏览器或认证公众号快照只能保存在 Git 忽略的 `.data/browser-imports/`，再用 `pnpm source:import-browser-snapshot <source-key> --file <path>` 离线导入；成功导入新快照会清除提醒并更新下次到期时间，该命令没有招聘站网络请求能力。只接受明确实习岗位；公众号投递方式还必须是白名单官方 HTTPS 页面或带原句的企业域名邮箱，个人邮箱、二维码-only、正式校招全职和社会招聘会被整批拒绝。

日常代码检查：

```powershell
pnpm check
pnpm build
```

## 核心链路

```text
34 个已登记来源配置中的本地岗位
  -> 快照、清洗、去重、结构化和来源追溯
  -> PDF / DOCX / 文本简历与隐私检查
  -> 用户确认事实、偏好与经历证据
  -> 资格、证据、偏好分开判断
  -> 可解释推荐与 AI 简历对照修改
  -> 有样本门槛的 JD 洞察与简历证据对照
  -> 复制 / DOCX
  -> 未决定 / 已保存 / 准备投递 / 已投递 / 已放弃
  -> 前往官方页面自行投递
  -> 删除全部个人数据
```

资格只使用“未发现明确冲突 / 存在明确冲突 / 需补充信息”；经历证据只使用“有明确证据 / 部分证据 / 简历暂未体现 / 信息不足”；偏好只使用“符合 / 不符合 / 未设置”。产品不输出匹配度百分比，也不自动劝退或隐藏岗位。

## 阅读顺序

1. [项目协作约束](AGENTS.md)、[MVP 路线](docs/06-mvp-roadmap.md) 与 [当前项目交接](docs/handoffs/current.md)：恢复当前事实和唯一目标。
2. [计划索引](docs/plans/README.md)、[当前交付计划](docs/plans/career-os-current-delivery-plan.md)与[Career OS 端到端体验与系统契约](docs/14-career-os-end-to-end-experience-contract.md)：确认当前里程碑、系统归属、Contracts/Platform/DB/Web 顺序、视觉/交互规则和退出条件；归档计划不得提供下一任务。
3. [产品定义](docs/00-product-definition.md)：产品是谁、解决什么决策问题，以及明确不做什么。
4. [当前 PRD v0.2](docs/01-prd-v0.2.md)：定义岗位、简历、匹配推荐、AI 优化、DOCX 和删除的现有本地能力基线。
5. [产品发现与实验](docs/09-product-discovery.md)：完整 MVP 后如何做 2 人校准、6 人正式验证和证据判定。
6. [集中式体验规范](docs/13-experience-design.md)：P0 旅程、三轴结果、决策队列、异常状态和可访问性。
7. [来源、岗位数据与采集](docs/02-data-and-ingestion.md)、[匹配设计](docs/03-matching-design.md)、[安全威胁模型](docs/04-security-threat-model.md)、[系统架构](docs/05-system-architecture.md)：数据、判断、安全和运行契约。
8. [Private Alpha 与上线就绪 Gate](docs/plans/private-alpha-readiness-gates.md)：未来真实参与者和推广上线前不能遗漏的条件，不是当前任务队列。
9. [验证与质量策略](docs/12-validation-and-quality-strategy.md) 与 [工程交付规范](docs/10-engineering-delivery.md)：产品证据和工程质量门。
10. [合规与公开上线门](docs/11-compliance-and-public-launch.md)：从邀请测试走向公开服务前的边界。

稳定流程规范见 [从 0 到 1 的产品工程流程](docs/08-zero-to-one-lifecycle.md)。重要架构决定见 [ADR 索引](docs/decisions/README.md)，执行记录入口见 [项目模板](docs/templates/README.md)。

## 参考资料

- [方法与工程调研依据](docs/07-method-research.md)：竞品、公共服务、体验研究和工程方法的参考，不是当前产品路线或技术选型的事实源。

## 已锁定原则

- 当前本地假设验证全部职能实习决策，不混入校招全职或社会招聘；历史 `/research/*` 产品/运营原型不代表当前范围。
- Private Alpha 外部测试硬门槛为 100 家企业、1000 条可见活动实习岗位，运营缓冲为 110 家、1100 条；SME 不少于企业数 50% 和可见岗位数 40%。产品、运营、工程技术、数据与 AI 各至少 100 条，其余 8 个职能各至少 15 条；北京、上海、深圳、广州、杭州、成都、武汉、南京各至少 40 条地点已知岗位；人工/浏览器来源不超过企业数 20% 和可见岗位数 10%。来源通过准入与持续性 Gate、供给硬门槛及后续服务器就绪 Gate 后，才启动外部测试。
- localhost 自动建立匿名 owner，并可用邮箱认领同一 owner；邀请环境使用受邀邮箱验证码候选，不再使用共享邀请码。真实邮件供应商仍需单独授权，手机号短信只有在 coco 重新授权供应商与成本后才评估。
- 简历原文在证据确认后立即删除，任何情况下最长不超过 24 小时；确认后的有序简历区块、结构化事实、偏好和原子证据默认长期保留，由用户主动删除。长期资产生命周期以 [ADR-0031](docs/decisions/0031-long-lived-career-os-architecture-realignment-2026-08-06.md) 为准。
- 规则与模板必须在 AI 不可用时独立完成资格、匹配和推荐；本地 MVP 实现受控 AI 简历优化，公开启用仍需供应商、合规与至少 4/6 用户增量 Gate。
- 不抓取 BOSS、实习僧、牛客等综合招聘平台，不绕过登录、验证码、访问控制或明确禁止的边界。
- 不自动填写、批量投递或模拟登录；用户始终在官方页面完成申请。
