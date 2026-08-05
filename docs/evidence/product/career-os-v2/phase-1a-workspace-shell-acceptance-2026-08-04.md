# Career OS 2.0 Phase 1A 工作台壳层验收

> 日期：2026-08-04
>
> 分支：`codex/career-os-phase-1`
>
> 结论：通过 Phase 1A Gate，可以进入 Phase 1B 的 JD 能力与定制简历静态原型

## 1. 本轮交付

- `VITE_CAREER_OS_V2` 显式功能旗标；关闭时保持原 `ProductShell` 与旧路由，开启时懒加载 `WorkspaceShell`。
- 一套全局侧栏、顶部工具栏、主画布和可调宽右侧检查器；移动端分别转为导航抽屉和全宽侧览抽屉。
- 仓库内六个明确标为“示例”的静态 Case；`/applications` 提供列表/看板、阶段与城市筛选、排序和 `?peek=<caseId>` 侧览。
- 视图、筛选、排序和侧览对象全部写入 URL；侧栏折叠与检查器宽度只写入版本化本机 UI 偏好 `aijob:career-os-ui:v1`。
- `/applications/:caseId/overview|requirements|resume|application|interview|debrief` 共享同一 CaseHeader、CaseTabs、阶段和固定岗位版本上下文；Phase 1B 页面只放明确占位。

未新增业务表、接口、认证、全局状态系统或大型编辑器依赖；未访问真实招聘来源、真实 AI、密钥、本地数据库或个人数据。

## 2. Gate 复核

| Gate | 可复现结果 | 结论 |
|---|---|---|
| 单一导航 | 1920px 页面只有 1 个 `主要导航`，岗位子页面只使用局部 CaseTabs | 通过 |
| 功能旗标回退 | 开启旗标时 `/` 进入 `/today`；关闭旗标时 `/` 仍进入旧 `/jobs` 和原 `ProductShell` | 通过 |
| URL 上下文 | `view/stage/city/sort/peek` 可深链接；列表切换、城市筛选、刷新、后退和前进都按 URL 恢复 | 通过 |
| 侧览焦点与位置 | 打开/关闭侧览前后触发卡片坐标均为 `left=307, top=329.604...`；关闭后焦点回到相同 `data-case-trigger` 按钮 | 通过 |
| 共享 Case 路由 | 六个标签保持同一 Case 和岗位版本；`requirements` 等未提前加载完整编辑器或真实能力 | 通过 |
| 1280 响应式 | `documentWidth=1280`、`viewportWidth=1280`；看板只在主画布内部横向滚动，没有整页横向溢出 | 通过 |
| 320 响应式 | `documentWidth=320`、`viewportWidth=320`；检查器宽约 319px 并作为全宽抽屉；关闭的全局导航为 `visibility:hidden` | 通过 |
| 键盘与焦点 | `Ctrl+K` 打开全局搜索并把焦点放到搜索框；`Esc` 关闭后焦点回到先前的 `#career-main`；移动导航和侧览关闭按钮都有唯一可读名称 | 通过 |
| 运行错误 | 新工作台桌面与移动验收的浏览器 `error/warn` 日志均为 0 | 通过 |

## 3. 语义守卫

- 侧览把资格、经历证据和偏好分开，不显示匹配分、匹配等级或自动劝退结论。
- 经历证据只使用`已有证据 / 证据待补充 / 用户尚未确认`三种状态。
- 所有静态公司都带`示例·`前缀，来源显示为`企业官方 ATS / 企业招聘官网 · 静态演示`，不会冒充真实岗位事实。
- “打开求职工作区”只进入本地 Case 路由；静态原型不会打开外部页面，也不会推断已经投递。

## 4. 概念图保真账本

主参考为[概念 01：我的求职看板与岗位侧览](concept-01-application-board.png)。

保留项：唯一侧栏与顶部工具栏、五阶段看板、列表/看板切换、右侧岗位侧览、下一步任务、官方来源说明、蓝色主操作、绿色证据和琥珀待确认状态。

有意差异：

- 概念图中的真实公司、数量、头像和日期全部替换为六个虚构静态 Case。
- 拒绝“匹配良好/中/有差距”，改为资格、经历证据、偏好三轴分别判断。
- Phase 1A 不实现新增岗位、任务完成写入、完整 JD 能力或简历编辑器；对应能力留在 Phase 1B 或后续领域阶段。
- 1280px 使用图标轨道与主画布内部横向看板，320px 使用全宽检查器抽屉；路由和语义顺序不变。

## 5. 工程检查

```text
pnpm exec biome check apps/web/src/App.tsx apps/web/src/environment.ts apps/web/src/environment.test.ts apps/web/src/vite-env.d.ts apps/web/src/career-os
  -> 26 files checked, 0 errors

pnpm lint
  -> 351 files checked, 0 errors

pnpm --filter @aijob/web typecheck
  -> passed

pnpm --filter @aijob/web test
  -> 18 files, 85 tests passed

pnpm --filter @aijob/web build
  -> passed
```

生产构建仍提示原主包约 511 kB 超过 Vite 的 500 kB 提示线；Career OS 已通过路由懒加载拆为独立小分包（Applications 约 5.5 kB、WorkspaceShell 约 12.5 kB），因此该既有提示不阻断 Phase 1A。
