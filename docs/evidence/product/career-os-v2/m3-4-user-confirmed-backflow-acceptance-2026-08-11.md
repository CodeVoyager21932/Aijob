# M3-4 用户确认回流验收

> 日期：2026-08-11
>
> 结论：**通过 M3-4 工程验收，继续 M3-5 工程与浏览器 Gate**
>
> 代码提交：`7e4d30e feat(platform): add itemized debrief confirmation`、`26918db feat(web): add user-confirmed debrief backflow`

## 1. 本切片交付

本切片只完成以下用户闭环：

```text
同一 Case 的 draft Debrief
→ 用户逐项选择采用 / 编辑后采用 / 拒绝 / 稍后处理
→ 用户显式确认整份复盘
→ 逐项决定、整份确认和 Debrief revision 原子保存
→ 刷新后恢复原决定
→ 采用项可返回同一 Case 的 Requirements 或 Resume 工作区
```

确认只表示用户认可改进方向，不会自动创建经历、修改证据、覆盖 Resume revision 或改变 Case 阶段。本切片没有实现 Knowledge、真实 AI、语音/音视频、自动投递、真实招聘来源、真实简历、邮件、服务器或旧页面迁移。

## 2. 契约、迁移与平台行为

- 新增 owner-protected `POST /v1/application-cases/:caseId/debrief/confirmations`；写入要求 CSRF、稳定幂等键和 `expectedDebriefRevision`，响应保持 `no-store`。
- 每个表达问题和证据缺口必须明确选择 `accepted / edited / rejected / deferred`；编辑后采用必须保存 1–2000 字符的用户文本，其他决定不得夹带编辑文本。
- migration 032 以 additive/append-only 方式新增 `application.debrief_item_decisions`，并把历史确认标记为 `whole_only`；新确认使用 `itemized_v1`。没有为历史记录伪造逐项选择。
- 逐项决定、整份确认和 Debrief `draft → confirmed` revision 推进在同一 PostgreSQL 事务完成；缺项、重复项、错误 item、stale revision 或任一步失败都不留下部分写入。
- 相同幂等键与相同请求稳定重放创建结果；相同键不同请求返回 `IDEMPOTENCY_KEY_REUSED`；资源已由同内容确认时，新请求编号返回既有结果且不重复插入。
- Case、Debrief 和 item 都按同一 owner/owner epoch 校验；跨 owner、已删除或不可见资源返回不可枚举 404。
- owner 全部删除与 retention 路径已覆盖新逐项决定；迟到或旧 epoch 写入由现有 owner guard 拒绝。
- 没有新增数据库、队列、认证、依赖、AI provider 或事实写入模型；PostgreSQL 仍是唯一真源。

## 3. Web 行为

- `debrief` 标签复用既有 lazy `CaseInterviewWorkspace`，不增加第二套壳层、主导航或独立事实状态。
- 提交前选择只保留在当前页面；所有可行动项完成选择后，“确认本次复盘”才可点击。Mutation 不自动重试。
- 编辑后采用允许用户调整认可的改进表达；拒绝和稍后处理也作为用户决定保存，而不是静默丢弃。
- revision conflict 会保留当前页面草稿并重新读取最新 Debrief，由用户核对后再次提交，不自动重放可能覆盖状态的写请求。
- 确认后只对采用或编辑后采用的表达项显示“去修改岗位简历”，只对采用或编辑后采用的证据缺口显示“去补证据”；返回工作区后仍需用户显式保存新修订。
- 历史 `whole_only` 确认显示“历史整份确认”，不会假装用户曾逐项采用、拒绝或稍后处理。

## 4. 自动化与工程 Gate

focused 检查：

| 检查 | 结果 |
|---|---:|
| Debrief contracts | 13/13 |
| Database forward contract / migration 032 | 13/13 |
| Platform Interview/Debrief PostgreSQL API | 1/1 |
| Platform owner deletion / retention | 2/2 |
| Web API / view model | 10/10 |

