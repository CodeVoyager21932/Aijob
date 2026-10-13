/** Hand-specified synthetic regressions, not production jobs or a measured accuracy claim. */
export const SEMANTIC_V2_CORPUS = [
  { title: "后端开发实习生", text: "熟悉 Python、C/C++", yes: ["tool:python", "tool:cpp"], no: ["task:data_analysis", "knowledge:machine_learning"] },
  { title: "数据分析实习生", text: "使用 SQL 分析用户留存", duty: true, yes: ["tool:sql", "task:data_analysis"], no: [] },
  { title: "算法研究实习生", text: "计算机、人工智能等相关专业", yes: [], no: ["task:model_training", "knowledge:machine_learning"] },
  { title: "产品实习生", text: "编写 PRD／产品需求文档", duty: true, yes: ["deliverable:prd"], no: ["deliverable:requirements_document"] },
  { title: "采购实习生", text: "整理供应商需求文档", duty: true, yes: ["deliverable:requirements_document"], no: ["deliverable:prd"] },
  { title: "产品实习生", text: "负责用户访谈", duty: true, yes: ["task:user_interviews", "task:user_research"], no: ["general:communication"] },
  { title: "运营实习生", text: "使用包括但不限于 Excel 的工具", yes: ["tool:excel"], no: ["task:data_analysis"] },
  { title: "内容运营实习生", text: "策划社群活动，撰写文章并发布内容", duty: true, yes: ["task:campaign", "task:content_creation"], no: [] },
  { title: "市场实习生", text: "开展市场调研，整理竞品分析报告", duty: true, yes: ["task:market_research", "deliverable:analysis_report"], no: [] },
  { title: "财务实习生", text: "了解企业会计准则；协助编制财务报表", yes: ["knowledge:accounting_standards", "task:accounting", "deliverable:financial_report"], no: [] },
  { title: "审计实习生", text: "执行审计程序，整理审计底稿", duty: true, yes: ["task:audit"], no: [] },
  { title: "税务实习生", text: "了解税法，协助纳税申报", yes: ["knowledge:tax_law", "task:tax"], no: [] },
  { title: "商务实习生", text: "拜访客户并提供售前支持", duty: true, yes: ["task:sales", "task:customer"], no: [] },
  { title: "招聘实习生", text: "筛选简历，安排面试", duty: true, yes: ["task:recruiting"], no: [] },
  { title: "行政实习生", text: "负责会议安排和文件归档", duty: true, yes: ["task:admin"], no: [] },
  { title: "法务实习生", text: "熟悉民法典；起草合同并参与合规审查", yes: ["knowledge:law", "task:legal", "deliverable:contract"], no: [] },
  { title: "供应链实习生", text: "协助供应商评估，进行库存盘点", duty: true, yes: ["task:procurement", "task:supply"], no: [] },
  { title: "质量工程实习生", text: "熟悉质量管理体系；参与工艺优化", yes: ["knowledge:quality", "task:quality"], no: [] },
  { title: "研究助理", text: "开展文献检索，记录实验操作，撰写实验报告", duty: true, yes: ["task:literature", "task:lab", "deliverable:experiment_report"], no: [] },
  { title: "生物研究实习生", text: "了解细胞培养与蛋白纯化方法", yes: ["knowledge:biology"], no: [] },
  { title: "前端实习生", text: "使用 React 实现页面交互", duty: true, yes: ["task:frontend", "task:software", "tool:react"], no: [] },
  { title: "后端实习生", text: "了解计算机网络、数据结构与算法基础", yes: ["knowledge:networks", "knowledge:algorithms"], no: [] },
  { title: "测试实习生", text: "编写测试用例并输出测试报告", duty: true, yes: ["task:testing", "deliverable:test_report"], no: [] },
  { title: "设计实习生", text: "使用 Figma 进行交互设计，交付设计稿", duty: true, yes: ["tool:figma", "task:visual", "deliverable:design"], no: [] },
  { title: "算法实习生", text: "使用 PyTorch 训练模型；了解机器学习算法", yes: ["tool:pytorch", "task:model_training", "knowledge:machine_learning"], no: [] },
  { title: "其他实习生", text: "协助整理馆藏标本", duty: true, yes: [], no: ["task:data_analysis"] },
] as const;

/** Held-out examples were written separately from the dictionary rules. */
export const SEMANTIC_V2_HOLDOUT = [
  { title: "产品助理", text: "协助收集用户需求并绘制交互原型", yes: ["task:requirements", "task:prototyping", "deliverable:prototype"] },
  { title: "客户成功实习生", text: "跟进客户需求，整理客户支持资料", yes: ["task:customer"] },
  { title: "材料研究助理", text: "协助样品制备，并完成材料表征", yes: ["task:lab", "knowledge:chemistry"] },
  { title: "数据实习生", text: "清洗数据后制作数据看板", yes: ["task:data_cleaning", "deliverable:dashboard"] },
] as const;
