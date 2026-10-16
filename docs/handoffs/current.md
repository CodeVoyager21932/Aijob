# 当前交接：简历基础主线收口，准备切换模块

更新：2026-10-15。当前目标见[路线图](../06-mvp-roadmap.md)，日常操作见[运行手册](../runbooks/system-upgrade-local.md)。

## 当前结论与授权

coco 已确认简历基础主线收口，并授权同步任务文档、清理过程临时文件及推送 GitHub。现有六套模板、手工编辑、标题/正文/联系方式局部调整、撤销重做、保存重开和正式单页 PDF 转入维护。收尾审查未发现阻止切换模块的数据保留、格式错套或 PDF 版本问题。下一模块尚未指定，不自行开新模块，也不恢复 30 套或其他模板数量目标。本次整理与远端同步见[归档记录](../evidence/resume-github-closeout-2026-10-15.md)。

本轮实际证据及后续项统一见[简历模块收口记录](../evidence/resume-module-closeout-2026-10-15.md)。[六套交付](../evidence/chinese-resume-all6-local-layout-2026-10-15.md)已经包含网页点选/拖选、整块和选字字号、换行/位置、撤销重做、保存重开、六份浏览器实际下载及超页拒绝。原 12 稿完整对象深比较不变；六份下载全部一页 A4，8,662 个原可见字符顺序一致且未自动缩字，18 处局部设置与实际 PDF 相符。收尾重算交付哈希一致。

## 继续使用与资料保护

