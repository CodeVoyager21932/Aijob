# M3-2 确定性文字面试验收

> 日期：2026-08-11
>
> 结论：**通过 M3-2 工程验收，继续 M3-3 反馈与复盘**
>
> 代码提交：`e2a74fe feat(platform): add deterministic interview sessions`、`33b220b feat(web): add case interview workspace`

## 1. 本切片交付

本切片只完成以下用户闭环：

```text
同一 owner 的真实 Case
→ 检查 Case-derived Resume 与已确认证据前置条件
→ 用户显式创建模板面试 Session
→ 固定岗位上下文、Resume content revision 与 evidence revision
→ 逐题提交回答并追加不可变 Turn
→ 刷新、深链和历史导航恢复同一 Session
→ 完成一轮确定性文字练习
```

没有实现结构化 Feedback、Debrief、复盘确认回流、Knowledge、真实 AI、语音/音视频、自动投递、真实招聘来源、真实简历、邮件、服务器或旧页面迁移。

## 2. 契约与平台行为

- 新增 owner-protected Interview Session 列表、创建、详情和回答契约，并把游标绑定到 Case 查询。
- 创建 Session 时锁定并固定同一 Case 的公共岗位版本或私有快照修订、Case-derived Resume content revision 与 evidence revision；缺少前置资产时明确拒绝，不创建空白或伪造材料。
- 模板问题只来自 Session 创建时已经存在的固定 JD 要求和通用行为题；不会读取后续新增要求，也不会把用户未确认事实写进题干。
- 固定要求原句进入问题前最多保留 6,000 字符，并明确标记截断，保证完整问题仍满足 20,000 字符数据库约束。
- 创建 Session 在同一事务推进 Case revision 并追加 `interview_started` Case event；回答只追加 Turn，不原地修改历史回答。
- 创建和回答均要求 CSRF、稳定幂等键及 revision/sequence 检查。同键同请求稳定重放；同键不同内容明确冲突，mutation 不会静默覆盖。
- 回答提交按 owner-scoped advisory lock 串行化，并使用确定性 answer ID；最后一题完成后 Session 进入 `completed`。
- 跨 owner、已删除或不可见 Case/Session 返回不可枚举 404；读取响应保持 `no-store`。

本切片复用了 migration 028 已有的 Session/Turn、固定输入、owner epoch、幂等和不可变约束，没有新增 migration、数据库、队列、认证、依赖或 AI provider。

## 3. Web 行为

- Case `面试` 标签改为独立 lazy workspace；岗位列表、看板和其他首屏不会加载面试实现。
- 页面先读取真实 Session 历史；不存在 Session 时只显示显式“开始模板面试”按钮，不在 GET 或打开页面时隐式写入。
- 缺少岗位简历或已确认证据时展示真实前置条件，并提供返回 Case 简历页的入口。
- `?session=<id>` 支持刷新、深链和前进/后退恢复；非法或不属于当前 Case 的 Session 不回退到静态数据，可由用户打开最近一轮。
- 页面展示固定岗位上下文、Resume revision、evidence revision、题目来源、历史问答和完成状态。
- 回答正文最多 20,000 字符，用户显式提交；revision conflict 会保留草稿、重新读取 Session，并要求用户核对后再次提交。
- 当前切片不显示分数、录用概率、ATS 结论或伪反馈；反馈区域留到 M3-3。

## 4. 自动化与工程 Gate

focused 检查：

| 检查 | 结果 |
|---|---:|
| Interview contracts | 11/11 |
| Platform service | 3/3 |
| Platform PostgreSQL integration | 1/1 |
| Web API / view / runtime focused | 8/8 |

全仓串行回归：

| 包 | 结果 |
|---|---:|
| Config | 17/17 |
| Contracts | 69/69 |
| Database | 54/54 |
| Platform | 456/456 |
| Web | 122/122 |
| 总计 | 718/718 |

其余工程检查：

- `pnpm lint`：428 files，通过。
- `pnpm typecheck`：全仓通过。
- `pnpm build`：全仓通过。
- `pnpm audit:ci`：退出码 0；既有 1 项 high 继续由已提交审计基线忽略，本切片没有新增依赖。
- `git diff --check`：通过。

PostgreSQL 测试和浏览器夹具均使用随机命名的 `aijob_*_test_*` 隔离库；结束后按精确库名删除，未读取或修改开发库、Alpha 库或本地业务数据库。

构建结果：

- `CaseInterviewWorkspace` 为 9.21 kB 独立 lazy chunk。
- Web main chunk 为 553.92 kB；相对 M3-1 的 551.87 kB 增加 2.05 kB，约 0.37%；相对 Phase 1A 510.96 kB 约增加 8.4%，仍低于 10% 边界。

## 5. 浏览器检查

应用内浏览器连接合成私有 JD、合成 Resume/evidence 与隔离 PostgreSQL，验证路径为：

```text
/applications/:caseId/interview
→ 缺前置资产时阻止创建并引导到简历
→ 补入合成前置资产
→ 显式创建模板 Session
→ 提交两次合成回答
→ 完成 Session
→ 刷新、后退、前进和非法 Session 恢复
```

结果：

- 创建后 URL 写入真实 Session ID；首题引用固定的“掌握 SQL”要求，后续通用题不添加用户未确认事实。
- 第一次回答后出现下一题；第二次回答后 Session 进入完成状态；刷新后题目、回答和完成状态保持一致。
- 后退/前进恢复同一 Session；合法格式但不存在的 Session 显示真实空态，并可打开最近一轮。
- 1280 CSS px 下完成布局和页面级溢出检查，`scrollWidth === innerWidth === 1280`；控制台没有新增 warning/error。
- 没有访问外部岗位、真实 AI 或真实用户材料；临时合成夹具脚本、截图和隔离数据库均未保留或提交。

本轮应用内浏览器表面固定为 1280 CSS px，无法切换到真实 320px/200% 渲染环境，因此没有把移动端和键盘人工操作写成已通过事实。M3-1 已验证相同壳层的 320/640 等效视口；M3-2 新增了 767px/380px 响应式规则并通过构建与静态检查，但完整 320px、200%、键盘和焦点复验仍明确保留在 M3-5 总 Gate。这一缺口不代表 M3 整体已通过。

## 6. 证据边界与决定

M3-2 只证明固定输入的确定性模板 Session/Turn 在合成环境中的工程可用性，不证明问题质量、反馈价值、用户会持续练习或能够提高求职结果。产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位仍为 0。

决定为 **继续**：当前唯一切片切换到 `M3-3 反馈与复盘`。M3-3 只允许基于同一已完成 Session 生成结构化反馈、表达问题、证据缺口和练习计划；不得接真实 AI、创造经历、修改已确认事实或提前实现用户确认回流。

验收完成后，前后端进程和项目 PostgreSQL 容器均已停止，端口 3000、5173、5432 未监听；所有临时数据库均已删除。`.claude/`、`.data/`、密钥、令牌、真实简历、本地业务数据库、下载产物和截图均未读取、暂存或提交。
