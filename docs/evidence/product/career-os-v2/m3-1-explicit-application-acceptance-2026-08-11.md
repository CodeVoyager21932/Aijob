# M3-1 显式投递记录与 Case 时间线验收

> 日期：2026-08-11
>
> 结论：**通过 M3-1 工程验收，继续 M3-2 确定性文字面试**
>
> 代码提交：`34c6b61 feat(platform): record explicit case applications`、`73f3420 feat(web): add case application timeline`

## 1. 本切片交付

本切片只完成以下用户闭环：

```text
Case 固定岗位或 owner 私有 JD
→ 用户自行打开官方页或用户提供链接
→ 打开链接不改变 Case 阶段
→ 用户在 Aijob 内进行二次确认
→ Case 阶段变为 applied
→ 不可变 Case event 进入真实时间线
```

没有实现 Interview、Debrief、Knowledge、自动投递、站外通知、真实招聘来源、真实 AI、邮件、服务器或旧页面迁移。浏览器只使用合成私有 JD、保留域名 `example.test` 和随机隔离 PostgreSQL；没有点击或访问外部投递页面。

## 2. 契约与平台行为

- 新增 owner-protected `GET /v1/application-cases/:caseId/events`，按 Case sequence 倒序分页；游标绑定 Case，不能跨查询复用。
- 新增 `POST /v1/application-cases/:caseId/manual-applications`，要求 `expectedRevision`、CSRF 和幂等键。
- 只有 `interested` 或 `preparing` Case 可以显式记录为 `applied`；已投递、面试中或已结束 Case 不会被静默回退。
- Case revision 与 event sequence 在同一事务递增；同键同请求稳定重放，同键不同请求返回幂等冲突。
- 公共 Case 在同一事务投影为旧 `job_decisions.applied`，保证关闭 Career OS 旗标后仍能读取可表示状态；私有 Case 不创建旧 decision。
- 旧 decision 写入与新 Case 命令统一采用 owner → Case → decision 锁顺序，避免双写兼容期形成相反锁序。
- 时间线严格解析当前事件；历史异常载荷明确降级为“旧版只读记录”，不会猜测或丢弃。
- 跨 owner、已删除或不可见 Case 继续返回不可枚举 404；响应保持 `no-store`。

本切片复用了 migrations 023/026/029 中已有 Case/event/幂等结构，没有新增 migration、数据库、队列、认证或依赖。

## 3. Web 行为

- Case `投递` 标签改为独立 lazy workspace；岗位列表和其他首屏不会加载该实现。
- 外链是普通 `target=_blank` 交接链接，不调用阶段写接口；界面明确说明点击不等于投递。
- “我已在官方页面完成投递”后仍需第二次确认，取消不会写入。
- mutation 不自动重试；相同 Case/revision 的人工重试复用稳定幂等键。
- revision conflict 会保留当前确认界面、重新读取 Case 与时间线，并要求用户核对后再次提交。
- 成功后同步刷新 Case 详情、Case 列表和分页时间线；刷新、深链和前进/后退都从真实 API 恢复。
- 时间线兼容当前两种 requirement evidence event 结构，历史异常事件明确只读。

## 4. 自动化与工程 Gate

受影响包完整回归：

| 检查 | 结果 |
|---|---:|
| Contracts | 66/66 |
| Platform | 452/452 |
| Web | 119/119 |
| M3-1 focused PostgreSQL / service | 10/10 |
| lint | 421 files，通过 |
| typecheck | 全仓通过 |
| build | 全仓通过 |
| `pnpm audit:ci` | 通过；既有 1 项 high 继续由仓库审计策略忽略 |
| `git diff --check` | 通过 |

完整 Platform 回归使用随机命名 `aijob_m3_application_full_test_*` 隔离库并串行运行；focused Gate 另使用 `aijob_m3_application_test_*`。所有隔离库均按精确库名删除，未读取或修改开发库、Alpha 库或本地业务数据库。

构建结果：

- `CaseApplicationWorkspace` 为 8.43 kB 独立 lazy chunk。
- Web main chunk 为 551.87 kB；相对 M2 的 551.19 kB 增加 0.68 kB，相对 Phase 1A 510.96 kB 约增加 8.0%，仍低于 10% 边界。

## 5. 浏览器 Gate

应用内浏览器连接合成隔离环境，验证路径为：

```text
/applications
→ 导入带用户提供链接的合成私有 JD
→ /applications/:caseId/requirements
→ 投递标签
→ 二次确认已投递
→ 刷新与浏览器历史恢复
```

结果：

- 页面身份、非空渲染和框架错误覆盖检查通过；控制台没有新增 warning/error。
- 创建前阶段为“感兴趣”，初始时间线只有 `case_created`；没有因链接存在而产生投递事件。
- 二次确认后 Header 变为“已投递”，时间线出现“确认完成投递”和“由用户手动确认”。
- 刷新、后退到 Requirements、前进回到投递页后仍恢复同一事件和阶段。
- 默认桌面视口、320 CSS px 和 640 CSS px（200% 等效）均通过；320px 页面 `scrollWidth === innerWidth === 320`，640px 同样无页面级水平溢出。
- `VITE_CAREER_OS_V2=false` 后恢复旧 `ProductShell`；“我的求职”和“导入私有 JD”入口均不存在，控制台无异常。这也补上了 M2 验收中披露的旗标关闭人工复验缺口。

截图仅通过应用内浏览器用于本机人工检查，没有保存或提交本机产物。

## 6. 修复记录

- 时间线展示层最初把 `case-event-v1` 的 `evidenceIds/action` 与 `case-event-v2` 的 `linkedEvidenceIds/removedEvidenceIds` 当成同一字段，类型检查失败。现已按判别字段分别映射并覆盖两种事件测试。
- 新增集成测试最初复用了上一测试已经切换目录版本的岗位夹具，创建接口正确返回 422。测试改用未切换版本的独立夹具后通过；生产契约未放宽。

## 7. 证据边界与决定

M3-1 只证明“用户显式记录投递”和真实 Case 时间线在合成环境中的工程可用性，不证明用户会持续记录、能够提高投递质量或带来面试结果。产品证据仍为 `E0`，可信供给仍为 22 岗 / 3 家企业 / 3 个官方 ATS，公共与 Alpha 岗位仍为 0。

决定为 **继续**：当前唯一切片切换到 `M3-2 确定性文字面试`。M3-2 必须固定同一 Case、岗位版本、Resume/证据修订，只使用确定性模板和已确认事实；不得接真实 AI 或提前实现 Debrief。

验收完成后，前后端、PostgreSQL 容器与 Docker Desktop 已停止；所有 M3 临时数据库均已删除。`.claude/`、`.data/`、密钥、令牌、真实简历、本地业务数据库、下载产物和截图均未读取、暂存或提交。
