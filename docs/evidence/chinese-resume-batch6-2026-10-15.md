# 中文模板第二批：六套成品制作与验收记录

历史快照：以下保留本批当时结果和下载验证边界；后续六套局部排版已核对浏览器实际落盘，当前状态见[简历模块收口记录](resume-module-closeout-2026-10-15.md)。

日期：2026-10-15。当前状态为**六套实际成品已交付，待 coco 视觉反馈**。coco 在[五套完整参考与结构对照](resume-reference-reselection-2026-10-15.md)交付后回复「可以」，已确认 A/B2/C/D2/E 的制作方向；不再等待重复批准。范围与硬约束见[中文模板计划](../plans/chinese-resume-first-template-2026-10-15.md)。

本记录区分独立生成的实际 PDF、自动化渲染契约与网页实际操作。三类证据现已齐备：网页完成五份副本编辑、保存重开和六份正式下载操作，原稿逐字段不变与正式产物核对通过。浏览器下载落盘路径未验证；下文明确服务端产物复制的来源和边界。

## 已实现的结构

保留「晴空 · 应届生」，新增五个独立页面组件。新模板仅参考 BOSS、超级简历；猫步、旧 B「规整」与旧 D「折角档案」没有恢复。

| 编号 | 模板 ID / 名称 | 结构与实现 |
|---|---|---|
| 首套 | `studio-campus-cn` / 晴空 · 应届生 | 曲线页首、可选居中照片、通栏正文；保留首套实现 |
| A | `studio-banner-cn` / 绯页 · 横幅分区 | 短横幅身份区与通栏章节，`studio-banner.tsx` |
| B2 | `studio-index-cn` / 序章 · 模块索引 | 深色短页首、章节索引轴和宽正文，`studio-indexed.tsx` |
| C | `studio-sidebar-cn` / 青岚 · 侧栏履历 | 26% 资料侧栏与经历主栏，`studio-sidebar.tsx` |
| D2 | `studio-layered-cn` / 叠影 · 名片叠层 | 小照片跨接短名片，下接连续正文面板，`studio-layered.tsx` |
| E | `studio-cards-cn` / 青瓷 · 柔和卡片 | 小页首与多个独立圆角模块，`studio-cards.tsx` |

以上组件位于 `packages/resume-renderer/src/`。共用 `studio-entry.tsx` 处理原始字段、链接和条目，页面组合分别实现。D2 仅借原图的跨接结构，未采用黑底、巨幅肖像、HELLO 或大自评卡；技能均采用文字事实，不显示无依据的圆环、进度条或自评分数。

`nativeTemplateCatalog` 与精选列表登记六套；图库使用真实样张 PNG/PDF，提供完整样张和个人内容预览，保持当前正在使用的精选模板选择。旧模板、历史渲染能力与许可保留。模板引用和公开资产边界见[署名记录](../../THIRD_PARTY_RESUME_TEMPLATES.md)。

## 独立生成的实际文件

私有目录 `.data/runs/template-batch6/20261015-production/` 保存本轮参考、原稿快照、输入文档、实际 PDF、整页 PNG、渲染元数据和 `render-report.json`。公开图库只包含原创虚构样张及已有示例头像，不包含个人原文或竞品预览资产。

`render-report.json` 共 12 项；逐项核对 PDF 页数、纸张大小、预期文字片段、实际字号、收紧档位及诊断，结果如下。个人内容来自既有修订 16 的材料；以下“个人稿”指独立生成的套版成品，不表示网页下载已完成。

| 模板 | 完整样张 | 个人稿 | 样张 / 个人稿收紧档位 | 样张 / 个人稿预期片段 |
|---|---|---|---|---|
| 晴空 | 1 页 A4 / 10 pt | 1 页 A4 / 10 pt | 0 / 1 | 38 / 38 |
| 绯页 | 1 页 A4 / 10 pt | 1 页 A4 / 10 pt | 0 / 1 | 45 / 36 |
| 序章 | 1 页 A4 / 10 pt | 1 页 A4 / 10 pt | 0 / 0 | 45 / 36 |
| 青岚 | 1 页 A4 / 10 pt | 1 页 A4 / 10 pt | 0 / 0 | 45 / 36 |
| 叠影 | 1 页 A4 / 10 pt | 1 页 A4 / 10 pt | 0 / 1 | 45 / 36 |
| 青瓷 | 1 页 A4 / 10 pt | 1 页 A4 / 10 pt | 0 / 1 | 45 / 36 |

12 份 PDF 的纸张均为 595.28 × 841.89 pt，`missingFragments=0`、`overflowItemIds=[]`、`diagnostics=[]`。每份文件的 SHA-256 与渲染节点坐标保存在私有报告。片段数取决于各自输入的段落划分，不能直接与首套历史记录的片段数比较，也不能代替原稿完整对象的逐字段比较。

新增五套完整样张使用 `batchGallerySample` 中原创非技术岗位在校生材料，首套继续使用 `campusGallerySample`。样张资产为 `apps/web/public/native-templates/<template-id>-v1.{png,pdf,json}`。当前版本：

- renderer：`rr6-0c6e75e-forme-0.28-aijob-8-batch6`
- font set：`aijob-studio-ttf-v1`
- field/link manifest：`native-fields-links-v3`

## 字段、链接与超页行为

