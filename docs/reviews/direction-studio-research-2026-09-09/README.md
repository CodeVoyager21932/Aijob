# 方向图谱与简历工作室研究记录

日期：2026-09-09。对应[改进提案](../../plans/direction-insights-and-resume-studio-rework-2026-09-09.md)。这是只读研究和方案记录，不是改造完成证据。

## 调查范围

- 主工作区 `C:\Users\72998\Projects\Aijob`，分支 `codex/job-fact-fidelity-handoff`，已有 HEAD `a4ff514` 及大量未提交实现；未覆盖这些改动。
- 阅读当前 README、路线图、交接、计划索引和适用 AGENTS；当前用户反馈揭示的核心体验问题，不能被旧交接“优先冷查询与运行联验”覆盖。
- 读取分类、能力词表、语义提取、图谱范围/聚合、Web 图谱、简历契约、编辑器、富文本、预览与 HTML 输出代码。
- 对本机 `http://127.0.0.1:3000/v1/job-graph?scope=%7B%7D` 执行 GET。摘要见 [baseline.json](baseline.json)。接口沿用 `dataset=public` 标识共享官方集合，但此实例是 `local_mvp`；93 条本机可见岗位不能计为准入公开岗位。
- 浏览器查看 Reactive Resume 官网的完整模板示例和模板切换入口；查看 OpenResume 公开简历编辑页及预览/缩放；查看 Magic Resume 官网示例，其 app 编辑入口返回登录页后停止。
- 检索 BOSS 官方模板页、超级简历官方模板页、职友集岗位职责入口、My Next Move 的任务/技能/教育组织。没有抓取这些平台的招聘数据进入 Aijob。

## 开源项目固定检查版本

GitHub API 的分支提交 SHA 已再次核对，用于固定本次调查，不以 README 的模板数量或历史版本号替代当前代码。以下路径已实际读取；没有安装或执行这些第三方项目。

