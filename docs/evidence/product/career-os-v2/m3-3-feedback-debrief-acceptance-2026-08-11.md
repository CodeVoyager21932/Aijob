# M3-3 反馈与复盘验收

> 日期：2026-08-11
>
> 结论：**通过 M3-3 工程验收，继续 M3-4 用户确认回流**
>
> 代码提交：`71edf98 feat(platform): add deterministic interview debrief`、`f8f9265 feat(web): show interview feedback and debrief`

## 1. 本切片交付

本切片只完成以下用户闭环：

```text
同一 Case 的已完成模板面试 Session
→ 用户显式点击生成反馈与复盘
→ 固定 Session、岗位上下文、Resume 与证据修订
→ 保存结构化 Feedback 与 draft Debrief
→ 展示表达问题、证据缺口和练习计划
→ 刷新或深链恢复同一只读草稿
```

没有实现 Debrief 确认、建议采用/拒绝、事实或简历回流、Knowledge、真实 AI、语音/音视频、自动投递、真实招聘来源、真实简历、邮件、服务器或旧页面迁移。

## 2. 契约与平台行为

- 新增 owner-protected `GET/PUT /v1/application-cases/:caseId/debrief` 契约；GET 为空时返回显式 `null`，不会因页面打开或刷新产生写入。
- PUT 要求已完成的指定 Session、`expectedSessionRevision`、CSRF 和稳定幂等键；同键同请求稳定重放，同键不同请求明确返回 `IDEMPOTENCY_KEY_REUSED`。
- Feedback 与 draft Debrief 在同一 PostgreSQL 事务中创建并固定同一 Session、岗位上下文和 evidence revision；任何一步失败都不留下半份记录。
- 一个 Case 当前只允许一份活动复盘。同一 Session 用新请求编号读取既有结果，不重复插入；另一 Session 尝试生成时返回 `CASE_DEBRIEF_ALREADY_EXISTS`。
- 确定性生成器只检查可观察的回答长度、情境—任务—行动—结果结构信号，以及要求与显式证据 ID 的关联；不判断经历真伪、语义质量、ATS 得分、匹配分或录用概率。
- 反馈只保存客观完成事实、表达提示、证据待核对项和练习动作；没有证据时不推断用户不存在相关经历。
- 跨 owner、已删除或不可见 Case/Session 返回不可枚举 404；读取响应保持 `no-store`，Session revision 冲突不自动重放写请求。
- 本切片复用 migration 028 的 `interview_feedback`、`debriefs`、owner epoch、固定输入、不可变历史与 confirmation trigger，没有新增 migration、数据库、队列、认证、依赖或 AI provider。

## 3. Web 行为

- 已完成 Session 先展示“生成反馈与复盘”显式按钮，并说明只有点击后才写入；页面 GET 不会伪装成已生成。
- 生成后在既有 lazy `CaseInterviewWorkspace` 内展示反馈摘要、客观 strengths、逐项提示、表达问题、证据缺口和练习计划，没有新增第二套页面壳层或主导航。
- 页面明确说明模板边界：只检查可观察结构、长度和证据关联，不判断事实真伪、ATS 或录用结果。
- Debrief 保持只读 draft，并明确说明不会自动修改简历、经历证据或 Case 状态；M3-4 之前没有确认或回流写入口。
- 选择同 Case 的另一已完成 Session 时，页面不会覆盖已有复盘，只提示“本求职项目已有另一轮复盘”，并可返回生成该复盘的 Session。
- 生成 mutation 不自动重试；Session revision 或既有复盘冲突时重新读取最新数据，由用户核对后再决定。

## 4. 自动化与工程 Gate

focused 检查：

| 检查 | 结果 |
|---|---:|
| Feedback/Debrief contracts | 12/12 |
| Platform deterministic generator | 2/2 |
| Platform PostgreSQL API integration | 1/1 |
| Web API / view focused | 9/9 |

最终代码树的全仓串行回归：

