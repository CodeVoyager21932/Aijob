# 简历模板体验修复证据

2026-09-10；所有材料均为合成，开发目录为 `C:\Users\72998\Projects\Aijob`。没有改写 coco 的简历。

- [根因、竞品依据和改进记录](../../reviews/resume-template-ux-2026-09-10.md)
- [30 套一页样稿总览](template-contact-sheet.html)
- [修复前复现](baseline.json)：958px 弹窗包含 4097px 内容，实际滚轮不能到达模板网格。
- [浏览器任务链](browser-journey.json)：第 30 套可达、比较返回、内容保留、撤销、320/360/800px。
- [一页排版和真实 API PDF](one-page-fit.json)、[PDF 文件](real-api-one-page.pdf)：两页短稿整理成一页，不改字号和正文；字体失败与迟到输入也覆盖。
- [原生 200% 缩放](native-zoom.json)：纸张可单独放大滚动，返回与应用保持可达；实体手机键盘未验。
- [模板输出报告](templates/report.json)：30 套 PDF 一页、中文读回、DOCX 字段、长材料不丢失。初轮中的两套分页失败在调整默认留白后复测；侧栏模板改用逐条内容校验，避免将 DOM 栏位顺序差异误判为丢内容。报告保留初轮与复查出处。
- [WPS 14 实际输出](templates/office/report.json)：30 套均一页；这些结果不代表 Microsoft Word。初轮测试结束时 WPS 自动断开 COM，清理脚本随后修正并[单独复测](templates/office/report-cleanup-check.json)。

工程验证：Contracts 112、Web 193、Platform 导出/内容 8 项单元测试；Studio/模板库 12 项专属 PG 集成通过。全仓 typecheck/build 通过，Web 在最终改动后另构建；[lint](lint.log) 0 错误、246 警告。测试运行不访问真实招聘站。

主要复现命令（从项目根目录运行，先启动 5173/3000；Python 使用项目 `.data/python-tools`）：

```powershell
python apps/web/verification/template-ux-journey.py
python apps/web/verification/template-one-page.py
python apps/web/verification/template-native-zoom.py
pnpm --filter @aijob/platform exec tsx src/verification/template-gallery-check.ts
& apps/platform/verification/verify-template-gallery-office.ps1
```

模板输出脚本直接执行全部 30 套。若使用 `--template=...` 进行单独复查，报告只包含本次选择；本次汇总保留 `report-initial.json` 和 `report-recheck.json`。原 2026-09-09 的 90 组压力测试和候选包保留为历史证据，不与新的一页图库样稿混淆。
