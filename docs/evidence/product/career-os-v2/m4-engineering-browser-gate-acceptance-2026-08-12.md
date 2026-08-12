# M4 工程与浏览器总验收

> 日期：2026-08-12
>
> 结论：**M4 通过，决定完成 M4 并进入 Private Alpha 准备；后续真实供给、服务器和参与者工作仍须单独授权并通过对应 Gate**
>
> 验收分支：`codex/career-os-m4-4`

## 1. 验收范围与环境

本轮没有扩建业务模块，只对 M4-3 已形成的一岗候选执行最终工程与浏览器 Gate。验收从 `6ea75fc` 创建独立分支，先确认远端 `origin/codex/career-os-phase-1` 同为 `6ea75fc`，再使用两个符合 `aijob_*_test_*` 保护规则的全新 PostgreSQL 隔离库：一个用于浏览器候选，一个用于最终全仓回归。

浏览器候选只包含合成公共岗位、合成 owner、合成简历和合成证据，岗位与投递地址均为 `.example.test`。为使候选可重复，新增 `m4-browser-fixture.cjs`，并把既有 M1 合成 seed 函数改为可复用导出；启动器仍 fail-closed，只接受 loopback 且名称匹配 `aijob_*_test_*` 的数据库。

没有读取、修改或提交 `.claude/`、`.data/`、密钥、令牌、真实简历、本地业务数据库、下载产物或截图；没有访问真实招聘来源、真实 AI、邮件、服务器或参与者数据。

## 2. 桌面一岗主路径

应用内浏览器在 1280 CSS px 下从合成岗位详情创建同一个公共 Case，并完成：

```text
岗位详情
→ 要求状态、备注与已确认证据关联
→ Case 派生岗位简历
→ 确定性模板 Review
→ 编辑后采用并形成新正文修订
→ DOCX
→ 外链读取但不写投递状态
→ 用户显式记录已投递
→ 两题模板文字面试
→ 生成反馈与复盘
→ 采用 / 编辑后采用 / 拒绝 / 稍后处理
→ 显式确认复盘
→ 回到同一 Requirement 与 Resume
→ 选择性删除 Case 并保留派生资产
```

- 刷新、Requirement 深链、浏览器前进/后退均恢复同一 Case 和固定岗位版本；目录变化不会替换 Case 内容。
- 外部 `.example.test` URL 的读取和呈现没有写入事件；只有显式确认后 Case 才进入 `applied`。
- 删除 Case 后原 URL 显示“没有找到这个求职项目”，脱离的岗位简历仍可从简历资产页发现、读取和单项删除。

## 3. 移动、缩放与可访问性

- 320 CSS px（等效于 640 物理像素下 200%）时，岗位、Case、Requirement 抽屉和删除对话框均满足 `scrollWidth === clientWidth`，页面没有水平滚动。
- Requirement 抽屉宽 319/320 CSS px，删除对话框保持在视口内；516 字符合成长备注和连续长 token 不撑破页面或表单控件。
- 新交互继续使用原生 link、button、textbox、combobox、checkbox 和 radio；Requirement 触发器可通过 Enter 打开。
- 抽屉与对话框关闭后焦点返回原触发器，浏览器实测可见 `2.66667px` outline；删除对话框取消后焦点返回“删除求职项目”。
- 浏览器控制层仍不能稳定把合成 Enter/Space 转成抽屉关闭按钮的 native click；因此没有把控制工具限制冒充产品自定义键盘事件。实际 DOM 为可聚焦原生 button，关闭后的焦点恢复与可见焦点已独立验证。

## 4. 错误恢复与回退

- 非法/不存在 UUID、已删除 Case 和跨 owner Case 均不枚举数据；浏览器显示统一不可用/404 页面，Platform 回归验证跨 owner 与缺失资源返回同类 404。
- 两个页面并发编辑同一 Requirement 时，旧 revision 显示“数据已在另一处更新”；合成草稿原文完整保留，系统读取最新 revision 后要求用户再次确认保存。
- 临时停止隔离 PostgreSQL 后，求职列表显示“求职项目暂时无法读取”和“重新读取”；数据库恢复后显式重试成功，未产生静默写入。
- Web 客户端 focused 11/11 通过，其中 mutation 遇到会话边界只发出一次写请求，恢复本机会话后返回 `SESSION_RECOVERED_RETRY_REQUIRED`，不会自动重放 mutation。
- `VITE_CAREER_OS_V2=false` 时，`/applications` 回到旧 ProductShell 的 404，`/jobs` 回到旧岗位首页；新“我的求职/简历资产/数据与设置”导航不加载。

## 5. 输出、网络与加载边界

- 脱离的岗位简历以固定正文修订 2、布局修订 1 成功生成 DOCX，界面确认产物未在服务器落盘；Platform 候选和 DOCX 单测继续验证有效、无宏的 ZIP/DOCX 响应。
- “浏览器打印”入口可调用，页面同时存在只用于打印的经典单栏文档，包含正确标题、1 个章节和 1 段正文；没有新增服务器 PDF 服务。
- 在恢复后的全新页面检查中，浏览器控制台 warning/error 为 0，Platform 新增 level 50 日志为 0，页面资源只有 `127.0.0.1`，没有真实招聘或 AI 请求。
- 新开岗位详情首屏与 Case 概览首屏均未观察到 `CaseResumeWorkspace`、`ResumeDocumentEditor`、`CaseInterviewWorkspace` 或 `DebriefConfirmationPanel`；重工作区继续 lazy load。
- 最终生产包体保持既有基线：main 564.42 kB（gzip 162.16 kB）、Resume Editor 29.23 kB、Interview 23.51 kB、数据设置 9.15 kB。main 的既有大于 500 kB 警告仍是技术债，没有误写为已解决。

## 6. 最终工程 Gate

最终代码在全新隔离库 `aijob_m44_verify_test_0f6b372448a946a98268fc88e6aea940` 从零通过：

| 包 | 结果 |
|---|---:|
| Config | 17/17 |
| Contracts | 79/79 |
| Database | 54/54 |
| Platform | 459/459 |
| Web | 141/141 |
| 总计 | **750/750** |

其余检查：

- `pnpm lint`：445 files，通过。
- `pnpm typecheck`：全仓通过。
- `pnpm build`：全仓通过。
- `pnpm audit:ci`：退出码 0；1 个既有 high 继续由审计基线忽略，本轮没有新增依赖。
- `git diff --check`：通过；仅有 Windows 行尾提示。
- 两个 fixture 脚本的 `node --check` 均通过。

## 7. 决定与证据边界

决定为 **完成 M4 并进入 Private Alpha 准备**。该决定只表示 M1–M4 的本地合成工程候选与浏览器 Gate 已通过，不授权或证明真实 Alpha 已就绪。

- 浏览器库与最终回归库均已按精确名称删除；M4 临时运行目录和数据库名记录已删除。
- Platform、Web 和 match worker 已停止；项目 PostgreSQL 容器与网络已关闭，3000、5173、5432 均未监听。
- 产品证据仍为 `E0`，没有可复核目标用户行为证据。
- 可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS；公共与 Alpha 岗位仍为 0。
- 100 家企业 / 1000 条岗位、来源连续性、邀请身份、服务器、安全、备份恢复、G0/G1 和 G4 均未通过。
- 下一步必须由 coco 单独授权，并继续以 `private-alpha-readiness-gates.md` 守门；不得把本证据冒充用户价值、真实来源准入或生产就绪。