| 项目 | 本次检查 SHA | 根许可证 | 建议位置 |
|---|---|---|---|
| [jlifeng/JobPilot](https://github.com/jlifeng/JobPilot) | `69e6692cedacaacd3d923908f622d967e97e96c8` | [Apache-2.0](https://github.com/jlifeng/JobPilot/blob/69e6692cedacaacd3d923908f622d967e97e96c8/LICENSE) | 版式与模板画廊主参考 |
| [Magic-Resume/Magic-Resume](https://github.com/Magic-Resume/Magic-Resume) | `c7e0826a674d144435ad18e3ab4d32785bc9fcbd` | [MIT](https://github.com/Magic-Resume/Magic-Resume/blob/c7e0826a674d144435ad18e3ab4d32785bc9fcbd/LICENSE) | 模板配置及中文模块适配 |
| [amruthpillai/reactive-resume](https://github.com/amruthpillai/reactive-resume) | `6416da28a4db7833a80b5d19b30c9b28d7df1807` | [MIT](https://github.com/amruthpillai/reactive-resume/blob/6416da28a4db7833a80b5d19b30c9b28d7df1807/LICENSE) | 模板选择、撤销与分页验证 |
| [xitanggg/open-resume](https://github.com/xitanggg/open-resume) | `4f8255a2c763479837f69f1dccf2a3338730cd79` | [AGPL-3.0](https://github.com/xitanggg/open-resume/blob/4f8255a2c763479837f69f1dccf2a3338730cd79/LICENSE) | 公开编辑器的交互对照，本次不计划直接并入代码 |

选择依据是可检查的具体实现，而非项目知名度或星数。免费开源不等于任意在线托管功能免费；Magic Resume 的开源代码与其云服务计划分别看待。

### JobPilot

- [模板画廊](https://github.com/jlifeng/JobPilot/blob/69e6692cedacaacd3d923908f622d967e97e96c8/desktop/src/routes/templates.tsx)：用完整 mockResume 渲染缩略图，提供完整尺寸预览。适合修复 Aijob 的空白模板卡片。
- [Classic 模板](https://github.com/jlifeng/JobPilot/blob/69e6692cedacaacd3d923908f622d967e97e96c8/src/lib/template-renderer/templates/classic.tsx)：居中姓名、分隔线、条目与日期层级。
- [Modern 模板](https://github.com/jlifeng/JobPilot/blob/69e6692cedacaacd3d923908f622d967e97e96c8/src/lib/template-renderer/templates/modern.tsx)：独立页眉色块、正文模块和强调色。
- [Modern Minimal 模板](https://github.com/jlifeng/JobPilot/blob/69e6692cedacaacd3d923908f622d967e97e96c8/src/lib/template-renderer/templates/modern-minimal.tsx)：左对齐页眉、模块分隔和时间信息布局；是否采用时间轴需根据中文长日期空间判断。
- 这些文件包含 React 预览及 HTML 输出两种实现，使用相同内容契约；不能仅凭文件头的 unified 字样声称两端完全一致。Aijob 应复用设计与可适配部件，同时保留自己的中文分页验收。

### Magic Resume

- [模板 registry](https://github.com/Magic-Resume/Magic-Resume/blob/c7e0826a674d144435ad18e3ab4d32785bc9fcbd/packages/resume-templates/src/registry.ts)：模板清单、缩略图和配置关联。
- [产品/运营模板配置](https://github.com/Magic-Resume/Magic-Resume/blob/c7e0826a674d144435ad18e3ab4d32785bc9fcbd/packages/resume-templates/src/config/product-ops-focus-template.ts)：按不同模块绑定数据并选择对应组件，适合摆脱所有条目同一表单的设计。
- 仓库目录另有 `templateLayout`、`renderer`、`pdf`，可作为实施时的定点复用候选；本轮没有将未逐一审阅的模块全部算作验证过。

### Reactive Resume

- [模板图库源码](https://github.com/amruthpillai/reactive-resume/blob/6416da28a4db7833a80b5d19b30c9b28d7df1807/apps/web/src/dialogs/resume/template/gallery.tsx)：真实模板图片、选中状态、切换模板后的撤销；响应式图库。
- [模板分页契约](https://github.com/amruthpillai/reactive-resume/blob/6416da28a4db7833a80b5d19b30c9b28d7df1807/packages/pdf/src/semantic/template-manifest.ts)：按模板固定语义元素、分组和展示契约，并检查一致性。
- [实际官网模板展示](https://rxresu.me/#templates)：已看到多种完整纸张的实图，版式有可辨认的差异；没有登录账户编辑真实材料，也没有对其 AI 进行质量验收。

### OpenResume 与国内产品

- [OpenResume 实际编辑器](https://www.open-resume.com/resume-builder)：本次看到连续表单、模块上移下移/隐藏、添加学校/项目、常驻纸张与自动缩放。可借鉴空间关系；其技能圆点熟练度和英语默认字段不直接移入 Aijob。
- [BOSS 官方模板入口](https://cv.zhipin.com/job/)：结合 coco 两张编辑器截图研究模块管理、字段、富文本和局部 AI 入口。截图中的暗色背景、占位业绩、年龄字段不等同于本项目需求。
- [超级简历的免费模板页面](https://www.wondercv.com/jianlimoban/mianfei/)：仅参考国内学生/实习/应届场景组织，未下载商业素材。
- [职友集岗位职责](https://www.jobui.com/gangwei/)：按岗位名称查工作内容的入口；不采纳其所有分类或来源数据。
- [My Next Move 的职业说明](https://www.mynextmove.org/profile/summary/15-1252.00)：任务、知识、技能、技术和教育分开呈现；只参考分层，不采纳美国就业条件与统计。

## 研究结论的证据强度

| 结论 | 证据 |
|---|---|
| Aijob 模板卡片是占位图，非真实模板渲染 | 本地 `ResumeStudioEditor.tsx` 的 `studio-mini-paper` 实现与用户截图一致 |
| 预览和模板/助手互相切换 | `panel` 条件渲染与用户截图一致 |
| 当前图谱混合不同方向和条件 | 页面默认范围、固定子岗位、聚合代码、本机 API 一致 |
| PRD/需求文档分开计数、Python 扩大推断为数据分析 | 词表、生成 key、本机原句实例和聚合结果一致 |
| 开源项目可提供更成熟的模板/编辑参考 | 上述固定版本代码，以及实际公开页面；不等同于已完成适配 |
| 新方案一定提高求职成功率 | **尚无此证据，不作该承诺**；先验证内容正确、易理解和可完成任务 |

本轮新增文档及只读查询摘要；没有变更应用、迁移数据库、测试真实模型或启动采集。只进行文档链接、结构和事实一致性检查，没有对尚未实施的方案报告 lint、构建或功能测试通过。
