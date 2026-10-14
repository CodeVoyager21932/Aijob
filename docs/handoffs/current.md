# 当前交接：网页开发版与维护减负

更新：2026-10-14。当前任务见[路线图](../06-mvp-roadmap.md)，日常操作见[运行手册](../runbooks/system-upgrade-local.md)。

## 工作基线

- 目录：`C:\Users\72998\Projects\Aijob`；分支：`codex/job-fact-fidelity-handoff`。
- 已推送的整理基线：`d6df922`；此前网页源码检查点：`45731d4`。接手时查看 Git 最新记录与差异，不用旧检查点覆盖未提交工作。
- [知识与维护减负结果](../plans/project-maintenance-simplification-2026-10-14.md#10-执行结果与保留项)已落地；附件物理退役受审批策略阻止，原副本暂留，不自动重试。前三批结果及恢复位置见[整理记录](../audits/system-cleanup-2026-10-13/README.md)。
- 安装包工作暂停；当前/旧业务库、来源未明的两份测试草稿、个人资料与密钥保留。不重建旧 HEAD，不扩大 Docker/备份清理。

## 运行位置与证据时点

| 对象 | 最近证据与使用含义 |
|---|---|
| 业务库 | `aijob-recovered-postgres` / `127.0.0.1:55439/aijob`；卷 `aijob_recovered_20260905_data`。10/13 已前向迁移至 078；10/14 启动核验只经应用读取，未执行迁移 |
| Web/API/worker | 日常端口 5173/3000，统一 `local:status/start/stop`。10/14 修复冷启动等待窗口后，Chrome 实看又发现后台 watcher 存活而服务子进程已退出；启动器改为直接管理服务进程，重启后 API/Web 就绪，API 监听 PID 与登记 PID 一致 |
| Docker | 10/14 本轮已启动 Docker Desktop 和原业务容器；停止应用时容器继续运行。未新建库、容器或卷 |
| 连接 | 10/13 上海/杭州产品实习使用 Tavily；个人模型普通生成已连通，中转 Responses 未观察到真实搜索工具。复用配置，不要求重填 Key |
| 后台 | `shining3d-internships,hellobike-internships` 各 24 小时；10/14 启动后各完成一次计划刷新。摘要仍为北京时间 09:00，本轮未手动触发新摘要或搜索 |
| 维护台 | 8091 仅供维护者按需使用；普通用户的模型与搜索统一在 `/settings/ai` |
| Chrome 页面与会话 | 10/14 已读取正常 HTTP 标签，今日、岗位发现、简历首页与连接设置通过有限实看；岗位筛选、详情与方向弹窗可用。当前 Chrome 为无简历/订阅/个人 AI 配置的本机会话，未跨会话恢复或迁移，不能算已有稿件及其导出已验收 |

能力与限制以[路线图](../06-mvp-roadmap.md)为准，运行历史证据见[10/13 交付](../evidence/local-productization-2026-10-13.md)。

## 接手动作

1. 读 README 入口、路线图和本文；涉及决定替代时再查计划/ADR 索引。
2. 核对分支、`git status` 与最近提交，保留已有改动。
3. 需要使用应用时才按运行手册检查和启动，复用健康服务；文档任务不启动业务环境。
4. 按[验证规范](../12-validation-and-quality-strategy.md#日常改动如何验证)选择检查；真实失败固定输入/修订/产物后局部复现。

## 恢复与保护位置

Git 不保存 `.data`、配置或数据库。私有整理保全在 `C:\Users\72998\Projects\Aijob-backups\20261014-system-cleanup`，分别查 `copies/RESTORE.md`、`test-databases/README.md`、`evidence/index/README.md`；迁移前备份与对应密钥见运行手册。历史备份不代表此刻全部业务数据。

Desktop job、Documents 旧 Git common directory、E 盘登记工作树与 C 盘 f057 链接、direction 测试库及冻结安装候选保留；具体身份、保留原因和路径只在整理记录维护。旧文字从[历史索引](../plans/archive/README.md)定位，不再复制另一份当前交接。
