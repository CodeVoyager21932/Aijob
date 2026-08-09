# M1 真实 Case 工作台验收

- 日期：2026-08-09
- 分支：`codex/career-os-phase-1`
- 实现前基线：`6d53e6e docs(plan): reset career os delivery roadmap`
- 平台实现：`27dd433 feat(platform): complete m1 case workflow contracts`
- 平台纠错：`8750211 fix(platform): preserve case display and revision conflicts`
- 前端实现：`91b4a37 feat(web): connect real career os case workspace`
- 产品证据：仍为 `E0`
- 四选一决定：**继续**到 `M2 专业简历闭环`

## 1. 目标与范围

本里程碑只完成以下真实内部闭环：

```text
本地离线岗位或 owner 私有 JD
→ 幂等创建或重新打开 Case
→ /applications 展示真实 Case
→ 刷新、深链和浏览器历史恢复
→ 核对要求三态、备注、证据与问题
→ 显式创建并读取 Case 派生简历
```

本次没有实现 Interview、Debrief、Knowledge、阶段流转界面、岗位版本升级界面、简历正文编辑、AI 建议、DOCX、打印或旧页面迁移；没有访问真实招聘来源、真实 AI、真实简历、邮件、服务器、开发业务库或 Alpha 库。`.claude/`、`.data/`、密钥、令牌、本地数据库和下载产物没有被读取或暂存。

## 2. 实现结果

### 2.1 统一 Case 岗位上下文

- `ApplicationCaseWithJobContext` 返回统一 `jobDisplay`，公共 Case 始终从 Case 固定的 `publishedJobVersionId` 读取岗位展示字段，不会因目录最新版本变化而漂移。
- 公共来源区分准入状态；`pending_review` 只显示本地待复核，不冒充已验证官方来源。
- 私有 JD 支持用户提供 HTTPS 链接、内推转发或未提供来源，全部明确标记为平台未核验；未知地点、办公方式和截止时间保持 `unknown/source_not_stated`。
- 私有正文只在同一 owner 内按规范化内容复用，支持用户显式另建；快照、第一修订、要求集和 Case 在同一事务完成，私有内容不进入公共岗位目录或供给统计。

### 2.2 Case 派生简历

- Resume Document 列表支持按 `kind` 和 `caseId` 查询，游标绑定完整筛选条件。
- 派生创建要求 `expectedCaseRevision`，在同一事务锁定 Case，固定岗位、基础正文和证据修订，复制稳定 section/block ID，创建 content/layout revision 1，推进 Case revision 并追加 `resume_document_derived` 事件。
- 缺少 V2 基础简历或已确认证据时不创建空白正文，界面明确引导先完成基础简历。
- 页面读取真实正文与布局并提供只读 A4 预览；创建只能由用户点击触发，页面 GET 不隐式写入。

### 2.3 真实 Career OS 工作台

- `/applications` 使用真实 Case API、集中查询键和最多 100 条的显式分页，不再从静态 `careerCases` 恢复正常业务会话。
- 岗位详情在 `VITE_CAREER_OS_V2` 开启时提供“加入我的求职”；关闭旗标后旧 `ProductShell` 与旧岗位详情不变。
- 私有 JD 抽屉覆盖无链接、用户链接、复用和另建，并明确说明仅当前用户可见、默认长期保存且可主动删除。
- Case 详情按 URL 读取真实公共/私有上下文；非法或跨 owner Case 返回不可枚举 404，不回退静态数据。
- Requirements 支持三态、备注、证据关联和问题；同 Case 写入串行，标准 revision conflict 会重新读取服务端状态并保留用户草稿，不自动覆盖。
- Case Resume 先按 Case 查询派生文档，前置条件满足后由用户显式创建，并按真实 section/block 顺序恢复 `?block=<id>`。

## 3. 实现中发现并收口的问题

- 公共岗位的已知地点和办公方式最初复用了只适合版本 diff 的语义归一化函数，误删 `FieldValue.evidenceRefs`，导致响应校验失败并回滚 Case 创建。现已保留原始证据引用，并增加 PostgreSQL 回归测试。
- Requirement 写入最初只按 Case revision 生成内部幂等键；两个标签页在同一 revision 提交不同草稿时会错误返回 `IDEMPOTENCY_KEY_REUSED`。现已把请求 hash 纳入内部键，同键重放仍稳定，不同草稿正确返回 `APPLICATION_CASE_REVISION_CONFLICT`。
- 首屏并行请求曾可能同时建立多个匿名 owner。前端 session bootstrap 已串行化，浏览器 Gate 证明首次并行读取只新增一个 owner。
- 320px 私有 JD 抽屉曾被底部层级遮挡。层级与焦点处理已修复，无水平滚动且关闭后焦点可恢复。