最终代码树使用全新的 `aijob_*_test` 隔离库完成全仓串行回归：

| 包 | 结果 |
|---|---:|
| Config | 17/17 |
| Contracts | 71/71 |
| Database | 54/54 |
| Platform | 458/458 |
| Web | 125/125 |
| 总计 | **725/725** |

其余工程检查：

- `pnpm lint`：432 files，通过。
- `pnpm typecheck`：全仓通过。
- `pnpm build`：全仓通过。
- `pnpm audit:ci`：退出码 0；既有 1 项 high 继续由已提交审计基线忽略，本切片没有新增依赖。
- `git diff --check`：通过；仅有 Windows 行尾提示。

一次完整测试在高负载下出现既有 `public-version-pointer` 15 秒超时；该文件单独复跑 1/1。随后一次复用失败运行库的容量测试结果被明确作废并删除，没有放宽 timeout 或修改既有测试。最终 Gate 在新的空隔离库中从零完成 725/725，所有临时数据库均按精确名称删除。

## 5. 浏览器检查

应用内浏览器只连接合成私有 Case、合成 Resume/evidence、合成回答和独立 PostgreSQL，验证路径为：

```text
已完成模板面试与 draft Debrief
→ 编辑后采用第 1 条表达问题
→ 拒绝第 2 条
→ 稍后处理第 3 条
→ 采用第 4 条与证据缺口
→ 显式确认
→ 刷新恢复五条决定
→ 精确进入 requirement 检查器
→ 返回并进入同一 Case 岗位简历
```

结果：

- 五条决定完成前确认按钮保持禁用；编辑文本、拒绝和稍后处理均原样持久化。
- 刷新后依次恢复“编辑后采用、拒绝、稍后处理、采用、采用”，没有重复确认或自动写入其他资产。
- “去补证据”打开 `/requirements?requirement=<固定 requirement id>` 并恢复对应检查器；“去修改岗位简历”进入同一 Case 的真实 Resume V2 编辑器。
- 1280 与 320 CSS px 下页面级 `scrollWidth === innerWidth`，确认结果卡片在移动端单列展示；控制台无 warning/error。
- 截图只用于本机视觉检查，没有保存或提交；临时启动器、运行目录和浏览器隔离数据库均已删除。

M3-4 没有把 200% 等效视口、完整键盘/焦点、旗标关闭回退或从投递开始的 M3 全链路写成已通过事实；这些仍由 M3-5 总 Gate 守门。

## 6. 包体与加载边界

- Web main chunk 为 558.27 kB；相对 M3-3 的 554.99 kB 增加 3.28 kB，约 0.59%；相对 Phase 1A 510.96 kB 增加约 9.3%，仍低于 10% 边界。
- `CaseInterviewWorkspace` 从 15.56 kB 增至 20.98 kB，仍是独立 lazy chunk；岗位列表、Case 列表和其他首屏不会加载确认回流界面。
- Vite 既有 main chunk 大于 500 kB warning 仍存在，本切片没有把该技术债误写为已消除。

## 7. 证据边界与决定

M3-4 只证明用户确认和受控回流在合成数据上的工程可用性，不证明用户会采纳建议、建议专业有效、表达会改善或能够提高面试/录用结果。产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位仍为 0。

决定为 **继续**：当前唯一切片切换到 `M3-5 工程与浏览器 Gate`。M3-5 只做 M3 全链路、安全/删除/错误边界、1280/320、200% 等效视口、键盘、焦点、旗标回退和包体总验收；只有发现可复现缺口才做最小修复，不提前执行 M4 或扩展 Knowledge/真实 AI。

验收完成后，前端、后端、Worker 与项目 PostgreSQL 容器均已停止，端口 3000、5173、5432 未监听；所有临时数据库、启动器和运行目录均已删除。`.claude/`、`.data/`、密钥、令牌、真实简历、本地业务数据库、下载产物和截图均未读取、暂存或提交。
