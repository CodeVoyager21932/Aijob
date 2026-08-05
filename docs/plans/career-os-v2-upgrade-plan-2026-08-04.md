# Aijob 求职 OS 2.0：交互架构先行与开源能力融合计划

- 状态：Phase 1A accepted；approved for Phase 1B implementation
- 日期：2026-08-04
- 决策者：coco
- 当前分支：`codex/career-os-phase-1`
- 关联决策：[ADR-0029](../decisions/0029-official-source-catalog-trust-boundary.md)、[ADR-0030](../decisions/0030-adopt-job-centric-career-os-and-interaction-first-integration.md)

## 1. 目标与当前事实

Aijob 从“官方岗位投递决策助手”升级为**可信官方岗位驱动的完整求职 OS**。产品不做招聘信息流或自动投递，而是围绕一次真实求职项目串联：

```text
可信企业与官方岗位
  -> JD 能力与资格拆解
  -> 用户经历证据确认
  -> 岗位定制中文简历
  -> 官方页面自行投递与进展记录
  -> 文字模拟面试
  -> 面后复盘与经验沉淀
```

当前可信供给仍以干净 `aijob_alpha` 为准：22 条活动岗位、3 家企业、3 个官方 ATS；SME 为 2 家/14 岗，人工、Alpha 和公共岗位均为 0。历史 231/149/29、152/30 和开发库 14/2 不是验收分母。

100 家企业/1000 条可见活动岗位仍是外部 Private Alpha 硬门槛，110/1100 仍是运营缓冲。本计划只调整执行顺序：先完成交互架构和一岗闭环，再恢复官方 ATS 容量扩容；不降低 ADR-0027、0028、0029 的来源与结构标准。

产品证据继续为 `E0`，G0/G1 未启动。

## 2. 固定执行顺序

```text
治理与交接收口
  -> Phase 1A 工作台壳层、静态求职看板与 URL 侧览
  -> Phase 1B JD 能力与定制简历静态原型
  -> Career OS 领域模型与接口
  -> 简历 / ApplicationCase / 文字面试三个 PoC
  -> 一岗全闭环
  -> 旧页面渐进迁移
  -> 完整 OS 扩展
  -> 恢复 100/1000 官方供给扩容
```

新增来源扩容在一岗闭环 Gate 前暂停；已授权 canonical 来源可以按现有安全边界维护新鲜度，但不得扩大真实请求范围。

## 3. 统一交互架构

### 3.1 产品壳层

Aijob 是面向求职者的个人工作台，不复制传统后台管理系统的账号、额度、系统管理和运营指标。

- 唯一可收起全局侧栏：`今日 / 发现岗位 / 我的求职 / 简历资产 / 面试训练 / 经验库`，底部固定`数据与设置`。
- 顶部工具栏只放面包屑、`Ctrl+K` 全局搜索、通知和账号；不再放第二套主导航。
- 页面固定为 `GlobalSidebar + UtilityBar + MainCanvas + ContextInspector`。
- 右侧检查器可以收起和调整宽度，用于展示当前岗位、要求、证据或 AI 建议；不得实现为悬浮聊天机器人。
- 筛选、排序、视图和侧览对象进入 URL；刷新、前进和后退必须恢复上下文。
- 侧栏状态和面板宽度属于本机非敏感 UI 偏好，不进入用户事实数据库。

### 3.2 路由信息架构

```text
/today
/jobs
/applications
/applications/:caseId/overview
/applications/:caseId/requirements
/applications/:caseId/resume
/applications/:caseId/application
/applications/:caseId/interview
/applications/:caseId/debrief
/resumes
/interviews
/knowledge
/settings/data
```

- 全局`简历资产`管理基础简历和模板；岗位内`定制简历`只管理岗位派生版本。
- 全局`面试训练`展示跨岗位练习历史；岗位内`面试`必须绑定具体 JD 版本。
- 全局`经验库`保存通用引用和笔记；岗位内只展示主动关联的内容。
- `我的求职`支持列表和看板；点击项目先打开右侧侧览，再进入完整工作区。
- 单岗位标签固定为：`概览 → JD能力 → 定制简历 → 投递 → 面试 → 复盘`。

### 3.3 响应式能力

