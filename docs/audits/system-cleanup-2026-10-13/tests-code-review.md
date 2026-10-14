# 测试、验证脚本与代码依赖审计

审计日期：2026-10-13。范围：`apps/`、`packages/`、`tools/`、`fixtures/`、`vendor/`、`patches/`、`.github/`、`infra/` 及 workspace/package 脚本。依据根 AGENTS、README、路线图、当前交接与计划索引；分支为 `codex/job-fact-fidelity-handoff`，HEAD 为 `a4ff514`。大量既有未提交改动构成本次基线。

本次只枚举路径、读取源码/配置/文档和追踪静态引用；没有运行测试、构建、浏览器旅程、网络采集、数据库操作，也没有读取密钥、个人简历原文或运行库。没有删除或移动任何既有文件。只新增本报告与机器清单；清单为本机同目录 `test-script-inventory.json`，不随 Markdown 报告提交。这里的“覆盖”是盘点覆盖，不是测试通过率或代码覆盖率。

## 结论

1. 当前业务、用户数据/来源准入迁移、40 个历史原生模板身份、RR5/RR6/Forme、旧 Studio 兼容路径及其回归应保留。四类新主推模板没有替代所有旧稿读取与渲染能力。
2. 日常检查可以按改动选取既有测试，历史 OS 阶段浏览器 Gate、S0–S4、K4 的全量矩阵不应每次重跑。历史工具适合先加索引/归档定位，不能因没有 package script 或字面引用直接删除。
3. 可优先讨论的删除候选是重复生成的中间产物、已保存代表性材料后的重复输出、确定仅含夹具的停止测试资源；本次没有足够证据批准删除任何业务源码、迁移、模板或整组验证脚本。
4. 桌面实现与候选冻结保留。安装、打包、桌面迁入/冒烟不纳入日常 Web 交付；这不意味着删除 `apps/desktop`、074 迁移或共用运行支持。

## 盘点覆盖

通过 `rg --files --hidden` 枚举可见文件，排除 `node_modules`、`dist`、`build`、`.git`；不进入 `.data`/`.hatch-runs`。源码文件和有选定文本扩展名的仓库文档参与引用搜索，未逐行审阅全部实现。

| 范围 | 文件数 | `*.test.*` / `*.spec.*` 文件数 |
|---|---:|---:|
| apps | 823 | 188 |
| packages | 219 | 48 |
| tools | 41 | 0 |
| fixtures | 27 | 0 |
| vendor | 483 | 134 |
| patches | 1 | 0 |
| .github | 2 | 0 |
| infra | 18 | 0 |
| 合计 | 1,614 | 370 |

其中 platform 141、web 47、config 1、contracts 13、database 17、resume-core 12、resume-renderer 5 个测试文件。RR5 vendor 测试为 fonts 1、pdf 84、resume 31、schema 9、utils 9。

独立工具/构建/手动验证脚本共 115 个：桌面 8，旧 Studio 取证工具 40，旧阶段浏览器 Gate 12，原生历史矩阵/语料/来源登记工具 17，近期定向手动工具 6，其他原生手动工具 18，运行/恢复支持 8，当前构建或定向验证入口 6。这是清单中的路径分类，不是逐文件删除结论；例如旧字体生成器仍可能是现行字体资产的复现来源。

49 个脚本未在本次文本范围内发现路径/文件名形式的引用。引用清单仅按完整相对路径或 basename 字面匹配：可能漏掉动态入口、无扩展名构建文件和人工命令，也可能把同名文件记作弱引用。**零字面引用不等于没有用途**。完整路径与命中行号见 JSON，不能据此自动清理。

## 当前入口与默认检查的真实范围

| 入口 | 静态映射与注意点 |
|---|---|
| 根 `pnpm check` | `lint && typecheck && test`；lint 是 Biome，全局 test 是 `pnpm -r test`。 |
| `pnpm -r test` | 有 test 脚本的 7 个第一方 package，合计 236 个测试文件；vendor 5 个包没有 test 脚本，134 个 vendor 测试不会因为根递归命令自动运行。保留 vendor 测试，可供其代码变化时定向使用。 |
| platform / database | 默认串行文件测试；有 65 个第一方测试文件读取 `AIJOB_TEST_DATABASE_URL`。代表性文件通过该变量决定 `describe`/`describe.skip`。没有配置隔离 PG 时，不能把命令退出成功写成数据库行为已验证。 |
| `@aijob/resume-renderer` | test 为 Vitest；typecheck 只指定 `tsconfig.studio.json`，其 include 是 studio 系列、resources、versions、isolated，不能称为所有 RR5 源码完整类型覆盖。 |
| `.github/workflows/ci.yml` | 有 Postgres 16 夹具服务；install → audit → migrate → check → build。真实采集关闭。没有把 115 个手动脚本串进 CI。 |
| 根 `pnpm build` | 递归构建包含 `apps/desktop` 的 `node scripts/check.mjs`，该脚本只是对 JS 做 `node --check`。它不是安装包构建，但本轮 Web 定向验证应显式选择 package，避免把桌面当作日常交付要求。 |
| `smoke:studio` | renderer 中已存在的四类 Forme 合成输出检查，包含文字、链接、跨页与锚点；不是所有旧模板矩阵。只在相关渲染变化时使用，不在本次审计运行。 |