这些修复均在 M1 范围内，没有新增 migration、依赖、数据库、认证、队列或 AI SDK。

## 4. 自动化结果

| 检查 | 结果 |
|---|---|
| Contracts | 62/62，通过；覆盖公共/私有 `jobDisplay`、私有 JD、HTTPS/长度/重复策略、Resume 筛选和 Case revision |
| Database | 54/54，通过 |
| Platform | 443/443，通过；覆盖公共/私有 Case、固定版本、幂等、owner、Requirement、派生 Resume、墓碑、CSRF 与 `no-store` |
| Web | 100/100，通过；覆盖 API 映射、URL 状态、未知文案、三态分组、冲突草稿、旗标和静态运行时边界 |
| 串行全仓 | config 17 + contracts 62 + database 54 + platform 443 + web 100 = 676/676 |
| `pnpm lint` | 402 files，通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm audit:ci` | 退出码 0；既有 1 high 继续由审计基线忽略，没有新增依赖 |
| `git diff --check` | 通过；仅有 Windows 行尾提示 |

所有 PostgreSQL 测试均使用随机命名的 `aijob_*_test_*` 隔离库，结束后按精确库名删除。开发库和 Alpha 库未读取或修改。

## 5. 浏览器与视觉 Gate

浏览器 Gate 使用合成岗位、合成私有 JD、合成基础简历和隔离 PostgreSQL，连接本地 Platform，不访问外部招聘站或模型：

- 公共岗位首次创建和再次打开同一活动 Case 通过。
- 私有 JD 无 URL、带 URL、默认复用和显式另建四条路径通过。
- 刷新、深链、要求选择参数和简历区块参数恢复通过。
- Requirement 状态、备注和问题刷新后仍存在；双标签页产生标准 409，第二标签草稿保留。
- 无基础简历时显示真实前置提示；补入合成基础资产后可显式创建并读取派生简历。
- Case 侧览关闭后焦点返回；网络失败/重试与真实 404 界面通过。
- 1280px、320px 和 640 CSS px 的 200% 等效视口均无水平溢出；移动抽屉可关闭，键盘与焦点规则由针对性 Web 测试覆盖。
- 旗标关闭时旧壳层和旧岗位页面不出现 Career OS 创建入口。
- 除测试刻意制造并分类的 404/409/网络中断外，浏览器控制台无 warning、error 或未分类请求失败。

浏览器验收生成的两张截图只用于本机人工检查，没有提交本机产物。1280px A4 只读预览和 320px 私有 JD 抽屉均已人工复核。

## 6. 构建与加载边界

- Web main chunk 为 548.24 kB；Phase 1A 基线为 510.96 kB，增长约 7.3%，低于 10% 门槛。
- `WorkspaceShell`、Applications、Requirements 和 Resume 均保持独立 chunk；岗位列表与 Applications 首屏不会预加载 Requirements 或 Resume 工作区代码。
- Vite 既有 main chunk 大于 500 kB warning 仍存在，但没有新增控制台运行时问题；后续不得把该 warning 误写为已消除。

## 7. 风险与证据边界

- M1 证明真实 Case 工作台的工程闭环可用，不证明目标用户愿意使用或能提高求职结果；产品证据仍为 `E0`。
- 可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS；公共与 Alpha 岗位仍为 0，不能用合成浏览器夹具抬高分母。
- `VITE_CAREER_OS_V2` 仍是紧急回退开关；关闭应用入口不得删除已创建 Case、私有 JD 或派生简历。
- 历史 Phase 2B 验收继续保留原始工程证据，但其中的“下一步”已经失效，不得再生成当前任务。

## 8. 决定

决定：**继续**。

M1 全部退出条件已满足，当前唯一目标切换为 `M2 专业简历闭环`。M2 只复用并整合既有解析、事实确认、Resume V2、tailoring 和 DOCX 能力；在新的 M2 切片经过基线核对前，不提前实现真实 AI、Interview、Debrief、Knowledge、真实来源或旧页面迁移。