- `>=1440px`：完整侧栏、主画布和右侧检查器。
- `1024–1439px`：侧栏缩为图标轨道，检查器按需展开。
- `768–1023px`：单主画布，辅助区域改为抽屉或标签。
- `<768px`：首轮只保证可访问和无整页横向溢出；后续可将全局导航转底栏、检查器转全屏抽屉，不改变领域模型和路由。

### 3.4 视觉与组件约束

- 保留现有年轻、向阳、编辑感：真白画布、浅暖灰壳层、深蓝主操作、鲜绿证据状态、琥珀未知状态、深色正文。
- UI 控件使用中文无衬线字体；页面与简历重点标题可以使用克制的中文衬线字体。
- 优先使用开放区域、列表、分栏、时间线和工具条；卡片只承担必要分组，禁止层层嵌套。
- 首批公共组件：`WorkspaceShell`、`GlobalSidebar`、`UtilityBar`、`CaseHeader`、`CaseTabs`、`ContextInspector`、`ResizablePane`、`ViewToolbar`、`EvidenceState`、`StageBadge`。
- 简历、岗位和面试模块必须复用同一壳层与 token，不建立独立视觉系统。
- Tiptap、dnd-kit 等大型依赖只在简历路由懒加载，岗位列表首屏不得加载完整编辑器。

### 3.5 已批准概念图

三张 PNG 是视觉参考，不是字段、状态或品牌命名事实源；采用、拒绝和术语映射统一见[概念图解释契约](../evidence/product/career-os-v2/README.md)。

1. [我的求职看板与岗位侧览](../evidence/product/career-os-v2/concept-01-application-board.png)：只作为壳层、看板和侧览参考；图中的“匹配良好/中/差”不得实现。
2. [单岗位 JD 能力工作区](../evidence/product/career-os-v2/concept-02-job-workspace.png)：主要岗位工作区基准。
3. [岗位定制简历工作室](../evidence/product/career-os-v2/concept-03-resume-studio.png)：主要简历工作区基准。

产品只能使用`已有证据 / 证据待补充 / 用户尚未确认`，不得显示匹配百分比、适合度等级或自动劝退结论。

## 4. 目标领域架构

### ApplicationCase

- 每位 owner 对同一稳定岗位最多一个活动 Case；已结束后允许为新招聘批次创建新 Case。
- Case 固定 `publishedJobId + publishedJobVersionId`。新版 JD 只显示差异，由用户显式升级。
- 阶段为 `interested / preparing / applied / interviewing / resolved`。
- `resolved` 结果为 `offer / rejected / withdrawn / expired / unknown`。
- 现有 `saved / preparing_to_apply / applied / abandoned` 分别兼容映射到新阶段；`undecided` 不自动创建 Case。

### JD Ability Map

- 分为硬条件、职责能力和未知待确认。
- 每项引用具体岗位版本与官方原文片段。
- 推导信息单独标记为系统分析，不能变成岗位事实。

### Resume Document V2

- 语义内容、证据引用和模板布局分离。
- 区块 ID 在编辑和换模板时保持稳定。
- V1 历史修订保持不可变；读取时通过转换器渲染，用户首次编辑才创建 V2 修订。
- 首轮两个模板：中文经典单栏、中文紧凑技术；保留现有 DOCX，PDF 通过浏览器打印，不新增服务器 PDF 服务。

### Timeline、Interview、Debrief、Knowledge

- 投递阶段变化使用追加式事件；打开官方链接不能推断为已经投递。
- 文字面试保存问题、回答、追问、证据引用与反馈；不录音、不处理音视频。
- 复盘输出表达问题、证据缺口和练习计划；只有用户确认后才能生成新的经历表达修订。
- Knowledge Clip 只保存 URL、标题、短摘要、适用场景、核验时间和用户笔记；首轮不抓取全文、不建设社区。

### AI 操作策略

- 沿用现有后端 AI 配置和 PostgreSQL 任务队列，不引入第二套 AI SDK 或独立服务。
- 每个 AI 操作声明输入、允许事实、输出结构、证据引用、用户确认点、保留期限和无 AI 降级路径。
- 模型不能读取简历原文件、创造经历、修改岗位事实、修改三轴或直接写数据库。