**可复现性缺口（静态发现，未运行确认）**：`packages/resume-core/package.json` 的 default export 是 `dist/index.js`；renderer exports 与 `src/studio-isolated.test.ts:4` 直接使用 dist，构建脚本还生成 RR6 的 `dist/export.worker.mjs`。这些产物被 `.gitignore` 排除，而 CI 当前在 check 后才 build。干净 checkout 是否能执行同一测试链需要单独确认；不能把现有工作区缓存下成功等同干净构建成功。本次不修 CI，也不清空 dist 来试验。后续若获准清缓存，先准备正确的依赖构建顺序和恢复路径。

## 必须保留的运行与数据依赖

| 对象 | 具体依赖证据 | 整理建议 |
|---|---|---|
| 当前四类 Forme 模板 | `resume-core/src/templates.ts` 登记四个 `studio-*`；`resume-renderer/src/versions.ts:2` 分派；`isolated.ts:31` 选择 `@aijob/resume-forme/worker`；`scripts/build.mjs` 单独构建该 worker。 | 当前实现保留。RR6 是服务端渲染依赖，不是可删研究目录。 |
| RR5 与历史 40 个原生身份 | `resume-core/src/index.ts:1` 使用 RR5 schema；`import-blocks.ts:1` 使用 RR5 文本提取；`resume-renderer/src/document.tsx` 直接导入 RR5 中文页与 semantic；`versions.ts:20` 保留旧渲染版本。图库 `NativeTemplateGallery.tsx:20` 仍允许历史模板，开关只是控制 studio 身份。 | 当前与兼容基础保留；不能把四类主推误解为只剩四套模板。 |
| 旧 HTML Studio / ProductShell | `apps/platform/src/app.ts:150` 仍注册旧 Studio routes；`NativeStudioPage.tsx:142` 对旧稿显示 LegacyEditor；`NativeLegacyUpgrade.tsx` 读取旧 studio、checkpoint，再主动复制至 native；`App.tsx:168` 保留 V2 开关与 ProductShell。 | 保留旧稿打开、复制、原件和历史导出，后续退役需独立数据/回退决策。 |
| 共用旧 Studio 服务 | `native-import.ts:23` 仍复用 `studio-import.ts` 的原件下载；`native-export.ts:8` 复用 export-artifacts；后者还使用 studio-docx。`studio/` 文件夹也包含当前 AI 设置、材料、助手页面。 | 不按目录名整组删除。 |
| 分页补丁 | `pnpm-workspace.yaml` 的 patchedDependencies 指向 `patches/@react-pdf__layout@5.2.0.patch`；补丁明确只对 opt-in 标志启用，`nested-pagination.test.ts` 维护分页行为。 | 与锁文件和实际使用版本一起保留。换引擎或升级依赖后再决定退役。 |
| 历史与新迁移 | `packages/database/src/migrate.ts` 显式登记 001–078（含 026b）；后续表/权限依赖此前演进。021/022 权限、034–038 来源/事实与 054–078 材料/持久访客/原生/机会/运行权限均有连续用途。 | 不压缩、删除或重写已应用迁移；旧测试名称不等于迁移废弃。 |
| 来源准入冻结夹具 | `source-tenant-config.test.ts:17–23` 明确使用 `fixtures/source-configs/legacy-beisen/` 的 5 份迁移前原文，与现行租户形状比较准入、目标网络范围和策略。 | 必须保留；改为读取新配置将变成自我比较。 |
| 其他来源夹具与金标 | `fixtures/ingestion` 是合成官方/二手来源输入，`fixtures/gold/job-family-classification.golden.csv` 被同名 golden test 使用；source-config tests 使用隔离来源配置。 | 保留必要来源分类、unknown、登录/政策拒绝和主体证明回归；不能因某生产来源暂停删其约束夹具。 |
| 字体和图库资产 | `studio-fonts.ts` 对 `font-set-v3.json` 和 woff2 做 hash 校验；RR6 worker 读 `font-set-studio-v1.json`；旧/新图库仍引用 public 资产。 | `apps/web/public` 是运行资产，不属于可以随手清理的 dist。字体生成脚本和许可保留复现关联。 |
| 第三方许可与来源 | RR5/RR6 的 LICENSE、upstream-manifest、local-patches，`vendor/resume-template-references/*` 的源文件/license/source.json，与模板登记和 `THIRD_PARTY_RESUME_TEMPLATES.md` 关联；desktop stage-runtime:127–152 复制字体、docs/licenses、署名与 vendor 许可。 | 许可/NOTICE/来源 hash 必须与保留代码和产物一同保留。参考源可归档定位，但不能仅删许可或打断来源路径。 |
| 桌面冻结实现 | `apps/desktop` 壳、备份恢复/迁入工具、runtime-lock；074 身份表和075–078角色权限进入当前 migration provider，部分运行准备是 Web/API 共用。 | 冻结保留，暂停执行与安装同步。不要按“桌面暂停”回滚数据库迁移或删除共用模块。 |

