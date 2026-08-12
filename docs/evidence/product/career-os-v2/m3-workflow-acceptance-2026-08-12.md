# M3 投递与持续改进总验收

> 日期：2026-08-12
>
> 结论：**通过 M3 工程验收，决定继续 M4 旧流程收口与测试候选**
>
> Gate 修复提交：`d3177ed fix(career-os): close m3 workflow acceptance gaps`

## 1. 本次证明的完整闭环

本次只使用合成私有 JD、合成 Resume V2、合成证据与隔离 PostgreSQL，完整执行：

```text
固定岗位 Case
→ 打开用户提供链接但不改变阶段
→ 用户显式确认已在外部页面完成投递
→ 创建固定岗位、简历与证据修订的模板面试
→ 追加两题回答并生成确定性反馈与复盘
→ 用户逐项编辑后采用 / 拒绝 / 稍后处理 / 采用
→ 用户显式确认整份复盘
→ 精确回到同一 Case 的 Requirement 与 Resume 工作区
```

M3 没有访问真实招聘来源、真实 AI、真实简历、邮件、服务器或参与者数据，也没有实现 Knowledge、自动投递、语音面试或新的事实写入模型。

## 2. 平台与数据结果

- 完整 PostgreSQL 集成链在创建 Case、确认 Requirement 和派生岗位简历之后，显式调用 `manual-applications`，再进入 Interview、Feedback 与 Debrief；投递事件为 sequence 4，面试开始事件为 sequence 5。
- 外链打开后 Case 保持 `interested`、revision 3；只有用户二次确认后才变为 `applied`、revision 4，并追加 `manual_application_recorded`。
- 创建模板面试后 Case 保持 `applied`、revision 5；最终隔离库中为 1 个 Interview Session、4 个不可变 Turn、1 份 Debrief 和 4 条逐项决定。
- 两个标签页同时提交同一题时，旧 revision 返回明确冲突；最新题目自动重读，旧标签页输入草稿原样保留，没有静默覆盖或自动重放。
- 逐项决定与整份确认原子保存；确认后 Case 阶段没有被复盘推断改变，系统也没有创建经历、修改证据或覆盖 Resume revision。
- owner、CSRF、幂等、跨 owner 404、owner epoch、墓碑/删除和 retention 继续由现有平台与迁移集成测试覆盖；M3 没有创建第二套数据库、认证、队列或 AI provider。

## 3. 浏览器验收

应用内浏览器只连接临时启动器和随机命名隔离库，完成以下检查：

- 投递页明确显示“用户提供链接，平台未核验”；外链使用 `noopener noreferrer` 和新窗口交接，点击本身不写 Case。
- 投递确认、面试 Session 深链、两题回答、反馈生成、复盘标签、逐项确认和刷新恢复均读取同一真实 Case。
- 空面试历史、非法 Case 真实 404、并发 revision conflict 与草稿保留均有明确界面。
- “去补证据”恢复固定 requirement 深链；“去修改岗位简历”进入同一 Case 的真实 Resume V2 编辑器。浏览器前进、后退与刷新均恢复正确工作区。
- Gate 发现并修复一处当前闭环缺口：关闭 Requirement 检查器原本只返回焦点却保留 `?requirement=`，移动端会立即重新打开。修复后关闭动作移除 URL 参数、收起 320px 抽屉，并把焦点返回原要求按钮。
- 1280、640（200% 等效）和 320 CSS px 下页面级 `scrollWidth === clientWidth`；320px Requirement 检查器为全宽抽屉，关键内容与原生表单控件可用。
- 新交互使用原生 button、link、textbox、combobox 与 checkbox；要求检查器关闭后的可见焦点返回已在浏览器验证。浏览器控制层不能可靠把合成 Enter 转成 native click，因此没有把该工具限制误写成产品自定义键盘事件；产品没有新增非原生点击容器或移除浏览器默认键盘语义。
- `VITE_CAREER_OS_V2=false` 后 `/applications` 恢复旧 ProductShell 404，`/jobs` 恢复旧岗位首页，且不出现“我的求职”新导航。
- 控制台只有 Vite 连接与 React DevTools 开发提示，没有新增 warning/error。
- 本机截图只在应用内浏览器中临时查看，没有保存或提交。

## 4. 自动化与工程 Gate

最终 Gate 使用全新的 `aijob_*_test` 空隔离库从零执行：

| 包 | 结果 |
|---|---:|
| Config | 17/17 |
| Contracts | 71/71 |
| Database | 54/54 |
| Platform | 458/458 |
| Web | 125/125 |
| 总计 | **725/725** |

其他检查：

- `pnpm lint`：432 files，通过。
- `pnpm typecheck`：全仓通过。
- `pnpm build`：全仓通过。
- `pnpm audit:ci`：退出码 0；既有 1 项 high 继续由已提交审计基线忽略，本次没有新增依赖。
- `git diff --check`：通过；仅有 Windows 行尾提示。

第一次全仓运行中，既有 `resume/privacy-persistence` 的隔离解析子进程出现一次 10 秒超时；失败库立即作废并按精确名称删除。该文件随后在第二个全新库单独通过 2/2，最终全仓又在第三个全新空库从零通过 725/725；没有放宽 timeout、修改测试或复用失败库。

## 5. 包体与加载边界

- Web main chunk 为 558.27 kB，与 M3-4 基线相同；相对 Phase 1A 的 510.96 kB 增长约 9.3%，仍低于 10% 边界。
- `CaseInterviewWorkspace` 为 20.98 kB、`CaseRequirementsWorkspace` 为 12.92 kB、`ResumeDocumentEditor` 为 29.23 kB，均保持独立 lazy chunk。
- 岗位列表和 Case 列表首屏没有把简历编辑器或面试工作区合入初始路由包。
- 既有 Vite main chunk 大于 500 kB 的技术债仍存在，本次没有把它误写为已解决。

## 6. 清理、证据边界与决定

- 临时浏览器数据库、失败测试库、复现库、最终测试库、启动器和临时 Vite 配置均已按精确名称删除。
- 前端、后端和项目 PostgreSQL 容器已停止；端口 3000、5173、5432 未监听。
- `.claude/`、`.data/`、密钥、令牌、本地业务数据库、真实简历、下载产物和截图均未读取、暂存或提交。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位仍为 0。M3 只证明合成数据上的工程可用性，不证明建议有效、用户愿意使用或能提高录用结果。

决定为 **继续**：M3 完成，当前唯一里程碑切换为 `M4 旧流程收口与测试候选`。M4 的第一个串行切片是 `M4-0 旧入口与一岗闭环差异审计`；先确认 `/resume`、`/recommendations`、`/insights` 与新 OS 的重复读写和删除/异常缺口，再决定最小兼容改动，不从历史 Phase 2B 或归档总计划生成任务。
