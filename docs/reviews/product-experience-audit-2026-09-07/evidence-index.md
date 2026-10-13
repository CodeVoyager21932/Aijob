# 本轮体验审视证据

全部校园/课程经历均为本轮合成数据。没有复制 coco 的上传简历、登录 cookie、令牌或测试身份会话文件。截图反映本地候选版本，不能当作生产环境或真实用户研究。

| 证据 | 可复核内容 |
|---|---|
| [空材料页](</C:/Users/72998/Projects/Aijob/docs/reviews/product-experience-audit-2026-09-07/evidence/materials.png>) | 首份简历入口仍要求解析已有简历 |
| [桌面编辑器](</C:/Users/72998/Projects/Aijob/docs/reviews/product-experience-audit-2026-09-07/evidence/base-editor.png>) | 多栏、正文/布局双保存、修订及区块概念 |
| [手机编辑首屏](</C:/Users/72998/Projects/Aijob/docs/reviews/product-experience-audit-2026-09-07/evidence/mobile-editor.png>) | 资产目录占据首屏，尚未到正文 |
| [手机面试首屏](</C:/Users/72998/Projects/Aijob/docs/reviews/product-experience-audit-2026-09-07/evidence/mobile-interview.png>) | 阶段、版本和介绍先于题目 |
| [手机图谱首屏](</C:/Users/72998/Projects/Aijob/docs/reviews/product-experience-audit-2026-09-07/evidence/mobile-graph.png>) | 当前样本范围与统计入口 |
| [页面文本摘录](</C:/Users/72998/Projects/Aijob/docs/reviews/product-experience-audit-2026-09-07/evidence/walkthrough-text.md>) | 8 个候选片段、确认后初始化、缺简历时的面试阻挡、地点题、教育段落追问、两题拼接、复用和日程表单、删除完成 |
| [面试反馈反例结果](</C:/Users/72998/Projects/Aijob/docs/reviews/product-experience-audit-2026-09-07/evidence/review-probe.json>) | 三个纯函数样例的输入、完整反馈和结果；不访问数据库或模型 |
| [反例脚本](</C:/Users/72998/Projects/Aijob/docs/reviews/product-experience-audit-2026-09-07/evidence/review-probe.mts>) | 调用当前实现的可复现探针，不改业务代码 |
| [布局尺寸](</C:/Users/72998/Projects/Aijob/docs/reviews/product-experience-audit-2026-09-07/evidence/viewport-metrics.json>) | 360px 的 body/main/textarea/table 尺寸 |
| [主要输入框位置](</C:/Users/72998/Projects/Aijob/docs/reviews/product-experience-audit-2026-09-07/evidence/first-action-positions.json>) | 320/360px、800px 高度，从页面顶部测量。面试会话已经有一次回答，不是首次空白会话 |
| [测试数据删除回执](</C:/Users/72998/Projects/Aijob/docs/reviews/product-experience-audit-2026-09-07/evidence/audit-cleanup.png>) | 仅本轮独立测试身份，删除完成时间 2026-09-07 10:50 |

纯函数反例可在 `C:\Users\72998\Projects\Aijob` 运行：

```powershell
pnpm --filter @aijob/platform exec tsx ../../docs/reviews/product-experience-audit-2026-09-07/evidence/review-probe.mts
```

脚本会将当前运行结果写入同目录 `review-probe.json`。保留现有证据时，可先复制结果文件再运行。UI 走查中主动触发了一次缺岗位简历的 409，它是前置条件响应，不应在后续截图累计日志中被误算成多次请求故障。

本轮阅读 [NN/g 渐进展示](https://www.nngroup.com/articles/progressive-disclosure/)用于评估信息层级，阅读 [国家大学生就业服务平台的简历准备指导](https://xn--dj-gt9c.ncss.cn/ncss/zd/jl/202411/20241118/2293345457.html)用于核对岗位相关经历、STAR 和必要个人信息的指导语境。来源只支撑对应设计原则，不证明本产品的实际转化率、录用效果或用户满意度。
