# 完整经历与个人准备、长期访客留存

本记录仅覆盖两项接续实现，不表示 U0–U6 全部完成。开发目录 `C:\Users\72998\Projects\Aijob`；未修改恢复业务库或旧项目目录。

## Contract / Platform / Web

- 方向图谱的个人对照直接读取当前 owner/epoch 的完整经历，输出完整描述、经历 ID 和修订；旧 evidence 仍兼容读取，新用户无需确认事实或拆分经历。规则只提供相关表述/任务线索，不判断资格或生成匹配分数。
- 准备事项新增 `sourceExperienceIds`，可从图谱带入或在事项编辑器选择。列表提供关联经历入口，图谱候选可直接打开完整经历。跨账户引用在服务及数据库两层拒绝。
- 059 前向迁移增加关联和数据库校验。删除经历只清除事项及幂等回执中的对应关联、提高事项修订，保留已完成状态、准备产物和用户备注；旧修订及重试不能恢复删除引用。
- 060 仅扩展 `persistent_guest` 保留模式及账号守卫，不批量转换既有匿名 owner。新访客的资料和原件无自动到期日，会话仍独立在 30 天后到期。可选邮箱认领沿用现有账号架构。
- 旧 `anonymous_ttl` 兼容资料保留原策略；用户实际新建/保存本轮材料时，在同一业务事务通过 `retainOwnerAssetsAfterMaterialSave` 升级当前仍有效的 owner。账号不受影响；过期、删除和旧 epoch 不被复活。失败事务不会改变保留模式。
- 设置页区分资料保留与浏览器访问期限。未绑定邮箱时清除浏览器凭据或会话到期会失去访问能力，资料本身不因此删除；绑定邮箱可跨设备找回。该说明位于设置内，不增加编辑步骤。

## Integrated Gate 与 Evidence

专属 PostgreSQL：`aijob_studio_test`，容器 `aijob-studio-test-20260907`，端口 55442。Docker 在会话恢复时未运行，已启动既有运行时及该测试容器，沿用原测试数据卷。

| 检查 | 实测结果 |
|---|---|
| `personal-comparison.test.ts` | 3 通过；SQL/NoSQL 边界、任务线索、完整项目描述保留 |
| `personal-comparison.integration.test.ts` | 2 通过；无旧证据直接使用、账户隔离、准备引用、删除及迟到修订 |
| `planner/service.integration.test.ts` | 5 通过；旧准备服务、幂等/冲突、删除/epoch、日历、常用筛选回归 |
| `identity/persistent-guest.integration.test.ts` | 3 通过；有限会话不删除原件、单用户事务升级及回滚、完整删除和迟到写入 |
| `identity/fastify.integration.test.ts` | 3 通过；Origin/CSRF、访客认领和已验证账号路径 |
| `profile/retention-service.integration.test.ts` | 2 通过；旧 TTL 显式夹具兼容、账号长期保留及删除 |
| `profile/local-owner-flow.integration.test.ts` | 隔离修正后 1 通过；旧解析/修订/删除业务兼容 |
| `contracts/identity.test.ts` | 7 通过 |
| `CareerDataControlPage.test.tsx` | 4 通过；三类保留模式及删除反馈 |
| 前端类型 | 通过；生命周期修改后再次通过 |
| scoped Biome | 图谱/准备修改文件和身份/设置修改文件无错误；保留旧 ICS 拼接提示 |

10 项图谱/准备检查于 2026-09-08 08:38 开始，耗时 21.81 秒；生命周期批次于 08:48 开始。全部自动测试使用夹具，不访问真实招聘站、SMTP 或模型。

旧 `local-owner-flow.integration.test.ts` 首跑失败于其全局队列假设：调用一次 worker 即假设领取本测试的解析任务。已改为仅当前 owner 夹具签发真实租约，再调用解析/删除业务处理器；调度行为继续由 worker 专项负责。2026-09-08 08:59 单项复核 1 通过，耗时 9.68 秒；不领取共享队列。

## 边界与后续验收

- 真实浏览器的图谱—经历—准备链、200% 缩放和整站联验由主线统一执行，本记录不把静态/类型检查当作浏览器验收。
- 自动审批曾拒绝“全部既有活跃匿名 owner 批量转长期保留”的提案。未执行该操作；采用无批量转换、仅新访客与用户实际材料保存事务升级的较小范围方案。
- Alpha 访问入口策略未被这项生命周期改动顺手放开。正式发布与业务数据库升级仍由整体候选验收处理。