| 包 | 结果 |
|---|---:|
| Config | 17/17 |
| Contracts | 70/70 |
| Database | 54/54 |
| Platform | 458/458 |
| Web | 124/124 |
| 总计 | **723/723** |

其余工程检查：

- `pnpm lint`：430 files，通过。
- `pnpm typecheck`：全仓通过。
- `pnpm build`：全仓通过。
- `pnpm audit:ci`：退出码 0；既有 1 项 high 继续由已提交审计基线忽略，本切片没有新增依赖。
- `git diff --check`：通过；仅有 Windows 行尾提示。

所有 PostgreSQL 测试使用随机命名的 `aijob_test_m33_*` 隔离库，测试后按精确库名删除；没有读取或修改开发库、Alpha 库或本地业务数据库。

## 5. 浏览器检查

应用内浏览器连接合成私有 JD、合成 Resume/evidence、合成回答与随机隔离 PostgreSQL，验证路径为：

```text
私有 JD Case
→ 确认合成简历证据并初始化 Resume V2
→ 创建 Case-derived Resume
→ 完成模板面试 Session
→ 显式生成 Feedback/Debrief
→ 刷新与深链恢复
→ 创建第二 Session 并验证不覆盖既有复盘
```

结果：

- 完成 Session 后、点击按钮前，数据库 `debriefs/interview_feedback` 为 `0/0`；点击后为 `1/1`，`debrief_confirmations` 仍为 0。
- 页面展示 1 段回答、2 个表达提示、0 个证据待核对项，以及对应表达问题与练习计划；原回答保持不变。
- 刷新后 URL 仍包含原 Session ID，反馈摘要和只读草稿说明恢复；“生成反馈与复盘”按钮不再出现，数据库记录没有重复。
- 第二轮已完成 Session 只显示已有复盘提示；“打开对应练习”恢复第一轮 Session 与原复盘。
- 1280 CSS px 下 `scrollWidth === innerWidth === 1280`；反馈卡片、三列复盘区和长文本无页面级横向溢出，控制台只有 Vite/React 开发提示，没有 warning/error。
- 浏览器截图只用于本机视觉检查，没有保存或提交；临时验收启动器、环境目录和隔离数据库均已删除。

当前应用内浏览器表面仍未提供可靠的真实 320px/200% 视口切换，本切片没有把移动端、完整键盘和焦点人工操作写成已通过事实。新增复盘区已有 767px 单列响应式规则，并通过构建和静态检查；真实 320px、200%、键盘、焦点、旗标回退及删除/墓碑总复验继续由 M3-5 守门。

## 6. 包体与加载边界

- Web main chunk 为 554.99 kB；相对 M3-2 的 553.92 kB 增加 1.07 kB，约 0.19%；相对 Phase 1A 510.96 kB 约增加 8.6%，仍低于 10% 边界。
- `CaseInterviewWorkspace` 从 9.21 kB 增至 15.56 kB，仍是独立 lazy chunk；岗位列表、Case 列表和其他首屏不会加载 Feedback/Debrief 界面。
- Vite 既有 main chunk 大于 500 kB warning 仍存在，本切片没有把该技术债误写为已消除。

## 7. 证据边界与决定

M3-3 只证明确定性模板 Feedback/Debrief 在合成数据上的工程可用性，不证明反馈专业价值、用户会采纳、表达会改善或能够提高面试/录用结果。产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位仍为 0。

决定为 **继续**：当前唯一切片切换到 `M3-4 用户确认回流`。M3-4 先复用 migration 028 的 Debrief Confirmation revision guard，让用户明确确认后选择“去补证据”“去修改岗位简历”或“暂不处理”；确认本身不得创建经历、修改证据、覆盖 Resume revision 或提前实现 Knowledge/真实 AI。

验收完成后，前端、后端、Worker 与项目 PostgreSQL 容器均已停止，端口 3000、5173、5432 未监听；所有临时数据库和启动器均已删除。`.claude/`、`.data/`、密钥、令牌、真实简历、本地业务数据库、下载产物和截图均未读取、暂存或提交。
