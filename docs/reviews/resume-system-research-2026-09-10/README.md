# 简历研究的现行结论与历史定位

研究于 2026-09-10，后续决定已由 ADR-0038–0043 接续，不再等待旧 S0–S4 方案审批。保留一份 `catalog.json` 作为当时来源目录；Star、维护状态和能力判断只属于研究时点。

| 研究得到的取舍 | 现在如何使用 |
|---|---|
| 文档、编辑器、纸张模板是不同层次 | 保留 Aijob 正文/经历/版本与申请系统，外部方案只解决对应局部问题 |
| Reactive Resume 的文档/模板组织可复用，但不能整站移植 | RR5 继续承担 schema/提取与旧稿；RR6/Forme 经只读适配用于服务端 PDF，固定版本及中文字体 |
| OpenResume 的连续编辑，LapisCV/billryan 的中文层级值得参考 | 导入直接编辑、优先清楚的中文版式；不把样张或模板数量当本项目质量通过 |
| RenderCV 的科研长稿结构有参考价值 | 用现有四类模板中的科研多页承接，本轮不加 Typst/第三套引擎 |
| 同名 Magic 项目、开源前端和商业完整产品不能混同 | 只按实际复制版本的来源及许可处理；许可不明或附加限制的代码不默认复制 |

当前依据：[ADR-0042](../../decisions/0042-opportunity-and-resume-system-upgrade.md)、[模板与字体许可](../../../THIRD_PARTY_RESUME_TEMPLATES.md)、[验证策略](../../12-validation-and-quality-strategy.md)。原输入是否保存、字段是否匹配和最终 PDF 是否完整分别定位，不能用视觉演示解释掉用户实际丢字。

原研究报告、逐项目录和浏览器观察通过[固定历史目录](https://github.com/CodeVoyager21932/Aijob/blob/d6df922deb8542d9ff82b81f60ea9be0d61e93da/docs/reviews/resume-system-research-2026-09-10/)读取；原始网页/README/代码/PDF 快照已压缩为本机历史包，见[恢复索引](../../plans/archive/README.md#本机历史材料)。批量删除被自动批准审查阻止，三份旧研究正文和展开快照暂留原位并退出默认检索。没有重新搜索或宣称当前上游状态已验证。