## 5. 开源参考与吸收级别

| 级别 | 项目 | 吸收内容 | 禁止内容 |
|---|---|---|---|
| 简历组件候选 | [OpResume](https://github.com/oopooa/opresume) | A4 分页、章节排序、React 编辑组件 | 独立数据模型和整仓接入 |
| 简历架构参考 | [JadeAI](https://github.com/LingyiChen-AI/JadeAI) | 模板注册、渲染、导出分层 | 与 JobPilot/LuJie 重复移植 |
| 视觉参考 | [resume-design](https://github.com/Hacker233/resume-design)、[Reactive Resume](https://github.com/AmruthPillai/Reactive-Resume) | 中文布局与编辑器边界 | Vue 页面直接复制、国外模板默认化 |
| 求职工作流 | [LuJie CareerKit](https://github.com/Chozzc/Lujie-Careerkit) | 一岗一档、逐段确认、完整链路 | SQLite、认证、独立后端 |
| 投递管理 | [JobSync](https://github.com/Gsync/jobsync) | 看板、时间线、任务、Provider Registry 思路 | 综合平台、评分和独立采集运行时 |
| 经历与复盘 | Career-Ops、JobTrac | STAR+Reflection、准备与复盘 | 自动劝退和通用评分 |
| AI 安全 | OfferU | 操作注册、事实 Gate、显式确认、审计 | Python/FastAPI/SQLite 整套接入 |
| JD 映射 | [Resume Matcher](https://github.com/srbhr/Resume-Matcher) | 要求—证据覆盖与缺口解释 | 匹配百分比、ATS 伪评分 |
| 文字面试 | [FaceTomato](https://github.com/Infinityay/FaceTomato) | 问答节奏、追问、反馈 | AGPL 代码和语音能力 |
| 工作台交互 | [Plane](https://plane.so/blog/introducing-plane-navigation-2)、[Twenty](https://docs.twenty.com/getting-started/core-concepts/layout)、[Linear](https://linear.app/docs/peek)、[Attio](https://attio.com/help/reference/attio-101/attios-data-model/understanding-records) | 唯一侧栏、项目标签、侧览、记录页 | 整个工作管理平台架构 |
| 采集研究 | ever-jobs、job-pro、JobSync | ATS 契约、分页、失败隔离 | 代理、Cookie、反爬绕过、聚合平台、自动投递 |

复用规则：

- Aijob 始终是唯一系统骨架。
- 只有 MIT/Apache、无认证/持久化/遥测/网络副作用的纯组件可以选择性移植。
- 每个移植文件记录上游仓库、固定提交、许可证和本地修改。
- 不使用 Git 子模块或整仓 Fork；外部类型必须经 Aijob DTO/anti-corruption layer 转换。
- AGPL、许可证不清晰、框架冲突或带独立后端的项目只学习行为，不复制代码和样式表。

## 6. 实施阶段与 Gate

### Phase 0：治理与基线

- 接受 ADR-0030，更新路线图与交接。
- 冻结新增来源扩容，保留 canonical 来源安全维护。
- 保存现有页面基线；`.claude/`、`.data/`、密钥、简历和本地数据库继续排除。

### Phase 1A：工作台壳层、静态看板与 URL 侧览

- 增加明确的 Career OS 功能旗标；关闭时继续使用现有产品路由和 `ProductShell`，开启时进入统一 `WorkspaceShell`。
- 实现统一侧栏、顶部工具栏、主画布、可收起右侧检查器、响应式容器及共享 CaseHeader/CaseTabs 路由骨架。
- 使用仓库内静态夹具实现 `/applications` 的列表/看板、筛选、排序和 `?peek=<caseId>` 侧览；视图状态进入 URL，本机 UI 宽度偏好不进入用户事实数据库。
- 六个岗位子路由只展示共享静态 Case 上下文与明确占位；不修改业务表或接口、不调用真实 AI、不删除旧页面。

Gate：导航无重复；功能旗标可安全回退；深链接刷新及前进/后退恢复上下文；列表侧览关闭后焦点和位置恢复；1280/320 无整页横向溢出；键盘与焦点通过。

### Phase 1B：JD 能力与定制简历静态原型

- 在 Phase 1A 的同一壳层和静态 Case 上完成概念 02、03 的可交互原型。
- JD 能力只使用`已有证据 / 证据待补充 / 用户尚未确认`；简历建议必须展示接受、编辑后采用和拒绝，不自动写入。
- 只验证信息架构、分栏、焦点和响应式；不接 ApplicationCase 数据库、完整编辑器、真实 AI 或真实招聘来源。

Gate：两个工作区复用同一 CaseHeader、CaseTabs、ContextInspector 与视觉 token；不存在独立简历品牌、匹配等级或第二套主导航。

### Phase 2：领域与接口

- 增加 ApplicationCase、阶段事件、能力映射、Resume V2、面试、复盘和 Knowledge Clip。
- 新增 owner 隔离的内部接口；公共岗位 API 与准入逻辑不变。
- 扩展 TTL、owner epoch、全部数据删除和迟到任务拒绝。

### Phase 3：三个 PoC

- 简历：V1→V2、两个中文模板、A4 预览、章节排序、逐段确认、DOCX 与浏览器打印。
- Case：创建、固定岗位版本、查看差异、阶段事件和旧决定兼容。
- 面试：规则问题、受控 AI 问题、文字回答、证据引用、反馈和复盘。

Gate：不存在第二套认证、数据库、队列、AI SDK、岗位真源或用户事实库。

### Phase 4：一岗全闭环

完成：岗位侧览→创建 Case→能力拆解→选择证据→定制简历→导出→记录投递→文字面试→复盘→知识引用→全部删除。

AI 不可用时仍能完成 JD 查看、简历编辑、导出、投递记录和模板化面试准备。

### Phase 5：渐进迁移

- `/resume` 兼容进入 `/resumes`。
- `/recommendations` 收口到 `/applications`。
- `/insights` 按岗位或 Case 上下文进入 `requirements`。
- 已关联旧 tailoring run 进入 Case 简历页；无法关联的保留旧只读页。
- 新闭环功能、安全和删除 Gate 全部通过后，才移除重复旧组件。

### Phase 6：完整 OS 与供给恢复

- 扩展多岗位管理、提醒、故事视图、公司研究、练习计划和引用式经验库。
- 恢复容量优先的官方 ATS 来源族和 100/1000 扩容。
- 外部 Private Alpha 必须同时通过产品闭环、可信供给、服务器就绪和隐私安全 Gate。

## 7. 接口与测试

- 新接口只增加 owner 隔离的 Case、事件、简历 V2、面试、复盘和知识能力；公共 `/v1/jobs` 与公开准入不变。
- UI 侧览使用 `?peek=<caseId>`；视图、筛选、排序写入 URL。
- 简历模板只接收 Aijob Resume V2 DTO，外部项目类型不得进入领域层。
- 全量验证覆盖：架构依赖、许可证、路由与侧览、响应式、Case 唯一性、岗位版本固定、V1→V2、证据 ID、AI 事实边界、owner 隔离、CSRF、TTL、删除、迟到任务、DOCX、公开岗位为 0。
- 完整 E2E 必须覆盖一岗全闭环；岗位与看板首屏不得加载简历编辑器和面试模块。

## 8. 明确不做

- 不抓 BOSS、实习僧、牛客等综合平台。
- 不自动登录、填表、批量投递或代替用户提交。
- 不做语音、视频、OCR、浏览器扩展、公共管理后台、Redis、向量库或消息总线。
- 不显示匹配百分比、适合度等级、自动劝退或 AI 自动接受。
- 不把高校、政府、公众号或经验文章当成当前岗位事实。

## 9. 新任务第一步

Phase 1A 已按[工作台壳层验收记录](../evidence/product/career-os-v2/phase-1a-workspace-shell-acceptance-2026-08-04.md)通过。新任务只完成 Phase 1B：在现有静态 Case、共享壳层与右侧检查器中实现概念 02、03 的 JD 能力和岗位定制简历可交互原型。不得接入完整编辑器、ApplicationCase 数据表、真实 AI 或真实招聘来源，不得引入独立简历品牌、匹配等级或第二套主导航。开始前必须检查分支与工作树，读取 `AGENTS.md`、`README.md`、路线图、当前交接和本计划；不得读取或提交 `.claude/`。
