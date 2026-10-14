# Aijob 项目副本只读盘点（2026-10-13）

第三批实际更新（2026-10-14，coco 已授权）：日常开发继续以 `C:\Users\72998\Projects\Aijob` 为唯一基线。以下 C2 实体副本已在私有归档验证后移除，精确路径与结果保存在主工作区 `.data/system-cleanup-batch3-20261014/*removal.json`：

- `C:\Users\72998\.codex\worktrees\b52a\求职ai聚合站`
- `C:\Users\72998\.codex\worktrees\975c\求职ai聚合站`
- `C:\Users\72998\.codex\backups\aijob-path-repair-20261012-092341\f057\求职ai聚合站`

C1 的 `E:/AppDataFiles/Codex/worktrees/b52a/求职ai聚合站`、`11dc/求职ai聚合站` 因当前任务没有 managed-worktree 归档工具的 attachment 资格而保留，没有手工删掉工作树代替工具归档。C3 的 `Documents/求职ai聚合站`、`Desktop/job`、E 盘 `f057/求职ai聚合站` 原目录继续保留，旧共同 Git 元数据及独有改动未删除。C1–C3 全部 8 份 ZIP 已逐文件读回校验，保存 65,511 普通文件和 3,117 链接目标记录；旧 Git 的 20 refs、142 可达提交及全部 detached HEAD（含 `81b7fa9`）已独立保全。恢复入口为 `C:/Users/72998/Projects/Aijob-backups/20261014-system-cleanup/copies/RESTORE.md` 与 `all-archive-results.json`；含忽略资料和密钥，仅留本机。六个历史证据目录与 C8 安装候选资源亦保留；Docker 对象实际变化见[运行环境更新](runtime-storage.md)。

**以下是 2026-10-13 只读审计的历史快照。** 其中的路径存在状态、HEAD、差异计数和“先保留”建议不代表第三批后的现状，也不单独授权后续删除。原审计时已找到两套独立 Git common directory、多个共享旧 Git 元数据的实体副本，以及一个指向 E 盘的目录联接；该审计阶段没有删除、归档、移动、重置、切换分支、fetch、构建或启动服务。本次实际处理以页首及[主执行记录](README.md)为准。

## 先保留的关键内容

- 当前 C 盘主工作区及全部未提交改动、`.env`、`.data`、密钥与业务库对应关系必须保留。
- `Documents\求职ai聚合站\.git` 是所有旧 worktree 的共同 Git 元数据；删除它会影响 E 盘 worktree、桌面 `job` 和旧路径副本。
- 桌面 `job` 与 E 盘 `f057` 共享同一 worktree 的 index/HEAD，但文件内容不同。不能把其中一个当作另一个的可靠备份，也不能对它们执行未经核对的 `git clean/reset`。
- 旧仓与多个旧副本的 `.data/resume-encryption.key` 均存在，且被 Git 忽略。普通 Git 归档不能覆盖这些资料。
- `Aijob-backups` 内有数据库备份、原卷快照、私有材料、密钥、Git bundle 和未提交源码快照。已安装桌面候选及发布快照也按最新产品范围继续保留。

## Git 关系与当前状态

下表“状态”使用 `git status --porcelain=v1 --untracked-files=all` 的文件计数。M 为修改、D 为删除、?? 为未追踪；不会把忽略的 `.data`、密钥和依赖算进去。“落后”仅指提交图，不表示文件与业务数据已被完整收录。

