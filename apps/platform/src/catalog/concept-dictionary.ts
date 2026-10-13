import type { GraphConceptKind } from "@aijob/contracts";

export type ConceptRule = { key: string; label: string; kind: GraphConceptKind; pattern: RegExp; parentKeys?: string[] };
const rules: ConceptRule[] = [];
function add(kind: GraphConceptKind, id: string, label: string, pattern: RegExp, parentKeys?: string[]) {
  rules.push({ key: `${kind}:${id}`, label, kind, pattern, ...(parentKeys ? { parentKeys } : {}) });
}
add("task", "user_research", "用户研究", /用户研究|用户调研|用户洞察/u);
add("task", "user_interviews", "用户访谈", /用户访谈|访谈用户|访谈研究/u, ["task:user_research"]);
add("task", "survey", "问卷与调研", /设计问卷|问卷设计|问卷调研|调研问卷/u, ["task:user_research"]);
add("task", "requirements", "需求梳理", /需求(?:分析|梳理|整理|挖掘|收集|调研)|(?:分析|梳理|收集|整理).{0,8}需求/u);
add("task", "product_design", "产品方案设计", /产品(?:规划|策划|设计)|设计.{0,8}(?:产品方案|功能)|功能设计/u);
add("task", "prototyping", "原型设计", /(?:设计|绘制|制作|搭建).{0,5}原型|原型设计/u);
add("task", "data_analysis", "数据分析", /数据(?:分析|挖掘|统计)|分析.{0,8}(?:数据|留存|转化|指标|营收)|(?:留存|转化|指标).{0,5}分析/u);
add("task", "data_cleaning", "数据整理与清洗", /数据(?:清洗|整理|预处理|标注)|清洗数据/u);
add("task", "experiment", "实验设计与验证", /(?:设计|开展|实施|进行).{0,6}实验|实验(?:设计|验证)|A\/B.{0,3}(?:测试|实验)/iu);
add("task", "content_planning", "内容策划", /内容策划|选题(?:策划|规划)|策划.{0,8}内容/u);
add("task", "content_creation", "内容制作与发布", /(?:撰写|制作|编辑|发布|创作).{0,8}(?:内容|文章|视频|文案)|文案(?:撰写|创作)|视频剪辑/u);
add("task", "community", "用户与社群维护", /(?:用户|社群|社区)(?:维护|运营)|维护.{0,6}(?:社群|社区)|用户服务/u);
add("task", "campaign", "活动策划与执行", /活动(?:策划|组织|执行)|(?:策划|组织|执行).{0,8}活动/u);
add("task", "market_research", "市场与行业研究", /市场(?:调研|研究|分析)|行业(?:调研|研究|分析)|竞品(?:分析|调研)/u);
add("task", "marketing", "营销与投放", /广告投放|渠道投放|营销(?:策划|推广)|品牌推广/u);
add("task", "software", "软件开发", /(?:开发|编写|实现|维护).{0,12}(?:软件|系统|程序|代码|应用|服务|引擎)|软件(?:开发|研发)|编码实现/u);
add("task", "frontend", "前端界面开发", /前端(?:开发|页面|工程)|(?:开发|实现).{0,8}(?:网页|Web页面|页面交互)/iu, ["task:software"]);
add("task", "backend", "服务与接口开发", /(?:开发|设计|实现).{0,8}(?:接口|后端|服务端)|后端开发/iu, ["task:software"]);
add("task", "testing", "测试与缺陷定位", /测试(?:用例|执行|设计|开发)|(?:编写|执行).{0,6}测试|缺陷(?:定位|分析)|自动化测试/u);
add("task", "deployment", "部署与运行维护", /(?:服务|系统|应用)(?:部署|运维)|部署.{0,6}(?:系统|服务)|故障排查|监控告警/u);
add("task", "model_training", "模型训练与评估", /(?:训练|微调|评估|优化).{0,8}模型|模型(?:训练|微调|评估|优化)|算法(?:研发|优化|设计)/u);
add("task", "literature", "文献阅读与研究", /文献(?:阅读|调研|综述|检索)|(?:阅读|检索|研究).{0,6}(?:文献|论文)/u);
add("task", "lab", "实验操作与记录", /实验(?:操作|记录)|(?:完成|执行|进行).{0,6}(?:实验操作|样品检测)|样品(?:制备|分析)/u);
add("task", "accounting", "核算与报表编制", /(?:会计|财务)核算|(?:编制|制作).{0,5}(?:财务报表|凭证)|记账|账务处理/u);
add("task", "audit", "审计与核查", /审计(?:程序|工作|底稿)|(?:核查|核对).{0,6}(?:账目|凭证|数据)|执行审计/u);
add("task", "tax", "税务处理", /税务(?:申报|处理)|纳税申报|税金计算/u);
add("task", "sales", "客户开发与销售", /客户(?:开发|拓展|拜访)|(?:开发|拜访|拓展).{0,5}客户|销售(?:线索|跟进|谈判)/u);
add("task", "customer", "客户需求与支持", /客户需求|客户支持|售前支持|售后服务/u);
add("task", "recruiting", "招聘协助", /简历筛选|筛选简历|招聘(?:渠道|流程)|面试(?:安排|邀约)|安排面试/u);
add("task", "legal", "合同与合规审查", /合同(?:审查|审核|起草)|(?:审查|审核|起草).{0,6}合同|合规(?:审查|评估)/u);
add("task", "admin", "行政与文档支持", /行政支持|会议安排|档案管理|文件归档|办公用品/u);
add("task", "procurement", "采购与供应商管理", /供应商(?:管理|评估|寻源)|采购(?:计划|执行|流程)|询价|比价/u);
add("task", "supply", "物流与库存管理", /库存(?:管理|盘点)|物流(?:调度|管理)|订单(?:履约|跟踪)|物料管理/u);
add("task", "quality", "质量检测与工艺改进", /质量(?:检测|改进|分析)|工艺(?:改进|优化)|质量检验|生产排程/u);
add("task", "visual", "视觉与交互设计", /视觉设计|交互设计|平面设计|界面设计/u);
for (const [id, label, pattern] of [
  ["statistics", "统计学", /统计学|概率(?:论|统计)|回归分析|假设检验/u],
  ["experimental_design", "实验设计方法", /实验设计|A\/B测试|对照实验/iu],
  ["machine_learning", "机器学习方法", /机器学习(?:算法|方法|基础)|深度学习|神经网络|强化学习/u],
  ["networks", "计算机网络", /计算机网络|网络协议|TCP\/?IP|HTTP协议/iu],
  ["algorithms", "数据结构与算法", /数据结构|算法基础|算法设计|复杂度分析/u],
  ["databases", "数据库原理", /数据库(?:原理|设计|基础)|事务隔离|索引原理/u],
  ["operating_systems", "操作系统", /操作系统(?:原理|基础)|进程线程|内存管理/u],
  ["accounting_standards", "会计准则", /会计准则|企业会计制度/u],
  ["tax_law", "税法", /税法|税收政策/u],
  ["law", "法律知识", /合同法|民法典|劳动法|公司法/u],
  ["finance", "金融与估值方法", /估值模型|财务建模|金融知识|证券分析/u],
  ["design_methods", "设计方法", /可用性测试|信息架构|设计规范|用户旅程/u],
  ["research_methods", "研究方法", /定性研究|定量研究|质性研究|研究方法/u],
  ["chemistry", "化学与材料知识", /有机化学|无机化学|材料表征|电化学/u],
  ["biology", "生物实验方法", /分子生物学|细胞培养|PCR|蛋白纯化/iu],
  ["quality", "质量管理方法", /六西格玛|质量管理体系|ISO\s*9001|FMEA/iu],
] as const) add("knowledge", id, label, pattern);
for (const [id, label, pattern] of [
  ["python", "Python", /\bPython\b/iu], ["sql", "SQL", /\bSQL\b|结构化查询语言/iu],
  ["java", "Java", /\bJava\b/iu], ["cpp", "C/C++", /\bC\+\+|\bC\s*\/\s*C\+\+|C语言/iu],
  ["javascript", "JavaScript", /\bJavaScript\b|\bJS\b/iu], ["typescript", "TypeScript", /\bTypeScript\b/iu],
  ["go", "Go", /\bGolang\b|\bGo(?:语言|开发|\b)/iu], ["r", "R", /\bR语言|\bR\b(?=、|，|语言)/iu],
  ["excel", "Excel", /\bExcel\b/iu], ["powerpoint", "PowerPoint", /\bPowerPoint\b|\bPPT\b/iu],
  ["word", "Word", /\bWord\b/iu], ["wps", "WPS", /\bWPS\b/iu],
  ["figma", "Figma", /\bFigma\b/iu], ["axure", "Axure", /\bAxure\b/iu],
  ["photoshop", "Photoshop", /Photoshop|\bPS\b/iu], ["illustrator", "Illustrator", /Illustrator/iu],
  ["premiere", "Premiere", /Premiere/iu], ["jianying", "剪映", /剪映/u],
  ["pytorch", "PyTorch", /\bPyTorch\b/iu], ["tensorflow", "TensorFlow", /\bTensorFlow\b/iu],
  ["git", "Git", /\bGit\b/iu], ["linux", "Linux", /\bLinux\b/iu],
  ["docker", "Docker", /\bDocker\b/iu], ["kubernetes", "Kubernetes", /Kubernetes|\bK8s\b/iu],
  ["react", "React", /\bReact\b/iu], ["vue", "Vue", /\bVue\b/iu],
  ["mysql", "MySQL", /\bMySQL\b/iu], ["postgresql", "PostgreSQL", /PostgreSQL/iu],
  ["tableau", "Tableau", /Tableau/iu], ["powerbi", "Power BI", /Power\s*BI/iu],
  ["spss", "SPSS", /\bSPSS\b/iu], ["stata", "Stata", /\bStata\b/iu],
  ["matlab", "MATLAB", /\bMATLAB\b/iu], ["cad", "CAD", /\bCAD\b|AutoCAD/iu],
  ["sap", "SAP", /\bSAP\b/iu], ["erp", "ERP", /\bERP\b/iu],
  ["llm_assistants", "大模型辅助工具", /ChatGPT|Claude|通义千问|豆包|DeepSeek/iu],
] as const) add("tool", id, label, pattern);
for (const [id, label, pattern] of [
  ["prd", "产品需求文档（PRD）", /\bPRD\b|产品需求文档/iu],
  ["requirements_document", "需求文档", /(?<!产品)需求文档/u],
  ["prototype", "交互原型", /原型(?:图|稿)?/u], ["dashboard", "数据看板", /数据看板|数据仪表盘/u],
  ["analysis_report", "分析报告", /(?:分析|调研|研究)报告/u], ["experiment_report", "实验报告", /实验报告/u],
  ["paper", "论文", /(?:研究|学术|发表)论文|论文(?:撰写|发表|成果)/u],
  ["campaign_plan", "活动方案", /活动方案|活动策划案/u], ["test_report", "测试报告", /测试报告/u],
  ["financial_report", "财务报表", /财务报表/u], ["code", "代码与程序", /代码|源程序/u],
  ["design", "设计稿", /设计稿|视觉稿/u], ["contract", "合同文本", /合同(?:文本|草案)|起草合同/u],
  ["documentation", "技术文档", /技术文档|接口文档/u],
] as const) add("deliverable", id, label, pattern);
add("general", "communication", "沟通与表达", /沟通能力|表达能力|善于沟通|沟通表达|清晰表达/u);
add("general", "collaboration", "团队与跨部门协作", /团队(?:协作|合作)|跨(?:部门|团队)协作|协同合作/u);
add("general", "learning", "学习与探索", /学习能力|主动学习|持续学习/u);
add("general", "ownership", "责任心与细致程度", /责任心|认真细致|细心严谨|认真负责/u);
add("domain", "education", "教育与学习", /教育(?:行业|场景|业务|产品)|学习场景/u);
add("domain", "ecommerce", "电商业务", /电商(?:业务|平台|行业|场景)/u);
add("domain", "health", "医疗与健康", /医疗(?:行业|业务|场景)|医药行业/u);
add("domain", "finance", "金融业务", /金融(?:业务|行业|场景)|银行业务/u);
export const CONCEPT_DICTIONARY: readonly ConceptRule[] = rules;
export const CONCEPT_BY_KEY = new Map(rules.map((r) => [r.key, r]));
