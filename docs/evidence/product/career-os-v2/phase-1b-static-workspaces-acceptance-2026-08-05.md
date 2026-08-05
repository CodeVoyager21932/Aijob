# Career OS 2.0 Phase 1B 静态工作区验收

> 日期：2026-08-05
>
> 分支：`codex/career-os-phase-1`
>
> 结论：通过 Phase 1B Gate，决定为“继续”；下一阶段只能进入 Phase 2 领域契约与迁移设计

## 1. 本轮交付

- `/applications/:caseId/requirements`：硬条件、职责能力、未知待确认三组静态要求；每项保留静态官方原文、来源和三态；选择写入 `?requirement=<id>`。
- `/applications/:caseId/resume`：结构导航、两套本地模板、A4 主预览、当前区块建议；选择写入 `?block=<id>`。
- 建议状态机：接受、编辑后采用、拒绝、撤销；仅影响当前会话预览，真实刷新回到静态初始状态。
- 共享 `ContextInspectorFrame`，两个页面复用 Phase 1A 的 `WorkspaceShell / CaseHeader / CaseTabs`、静态 Case、视觉 token 和焦点规则。
- 新增纯领域夹具与状态 reducer 测试；未新增 API、数据库、认证、AI SDK、编辑器或拖拽依赖。

未访问真实招聘来源、真实 AI、密钥、本地数据库、`.claude/`、`.data/` 或个人数据。

## 2. Gate 结果

| Gate | 可复现结果 | 结论 |
|---|---|---|
| 三组 JD 语义 | 硬条件 2、职责能力 3、未知待确认 2；只有三种合法证据状态 | 通过 |
| 原文与未知诚实 | 每项引用静态原文；未说明的到岗/周期问题保持未知，不补写答案 | 通过 |
| URL 恢复 | 选择要求产生 `?requirement=requirement-case-starbridge-product-user-research`；选择区块产生 `?block=resume-case-starbridge-product-project`；真实刷新保留选择 | 通过 |
| 检查器焦点 | 桌面和 320px 抽屉关闭后，焦点分别返回相同 requirement/block 触发按钮 | 通过 |
| 简历三种决策 | 接受更新预览；编辑后采用显示用户编辑稿；拒绝隐藏建议且原文不变；三者均可撤销 | 通过 |
| 会话非持久化 | 接受后真实刷新：`accepted=false`，建议回到 `pending`；没有使用 localStorage 保存业务状态 | 通过 |
| 统一架构 | 页面只有一套全局导航和 CaseTabs；没有独立简历品牌、悬浮 AI、匹配等级或自动写入 | 通过 |
| 功能旗标回退 | 旗标关闭访问 `/` 仍进入 `/jobs`，旧导航存在且 Career OS 全局侧栏不存在 | 通过 |
| 包体边界 | 生产主包仍为 510.96 kB / gzip 150.93 kB，与 Phase 1A 相同；Case 工作区为懒加载 24.61 kB / gzip 7.70 kB | 通过 |

## 3. 浏览器交互证据

桌面主回路（1280 CSS px）：

1. 选择“用户研究”后 URL 写入 requirement，检查器显示原文、`证据待补充`与下一步。
2. 关闭检查器后焦点回到同一要求按钮。
3. 在项目经历建议上依次验证接受→撤销、编辑后采用→撤销、拒绝→撤销。
4. 接受后执行真实 reload，URL 中 block 保留，建议决策恢复 `pending`。
5. 旗标关闭的 5174 本地实例保持旧 `/jobs` 与 `ProductShell`。

响应式结果：

| CSS 视口 | JD 页面宽/文档宽 | 简历页面宽/文档宽 | 检查器 | 控制台 |
|---:|---:|---:|---|---|
| 1920 | 1920 / 1920 | 1920 / 1920 | 桌面右栏 | 0 warning/error |
| 1280 | 1280 / 1280 | 1280 / 1280 | 桌面右栏 | 0 warning/error |
| 768 | 768 / 768 | 768 / 768 | 按需抽屉 | 0 warning/error |
| 320 | 320 / 320 | 320 / 320 | `x=0, width=320, right=320` 全宽抽屉 | 0 warning/error |

应用内浏览器宿主把宽度固定为 1280，因此 320/768/1920 使用 Chrome 视口能力校准到实际 `window.innerWidth` 后验证。Chrome 截图命令在 320px 下超时，未把失败的截图冒充证据；验收使用可访问性快照、实际 DOM 几何、URL、焦点与控制台日志。320 CSS px 的 reflow 也覆盖了 640px 物理宽度在 200% 放大时的等效布局约束；后续阶段仍需保留一次人工实际 200% 缩放回归。

## 4. 自动工程门

```text
git diff --check
  -> passed

pnpm lint
  -> 359 files checked, 0 errors

pnpm typecheck
  -> contracts / config / database / platform / web passed

pnpm test
  -> web 20 files / 91 tests passed
  -> platform 55 files / 395 tests passed
  -> contracts 2 files / 16 tests passed
  -> config 1 file / 17 tests passed
  -> database 1 file / 9 tests passed
  -> platform 38 PostgreSQL integration tests skipped
  -> database 13 PostgreSQL integration tests skipped

pnpm build
  -> passed; existing main-chunk >500 kB warning remains

pnpm audit:ci
  -> passed after fast-uri 3.1.5 / 4.1.2 security override update
```

本机 Docker Desktop 引擎与 5432 PostgreSQL 均不可用，所以 51 项 PostgreSQL 集成测试是“未执行”，不是“通过”。Phase 1B 无数据库改动，因此不阻断本静态 Gate；Phase 2 任何迁移 Gate 必须先提供隔离 PostgreSQL 结果。

## 5. 概念图保真与差异

采用概念 02 的要求分组、选中项和证据检查器，以及概念 03 的结构区、A4 主预览和逐段决策。所有公司、原文、候选人、日期和建议均为明确静态示例。

有意拒绝：匹配等级/百分比、独立“AI 简历工作台”品牌、自动接受、未经确认事实或数字、完整富文本、拖拽、真实导出和外部链接。

## 6. 风险、回退与决定

- 风险：本阶段只证明交互架构，不证明 ApplicationCase 持久化、Resume V2、真实导出或用户价值。
- 回退：`VITE_CAREER_OS_V2=false` 返回旧壳层，不删除任何旧页面或数据。
- 观察项：后续阶段执行独立的实际 200% 浏览器缩放截图；不把 320 reflow 证据重复记为新阶段通过。
- 决定：**继续**。路线图当前唯一目标更新为 Phase 2 的领域契约与迁移设计包。
