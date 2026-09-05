# 岗位事实纠偏与工作区接手验收

日期：2026-09-05。输入为 `d11b328` + 桌面 job 的 37 个未提交文件；执行计划见[四步接手计划](../../plans/job-fact-fidelity-handoff.md)。

状态：四步全部完成。Contract、Database/Platform、Web、Integrated Gate、Evidence均已关闭；接续SA准入准备，外部与用户价值Gate不变。

## 已验证的输入事实

- 旧 OS-7 检查点 `10f7451` 到已提交 `d11b328` 为 11 个提交、138 个文件差异；到桌面副本为 161 个文件差异。桌面相对 d11 为 31 修改 + 6 新增，不能把这些数字简单相加。
- OS-7 已于 `9d77021` 完成；不是从旧暂停点重新实现。Kiro 后续已完成 SA Phase A、ADR-0032–0035、公开发布双向对账、北森厂商/租户配置和首次 robots 取证。
- 最新未完成任务是岗位事实纠偏，动态文档仍混有“阶段0”“待ADR审定”“硬数量门槛”等旧描述。本轮按已接受 ADR 纠正当前说明，不改写历史实验结论。
- 新主仓库独立 `.git`，37 文件从备份导入后逐字节 SHA-256 相同；原目录保持不变。

## 修复与反证

| 发现 | 完成的修复 / 必需检查 |
|---|---|
| 面试 mapper 改为异步但调用方未 await、导入缺失 | 完成导入与所有 public job read model 的调用链 |
| Case、简历、Review、面试、复盘仍可把来源页冒充投递页 | 统一三态交接，当前白名单重验；列表批量读取；兼容字段 exact-only |
| 整句多断言重复显示、硬性3月被优先6月覆盖 | sourceUnits 保留整句与未分类句，断言独立引用；投影优先选择硬条件 |
| 同内容刷新产生新的要求集或岗位版本 | 分解输入固定在不可变岗位版本；兼容迁移前内容哈希，重复刷新不伪造历史 |
| 同版本换要求集只有接口通过 | 038 同步 SQL 事件校验；拒绝无变化/畸形事件，保留旧投影和旧 Case |
| 私有 JD 与 Resume Review 丢失原句 | 私有快照存 source_units，Review 返回固定原句；Web 两处共享展示 |
| 不可变要求集导致旧测试清理失败 | 测试清理 helper 双重核验隔离库与 VITEST；事务内仅临时关删除 guard，生产保护保持 |
| 空实例数据库包并行建全局角色产生竞争 | 数据库迁移用例按文件顺序执行 |
| 旧 OS-7 合成来源缺导航白名单和完整范围关闭策略 | 更新合成夹具，使其满足现行真实数据库约束；不改变准入标准 |
| 浏览器夹具失败前打开连接导致子进程不退出 | 失败显式退出；编排器检查端口占用、严格绑定端口并清理专属库和服务 |

中间失败日志保留在外部备份目录；不把失败、跳过或外层 shell 的退出 0 记为成功。

