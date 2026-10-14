# 历史：S0–S4 简历工作室质量候选

> 状态：迁移 065 与旧 HTML/Chromium 候选的版本运行记录。ADR-0041、ADR-0042 已更新简历主链，当前日常启动统一见[网页版运行说明](system-upgrade-local.md)。保留下方原步骤供追溯，不重跑 S0–S4、全模板矩阵或业务迁移，也不把当年候选通过当作当前最终简历质量结论。

本轮基准是 S0–S4、40 套模板、`studio-pages-v3` 与迁移 065。旧 direction-studio 候选仅供历史查阅，不包含本轮内容检查和导出产物。源码候选需要安装锁定依赖并构建，不是已部署服务。

## 历史候选工作区与启动

使用 `C:\Users\72998\Projects\Aijob`。先检查 5173 / 3000 监听和 API `/health/ready`；已有进程正常时直接使用，不重复启动。恢复业务库在 55439，专属合成测试库在 55443；继续使用原有数据库与密钥，不重新 bootstrap、恢复业务或启用来源。

```powershell
Set-Location C:\Users\72998\Projects\Aijob
pnpm install --frozen-lockfile
pnpm build
# 仅当已有本机环境加载完成且没有相同进程时
$env:VITE_CAREER_OS_V2='1'
pnpm dev
```

访问 `/resumes` 新建或导入，编辑、下载、重新进入。实际导出历史在“版本与导出”。“预览 PDF”和“下载这份 PDF”读取同一份已保留文件。图库使用完整合成样稿，编辑纸张只显示实际内容。

开发模式与发布模式的访问策略沿用 `apps/web/src/environment.ts`。默认 production 构建不会自动开放内部产品页面；正式试用按既有 alpha 邀请和身份配置部署。性能检查使用 `vite build --mode test` 的优化产物及本机访问策略，不能据此声称生产访问配置已验证。

## 数据、字体与导出

1. 新环境先备份数据库、原件及对应加密密钥，记录应用版本。先提供同时读取 v1/v2/v3 的兼容服务，再启用新版写入。迁移只前向运行 `pnpm db:migrate`，本轮新增 065；不修改旧迁移。
2. 本机 065 已应用。升级前备份 `.data/resume-quality-20260910/before-export-065.dump` 留在本机。065 增加私有导出产物/幂等回执、正文布局配对约束、owner epoch 和角色权限。
3. `PDF_BROWSER_EXECUTABLE` 指向 Chromium；`PDF_FONT_PATH` 的同目录必须含 `font-set-v3.json` 及清单中的 v3 字体。旧 `AijobCJK.otf` / 衬线字体仍供历史读取。全部字体从同源/受控本地资产读取，运行时不下载网络资源。不要修改字体后沿用旧版本号。
4. 保留现有 `RESUME_ENCRYPTION_KEY`。原件、照片与导出产物的删除相互独立；导出字节加密保存在 PostgreSQL 的 `profile.resume_export_artifacts`，不是公开静态目录。文档/owner 删除会清理其关联产物；迟到任务不能复活数据。
5. 默认 PDF 有界并发 2、单次超时 20 秒，由 `PDF_RENDER_CONCURRENCY` / `PDF_RENDER_TIMEOUT_MS` 配置。字体或正文验证失败会返回明确错误；不能将失败改为“成功但空白”。日志记录阶段/字段标识，不写简历正文。

接口：`POST /v1/resume-documents/:id/exports` 接收格式和成对修订；`GET /v1/resume-documents/:id/exports` 查询历史；`GET /v1/resume-exports/:id/file` 下载相同字节。现有 PDF/DOCX 下载地址继续兼容。导出前保存并 checkpoint；用户继续编辑不会改变已经生成的文件。

## 回退

065 不提供删除新表的 down。回退应用必须能读取 `studio-pages-v3`、40 套模板及已保留的历史版本。不得把旧 30 套程序直接对准新数据，也不能把 `VITE_CAREER_OS_V2=false` 当作数据回退。

保留本轮源码清单、字体哈希与导出文件。当前没有另一份经过独立验收的 v3 回退构建；故障时采用兼容的修复构建。恢复数据库备份会舍弃备份后写入，必须作为独立灾备操作，不能自动执行。旧投递稿、原件和既有导出不批量重生成。

## 复现检查

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# 已加载仅含合成数据的 AIJOB_TEST_DATABASE_URL 后
pnpm --filter @aijob/platform exec vitest run src/resume-documents/export-artifacts.integration.test.ts src/resume-documents/studio.integration.test.ts src/resume-documents/studio-roles.integration.test.ts src/resume-documents/template-library.integration.test.ts --no-file-parallelism
pnpm --filter @aijob/platform exec tsx src/verification/resume-quality-matrix.ts '--templates=all'
pnpm --filter @aijob/platform exec tsx src/verification/resume-quality-gallery.ts
pnpm --filter @aijob/platform exec tsx src/verification/resume-quality-edges.ts
pwsh -NoProfile -File apps/platform/verification/verify-resume-quality-office.ps1
```

PDF 栅格化与 WPS 文本读回脚本在 `apps/platform/verification/`，使用 Python/pypdf/Pillow/Poppler；本机脚本里的 Chrome、Python、Poppler 路径在其他主机须明确调整。浏览器四类走查在 `apps/platform/src/verification/resume-quality-{journey,import,input,performance}.ts`，仅创建合成 owner，不操作用户文档。原始失败 PDF 保留本机，不复制到候选或 Git。

## 真实运行限制

本机 Windows Chrome、WPS 14 已用于实际输出。Linux 缓存镜像加载本轮编译代码、断网/2 CPU/2 GiB 下通过四组边界 PDF；完整新镜像构建在拉取 Docker Hub 基础镜像时遇到 EOF，尚未形成新可部署镜像。这两种结果不能合并为“Linux 部署通过”。

BYOK 真实模型、实体手机软键盘/中文输入法、原生打印对话框、新主机身份/HTTPS/SMTP仍待实际环境。既有岗位冷查询/混合负载和来源准入不因本次简历验收变为通过。监控分别记录输入/保存、冲突、导出等待/耗时/失败、解析队列、CPU/内存，不用一次总体成功率掩盖具体失败。
