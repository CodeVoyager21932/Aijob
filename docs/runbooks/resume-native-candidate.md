# 历史：原生简历工作室 K4 / K5 候选运行手册

2026-09-13 候选记录，工作区为 `C:/Users/72998/Projects/Aijob`。当时替代 S0–S4 的启动指令已由[当前网页版运行说明](system-upgrade-local.md)接替；本页保留 K4/K5 原步骤、旧渲染链和兼容证据，不再是日常入口。ADR-0042/0043 已更新统一服务端预览、四类新模板与机会任务，不能按此关闭当前所需 collector 或重新运行旧验收。

## 历史候选的启动与访问

以下仅描述 K4/K5 简历候选：先检查端口及 `http://127.0.0.1:3000/health/ready`，正常进程直接复用。业务 PostgreSQL 为既有 `aijob-recovered-postgres` / 55439；55443 是隔离测试库，不能互换。本机前端 `http://127.0.0.1:5173/resumes`，API 3000，导入由 match-worker 处理。当时单独检查简历未启动 collector-worker；当前机会刷新需要该 worker，以现行手册为准。

在已加载本机原有环境配置且端口没有同名服务时：

```powershell
Set-Location C:\Users\72998\Projects\Aijob
pnpm install --frozen-lockfile
pnpm --filter @aijob/resume-core build
pnpm --filter @aijob/resume-renderer build
pnpm --filter @aijob/platform build
pnpm --filter @aijob/web build
# 分别在服务进程中运行，保留原环境，不输出密钥
pnpm --filter @aijob/platform exec tsx src/server.ts
pnpm --filter @aijob/platform exec tsx src/match-worker.ts
# Web 进程
$env:VITE_CAREER_OS_V2='1'
$env:WEB_API_ORIGIN='http://127.0.0.1:3000'
pnpm --filter @aijob/web dev --host 127.0.0.1 --port 5173
```

Windows 后台启动使用隐藏窗口并记录 PID/日志。不要覆盖已有 `.env`、重新生成加密密钥或运行业务恢复。发布构建的身份/邀请限制沿用既有配置，不能把本机 local 模式直接对公网开放。

**隔离测试使用不同浏览器配置或不同主机名。** Cookie 不按端口隔离，不能在同一个浏览器配置中同时打开 `127.0.0.1:5194` 的隔离库与 `127.0.0.1:5173` 的业务库。测试站重建匿名会话可能覆盖业务 Cookie，使仍存在的稿件因 owner 不符而暂时无法访问。交付时已关闭本轮 5194 / 3002 测试服务，保留业务 5173 / 3000；不要通过修改稿件 owner 绕过隔离。

## 内容、字体及导出

新版 `aijob-native-resume-v1` / `reactive-resume-5.3.0-aijob-1` 由固定原生核心承担。浏览器 worker 和服务器隔离渲染器使用相同 React-PDF 模板，PDF.js 展示实际页面。当前服务器导出去重版本 `native-react-pdf-cn-v11`，40 套模板及源哈希见 `docs/evidence/resume-native-template-catalog.json`。

字体来自 `apps/web/public/fonts/font-set-v3.json` 对应本地 Noto Sans / Serif SC 普通与加粗字重；服务端字体目录必须包含清单及对应资源。按锁定 pnpm 补丁安装，保留 `patches/@react-pdf__layout@5.2.0.patch`；不要绕过补丁或静默替换字体。旧 Chromium 配置继续服务旧 HTML 版本，不参与新稿 PDF 主链。

保存完成后创建成对 checkpoint，再产生私有加密导出产物；下载/重复下载读取同一产物。用户继续编辑不改变已投递或已开始的练习快照。原件、照片和产物按 owner 隔离；用户删除后的迟到任务不能重新建回数据。DOCX 是独立可编辑适配，正文与栏位保留，装饰布局不与 PDF 等同。

## 迁移及回退

业务库已从 065 前向升级 066/067。升级前备份 `.data/resume-native-k5-20260913/business-upgrade/before-native-066.dump`，迁移前后既有文档74、正文修订18、布局修订18不变。备份与加密密钥只留本机，不打包。

新环境先备份数据库/附件并记录应用版本，再 `pnpm db:migrate`，先提供新旧版本同时读取能力再启用新写入。旧稿不批量转换，转换操作创建新稿。066/067不使用破坏性 down；回退程序必须支持原生 envelope 和新版条目 ID。不能将旧 S0–S4 程序直接接到已有原生稿的数据，也不能把关闭前端开关当作数据回退。

当前源码包是兼容修复基线，没有另一份独立验收的旧原生回退镜像；故障采用兼容修复。恢复升级前数据库会舍弃新写入，只可作为明确批准的灾备操作。

## 验证、交付与限制

完整范围、复用检查、真实矩阵及未就绪项见 `docs/evidence/resume-native-k4-k5-2026-09-13.md`。日常改动只运行受影响模块检查；修订/owner/删除规则变化时运行专属 PostgreSQL 集成。不要每次重导 120 组，使用 `tools/resume-native/export-matrix.mts --templates <id>` 核对变更版式，再保留来源哈希合并证据。

候选包 `.data/releases/resume-native-20260913-k5/` 为需安装构建的源码和独立合成输出证据；排除 `.env`、业务库、真实简历和密钥。BYOK、实体设备、生产部署镜像、远程身份/HTTPS/SMTP与供给条件不因 K5 本机接管变成已验证。
