# 运行环境与存储审计

审计日期：2026-10-13，约 22:25–22:47（北京时间）。只读盘点；未启动服务、数据库或采集，未删除或移动任何既有文件。

第三批实际更新（2026-10-14，coco 已授权）：已在私有备份及必要核对后，精确删除 `aijob-core-test-20260906` / 55441、`aijob-studio-test-20260907` / 55442 两个测试容器及各自匿名卷，删除 `aijob-native-office-20260912` 容器（`/work`、`/tmp` 独有材料已保全），并删除清单 C6 指定的 9 个旧 Aijob 镜像。此时剩 **3 个停止容器、3 个卷、6 个镜像**：容器为 direction 测试库、当前 recovered 业务库及旧 local 业务库。direction / 55443 中仍有 2 份草稿无法证明为合成资料，容器及卷完整保留；两业务容器、数据库和卷未访问、启动或修改。未执行全局 prune。

三个历史测试集群的 36 份数据库归档、角色配置及只读计数保存在工作区外 `C:/Users/72998/Projects/Aijob-backups/20261014-system-cleanup/test-databases`。C2 的三个 C 盘实体副本已归档验证后移除，精确执行清单见 `.data/system-cleanup-batch3-20261014/*removal.json`；副本范围和保留项见[项目副本更新](project-copies.md)。C1 的 E 盘工作树因当前任务没有归档工具 attachment 资格而保留；C3 的旧 Documents、Desktop/job、E/f057 原目录保留。C1–C3 的 8 份 ZIP 与旧 Git 独有引用保全已全部完成，恢复入口见外部 `copies/RESTORE.md` 与 `all-archive-results.json`。六个历史证据目录及 C8 的安装候选资源继续保留；不以本次整理恢复安装版工作。