| 位置 | 类型 / Git 元数据关系 | HEAD / 分支 | 状态 | 与主仓 HEAD 的提交关系 |
|---|---|---|---|---|
| `C:\Users\72998\Projects\Aijob` | 当前独立仓，common dir 为自身 `.git` | `a4ff514` / `codex/job-fact-fidelity-handoff` | 本子审计时 140 M + 4647 ?? 文件；默认目录折叠口径为 447 项 | 当前基线 |
| `C:\Users\72998\Documents\求职ai聚合站` | 旧独立主仓；其 `.git` 支撑下面所有旧 Git 指针 | `a8ddb65` / `codex/g2-1000-alpha-supply` | 4 M + 7 ??；默认口径 9 项 | 旧 HEAD 为祖先，落后 94 |
| `C:\Users\72998\Desktop\job` | 实体源码副本；`.git` 指向旧主仓 `.git/worktrees/求职ai聚合站1`，该记录登记的是 E 盘 f057 | `d11b328` / `codex/career-os-ux-convergence` | 31 M + 6 ?? | 旧 HEAD 为祖先，落后 5；文件有独立差异 |
| `E:\AppDataFiles\Codex\worktrees\11dc\求职ai聚合站` | 已登记 managed worktree；旧 common dir；管理子目录 `求职ai聚合站3` | `81b7fa9` / detached | 干净 | 旧侧独有 1 提交，主侧独有 140 |
| `E:\AppDataFiles\Codex\worktrees\975c\求职ai聚合站` | 已登记 managed worktree；管理子目录 `求职ai聚合站` | `6ea75fc` / `codex/career-os-phase-1` | 1 ?? | 祖先，落后 29 |
| `E:\AppDataFiles\Codex\worktrees\b52a\求职ai聚合站` | 已登记 managed worktree；管理子目录 `求职ai聚合站2` | `10f7451` / detached | 干净 | 祖先，落后 16；旧 OS-7 |
| `E:\AppDataFiles\Codex\worktrees\f057\求职ai聚合站` | 已登记 managed worktree；管理子目录 `求职ai聚合站1` | `d11b328` / `codex/career-os-ux-convergence` | 97 M + 41 D | 祖先，落后 5；不能以 HEAD 代表工作区文件 |
| `C:\Users\72998\.codex\worktrees\975c\求职ai聚合站` | 实体旧副本；重用 E 975c 的 Git 管理子目录，未另行登记 | `6ea75fc` / 同 E 975c | 1 ?? | 与 E 975c 相同提交 |
| `C:\Users\72998\.codex\worktrees\b52a\求职ai聚合站` | 实体旧副本；重用 E b52a 的 Git 管理子目录，未另行登记 | `10f7451` / detached | 干净 | 与 E b52a 相同提交 |
| `C:\Users\72998\.codex\backups\aijob-path-repair-20261012-092341\f057\求职ai聚合站` | 路径修复备份；实体副本仍重用 f057 的 `.git` 指针 | `d11b328` / 同 f057 | 97 M + 41 D | 与 f057 相同提交；非独立 Git 备份 |
| `C:\Users\72998\.codex\worktrees\f057` | **Junction → `E:\AppDataFiles\Codex\worktrees\f057`** | 经联接访问 E f057 | 同 E f057 | 是路径别名，不应重复计算占用 |

当前主仓的 `git worktree list` 只有自身。旧主仓的登记列表为自身和 E 盘 11dc/975c/b52a/f057；桌面 job、C 盘 975c/b52a 和路径修复备份不在该登记列表中。两套 common dir 均无 stash。

主 Agent 开始时记录默认口径为 446 项（140 M + 306 ??）；本子审计期间为 447 项（140 M + 307 ??）。并行审计新增报告会增加未追踪目录项。不能把默认目录折叠口径与逐文件口径相加，或据此推断用户产品文件被改变。

### 独有历史

旧仓所有 refs 可达提交为 142 个，当前主仓所有 refs 可达提交为 146 个。旧仓有 1 个提交不在当前主仓 refs 的可达集合中：

- `81b7fa9ab6d7b402f0f65ad1f72a6d78bd057afe` — `Codex worktree snapshot: archive-cleanup`
- 旧仓持久引用为 `refs/codex/snapshots/9603e38b4ad20d8041a94d07e838773d844be125`。
- 当前主仓对象库能读取该对象，但没有 refs 包含它。因此“当前仓里能读到对象”不足以证明归档历史已被可靠保存；归档 11dc 或旧 common dir 前需保留该引用与对象。

## 文件核对证据

只对源码、工程文档及非敏感配置进行 SHA256 比对，排除 `node_modules`、`.git`、`.data`、`dist`、`.hatch-runs`、`.env*`、`*.key`、`*.pem`。未读密钥内容，也未用哈希证明密钥相等。

| 对照 | 已比较文件 | 结果 | 限制 |
|---|---:|---|---|
| C 975c ↔ E 975c | 655 对 | 相同；无仅单侧源码文件 | 忽略的本地数据与密钥未比较 |
| C b52a ↔ E b52a | 709 对 | 相同；无仅单侧源码文件 | 排除项未作完整备份等价认证 |
| C 路径修复 f057 备份 ↔ E f057 | 709 对 | 相同；无仅单侧源码文件 | `.data` 与密钥未比较 |

旧目录 dirty 文件与当前主目录的同路径比较：

- 旧 Documents 主仓：11 项中 3 项相同、7 项不同、1 项仅旧目录存在。仅旧目录存在的是 `.claude/launch.json`；多份旧 ADR/计划/交接文档与当前版本不同，不能仅靠文件名认定重复。
- 桌面 job：37 项中 7 项相同、30 项不同；6 个未追踪源码文件均有当前同路径文件，但其中 3 个内容不同。
- E 975c：唯一未追踪项为 `.claude/launch.json`，当前主仓没有同路径文件。
- E f057：97 个现存修改文件全部与当前主仓不同；另有 41 个相对共享 Git index 的删除。此结果不证明哪个版本应被采用。

这些检查能指出需要保留的差异，不能替代逐文件迁移或恢复验收。

## 本地资料、快照及安装目录

