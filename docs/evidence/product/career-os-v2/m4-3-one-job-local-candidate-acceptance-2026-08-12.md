# M4-3 一岗本地测试候选验收

> 日期：2026-08-12
>
> 结论：**通过 M4-3 工程验收，决定继续 M4-4 工程与浏览器 Gate**
>
> 代码提交：`f40da77 test(platform): add m4 one-job candidate`

## 1. 本切片交付

M4-3 没有扩建新的业务服务，而是把此前分散在 ApplicationCase、Resume、Interview、Debrief 和删除测试中的能力，收束为同一个合成公共岗位、同一个 owner、同一个 Case 的可重复本地候选：

```text
零网络合成公共岗位 V1
→ 通过 API 创建并幂等重开 Case
→ 目录切换到 V2 后仍读取 Case 固定的 V1
→ 确认要求并连接已确认经历证据
→ 创建岗位简历、运行模板 Review、接受/编辑/拒绝建议
→ 从当前内容与布局修订导出 DOCX
→ 读取合成官方 URL，不产生投递写入
→ 用户显式记录已投递
→ 完成模板文字面试、反馈、复盘和逐项确认
→ 回读同一 Case 的 Requirements 与 Resume
→ 删除 Case 并保留关联资产
→ 从真实数据范围发现脱离资产
→ 删除全部 owner 数据
```

候选使用 `.example.test` 合成 HTTPS 地址、合成岗位内容和合成职业材料；没有访问真实招聘来源、真实 AI、真实简历、邮件、服务器或参与者数据。

## 2. 同一 Case 的关键证据

- 公共 Case 由 `POST /v1/application-cases` 创建；使用新的幂等键再次提交同一岗位时返回同一个活动 Case，而不是建立重复项目。
- Case 固定 `publishedJobVersionId`、Requirement Set、基础简历内容修订和 Evidence 修订。目录指针从合成 V1 前进到 V2 后，Case 标题和要求仍来自固定 V1。
- Requirement 三态、用户备注和 Evidence Link 进入同一 Case revision/event 序列；面试只使用已持久化的固定要求和被 Case-derived Resume 固定的证据修订。
- 同一岗位简历已经覆盖模板 Review 的接受、编辑后采用和拒绝三种决定；决定保留原输入、结果内容修订和证据 ID，不覆盖已确认事实。
- DOCX 从候选当前的 content/layout revision 生成，响应为 `no-store` 且产物是有效 ZIP/DOCX；浏览器打印仍由 M4-4 的人工 Gate 验收，不新增服务器 PDF 服务。
- 合成官方 URL 只从 Case 读取。读取前后 Case event 数量和阶段不变；只有显式 `manual-applications` 命令把阶段改为 `applied`。
- Interview 使用确定性模板，Session 固定同一 Case、岗位版本、Resume 内容和 Evidence 修订；Feedback/Debrief 只提出表达问题、证据缺口和练习计划。
- Debrief 逐项决定和整份确认原子保存。确认后回读 Requirements/Resume，原三态、证据和简历修订保持不变，证明“确认回流”是用户返回修改入口，而不是自动创造或覆盖经历。

## 3. 删除与恢复边界

- Case 删除选择保留 Resume、Interview 和 Debrief；三类资产均脱离 Case，Resume 由真实数据范围计数，Interview/Debrief 由脱离资产列表发现。
- 随后通过 `DELETE /v1/profile` 请求全部删除：当前会话立即撤销，预先排队的迟到任务转为 `dead / OWNER_EPOCH_STALE`。
- 删除 worker 成功后，Case、Resume Documents、Interview Sessions、Debriefs 和旧 Job Decisions 对该 owner 均为 0；owner 成为 `deleted` 墓碑并推进 epoch。
- 合成公共岗位及其当前 V2 指针保持存在，证明个人数据删除不会破坏公共岗位真源。
- 现有跨 owner 404、stale revision、CSRF、幂等冲突和删除后不可读覆盖继续由同套 Platform 回归守门；本切片没有放宽任何既有校验。

## 4. 自动化与工程 Gate

最终代码的 Focused 候选在全新隔离库 `aijob_m43_review_test_eea3f0eb141b402e80e855ff99215f74` 中通过：

| 检查 | 结果 |
|---|---:|
| Resume/Application/Interview/Delete 同场景文件 | 4/4 |
| 其中同一公共 Case 完整候选 | 1/1 |

最终全仓回归使用新的合规隔离库 `aijob_m43_verify_test_70f56674051147de9939b8ece8d71f55`：

| 包 | 结果 |
|---|---:|
| Config | 17/17 |
| Contracts | 79/79 |
| Database | 54/54 |
| Platform | 459/459 |
| Web | 141/141 |
| 总计 | **750/750** |

其余工程检查：

- `pnpm lint`：444 files，通过。
- `pnpm typecheck`：全仓通过。
- `pnpm build`：全仓通过。
- `pnpm audit:ci`：退出码 0；1 个既有 high 继续由已批准基线忽略，本切片没有新增依赖。
- `git diff --check`：通过；仅有 Windows 行尾提示。
- Web 生产构建没有代码变化，main chunk 仍为 564.42 kB；Resume Editor、Interview 和数据设置继续保持独立 lazy chunk。

一次预备全仓运行因隔离库名称没有包含强制 `_test` 标记而被数据库安全护栏在连接阶段拒绝；没有执行迁移或业务写入。最终 Gate 使用符合仓库白名单的新空库从零完成，不放宽数据库保护。

## 5. 清理与证据边界

- 本轮所有精确命名的 M4-3 隔离数据库均已删除。
- 项目 PostgreSQL 容器和网络已关闭；端口 3000、5173、5432 均未监听。
- 没有读取、修改、暂存或提交 `.claude/`、`.data/`、密钥、令牌、本地业务数据库、下载产物或截图。
- M4-3 只证明同一合成 Case 的本地工程候选可重复，不证明浏览器全流程、用户价值、真实来源可用性或生产就绪。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位仍为 0。

决定为 **继续**：当前唯一切片切换到 `M4-4 工程与浏览器 Gate`。M4-4 只对已经形成的候选执行 1280/320、200% 等效视口、键盘/焦点、刷新/历史、错误恢复、旗标回退、控制台、打印和包体总验收；只有发现可复现的当前闭环缺口时才做最小修复，不扩建邮箱、Knowledge、真实 AI、真实来源或服务器。