依赖审计额外发现旧锁文件中的高危/中危公告，已在同主版本内定点更新 Fastify 5.12.1、fast-uri 3.1.6/4.1.3、Browserslist 4.28.7、xmldom 0.8.15 和 nanoid 3.3.18，并移除原两条 GHSA 忽略项。依据为[Fastify 公告](https://github.com/fastify/fastify/security/advisories/GHSA-w2qp-rph6-63g4)、[fast-uri 公告](https://github.com/fastify/fast-uri/security/advisories/GHSA-f65p-4m7j-42xc)、[Browserslist 公告](https://github.com/browserslist/browserslist/security/advisories/GHSA-c83g-rgw3-j3cx)及 npm 实际审计/版本元数据。原缓存声称修复版不存在，独立元数据缓存恢复正常解析；安装使用 `--ignore-scripts`，不执行新包生命周期脚本。最终 `audit-verified.log` 为 `No known vulnerabilities found`，没有增加忽略规则。

新增 Review sourceUnits 时曾把内部 schemaVersion 一同展开到 strict 响应，定点测试和浏览器均复现400；现仅返回明确允许的 requirements/sourceUnits，旧私有JD无原句历史默认空数组，不伪造历史内容。

全仓检查还复现 Review 旧记录最后更新时间较新时返回上一条审阅，导致新审阅ID与结果错位。当前审阅改为优先按创建时间排序，增加“旧记录延迟更新但新建审阅仍为当前”的确定性PG回归；未通过增加重试或放宽断言掩盖此问题。

## 最终验证

原始日志根目录：`C:\Users\72998\Projects\Aijob-backups\20260905-job-takeover`。最终整体命令退出码0，且逐包、逐浏览器结果均单独检查。

| 检查 | 最终结果 | 日志 |
|---|---|---|
| 全仓 `pnpm check` | **948/948，163个测试文件**；Config20、Contracts105、Database76、Platform563、Web184；无失败/跳过 | `check-delivery.log` |
| lint / typecheck | lint531文件通过，保留同一旧tenant测试中的3个any警告；5包typecheck通过 | `check-delivery.log` |
| PostgreSQL | 001–038及前向修复、历史v4/私有JD读取、多要求集投影、升级事件、权限和回滚通过；数据库包76/76 | 同上 |
| OS-7 双库 | 最终run8的8个step全部通过，1536/1280/768/320；满态、真实空态、旗标回退、owner/冲突/删除等通过 | `browser-gate-delivery.log` |
| 纠偏专项 | `passed:true`，整句/独立断言/同版本显式升级/历史pin/投递三态通过，外部请求0 | 同上 |
| build | 5包通过；主包**403.58kB / gzip117.66kB**，低于411.31kB上限；比历史OS-7主包增加2.25kB | `build-delivery.log` |
| audit | **No known vulnerabilities found**；原忽略项已移除 | `audit-verified.log` |
| Review迟到任务回归 | 真实本地worker先完成旧任务时，新建审阅仍为当前；独立5/5及最终全仓通过 | `review-order-final.log`、`check-delivery.log` |
| 目录恢复点 | 原37文件、备份37文件SHA-256一致；旧b52a仍干净且HEAD为10f7451；独立Git与完整bundle校验通过 | `manifest.json`、`committed-history.bundle` |
| 文档 / 差异 | 63个本地文档链接存在；git diff check通过；未暂存/提交私有数据 | 本地复核 |

Fastify5.12.1对既有disableRequestLogging选项给出弃用警告，当前仍受支持且测试通过；未借机升级到Fastify6。中间单次受并发负载影响的数据库5秒超时、Review旧排序复现和其他失败日志均保留，最终结果来自浏览器结束后独立完整运行。

## 复现环境

Node 22.16.0、pnpm 11.9.0、Windows、独立 PostgreSQL 16-alpine。数据库容器只绑定 `127.0.0.1:55438`，数据使用 tmpfs，没有业务卷。数据库测试先完成再跑浏览器，避免在同一小型测试实例同时做迁移和完整页面验收造成5秒默认超时；不能通过删断言或把超时算通过收尾。

先设置 `AIJOB_TEST_DATABASE_URL` 为专属 loopback 测试库，然后顺序运行 `pnpm check`、`pnpm build`、`pnpm audit:ci`。这些命令不访问真实招聘站；audit 访问软件注册表。

浏览器编排命令为 `node apps/web/scripts/isolated-system-gate.cjs`，需额外设置：

- `AIJOB_GATE_RUNTIME_ROOT`：仓库外合成验收输出目录。
- `CODEX_NODE_MODULES`：可加载 Playwright 的依赖目录；本机使用 Codex bundled runtime 的 node_modules。
- `OS7_BROWSER_EXECUTABLE`：本机 Edge 可执行文件。
- `OS7_PNPM_EXECUTABLE`：可执行 pnpm.cmd 的绝对路径。
- `AIJOB_FIDELITY_BROWSER=true`：OS-7 后继续纠偏专项。

编排器生成新的 `aijob_ux_full_test_*` 和 `aijob_ux_empty_test_*`，顺序迁移并启动3000/3001和5173/5174/5175，检查端口冲突，结束时只清理自己创建的服务与数据库。浏览器阻止外部请求；DOCX只检查合成流并取消下载，不保存截图或真实求职资料。不能对业务库执行该runner。

收尾已删除专属 `aijob-fidelity-test-20260905` tmpfs测试容器，确认未挂业务卷；3000/3001/5173/5174/5175/55438均无监听。外部合成日志与原始备份继续保留。

## 真实边界与下一步

本轮测试全部使用 loopback 的独立 PostgreSQL 和合成数据，不访问真实招聘站、真实 AI、邮件或参与者，不升级原业务数据库。源配置仍为 34 个、0 approved；历史 22 岗/3企业/3 ATS 与 public 0 不代表今天重测的真实库数量。E0 保持不变。

最终交叉检查还确认SA遗留的“文档/执行不一致”：ADR-0035 §五规定单家统一30条，`applyCompanyQuotaSelections` 却仍按SME30/非SME10，materialize集成测试明确断言该旧行为。已同步登记到路线图、交接和SA计划，作为恢复真实分母前的首项修复；本轮没有修改该旧SA配额算法，也不把既有测试通过写成该产品口径已通过。

目录处理见[工作区手册](../../runbooks/workspace-takeover.md)。纠偏验收完成后，下一目标是恢复业务数据准备和 SA 准入证据核验；不能把工程通过视为获准公开或真实 Alpha 已完成。