| 位置 | 只读证据 | 处置判断 |
|---|---|---|
| 当前主仓、旧 Documents 主仓、Desktop job、C/E 975c、E f057、C f057 修复备份 | 均存在 `.data/resume-encryption.key`；检查的仓中 `.data`、`.env`、key/pem 路径未被追踪；主仓另有 `.env` | 保留；Git 干净不能证明数据可删 |
| `C:\Users\72998\Projects\Aijob-backups` | 4 组：20260905-business-recovery、20260905-job-takeover、20260906-product-core-upgrade、20260908-experience-upgrade；可见 dump、原卷 tar、private-materials、密钥、bundle、uncommitted 等存在性证据 | 必须保留，未校验完整恢复能力 |
| `C:\Users\72998\Projects\Aijob\.data\releases` | 8 个候选目录及 product-core 源码 tar、manifest/receipt | 保留为历史候选；不是独立开发工作区 |
| `C:\Users\72998\AppData\Local\Programs\Aijob` | 桌面 Aijob.lnk 指向此处 Aijob.exe；exe 与 resources/app.asar 实际存在 | 安装目录，按最新决定保留现有候选 |
| `C:\Users\72998\Documents\求职` | 个人求职材料；存在 .git 目录，但 git rev-parse 返回 128 | 不属于已确认的 Aijob 源码副本；不列为清理项，未读正文 |
| `E:\data\Downloads` | Windows Downloads 实际位置；命中 9 个 Aijob 名称的 PDF/DOCX | 用户导出资料，不列为项目副本清理项 |
| `E:\CodexWork\MigrationKit\aijob-path-repair-20261012-092341` | 只见修复记录/清单/验证脚本等文件名 | 迁移证据，保留；未执行脚本或读取会话内容 |

发布目录名称为：`aijob-desktop`、`direction-studio-20260909-r5`、`experience-20260908`、`interactive-20260909-v4`、`query-20260908-v3`、`resume-native-20260913-k5`、`resume-quality-20260911-s4`、`runtime-20260908-v2`，以及 `aijob-product-core-source.tar.gz`。本子审计未解包、构建或对全部快照做完整性认证。

主 Agent 另外核对到：旧容器 `aijob-local-postgres-1` 的 compose working dir 是 `C:\Users\72998\Desktop\job\infra`，对应卷 `aijob-local_aijob_postgres_data`；当前恢复业务环境是 `aijob-recovered-postgres` / `aijob_recovered_20260905_data`。这是主 Agent 的 Docker 证据，本子审计未独立查询 Docker。桌面源码、旧密钥和旧业务卷之间是否还有独有数据需要保留核对，不能因目录旧就一起删除。

## 建议顺序

1. **必须保留**：C 盘当前主目录、旧 Git common dir、桌面 job、数据库及密钥关系、Aijob-backups、现有发布/安装候选、个人材料与导出文件。
2. **优先归档候选，仍需实际授权和保存校验**：干净且落后 16 提交的 E b52a；C b52a 的实体重复源码。E b52a 应走对应 managed worktree 的归档流程；C 副本应先确认其独立保存内容，不把其路径当成另一已登记 worktree 去删除。
3. **条件满足后可归档**：E 11dc（先保全独有 snapshot ref）；C 975c（先保全 launch 配置并核对忽略数据）；C f057 路径修复备份（先确认忽略资料被可靠保存）。
4. **待差异协调**：旧 Documents 主仓、桌面 job、E f057。先做包含未提交内容和忽略数据的可恢复归档，再判断哪些版本不再需要。此次未执行上述操作。

空间数字由主 Agent 统一盘点。存在硬链接与目录联接，逻辑大小之和不等于删除后保证可回收的物理空间。

## 搜索覆盖与限制

- 已先读当前项目 AGENTS、README、路线图、交接与计划索引，并核对当前 branch、HEAD、status、worktree list 和最近提交。
- 已枚举 C 用户 Projects、Documents、Desktop；`C:\Users\72998\Downloads` 不存在，依据 Windows Known Folder 查询补查 `E:\data\Downloads`，并补查 `D:\Downloads`。
- 对 Documents/Desktop/Downloads、E Projects、CodexWork、CodexMigrationBackups、MigrationBackups 做有限深度文件名搜索（`rg --maxdepth 5`）；搜索项目名、`.git` 指针、package/workspace 标识。
- 对实际 `CODEX_HOME=E:\AppDataFiles\Codex` 和 C 用户 `.codex` 做 `--maxdepth 6` 候选搜索，针对确认的 worktree 再精确查询。C 用户 .codex 本身是实体目录，不是整个指向 E 盘的联接。
- D/E 盘仅枚举根与下一层目录名线索；补查 E AppDataFiles 下两处 Codex-Migration 目录到有限深度，没有发现新的 Aijob 源码候选。
- `Documents\Codex` 是到 `E:\CodexWork\Legacy` 的 junction，`Documents\ChatGPT` 是到 `E:\Projects\ChatGPT` 的 junction，已识别避免重复推断。
- 没有递归读取无关个人正文；跳过依赖、浏览器资料、session/archived-session、插件、生成媒体、秘密目录；未读 .env/密钥值、个人简历正文和数据库正文。
- **这不是全机所有路径的穷举证明**。深层任意命名目录、压缩包内部、云端、其他用户目录、已归档会话中的位置及未挂载盘仍未确认。未证明任一资料备份已可完整恢复，也没有执行运行、构建或产品测试。

机器可读证据见同目录 `project-copies.json`。报告仅记录 2026-10-13 本轮只读观察，运行状态和并行写入可在之后改变。
