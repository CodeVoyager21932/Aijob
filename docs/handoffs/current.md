# 当前项目交接：纠偏已完成，接续 SA 准入准备

更新日期：2026-09-05。先读 [路线图](../06-mvp-roadmap.md)、[计划索引](../plans/README.md) 和 `git status`；不要把历史对话或旧目录状态作为新工作起点。

## 从这里接手

唯一主工作区为 **`C:\Users\72998\Projects\Aijob`**，分支 `codex/job-fact-fidelity-handoff`。输入基线 `d11b328` 包含 OS-7 之后的11个提交，再迁入桌面31修改+6新增文件。精确完成提交以 Git 为准。

[四步接手计划](../plans/job-fact-fidelity-handoff.md)四步已完成；最终代码全仓948/948、lint、typecheck、build、audit及双库四视口/纠偏专项均通过。检查结果见[本轮验收证据](../evidence/product/job-fact-fidelity-acceptance-2026-09-05.md)。下一目标为 [SA 准入证据与恢复准备](../plans/supply-admission-scaleup-track.md)。不从 `10f7451` 重新做 OS-7。

## 本轮完成的实现

- Requirements v5 保存完整原句和未分类句，硬性出勤/最低时长/优先时长分别引用原句，不重复伪装成多条官方原文。最低3个月不会被优先6个月覆盖。
- 038 增加投递分类和私有 JD 原句存储，条件投影按岗位版本+要求集共存，要求集不可变。相同语义刷新不伪造岗位版本/要求集。
- Case 显式升级同时核对目标岗位版本和要求集；同版本新要求集在数据库事件校验中同样可用，旧 Case/旧匹配输入保持固定。
- Job、Case、Resume、Review、Interview、Debrief 使用统一 exact / official_list_fallback / missing；每次按当前导航白名单验证，集合批量加载，兼容 URL 仅 exact 有值。
- Web Requirements 与 Resume Review 按原句分组；列表投递提供岗位标题/编号，缺链接时保留清晰说明，打开链接不等于已投递。
- 当前 Review 优先按创建时间选择；旧任务晚完成不会覆盖更新审阅的“当前”位置，已增加真实本地worker顺序的回归场景。
- 使用独立 PostgreSQL、合成数据、OS-7 双库和纠偏专项浏览器 runner 验收；不迁移真实业务库。

## 历史与当前的区别

OS-7 `9d77021` 的808/808和供给阶段918/918均为历史结果。SA Phase A 已完成，ADR-0032–0035 已接受；2026-08-31 已实际取证robots，不应再记成“阶段0从未触网”“待ADR审定”。7个robots检查通过不等于7来源准入：34配置仍为0 approved，ToS与稳定运行证据尚待补齐。

22岗/3企业/3 ATS、公共0是历史业务库快照。本轮不接触业务数据库，不能据此宣称今天的真实岗位数量或新鲜度。规模、人工占比为ADR-0035报告项；产品证据仍E0，真实Alpha和用户实验未启动。

coco于2026-09-05明确取消单家公司岗位上限，按[ADR-0036](../decisions/0036-remove-company-job-cap.md)执行：不再统一到30，而是取消30/10及30条截断。取消上限已通过949/949全仓测试、lint、类型检查与构建；接续业务恢复与SA准入证据工作。

## 目录与数据处理

[工作区处置手册](../runbooks/workspace-takeover.md)解释桌面 `.git` 指针为何与 f057 冲突，以及每个目录的用途。旧 job、b52a、f057、Documents 仓库均原样保留；后续开发只使用新目录。

备份根目录：`C:\Users\72998\Projects\Aijob-backups\20260905-job-takeover`。包含提交历史bundle、37文件原字节与SHA-256、隔离验收日志；不包含真实数据库、密钥、简历和 `.data`，因此不能据此删除旧目录。

## 接续检查表

1. 打开新主工作区并核对分支/未提交变更，核对本轮已通过的最终验收证据，不重复旧OS-7或已闭合纠偏。
2. 在业务恢复副本上验证 PostgreSQL 备份、加密材料与业务资产一致性；再迁移到038、幂等物化并检查旧 Case 保持原要求集。本轮隔离迁移不代替这一步。
3. 按 SA Track 逐来源核对主体、robots/ToS、稳定观察、投递和关闭可检测证据；有证据才提升状态，不能批量把 pending 改 approved。
4. 只有获准来源满足逐岗位对外资格，才检查发布指针；同时验证暂停、过期与复核失格会撤回。明确保留缺项与数量报告。

常用验证：`pnpm check`、`pnpm build`、`pnpm audit:ci`。带数据库的完整测试需指向专属 loopback `aijob_*test*` 库；双库 Gate 用 `apps/web/scripts/isolated-system-gate.cjs`，复现环境见验收证据。不得把测试 URL 指向业务库。

## 本轮追加需求：取消公司岗位上限

coco明确取消单家公司30条上限，已按ADR-0036移除旧30/10和批次30条截断。目录、Case创建/升级、匹配状态、洞察不再读取旧selected作为资格条件；供给统计直接读取岗位事实。旧配额表仅保留兼容投影，物化后全部选中。真实业务库尚未恢复或重算。验证见[取消上限验收](../evidence/product/company-job-cap-removal-2026-09-05.md)。下一步仍为业务恢复准备与SA来源证据核验，不再安排“统一到30”。