## 历史矩阵与一次性工具的处理

| 组 | 作用与引用关系 | 建议 |
|---|---|---|
| `apps/web/scripts/m1-*`、`m4-*`、`pa1-*`、`os1-*` 至 `os7-*`、job-fidelity | 已关闭阶段的浏览器 Gate；与当前路线图的历史基础对应，部分脚本需要独立夹具服务、写入浏览器状态或数据库。 | 可从“日常入口”降级为历史复现，先做索引和摘要；移动前核对文档命令、import、相对路径，暂不删除。 |
| `apps/platform/src/verification`、`apps/platform/verification`、`apps/web/verification` | 旧 S0–S4 模板、Office、字体、故障回放、性能及页面取证。`src/verification` 还属于 platform tsconfig 的 `src/**/*`，不是完全独立目录。 | 归档候选组，保留首次失败、最终结果、复现输入、字体/模板版本与原件关联；只归档成功截图会失去解释力。 |
| `tools/resume-native/export-matrix.mts` 及 assemble/render/Office tools | 运行时读取当前模板 catalog，默认对全部模板跑 short/medium/long；`--templates` 已支持限制范围。历史 120 不是该脚本永远固定的执行量，当前 catalog 还加入四类模板。 | 留作范围受控的定向工具；不重跑全量来证明普通 UI 改动，也不为本次整理新建替代套件。 |
| `audit-pdf-reimports.mts` | 读取既有 `*-short.json` 与对应 PDF，PDF 文字/坐标送解析器，源 JSON 仅作期望值。 | 保留代表性 PDF+JSON、manifest/hash、首次失败与最终摘要；不能用截图或嵌入 JSON 代替真实 PDF 读回。 |
| fresh/postfix holdout、evaluate/score、public-specimen | 保存首次封存和失败；新的盲集只能在未见时称盲集。公开样稿无逐字段金标，已用于调规则的样本属开发回归。 | 可归档历史执行材料，但不重新生成/覆盖来“清理”失败；不把语料文件名未引用当无用。 |
| `audit-upgrade-imports.mjs` | 10/12 的八份现有材料定向检查，读取 9/23 公共 PDF、旧 independent corpus DOCX、旧矩阵中稿 DOCX 和 postfix 文本；保留首次输出，显式 `notBlind`。 | 证明旧输出仍被近期检查复用。删除矩阵前必须抽出其引用的具体文件，而不是只留最终汇总。 |
| `browser-system-upgrade.mjs`、`browser-opportunity-journey.mjs`、近期 import/submission 工具 | 当前两条页面旅程和局部问题的复现入口，不属于默认 Vitest。 | 近期定向工具保留，未来按受影响链路选取。不能只因为同为“browser”就合并或全跑。 |
| `infra/runtime` | 部署、容器解析、安全配置、候选打包、恢复检查与旧说明混在同一目录；其 README 仍含 U0–U6/061 的历史表述，低于当前路线图优先级。 | 保留工程能力，后续只需校准说明的历史标签；不是当前要求重做部署。 |

三个数字必须分开记录：

- **40 套模板**：产品中的模板身份和原生兼容能力；当前另有四个 `studio-*` 身份。
- **120 组输出**：K4 的 40 × 短/中/长，合计 294 页 PDF、8,640 项预期字段，DOCX 实际 LibreOffice 读回另验。旧 S0–S4 同样称 120，但属于不同引擎/版本且当时为 318 页，不能混成一份结果。依据 `docs/evidence/resume-native-k4-k5-2026-09-13.md:19–28` 与旧质量证据。
- **1320/1320**：40 份短稿 PDF 回导中的非空字段与条目数检查，不是 1,320 份简历，也不是又一轮 120 组导出。范围未覆盖所有自定义模块和嵌套数组；首次 12 套错分、合成盲集失败须留存。依据 `docs/evidence/resume-native-import-acceptance-2026-09-23.md:32–44`。

