# 产品、体验与工程调研依据

## 1. 调研目的

本页记录 2026-07-15 通过 Exa 检索的外部证据。调研以 GitHub 上官方组织、高认可度、长期维护或行业标准项目为主，用来检查本项目是否遗漏了从产品发现到工程交付的关键环节。

这些资料只提供方法和检查项，不作为代码底座。本轮没有克隆、安装或运行任何调研仓库。

Star、Fork 和更新时间会变化，只作为社区认可度信号；官方组织、方法来源、适用范围、许可证和实际内容比 Star 更重要。

## 2. 调研结果

| 项目 | 认可度与维护信号 | 核心方法 | 本项目采用方式 | 不照搬的部分 |
|---|---|---|---|---|
| [GitHub Spec Kit](https://github.com/github/spec-kit) | GitHub 官方；约 121k Stars；240+ 贡献者；2026-07-14 仍更新；MIT | Constitution -> Specify -> Plan -> Tasks -> Implement -> Converge；实现前检查规格、计划和任务一致性 | 建立项目原则、功能规格、技术计划、任务与完成度审计之间的追溯链 | 不安装其 CLI，不让 AI 自动生成的规格代替用户研究和人工判断 |
| [Microsoft Engineering Playbook](https://github.com/microsoft/code-with-engineering-playbook) | Microsoft 官方；约 2.7k Stars；2018 年以来持续维护；CC BY 4.0 | 工程基础检查表、NFR、设计评审、测试、CI/CD、安全、可观察性 | 把工程要求压缩成 MVP 的 Definition of Done 和发布门 | 不采用大团队会议、角色和高覆盖率数字作为当前硬指标 |
| [Google Engineering Practices](https://github.com/google/eng-practices) | Google 官方；约 23k Stars；已归档；CC BY 3.0 | 小而自洽的变更、代码健康、作者与审查者责任、解释审查理由 | 每个 PR 聚焦一个目标，优先改善整体代码健康，保留验证证据 | 仓库已归档，只采用稳定原则，不视为当前工具或流程标准 |
| [Architecture Decision Record](https://github.com/joelparkerhenderson/architecture-decision-record) | 约 16k Stars；50 位贡献者；2026-06 仍更新 | 用 Context、Decision、Consequences 记录重要决策；旧决策被新记录替代而非静默改写 | 为来源策略、AI 边界、数据存储、搜索方案等重要选择建立决策记录 | 不为小型、可逆的日常实现制造文档负担 |
| [18F Product Guide](https://guides.18f.org/product/) 与 [18F Methods](https://github.com/18F/methods) | 美国政府数字服务团队；GitHub 仓库已归档；方法内容仍公开 | Discover current state -> Define future state -> Deliver incremental value；用户访谈、假设、原型、可用性测试 | 在自动化之前增加问题发现、当前替代方案和人工礼宾实验 | 不照搬政府组织结构、审批和采购流程 |
| [thoughtbot Guides](https://github.com/thoughtbot/guides) 与 [Customer Discovery](https://thoughtbot.com/playbook/customer-discovery/README) | thoughtbot 官方验证组织；Guides 约 9.5k Stars；2026-06 仍更新 | 持续追问“是否正在构建正确的东西”；用户细分、假设板、访谈、原型和市场测试 | 用真实用户行为验证定位和方案，不用态度问卷代替行为 | 不照搬固定设计冲刺日程或其公司内部协作方式 |
| [Microsoft REST API Guidelines](https://github.com/microsoft/api-guidelines) | Microsoft 官方；约 23k Stars；CC BY 4.0 | API-first、资源一致性、幂等、版本化、错误契约、兼容演进 | 在实现 API 前先定义请求、响应、错误、幂等和版本边界 | MVP 不需要完整企业级 API 治理委员会和全部规范 |
| [OWASP ASVS](https://github.com/OWASP/ASVS) | OWASP 官方；约 3.5k Stars；稳定版 5.0 于 2025-05 发布；CC BY-SA 4.0 | 把安全从建议变成可验证需求，覆盖输入、文件、认证、授权、数据保护、日志等 | 从相关章节抽取本项目上线安全门和测试用例 | 不宣称完整通过 ASVS；MVP 只声明实际验证的控制项 |
| [OWASP Cheat Sheet Series](https://github.com/OWASP/CheatSheetSeries) | OWASP 官方旗舰项目；约 32k Stars；长期维护；CC BY-SA 4.0 | 面向开发者的具体安全实践 | 继续用于 SSRF、文件上传、提示注入、日志和密钥处理 | 不把清单勾选等同于威胁已经消失 |
| [OpenSSF Scorecard](https://github.com/ossf/scorecard) | OpenSSF 官方；约 5.6k Stars；190 位贡献者；2026-07 仍更新；Apache 2.0 | 评估维护状态、代码审查、固定依赖、工作流权限、漏洞、安全政策、发布等供应链信号 | 用于第三方依赖准入和仓库自身安全改进 | 分数只是信号，不能替代代码、许可证和实际使用边界审查 |
| [Twelve-Factor](https://github.com/twelve-factor/twelve-factor) | 经典方法的官方开放更新；约 2.5k Stars；CC BY 4.0 | 配置外置、构建/发布/运行分离、日志事件流、进程可处置 | 约束部署、配置、日志和回滚设计 | 不因“云原生”提前引入微服务、容器编排和复杂平台 |

## 3. 产品与体验补充证据

本轮三视角审计同时检查了成熟公共就业服务和求职推荐研究，避免把“官方岗位聚合”误当成天然差异化：

| 资料 | 提供的证据 | 本项目采用方式 |
|---|---|---|
| [国家大学生就业服务平台](https://www.ncss.cn/) | 教育部主管的高校毕业生公共就业服务已经提供官方岗位、招聘活动和就业指导 | 作为首要替代方案；本项目不宣称比公共平台更可信，差异集中在跨来源资格核对、经历证据和决策管理 |
| [中国公共招聘网](http://job.mohrss.gov.cn/) | 人力资源社会保障部主办的公共招聘服务已经提供真实性导向的免费招聘信息 | 验证“可信聚合”本身不足以形成产品壁垒 |
| [美国劳工部在线求职行为干预研究](https://www.dol.gov/sites/dolgov/files/OASP/evaluation/pdf/Behavioral-Insights-IJS.pdf) | 补充信息可能提高筛选效率，也可能造成信息过载；信息必须在决策时点渐进展示 | 首屏保持少量关键资格和来源状态，原文、证据与缺口按需展开 |
| [招聘推荐解释的健康摩擦研究](https://ceur-ws.org/Vol-3788/RecSysHR2024-paper_7.pdf) | 解释更适合作为可质疑的决策支持，而不是说服用户接受推荐 | 资格、证据、偏好分开展示；保留未知、纠错和查看冲突岗位的能力 |
| [GOV.UK Responsible AI in Recruitment](https://www.gov.uk/government/publications/responsible-ai-in-recruitment-guide/responsible-ai-in-recruitment) | 强调透明、可解释、公平、问责、质疑与救济 | AI 不修改资格或用户事实；本地显式启用，公开启用仍需用户实验、回归评估、供应商审查和反馈升级路径 |

## 4. 中国场景的合规资料边界

除产品与工程方法外，本项目还处理公开招聘信息、简历和个性化推荐。以下官方资料用于建立上线检查项，不构成法律意见，公开或经营性上线前仍需由具备相应能力的人复核适用范围：

- [《中华人民共和国个人信息保护法》](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm)：用于检查处理目的、最小必要、告知同意、保存期限、删除和个人信息跨境等边界。
- [《生成式人工智能服务管理暂行办法》](https://www.gov.cn/zhengce/zhengceku/202307/content_6891752.htm)：用于检查模型服务中的个人信息保护、输入输出治理和服务提供责任。
- [《互联网信息服务算法推荐管理规定》](https://www.gov.cn/zhengce/zhengceku/2022-01/04/content_5666429.htm)：用于评估推荐透明、用户选择、标签管理和申诉机制等要求是否适用。

此外，公开上线前还要专项确认网络招聘服务资质、网站备案/许可、来源页面条款、著作权与数据库权益、个人信息出境以及第三方模型供应商的数据处理条款。对应检查见 [合规与公开上线门](11-compliance-and-public-launch.md)。

## 5. 跨资料共识

这些资料虽然来源不同，但共同支持以下判断：

1. 先确认用户和问题，再决定功能和技术。
2. 把假设写出来，用最便宜的实验验证最危险的假设。
3. 需求、设计、任务、实现、测试和结果必须可追溯。
4. 一次只交付一个小而完整的用户价值切片。
5. 重要决策记录背景、选项和后果，避免未来重复争论。
6. 非功能要求、安全、隐私、可观察性和回滚不能等上线前再补。
7. 主分支应持续保持可验证、可发布，而不是长期积累黑盒改动。
8. 发布不是终点，真实使用数据和用户反馈必须回到路线图。

## 6. 对当前项目的直接校准

这些调研支持从“岗位聚合与 AI 匹配”收敛到“官方岗位投递决策助手”。2026-07-18 的 [ADR-0011](decisions/0011-mvp-before-participant-validation.md) 进一步锁定：先构建受限的本地完整 MVP，再用参与者验证决策价值。当前需要守住两条边界：

- 三来源本地实现可以先行，但技术可用和岗位数量不能被解释为跨来源价值已经成立。
- 在开始每个功能前，建立从问题证据到规格、计划、任务、测试、发布和结果的完整链路。

因此，当前交付按以下顺序推进：

1. 本地完整 MVP：三个官方来源、30–100 条岗位、简历、三轴、推荐、AI 对照修改、DOCX、决定和删除。
2. 2 人校准与 6 人正式验证：使用完整 MVP 证明或否定用户决策增量。
3. 数据持续性：三个来源的准入、连续运行和独立失败可与 MVP 并行，但不因本地可读自动通过。
4. Private Alpha：仅在 G0–G3 全部通过后，以匿名邀请验证 7 日真实求职周期。

## 7. 资料使用边界

- 不因为仓库高星就安装或运行其代码。
- 不复制与本项目规模不匹配的企业流程。
- 不把模板数量当成工程成熟度。
- 不宣称采用了某项标准，除非存在对应的实现和验证证据。
- 如果外部方法与真实用户反馈冲突，以合规、安全边界内的真实反馈为准，并记录为何调整。