- [应用简历库](http://127.0.0.1:5173/resumes)、[六套前后对照](http://127.0.0.1:8775/)、[实际 PDF 总览](http://127.0.0.1:8775/overview.html)；对照页含整页、近景、操作图、PDF 与可编辑副本。
- 本轮私有成品 `.data/runs/all6-local-layout/20261015/`，索引 `formal-delivery-manifest.json`，原稿保留检查 `preservation-final.json`。六份验收副本保留，可用于继续复现，不覆盖原稿。
- 旧 8770–8774 页、参考、截图、输入、原件、个人稿、历史产物与必要失败证据均保留。页面进程停止时按对应私有目录的服务脚本恢复，不能通过移动成品“整理”而破坏链接。
- 正式 PDF 严格一页；超页诊断预览只用于修正并拒绝正式下载。不自动缩字、删文或截断。原文变化后不再应用失配的选区格式，需重新选定，事实正文仍保留。
- DOCX 为可编辑内容导出；本轮局部格式尚未同步到 DOCX，Word/WPS 实际分页未验，不能宣称与 PDF 同版。

## 保留后续项

简历库真实缩略图与内容状态、AI 目标条目原文/改后就地对照、真实材料 AI 起草/审阅/采用联调，以及 DOCX 局部格式和分页验证尚未完成。旧稿断段按需手动处理，不批量重解析。它们不阻止已验收的手工 PDF 主线使用，也不在此次收尾自动开工；具体风险和入口见收口记录。

共同界面、岗位相关性/运行状态、连续投递流程仍有[全站审查](../audits/ui-ux-2026-10-15/README.md)遗留。不能把简历本轮收口写成全部 29 项问题关闭。

## 工作基线

- 目录：`C:/Users/72998/Projects/Aijob`；分支：`codex/job-fact-fidelity-handoff`。本轮功能提交为 `cb3a725`（会话恢复）与 `c94a7dc`（六套模板、共同编辑界面及局部排版）；收尾文档另作提交，接手以 Git 最新记录为准。
- 此前受管服务修复 `57c281c` 等六个本地提交保留历史，已随功能基线 `c94a7dc` 正常推送 GitHub；收尾文档随后同步。不重建旧 HEAD、不强推、不合并到 `main`。接手核对最新 Git 记录与远端分支，不能再把此前未提交状态当作现状。
- 旧研究/证据与原始盘点的 3,452 个未跟踪文件已按精确路径加入本机 `.git/info/exclude`，原文件保留且不上传；私有清单和原排除文件在 `.data/runs/resume-github-closeout/20261015/`，不以 Git 状态干净误称个人资料也已备份到 GitHub。
- 仅网页开发版。安装包专属工作、资料迁入和公网部署没有随简历收口恢复；当前/旧业务库、来源未明的测试草稿、个人资料、配置与密钥保留。
- 本次文档整理前的入口副本放 `.data/runs/resume-closeout/20261015/before-docs/`；历史交付文件原位保留。该副本仅保护本次文档改动，不是业务库或完整源码备份。

## 运行位置与证据时点

| 对象 | 最近证据与使用含义 |
|---|---|
| 业务库 | `aijob-recovered-postgres` / `127.0.0.1:55439/aijob`；卷 `aijob_recovered_20260905_data`。10/13 已前向迁移至 078，此次收尾未迁移或初始化数据库 |
| Web/API/worker | 日常端口 5173/3000，统一 `local:status/start/stop`。10/15 收尾时只读 `local:status` 显示 API/Web ready、collector/match running，原业务容器 running；健康服务直接复用 |
| Docker | 停止应用不停止原业务容器；本次未新建库、容器或卷 |
| 连接与后台 | 10/13 上海/杭州产品实习使用 Tavily；个人模型普通生成已连通，中转 Responses 未观察到真实搜索工具。`shining3d-internships,hellobike-internships` 各 24 小时，摘要北京时间 09:00；本次未手动触发采集、搜索、摘要或模型调用 |
| 维护台 | 8091 仅供维护者按需使用；普通用户模型与搜索在 `/settings/ai` |
| 网页身份与恢复 | [ADR-0044](../decisions/0044-local-web-session-recovery.md)：Chrome 已记住原身份，30 天会话到期自动续接；浏览器记住凭据最长闲置 400 天、使用时续期。清除浏览器数据或换浏览器后，用 `/settings/data` 下载保存的恢复文件找回同一本机服务资料 |

运行结果只是上述检查时点，不代替下次需要使用应用时的 `local:status`。恢复文件尚无用户已下载保存的证据，也不代替数据库与原密钥备份。此前一次性恢复入口已关闭，正式网页续接证据见[恢复交付](../evidence/web-session-recovery-2026-10-14.md)。

## 历史与接手动作

简历各轮历史统一从[收口记录](../evidence/resume-module-closeout-2026-10-15.md)和[路线图证据入口](../06-mvp-roadmap.md#已完成工作的证据入口)查阅。早期“模板完全不符合预期”、C-only 范围、9.5 pt 收紧规则及短尾待办均为当时记录，已由后续交付接续，不再作为当前任务；[早期现场交接](2026-10-15-ui-ux-template-resume-handoff.md)保留为历史。

1. 读 README、路线图和本文；授权替代再查计划/ADR 索引。
2. 核对当前分支、`git status` 与最近提交，保留已有改动。
3. 接受 coco 指定的下一模块和实际使用目标；简历只因具体反馈维护，不继续无期限精修。
4. 需要使用应用时才按运行手册检查和启动，复用健康服务；按[验证规范](../12-validation-and-quality-strategy.md#日常改动如何验证)选择定向检查。

## 恢复与保护位置

Git 不保存 `.data`、配置或数据库。10/14 私有整理保全在 `C:/Users/72998/Projects/Aijob-backups/20261014-system-cleanup`，分别查 `copies/RESTORE.md`、`test-databases/README.md`、`evidence/index/README.md`；迁移前备份与对应密钥见运行手册。历史备份不代表此刻全部业务数据或源码。

[知识与维护减负](../plans/project-maintenance-simplification-2026-10-14.md#10-执行结果与保留项)与[前三批整理](../audits/system-cleanup-2026-10-13/README.md)保留：历史附件批量删除受阻，原副本暂留，不自动重试。Desktop job、Documents 旧 Git common directory、E 盘登记工作树、C 盘 f057 链接、direction 测试库及冻结安装候选保留；身份和路径以整理记录为准。历史阶段从[历史索引](../plans/archive/README.md)定位，不恢复为新待办。
