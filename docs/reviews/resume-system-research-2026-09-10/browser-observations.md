# 公开页面走查记录

日期：2026-09-10。用途：竞品研究，不是 Aijob 新版本验收。只操作公开页面和示例，不上传用户简历，不注册或登录竞品账号。

| 页面 | 本轮实际到达 | 观察 | 未验证 |
|---|---|---|---|
| https://www.open-resume.com/resume-builder | 编辑器 | 左侧连续表单、右侧纸张、底部缩放/下载；基础字段与经历模块直接可填，页面初始无登录关卡 | 中文长稿、PDF 多页、导入正确性 |
| https://cv.zhipin.com/job/ | 模板列表 | 分职类/风格，模板有真实样图、名称、角色；列表有翻页 | 线上付费与账号流程 |
| https://cv.zhipin.com/job/p100101/4982249bba06f1a91X0~.html | 模板详情 | 可看样式与文字版、适用对象、导入/使用模板、相关模板与指导 | 本轮未进入登录后编辑；编辑器分析使用 coco 先前提供的 BOSS 截图 |
| https://rxresu.me/ | 首页模板演示与进入编辑入口 | 模板候选、可打开的 PDF、明确区分演示修改与真实应用；点击 Get Started 后到登录页 | 未登录编辑器；不能根据首页推断所有编辑行为 |
| https://salomonelli.github.io/best-resume-ever/#/ | 模板目录及 side-bar 演示 | 多种完整布局，侧栏与主体有独立结构；包括同设计的 RTL/项目变体，不能全计为独立布局 | 当前依赖安装与重新导出 |
| https://flowcv.com/ | 官方说明与模板入口 | 模板、内容、布局/设计、下载分开说明；含真实模板卡片 | 完整编辑与导出质量；仅依据官方功能说明，不将营销数字作为验收 |
| https://app.flowcv.com/resumes | 入口页 | 确认入口可达；未打开已有草稿 | 编辑器具体行为 |
| https://magicv.art | 导航超时 | 本轮访问失败，改查固定版本源码 | 不声称浏览器实测通过 |

补充官方网页检索：WonderCV、简历本、Canva 可画、RenderCV、PPResume。其功能说明仅作产品方声明；具体可复用性以开源实现、资产许可和后续本地验证为准。

## 源码抽查形成的判断

- Reactive Resume：`packages/pdf` 使用 React-PDF；`ResumeDocument` 分派模板组件并注册字体；Gengar、Onyx 各有独立结构；Gallery 采用可滚动模板网格，应用后提供撤销。固定提交与文件见 code-manifest.json。
- OpenResume：源码明确说明即时 PDFViewer 的延迟问题，采用带 `isPDF` 分支的预览方式。它是可学习的编辑流程，而不是可免验收照搬的预览架构。
- Resume Matcher：PDF 使用 Playwright/Chromium；前端分页等待字体，考虑条目、标题与首条内容，以及大条目拆分。前后端是否对 Aijob 中文材料产生相同断页仍待集成测试。
- 猫步：前端 PDF 方法调用后端 API，并提交预览地址和页数；注释掉的旧 html2canvas 代码不是当前主 PDF 路径，不能据此说当前猫步只输出位图。
- JadeAI：相近模板分别存在于 React 预览组件和导出 HTML 构建器；这是一项维护成本的推断，不是对其所有 PDF 质量的否定。
- Magic / JOYCEQL：浏览器打印路径显式处理样式与字体；实际许可证含附加商业限制。
- 木及基础版、dnd-resume、YAMLResume、RenderCV：抽查输出/编辑边界，具体文件和哈希见 code-manifest.json。

## PDF 样张观察

样张原件、首屏图与文本读回见 specimens 和 pdf-specimen-manifest.json。本轮没有重新运行这些项目生成中文材料，因此没有得出“某引擎对 Aijob 全部输入已通过”的结论。

| 样张 | 页数 | 文本读取 | 首屏观察 |
|---|---:|---|---|
| Reactive Gengar | 2 | 两页均非空 | 整体侧栏色块、身份区和主体模块具有明确分工；当前 Aijob 同名适配没有完整保留该组织 |
| Reactive Onyx | 3 | 三页均非空 | 单栏、紧凑页眉和条目层级；多页来自样稿内容，不能把这一页数设为产品默认 |
| RenderCV Classic | 2 | 两页均非空 | 学校/职位/日期清楚，正文与日期列自然组织 |
| RenderCV Engineering Resumes | 3 | 三页均非空 | 单栏文字层级明确；尾页内容较少，仍需按实际内容评估密度 |
| billryan 中文样张 | 1 | 可读回中文文本 | 中文标题、日期右对齐、学校与专业分层，是专业单栏的重要参考 |

样张中可能含刻意构造或不一致的示例内容。只取版式，不将示例经历、数值、姓名或联系方式写入 Aijob 用户资料。
