# 开发与定向检查工具

日常操作从项目根执行 `pnpm local:status`、`pnpm local:start`、`pnpm local:stop`，详见[运行手册](../docs/runbooks/system-upgrade-local.md)。检查按[验证规范](../docs/12-validation-and-quality-strategy.md#日常改动如何验证)选择，不执行全部工具。

| 工具族 | 用途、输入与影响 |
|---|---|
| `local-workspace.mjs` | Windows 当前工作区状态/启动/停止；复用现有配置与登记容器，只补缺少的服务，不初始化/迁移库。停止只作用于本入口记录的进程 |
| `resume-native/regression-inputs.mjs` | 读取并校验本机固定输入清单，无解析、浏览器或网络副作用 |
| `resume-native/audit-upgrade-imports.mjs` | 八份既有材料的字段回归；需要当前 platform/resume-core 构建，私有结果写新 `.data/runs/resume-import-fields/`；不写业务库 |
| `resume-native/coverage-fixtures.mts` / `verify-coverage.mts` | 六类显式虚构的专业/经历量材料，通过实际 renderer 生成现有六套 PDF，逐份检查 A4 一页、全文、越界及源对象不变；可用 `--fixtures` / `--templates` 限定，`--out` 指向独立运行目录，`--rasterizer` 指向已安装的 `pdftoppm` 输出整页 PNG。无数据库读写，不替代整页目视与用户评价 |
| `resume-native/browser-system-upgrade.mjs` | DOCX 导入、编辑、预览、立即下载与重开；只用于已配置的隔离测试服务，会创建测试资料 |
| `resume-native/browser-opportunity-journey.mjs` | 复杂 PDF、方向结果、岗位准备及实际投递稿；用配套 seed 和隔离 PG，不能指向业务服务 |
| `resume-native/browser-import-smoke.mjs` / `browser-public-pdf-smoke.mjs` / `browser-import-check.py` | 按需缩小到 DOCX 或 PDF 导入问题，默认隔离 5194；与上面完整旅程按问题择一，不重复跑 |
| 其他 `browser-*`、`*-seed.mts` | 特定历史故障或 UI 行为复现；先读脚本参数/输入，seed 写隔离库。旧环境不自动恢复为当前验证 |
| `export-matrix.mts`、assemble/render/Office 类 | 定向模板导出与办公软件读回，先用 `--templates` 限定模板；默认全矩阵不是日常交付步骤 |
| `audit-pdf-reimports.mts` | `--input dir[,dir]` 明确指定 PDF 与源 JSON，PDF 实际读回；历史输入需先从本机历史包恢复 |
| holdout/evaluate/score/public-specimen/corpus 类 | 历史样本来源与复现；用过的集保持回归身份，不覆盖封存与首轮结果，也不默认重新下载 |
| `apps/platform/src/verification/{resume-failure-replay,resume-quality-input,resume-pdf-field-diagnose,resume-font-copy-check}.ts` | 仍有用途的旧稿失败诊断与字体检查；保留必要 helper，按需运行，不在默认检查中重建旧矩阵 |
| `apps/platform/verification/{build-common-fonts,build-studio-v3-fonts,unique-cmap}.py` | 已用字体的来源与可复现准备，会生成字体；字体/许可未变化时不执行 |
| `apps/web/scripts/interactive-queue-browser-gate.mjs` | 队列展示夹具复现；不证明真实供应商速度，不作为每次修改的门槛 |
| `infra/runtime`、`infra:up`、`local:bootstrap` | 服务器部署、新环境或恢复能力；不适用于当前已恢复工作区的正常启动 |

## 固定简历输入

默认 `.data/resume-regression/manifest.json`，可用 `AIJOB_RESUME_REGRESSION_MANIFEST` 显式指定另一份本机包。它记录八份原字节文件、来源/许可线索、hash、字段期望和首轮结果位置；不在 Git 中分发个人内容。缺包时明确失败，不自动下载新版本替换。

本机原始保全位于 `C:\Users\72998\Projects\Aijob-backups\20261014-system-cleanup\evidence\fixed-regression`；新独立包的保全见同目录 `maintenance-history`。恢复时保持 manifest 与输入配套，不只复制截图或最终分数。

`audit-upgrade-imports` 的 `AIJOB_IMPORT_OUTPUT` 可指定新结果目录；`--resume-saved` 必须同时明确指定先前目录，只继续该次未完成检查，不用于覆盖首次结果。`.data/system-upgrade-20261012/import-fields-first/` 保留原首轮记录。

## 输出与退役

新手动输出放 `.data/runs/<任务>/<运行标识>/`；`AIJOB_BROWSER_OUTPUT` 可显式指定隔离输出目录。普通临时结果在核对后清理，必要输入、独有失败和采用结果按用途保留。未知归属旧文件不按年龄删除。

已关闭 OS/M/PA 和旧 HTML 全矩阵脚本已退出活动目录。其断言针对当时页面/引擎；现行 owner、修订、删除、投递产物等保障继续由各模块测试承担，不能把“脚本退出”当质量通过。原文用 `git show d6df922:<原路径>` 读取；来源索引见[历史定位](../docs/plans/archive/README.md)。

旧 Studio 原件/DOCX、RR5 schema/提取/渲染、旧 40 模板、旧全局搜索及迁移仍有真实依赖，继续保留；不为整理强制转换旧稿。实际采用的 vendor、补丁、字体和许可证不属于研究副本。