第二批完成时快照（2026-10-14）：B1–B5 已完成；文件项先行处理，coco 打开 Docker 后精确删除字体提取和 Web 冒烟两个无挂载旧容器。当时其余 6 个容器停止、5 个卷和 15 个镜像保留，未启动业务服务。见[第二批记录](README.md#第二批中间产物清理记录)。

**下方原审计表、容量、对象存在状态及“第一批清理”等早期用语均为 2026-10-13 历史快照，不代表第三批完成后的库存或新的执行指令。** 实际处理以本页更新及[主执行记录](README.md)为准，当前容器数量也只代表本次核对时点。

## 结论

主要可整理空间来自安装包中间产物、旧构建镜像及历史测试库。真正需要保护的是现有未提交源码、业务数据库、加密密钥、配置、岗位事实快照与恢复材料。不能按目录名 `.data`、容器停止状态或 Docker 的 `reclaimable` 标志直接删除。

主工作区 `.env` 的数据库地址经脱敏核对为 `127.0.0.1:55439/aijob`。PDF 使用已安装 Chrome 和 `apps/web/public/fonts/AijobCJK.otf`；并未指向桌面打包用 Chromium。没有发现 `.data/desktop-migration.json`。默认 `%LOCALAPPDATA%/Aijob` 目录不存在，与现有记录“业务资料尚未迁入安装版”一致，但不能据此推断所有自定义测试目录内都无资料。

## 文件空间

统计只读取文件元数据，不读取个人材料正文；不遍历符号链接/junction，统计文件逻辑长度，单位为十进制 GB。硬链接、稀疏文件、压缩和共享层会使真实可回收空间不同。主目录扫描有 57,217 个多硬链接文件，因此不能把下表简单相加成回收承诺。

| 范围 | 文件数 | 逻辑大小 | 处理建议 |
|---|---:|---:|---|
| `C:/Users/72998/Projects/Aijob` | 210,058 | 12.857 GB | 唯一开发主目录；保护全部既有改动 |
| 其中 `.data` | 139,659 | 10.778 GB | 混有配置、备份、证据和可生成产物，按子目录处理 |
| 其中 `node_modules` | 57,898 | 0.872 GB | 当前依赖，暂留；不是业务源码，但清掉会影响继续开发 |
| 其中 `docs/evidence` | 3,311 | 0.565 GB | 历史证据，先摘要及保留代表材料，不能全删 |
| `C:/Users/72998/Projects/Aijob-backups` | 734 | 0.613 GB | 四组历史恢复/升级备份，全部暂留 |
| `C:/Users/72998/Desktop/job` | 11,677 | 0.267 GB | 非独立 Git 主仓；有独有工作区修改和密钥，暂留 |
| `C:/Users/72998/Documents/求职ai聚合站` | 17,038 | 0.330 GB | 旧 Git 公共目录及工作树管理根，暂留 |
| `E:/AppDataFiles/Codex/worktrees` | 24,532 | 0.574 GB | 4 个已发现工作树父目录；先保存独有状态 |
| `C:/Users/72998/.codex/worktrees` | 12,846 | 0.310 GB | 两个实体副本及一个 junction；不能当成三个独立副本计数 |
| `%LOCALAPPDATA%/Programs/Aijob` | 16,401 | 1.750 GB | 已安装候选，保留，暂停适配与验收 |

各目录扫描未遇到读取错误；跳过的链接数量及路径存于本机元数据清单。统计过程中新增的审计报告会使后来目录计数略有增加，不作为新的业务改动。

### 桌面相关中间产物

| 主目录内相对路径 | 逻辑大小 | 判断 |
|---|---:|---|
| `.data/desktop-stage` | 1.410 GB | 早期 stage；现有打包脚本指向 `desktop-bundle-20261013`，可列第一批待批准清理 |
| `.data/releases/aijob-desktop/win-unpacked` | 约 1.749 GB | 安装器生成用展开目录；保留安装器、校验及许可后可清理；暂不触碰已安装程序 |
| `.data/desktop-downloads` | 1.043 GB | 含完整下载、45 个 `pg-00.part` 至 `pg-44.part` 分片、`pg-range.part`、另一份 PG zip；优先清理确认已合并的分片 |
| `.data/desktop-extracted` | 1.011 GB | Node/PG 解包源，可重下载重建；删后要恢复才能再打包，放第二批 |
| `.data/desktop-bundle-20261013` | 1.364 GB | 当前冻结候选的 stage；可生成但保留成本与恢复成本需取舍，第一批保留 |
| `.data/desktop-browsers` | 0.457 GB | 桌面 Chromium；当前 Web PDF 未使用，第一批仍保留 |
| `.data/desktop-builder-cache-20261013` | 0.016 GB | 构建缓存，可列清理候选 |
| 各 `desktop-smoke-*` / `desktop-legacy-fixture-*` | 合计约 0.65 GB | 包含隔离 PG 和测试账户数据；先确认目录仅为夹具并保留结果，再清理 |

最后安装器 `Aijob-Setup-0.2.0-x64.exe` 为 715,992,046 字节，本次 SHA256 实测与保留的 `SHA256SUMS.txt` 一致：`7efdc0f1392ac37e4f0010a37448b364e9d03c3662cc28ef30dac34598fec5c2`。这只证明候选文件未变，不是重新验收安装版。

不把旧 `releases/direction-studio-*`、`resume-quality-*`、`resume-native-*` 打包归档直接当垃圾。这些可能封存了尚未进入 Git 的源码与失败材料，需要先形成版本/材料清单，保留所需快照之后再决定。

## Docker 清单

当前连接为 Docker Desktop 的 `desktop-linux`；仅发现 `default` 与 `desktop-linux` 两个本机 context。共 8 个容器，**0 个运行中**。监听检查未发现 `3000/5173/8091/55439/55441/55442/55443/5432`。因此交接中“业务仍运行”只能当成当时的快照，当前不可直接沿用。

未为盘点启动数据库，以下角色来自配置、挂载、历史恢复记录和测试脚本；**没有再次查询卷内数据库内容**。

| 容器 | 端口配置 | 卷/可写层大小 | 决定 |
|---|---:|---:|---|
| `aijob-recovered-postgres` | 55439 | `aijob_recovered_20260905_data` 462.4 MB | 当前业务库，保留 |
| `aijob-local-postgres-1` | 5432 | `aijob-local_aijob_postgres_data` 409.4 MB | 旧业务库，保留；关联桌面 `job/infra/compose.yaml` |
| `aijob-direction-studio-test-20260909` | 55443 | 匿名卷 `88ffd68e…` 2.663 GB | 最新隔离测试库；确认仅夹具后可重建，不能仅凭名字删 |
| `aijob-studio-test-20260907` | 55442 | 匿名卷 `78a4fdae…` 2.171 GB | 旧隔离测试库；同上 |
| `aijob-core-test-20260906` | 55441 | 匿名卷 `3f3d59c1…` 2.353 GB | 旧隔离测试库；同上 |
| `aijob-native-office-20260912` | 无 | 可写层 585 MB，无挂载 | 有 `/work/matrix22`、`matrix24`、`office22`、`office24` 导出文件；先核对宿主已有证据，不能直接删 |
| `aijob-font-assets-20260909` | 无 | 可写层约 4.1 KB，无挂载 | 从未运行的字体提取容器，可列清理候选 |
| `aijob-web-smoke-20260906` | 5188 | 可写层约 4.1 KB，无挂载 | 旧 Web 冒烟容器，可列清理候选 |

匿名卷全名、容器 ID 与镜像对应关系已保留在本机 `docker-containers.json`，执行前必须逐项匹配，不能用全局 prune 代替清单。

`docker system df` 报告：15 个镜像总计约 16.41 GB；镜像可回收约 10.42 GB；容器可写层约 629.5 MB；5 个卷总计约 8.059 GB；构建缓存约 10.37 GB，其中可回收约 4.465 GB。共享层存在重叠，**这些数字不能相加**。

11 个 Aijob 镜像中，9 个当前没有容器引用，可作为过期候选审查；目前仍保留用于旧字体/Office 容器的 `aijob-platform:query-20260908-v3` 及旧 Web 容器的镜像。`postgres:16-alpine` 被两业务库和两测试库共用，不能删除；`postgres:16` 被 55442 使用。`xykt/check`、`hello-world` 不属于本次 Aijob 清理范围。

Docker 构建缓存属于 builder 的共享资源。本轮没有逐缓存证明所有权；不要因为现在看到的镜像主要属于 Aijob 就全局清理缓存。

Docker 虚拟磁盘位置为 `E:/DockerData/wsl/DockerDesktopWSL`，`docker_data.vhdx` 逻辑长度约 27.710 GB，另有约 0.101 GB 的 `ext4.vhdx`。它们承载整个引擎，不是可删除的项目文件；删除 Docker 对象后，Windows 文件长度也不等于立即缩小，不纳入回收承诺。

## 必须一起保护的状态

- 主工作区全部未提交内容：默认 Git 状态合并目录后为 446 项（140 修改、306 未追踪项）；展开未追踪目录后为 4,786 文件项（140 修改、4,646 未追踪），已排除本次审计输出。HEAD 不能代表完整当前产品。
- `.env`、Web 本机配置、`.data/resume-encryption.key`、来源刷新/搜索配置与数据库中的加密配置；不将密钥打印或提交。
- 当前/旧业务卷、原件与保留产物、投递版本和经历。代码显示产物和实际投递文件有数据库密文，保护文件夹但丢掉数据库或钥匙仍会丢业务。
- `.data/job-snapshots`、`.data/access-policy`、实际来源配置及其核验依据；这些支撑现有岗位事实，不能当历史测试缓存删除。
- `Aijob-backups` 四组备份及主工作区内升级前 dump。最新识别的 `before-072.dump` 在升级前生成，不是此次审计时刻的完整业务备份；若后续整理涉及业务数据，应先做一次配套的必要备份，而非反复备份所有缓存。
- `apps/desktop`、冻结安装候选与运行时/第三方许可；暂停同步不等于删除实现。

## 本机审计证据

元数据保存在 `.data/system-cleanup-audit-20261013/`：`storage-summary.json`、逐根 `storage-N.json`、`docker-containers.json`、`docker-space.txt`、`office-container-paths.txt`、`runtime-metadata.json`、`git-status.txt`。只含路径/大小/状态等必要信息；未输出密码、Key、个人正文或数据库记录。扫描工具也保存在该目录供核对，不安装新的审计服务。

这些材料是一次快照；实施清理时只复核拟处理目标的路径、引用和状态，不重跑全量验收，也不重复进行整机扫描。
