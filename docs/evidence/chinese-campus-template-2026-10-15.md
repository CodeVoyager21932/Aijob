# 中文首套模板：实际样张、个人内容和单页 PDF

历史阶段记录：下文保留首次交付时的范围与结果；30 套硬要求已取消，当前六套主线已收口转维护，见[最新收口记录](resume-module-closeout-2026-10-15.md)。历史字号与数量承诺不恢复为当前任务。

日期：2026-10-15。范围与授权见[首套及至少 30 套计划](../plans/chinese-resume-first-template-2026-10-15.md)。

## 已交付的可查看结果

coco 选定的 B（超级简历「应届生通用」视觉方向）已实现为 `studio-campus-cn`「晴空 · 应届生」。完整样张、套用个人内容、编辑保存、重开和网页下载已接通；最终审美与可用性仍由 coco 实看本轮成品评价，不因下述检查通过而自动认可。

| 参考部位 | 本产品实现 | 实际检查 |
|---|---|---|
| 蓝色曲线页首及柔和纸面 | `studio-campus.tsx` 的独立 SVG 曲线和页面背景 | 查看整页栅格；修正首次 SVG 颜色解析异常，保留失败产物 |
| 居中可选照片与身份区 | 流式页首、居中圆形照片、姓名/方向/联系信息 | 查看有图及无图两种成品；修正头像偏左与被曲线覆盖的问题 |
| 教育、实习和经历层次 | 学校/学位/专业/成绩独立信息行；公司/岗位/地点独立行；其他字段和结构化角色完整保留 | 实际个人稿、非程序员合成样张和针对性字段检查 |
| 选样到个人内容 | 完整样张、整页/100%阅读、个人内容预览和固定应用栏 | Chrome 实看、切换和应用；样张仅存在静态产物，不创建个人稿 |

原有正文 schema、ID、原件与历史文件保留；复用 RR6/Forme 隔离渲染与同一服务端 PDF。未引入第三个引擎。独立布局的原生语义行不再仅依赖通用条目配色。

样张为原创虚构市场营销学生材料，示例头像使用已有自制图示。竞品肖像、范文、品牌与预览资产没有进入交付产品；来源与运行许可见[许可记录](../../THIRD_PARTY_RESUME_TEMPLATES.md)。

## 实际文件与资料保留

- 完整样张：1 页 A4，正文 10 pt，收紧档位 0；PDF、PNG 和版本/hash 元数据位于 `apps/web/public/native-templates/studio-campus-cn-v1.*`。
- 个人稿：1 页 A4，正文 9.5 pt，收紧档位 2；48 段期望文字均在实际 PDF 中，未删正文。正式网页下载与独立复核成品 SHA-256 完全相同。
- 当前浏览器可见的 6 份稿件逐份保全，内容与标题前后相等。个人稿只改版式；既有合成稿用于输入、自动保存、预览更新及重开检查，临时修改已恢复。
- 当前 6 份中有 4 份空稿。空稿显示填写引导，模板个人预览说明暂无内容；不会把空白页显示为完成。历史反馈截图未绑定确切文档/修订，不能由本次观察反推其全部成因。
- 页面将“单页已满足”改为“当前排版：1 页 A4”，只陈述页数。

私有证据在 `.data/runs/campus-template/20261015/`：`drafts-before.json`、`drafts-after.json`、`drafts-final.json`、`preservation.json`、`personal-candidate-review.json`、实际下载文件及 PNG、编辑页/图库截图、首次失败与照片修复产物。个人原文和文件不进入 Git。

渲染身份：模板版本 1；`rr6-0c6e75e-forme-0.28-aijob-5-campus`；字体集 `aijob-studio-ttf-v1`。旧模板和已保留历史产物没有批量改写。

## 验证范围

| 检查 | 结果及边界 |
|---|---|
| Chrome 实际用户流程 | 完整样张/个人内容切换、应用、自动保存、重开、真实下载；既有合成稿切换新模板后输入进入 PDF，再撤销输入及版式并重开核对 |
| 整页图片 | 已查看个人下载、完整样张、有/无照片；未见缺字、遮挡或分页裁切。超量夹具在渲染检查中保留末条并报告超页 |
| core | visible-content/single-page 共 3 个定向检查通过；保留原导入保护与新的可见内容判断各自含义 |
| renderer | studio-model/studio-isolated/studio-campus 共 7 个检查通过；包括照片、结构化角色、链接、补充字段及超量材料末条文字 |
| 独立 PostgreSQL | `aijob_test` 中两条选定检查通过：预览/下载同字节与保留生命周期、收藏私有及仅保存后记录使用；其余 13 条未选，不代表整文件全部执行 |
| 工程 | 受影响源码 Biome、core/renderer 类型及构建、Web 类型及生产构建、platform 构建完成 |

PDF.js 对部分中文子集字体输出 `loca` 表恢复警告；上述实际文字核对和页面显示通过。DOCX 在 Word/WPS 中的实际分页、本轮未涉及的模板、移动端全流程、全站问题与安装包没有重新验收。

## 复现完整样张

在当前仓库先构建 core/renderer，再执行：

```powershell
pnpm --filter @aijob/resume-renderer exec tsx ../../tools/resume-native/generate-gallery.mts --templates studio-campus-cn --photo apps/web/public/resume-templates/sample-photo.png --require-one-page --out .data/runs/campus-template/<运行标识>/sample
```

产物 JSON 的 `visualReview: pending` 需要实际渲染看图后记录结果。脚本成功不自动证明视觉质量。

## 后续

本轮交付首套的实际成品供 coco 查看；至少 30 套按 1 → 6 → 12 → 20 → 30 的既定计划扩展。换色、换职业标题、换范文不计为新套数，现有候选不能按数量直接计入完成。
