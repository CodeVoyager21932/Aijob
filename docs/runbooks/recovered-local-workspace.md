# 新主工作区的业务恢复与启动

> 当前（2026-09-09）：业务库已升级 064，前端 5173/API 3000；本轮字体和解析环境请按 [方向工作室候选手册](direction-studio-candidate.md) 配置。下方 061、5189/3018 和 Windows 系统字体命令是历史记录，不能作为本轮启动默认值。


> 2026-09-08：当前体验升级代码依赖061，业务容器55439已在本轮备份、克隆演练后升级061，80张旧表原有字段一致，93条本机岗位、公共0和图谱均通过冒烟。容器已停止；下方命令可启动当前代码。此次备份位于 `C:\Users\72998\Projects\Aijob-backups\20260908-experience-upgrade`。体验联验使用独立 `aijob-studio-test-20260907`（55442）的 `aijob_studio_browser`，前端5189/API3018；其中只有合成资料。不得在恢复业务库运行测试或重置。当前状态以[交接](../handoffs/current.md)为准。

用户 AI 改为在 `/settings/ai` 接入自己的 API，平台不提供模型，不再要求 coco 配置运营方供应商。保留原业务加密钥，不能使用夹具密钥替换它。

2026-09-06更新：主体升级已将恢复库从038升级到053，目录、图谱与健康检查通过。下方2026-09-05恢复数据仅作历史记录，不再代表当前schema。

## 启动与停止

在新主目录执行：

```powershell
Set-Location C:\Users\72998\Projects\Aijob
docker start aijob-recovered-postgres

# 本机PDF下载使用已安装Chrome和Windows中文字体；只影响当前终端，不改.env
$env:PDF_BROWSER_EXECUTABLE="C:/Program Files/Google/Chrome/Application/chrome.exe"
$env:PDF_FONT_PATH="C:/Windows/Fonts/simhei.ttf"
pnpm dev
```

访问 `http://127.0.0.1:5173/today`。关闭开发终端后，使用 `docker stop aijob-recovered-postgres` 停止数据库，持久数据保留。

本轮验证后API、Web与恢复数据库均已停止。新目录根 `.env` 指向独立数据库 `127.0.0.1:55439/aijob`，Web `.env` 开启Career OS V2；两者均被Git忽略。恢复容器使用持久卷 `aijob_recovered_20260905_data`。

此环境不用旧 `pnpm infra:up/down`，它仍描述5432端口的原Compose环境。也不需要 `local:bootstrap --confirm-live`。来源探测、本地刷新和真实邮件均关闭，AI供应商配置只备份、未启用。日常启动完整服务使用上面的 `pnpm dev`。

## 2026-09-06主体升级

升级前备份：`C:\Users\72998\Projects\Aijob-backups\20260906-product-core-upgrade`，包含custom dump、原环境与密钥文件。当前053，本机93岗/公共0；原437条来源修订、345个岗位版本及647份历史要求记录未改写。升级生成新的要求集合以保留旧语义；Case固定版本不后台替换。详情见[升级证据](../evidence/product-core-upgrade-2026-09-06/recovered-database-upgrade.json)。

## 2026-09-05恢复与验证结果

- 从停止状态的原卷只读导出冷备份，再解包到独立卷启动；原容器 `aijob-local-postgres-1`、原卷与旧目录未改动。
- 选择原主库 `aijob`，从037迁移至038；`aijob_alpha`仍为022/22岗历史快照。复制集群中的其他历史库原样保留，未合并。
- 主库236个岗位实体、345个岗位版本、437条来源修订均保留。存储总量不能当成可见供给：本机API实际93岗/7公司、无下一页；公共指针0。这是恢复的历史数据，不是本轮新采集或新鲜度认证。
- 原主库Case、简历文档、已确认资料修订、简历分析与导出均为0，恢复后仍为0；122个owner保留。不能把无样本比对说成验证过真实Case升级。
- 345个旧岗位版本仅170个活动要求集指针更新；437条来源修订、477套旧要求集的原字段逐行一致，没有旧行丢失。第一次物化新建170套要求集、0版本；第二次新增要求集和版本均为0。
- 113个快照引用恢复并校验111个。2个原本缺失的对象关联 `bytedance-manual-test`、`official-account-test` 历史测试来源，缺项如实保留，不伪造补齐。
- API健康检查200、岗位查询200/93岗、Web页面200。没有修改产品代码，不重复949项工程测试；未采集、发布或启动参与者工作。

## 备份与密钥

备份位置：`C:\Users\72998\Projects\Aijob-backups\20260905-business-recovery`。权限限定当前Windows用户与SYSTEM，包含原卷tar、迁移前后逻辑dump、195个逐文件校验的本地材料和检查摘要。该目录包含私有材料和密钥，不提交或上传。

迁移前dump已实际恢复到临时基线库比对；结束后只删除了该临时基线库。原卷、恢复卷和迁移前后dump均保留。

活动密钥沿用桌面job原密钥；Documents旧密钥和新工作区此前测试密钥分别备份，不混用。主库无可供解密校验的简历/邮箱密文，因此只确认材料保留，不宣称已验证真实密文解密。

历史恢复已关闭；当前任务按主体升级执行记录与交接接续。
