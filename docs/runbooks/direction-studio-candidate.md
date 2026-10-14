# 历史：2026-09-09 方向图谱与简历工作室候选

> 状态：此版本运行、迁移与回退步骤仅供历史追溯，不提供当前任务。当前启动及配置统一见[网页版运行说明](system-upgrade-local.md)；不得照此重跑 062–064 迁移、图谱重建或旧候选验收。原源码候选、证据和命令保留，不表示它们应重新执行。

这是需要安装依赖并构建的本地源码候选，不是已部署服务。源码包在 `.data/releases/direction-studio-20260909-r5/`；独立证据包包含三份合成样稿和 90 组输出。真实环境、密钥、业务库、依赖和 `.data` 不进入包。候选清单记录基线提交及每个源码文件散列，包含当前工作区原有改动，未将混合改动自动提交 Git。

## 历史候选的检查与启动

主工作区 `C:\Users\72998\Projects\Aijob`。API 默认 `http://127.0.0.1:3000`，Web `http://127.0.0.1:5173`；先检查已有进程，不重复启动相同端口。已有本机环境使用恢复业务库 55439，测试库在 55443；不得把测试数据灌入业务库。未自动启用新的来源或采集任务。

```powershell
Set-Location C:\Users\72998\Projects\Aijob
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
# 仅在本机已有环境已配置、且前后端未运行时：
pnpm dev
```

完整运行权限、解析容器和环境字段沿用 `infra/runtime/README.md`。部署端需要单独准备 PostgreSQL、原件存储、Chromium、同源字体和隔离解析运行时。用户在应用中配置自己的兼容 API；不要用旧平台 `ai:configure` 代替 BYOK，也不要自动购买模型。无 API 时保留手工编辑与标记清楚的固定提示。

## 数据升级

1. 备份目标库与私有附件存储，记录当前程序版本，暂缓写入窗口内的修改。不要输出环境中的密钥。
2. 先部署同时读取内容 v1/v2、渲染 v1/v2 的兼容程序，再运行 `pnpm db:migrate`。本轮前向迁移为 062（语义投影/运行记录）、063（模板偏好/私有照片）、064（语义投影更新权限/触发约束）；不修改既有迁移。
3. 运行 `pnpm --filter @aijob/platform cli graph-reindex-v2 --batch-size 200`。它使用已存岗位版本，不发起来源请求。按报告检查成功、失败和覆盖。当前提取为 role-semantics-v2，实施散列 2026-09-09.3；重跑幂等。
4. 检查 `/v2/job-graph/directions`、`/v2/job-graph`、分页原句；通过本机/公开各自准入。当前公开 0 是未准入的正确结果，不能提升来源状态凑数量。
5. 用合成 owner 验证创建/保存/历史导出、照片、原件、全量删除与迟到任务。旧投递稿、旧匹配、原件与已生成导出文件不批量改写。

本机实际恢复库已升级 064；升级前备份 `.data/aijob-before-r2-20260909.dump` 保留。本轮 236 个岗位版本重建，0 失败；本机可见 93 岗/7 家，34 来源配置，公开 approved 0。测试使用专属 PostgreSQL，不以过去恢复测试替代本轮 28 项集成检查。

## 回退

数据库只前向升级。应用回退必须选择能够读取本轮 v2 内容/模板/渲染版本的兼容候选；旧 a4ff514 或旧五模板候选不具备该条件，不能直接部署读取新写入。尚未有另一份经过验收的 v2 回退构建时，保留本次源码和散列，采用维护窗口内的修复构建。恢复备份会丢失备份之后的写入，必须作为独立灾备决定处理，不自动运行。

前端旧路由、历史 insight-runs、旧文档读取适配保留。私有原件清理和临时解析清理分开。删除 owner 后的上传、解析和 AI 迟到结果必须拒绝；模板偏好、照片、恢复草稿同步清理。实际删除与重试检查见本轮 PG 和浏览器证据。

## 复现验收

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# AIJOB_TEST_DATABASE_URL 仅设置为专属测试库，不使用业务库。
pnpm --filter @aijob/platform exec vitest run src/insights/graph-v2.integration.test.ts src/resume-documents/studio.integration.test.ts src/resume-documents/template-library.integration.test.ts src/resume-documents/studio-roles.integration.test.ts src/ai/assistant.integration.test.ts src/workers/studio-task-recovery.integration.test.ts
pnpm --filter @aijob/platform exec tsx src/verification/studio-docx-check.ts
# Windows 且已安装 WPS/Word COM；脚本只打开合成文件：
& apps/platform/verification/verify-office-templates.ps1
python apps/platform/verification/verify-office-output.py
pnpm --filter @aijob/platform exec tsx src/verification/studio-delivery-manifest.ts
```

Python 验证依赖 Playwright、pypdf、Pillow、fontTools；脚本内 Chrome 路径为本机 Windows 路径，其他机器须显式调整。浏览器脚本在 `apps/web/verification/`，创建合成 owner；存储状态写入 `.data`，不得发布。字体复现与度量脚本在 `apps/platform/verification/build-common-fonts.py` 和 `src/verification/studio-web-font-check.ts`。性能脚本 `src/performance/direction-studio.ts` 仅接受专属合成测试库，先读参数及安全检查再运行。

监控按目录/图谱冷与热请求、保存冲突/失败、解析/导出等待、AI 排队与失败、重建覆盖、来源新鲜度、CPU/内存分别记录。当前冷查询/混合负载未达标，真实 AI、HTTPS/SMTP、部署主机新模板和持续来源均未验；详见本轮证据，不应据此直接宣布上线。

最终归档复核于 2026-09-10；当时 5173/3000 未监听，未重复启动服务。端口说明是该版本的已验证配置，不代表当前进程状态；当前检查与启动使用[网页版运行说明](system-upgrade-local.md)。