## 可讨论的删除候选与前置条件

本次没有提供立即执行删除命令。建议先以“保留、冻结、归档、删除候选”四类让 coco 对齐，再具体到文件。

| 候选 | 必须满足的条件 |
|---|---|
| dist、覆盖率、缓存等可生成输出 | 确认没有正在运行的进程依赖，源文件/lockfile/补丁/字体齐全，恢复构建链已确认；目前 dist 是实际 package export 和 worker 入口，本次不能直接清。 |
| 重复矩阵渲染、联系图中间页、重复 Office 转换结果 | 保留最终 PDF/DOCX、代表性异常、源 JSON、版本/hash、首次失败及报告引用；尤其抽出八份近期检查所用旧文件。未核对同内容 hash 前不能称“重复”。 |
| 停止的合成测试数据库卷 | 主审计提供 55441/55442/55443 停止卷信息，但本子审计未读数据库内容；须确认只含夹具，并保留恢复/迁移复现所需输入、计数与既有证据。停止状态本身不能证明可删。 |
| 已停止 Office 容器及工作目录 | 主审计发现 `/work/office22` 中仍有模板 PDF/DOCX；先确认其中独有验收材料已保留。不能把容器缓存和唯一输出证据一起删掉。 |
| 无引用的一次性脚本 | 先确认任务已关闭、没有关键失败复现或隐式入口、没有独有样本/来源清单，且已有可检查的归档摘要。49 个零字面命中脚本整体不满足此条件。 |

只有总结/归档、不能用后来成功覆盖的材料：首次盲集失败、首次 PDF 错分、边界输入无可读中文字、解析器/输入 hash、原生产候选及许可、历史运行/部署限制。真实用户资料和密钥不进入本报告或归档提交。

## 必要最小验证建议（仅建议，未执行）

本次仅新增审计 Markdown/JSON，核对路径、JSON 可解析和统计即可；不因此运行业务测试。未来获准整理时，优先使用下列现成入口，按实际改动选取。

| 改动影响 | 最小验证组合 |
|---|---|
| 仅文档重排/归档 | 检查移动文件的入链、相对路径、命令入口与现行索引；不跑 120/1320、PG或真实搜索。 |
| 原生导入/局部纠错 | resume-core 已有 import-cn/fields/headings/period/correction 定向测试；影响保存/原件时加 `native-import.integration.test.ts`；只有实际复现需要时再用固定代表样本。 |
| 新模板/Forme/统一 PDF | renderer 的 `studio-model`、`studio-isolated` 和必要时已有 `smoke:studio`；核对真实 PDF 字符、链接、页界与预览下载同产物。共享 RR5 分页改动再加 `nested-pagination` 与受影响历史模板样本。 |
| 旧稿兼容、导出/投递 | `native-legacy-content`、`native-studio`、`export-artifacts`、`native-submission` 相关测试；从旧稿打开/复制到投递快照选择一条受影响流程，不重启 OS-7。 |
| owner、持久访客、删除/恢复、迁移 | 必须隔离 PG；对应 persistent-guest、retention-service、native-studio/import/submission、worker recovery/roles 和迁移 forward-contract，覆盖所有权、原件保留、迟到任务删除与前向升级。不能用业务库代替测试库。 |
| 来源目录、北森、机会发现 | source-config / source-tenant-config / tenant-onboarding / robots-policy / safe-http，以及 opportunities/search-adapters/local-settings；涉及持久化时加 user-discovery/opportunities/runtime-productization PG 测试。不触发真实搜索、来源启用或采集。 |
| 运行打包或桌面 | 当前暂停；只在 coco 明确恢复此目标后选现有 stage/check/backup/legacy/desktop journey，不能作为普通 Web 改动的附加门槛。 |

受影响 lint、package 类型检查和必要构建仍按项目要求执行；上述是测试选取，不取消项目检查约定。PG 门控变量必须显式配置隔离库；`packages/database/src/index.ts:9–24` 限制回环地址和测试库名。浏览器隔离还应使用独立 profile/主机名：历史 K5 已记录同 `127.0.0.1` 的不同端口共享 cookie 影响会话，不能仅凭 3002/5194 不同端口认为隔离完成。

清单没有证明所有历史脚本仍能运行、所有测试都通过、所有链接都有效，也没有证明运行库只有合成数据。任何实际移动或删除都需要后续授权与对应的窄范围验证。