新增 `packages/resume-renderer/src/studio-batch6.test.ts`，对五套各渲染两份实际 PDF，不仅检查配置对象。完整夹具包含照片、中文非技术经历、结构化角色、项目与论文补充字段、自定义模块、隐藏条目、隐藏模块及未放置条目；逐份验证 43 项具名事实、4 个链接注释、图像绘制指令、条目 anchors 和文字坐标。

五套完整夹具均为一页 A4，具名事实和链接保留；隐藏和未放置内容未进入 PDF；原始文档未被渲染过程修改。HTML 文本中的原始换行折叠为行内空白，显式 `<br>` 保留为换行，已通过 PDF 实际文字基线坐标验证。

每套另用 28 条长项目材料验证超页：收紧至档位 2 后仍超出一页时，如实返回多页诊断用产物、超页条目和至少 9.5 pt 字号，28 条标题与尾句均完整，最后一项及其 anchor 保留，文字没有越出纸张。**这些多页产物只用于诊断，不是完成品。** 正式 PDF 下载由 `export-artifacts.ts` 的 `NATIVE_SINGLE_PAGE_OVERFLOW` 守卫拒绝；DOCX 导出也在 `native-export.ts` 校验对应排版的单页状态，没有放宽只允许一页的产品要求。此处是源码边界核对，实际网页拒绝流程未在本记录重新执行。

C 的长材料最初触发 `NATIVE_EXPORT_LAYOUT_DEFECT`。原因是固定侧栏背景影响分页容器；改为正常文档流中的侧栏背景后，正式构建中的相同长材料测试通过，未使用裁切或丢弃尾项来解决。

最终定向运行：`studio-batch6.test.ts` 10 项、`studio-model.test.ts` 3 项、`studio-isolated.test.ts` 2 项，**15 项通过**。JSON 报告位于 `.data/runs/template-batch6/20261015-reselection/batch6-renderer-contract-tests.json`。此前 core/web 类型检查及模板内容保留/间距 54 项通过；这些工程检查不代表视觉认可。

观察到 PDF.js 输出 `Incorrect 'loca' table length -- attempting to fix it` 字体修复提示。该轮渲染器诊断为空，文字提取、链接、图片和纸张边界断言通过；本记录保留该提示，不把它抹去或扩大为所有阅读器均已验证。

## 实际网页流程、原稿保留与正式产物

五套新增模板均在网页副本中走完「完整样张 → 用我的内容（1 页）→ 应用 → 命名保存 → 重开 → 下载 PDF」；副本按模板对照 A/B2/C/D2/E 命名。首套也完成重开和下载操作，六份均出现「查看上次下载稿」。最后从列表重新打开 B2 显示正确名称；图库选择 E 时先显示「正在显示完整纸张…」，随后完整页面绘制出现，未观察到错误日志。

实际操作发现过路由切换期间旧编辑界面短暂保留、名称写入旧稿本地缓存的风险。已将整份文档会话按 `documentId` 重建，加载前阻止展示不匹配稿件，保存与恢复缓存绑定原会话 ID，并在卸载时同步关闭编辑入口。副本缓存恢复与名称修正后已重新打开核对；原有六稿最终比较均未变化。`NativeStudioPage.test.tsx` 与既有恢复测试共 8 项通过，PDF 加载占位测试 2 项通过，web 类型检查及最终 `pnpm --filter @aijob/web build` 通过。测试支撑修复，不替代上述真实页面记录。

私有 `final-delivery-verification.json` 的 `passed=true`，使用只读数据库检查，结果为：

- 原有六份稿件的完整 content、layout、revision、title 均不变，差异路径为空。
- 五份新增副本仅合并个人简介的段落包裹与空白，其他内容字段完全一致；原稿不做此调整。
- 六份正式个人 PDF 均为 1 页 A4（595.28 × 841.89 pt）、10 pt，原始 38 个文字片段全部存在，纸张外文字为 0，诊断为 0。
- 六份正式 PDF 的 SHA-256 分别与当前保存稿重渲染完全一致，核对期间保存状态稳定；6 份独立个人排版 PDF 也分别与对应的 6 份正式产物哈希相等，6 份完整虚构样张另有各自渲染报告。

`ui-export-artifacts.json` 记录六项均通过，正式下载已将对应产物保留为 `retained`。用于文件验收的 `*-downloaded.pdf` 是从数据库中同一份已生成 PDF 只读保真复制，`provenance=serverArtifactCopy`、`renderInvoked=false`，不是另外生成的替代文件。**`browserDiskDownloadVerified=false`**：CUA 下载事件接口超时，因此本记录不声称浏览器实际落盘位置或文件已核实；已核实的是网页下载操作、保留状态及正式服务端 PDF 字节与保存稿的一致性。

交付对照页为 `http://127.0.0.1:8771/`，包含六套完整样张、个人稿、PDF、原始参考及编辑链接，依赖本机查看服务。私有目录中的 `samples-overview.jpg`、`personal-overview.jpg`、`reference-comparison.jpg`、`product-gallery.jpg` 和最终 `product-gallery-final.jpg` 保留完整样张、个人稿、参考对比和实际图库画面。

严格一页、现有资料保留和至少 30 套的后续目标继续有效。当前六套实际成品已交付，等待 coco 看页首、字体、间距、密度和整体效果后的反馈；至少 30 套尚未完成，按 6 → 12 → 20 → 30 继续扩展。桌面安装包、Word/WPS 分页、岗位来源、AI 配置及全站其他问题未扩展为本轮验收范围。
