import type { JobFamily } from "@aijob/contracts";

export const CAPABILITY_DICTIONARY_VERSION = "capability-ontology-v2";

const CAPABILITY_DEFINITIONS = {
  data_analysis: {
    label: "数据分析",
    cues: [
      "数据分析",
      "数据洞察",
      "指标分析",
      "指标体系",
      "数据看板",
      "数据监控",
      "漏斗分析",
      "埋点",
      "转化率",
      "留存率",
      "报表",
      "sql",
      "tableau",
      "power bi",
      "excel",
      "python",
    ],
  },
  user_research: {
    label: "用户研究",
    cues: [
      "用户研究",
      "用户调研",
      "用户访谈",
      "深度访谈",
      "需求访谈",
      "用户反馈",
      "问卷",
      "可用性测试",
    ],
  },
  market_research: {
    label: "市场与竞品研究",
    cues: ["竞品分析", "行业研究", "行业分析", "市场调研", "市场分析", "商业分析", "行业对标"],
  },
  product_planning: {
    label: "产品策划",
    cues: [
      "需求分析",
      "需求梳理",
      "产品需求",
      "产品设计",
      "产品方案",
      "产品原型",
      "原型设计",
      "功能设计",
      "产品迭代",
      "需求文档",
      "prd",
      "axure",
      "figma",
    ],
  },
  project_delivery: {
    label: "项目推进",
    cues: [
      "项目推进",
      "项目管理",
      "推动落地",
      "推进落地",
      "协调上线",
      "上线交付",
      "排期",
      "里程碑",
      "跨部门推进",
      "推进项目",
    ],
  },
  communication_collaboration: {
    label: "沟通协作",
    cues: [
      "跨部门沟通",
      "跨团队协作",
      "团队合作",
      "沟通协调",
      "沟通能力",
      "协作能力",
      "协同",
      "对接",
      "访谈",
      "汇报",
      "宣讲",
    ],
  },
  operations_growth: {
    label: "运营与增长",
    cues: [
      "用户运营",
      "活动运营",
      "内容运营",
      "产品运营",
      "社群运营",
      "增长运营",
      "用户增长",
      "活动策划",
      "拉新",
      "留存",
      "转化",
      "复购",
    ],
  },
  content_creation: {
    label: "内容策划",
    cues: ["内容策划", "内容创作", "文案", "新媒体", "公众号", "短视频", "脚本", "选题"],
  },
  ai_application: {
    label: "AI 应用",
    cues: [
      "人工智能",
      "大模型",
      "生成式ai",
      "ai技术",
      "ai 技术",
      "ai应用",
      "智能体",
      "智能推荐",
      "自然语言处理",
      "机器学习",
      "llm",
      "agent",
      "prompt",
    ],
  },
  software_engineering: {
    label: "软件工程",
    cues: [
      "软件开发",
      "系统开发",
      "前端开发",
      "后端开发",
      "客户端开发",
      "接口开发",
      "代码评审",
      "单元测试",
      "自动化测试",
      "系统设计",
      "性能优化",
      "故障排查",
    ],
  },
  model_development: {
    label: "算法与模型开发",
    cues: [
      "模型训练",
      "模型评估",
      "特征工程",
      "算法优化",
      "实验设计",
      "离线评估",
      "自然语言处理",
      "计算机视觉",
      "推荐算法",
    ],
  },
  user_experience_design: {
    label: "用户体验设计",
    cues: [
      "交互设计",
      "视觉设计",
      "界面设计",
      "用户体验",
      "设计规范",
      "设计系统",
      "可用性测试",
      "信息架构",
    ],
  },
  brand_marketing: {
    label: "品牌与市场营销",
    cues: [
      "品牌策划",
      "整合营销",
      "营销策划",
      "市场推广",
      "媒介投放",
      "传播策略",
      "公关活动",
      "营销复盘",
    ],
  },
  business_development: {
    label: "销售与商务拓展",
    cues: [
      "商务拓展",
      "销售线索",
      "客户开发",
      "客户成功",
      "渠道拓展",
      "商机管理",
      "合同谈判",
      "销售转化",
    ],
  },
  financial_operations: {
    label: "财务分析与核算",
    cues: [
      "财务分析",
      "会计核算",
      "预算编制",
      "成本分析",
      "审计底稿",
      "税务申报",
      "资金管理",
      "财务报表",
    ],
  },
  people_operations: {
    label: "人力与组织支持",
    cues: [
      "招聘运营",
      "人才招聘",
      "员工关系",
      "培训运营",
      "组织发展",
      "人事流程",
      "行政支持",
      "会议组织",
    ],
  },
  legal_compliance: {
    label: "法务与合规",
    cues: ["法律检索", "合同审核", "合规审查", "法规研究", "案件管理", "知识产权", "风险排查"],
  },
  strategic_research: {
    label: "战略研究与咨询",
    cues: [
      "战略研究",
      "咨询项目",
      "专家访谈",
      "案头研究",
      "政策研究",
      "商业尽调",
      "研究报告",
      "战略规划",
    ],
  },
  supply_chain_operations: {
    label: "供应链运营",
    cues: ["供应链分析", "采购管理", "供应商管理", "库存管理", "需求预测", "物流规划", "订单履约"],
  },
  manufacturing_quality: {
    label: "制造与质量",
    cues: ["生产计划", "工艺优化", "质量管理", "质量分析", "产线改善", "精益生产", "设备维护"],
  },
} as const;

export type CapabilityKey = keyof typeof CAPABILITY_DEFINITIONS;

export interface CapabilityMatch {
  key: CapabilityKey;
  label: string;
  cues: string[];
}

export const CAPABILITY_KEYS_BY_JOB_FAMILY: Readonly<Record<JobFamily, readonly CapabilityKey[]>> =
  {
    product: [
      "user_research",
      "market_research",
      "product_planning",
      "project_delivery",
      "data_analysis",
      "communication_collaboration",
    ],
    operations: [
      "operations_growth",
      "content_creation",
      "data_analysis",
      "project_delivery",
      "communication_collaboration",
    ],
    engineering: ["software_engineering", "project_delivery", "communication_collaboration"],
    data_ai: ["data_analysis", "ai_application", "model_development", "software_engineering"],
    design: ["user_experience_design", "user_research", "communication_collaboration"],
    marketing: ["brand_marketing", "market_research", "content_creation", "data_analysis"],
    sales_business: ["business_development", "market_research", "communication_collaboration"],
    finance: ["financial_operations", "data_analysis"],
    people_admin_legal: ["people_operations", "legal_compliance", "communication_collaboration"],
    research_consulting: [
      "strategic_research",
      "market_research",
      "data_analysis",
      "communication_collaboration",
    ],
    supply_chain_manufacturing: [
      "supply_chain_operations",
      "manufacturing_quality",
      "data_analysis",
      "project_delivery",
    ],
    other: [],
  };

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
}

function containsCue(text: string, cue: string): boolean {
  if (!/[a-z]/i.test(cue)) return text.includes(cue);
  const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_])${escaped}($|[^a-z0-9_])`, "i").test(text);
}

export function inferCapabilities(value: string): CapabilityMatch[] {
  const text = normalize(value);
  return (
    Object.entries(CAPABILITY_DEFINITIONS) as Array<
      [CapabilityKey, (typeof CAPABILITY_DEFINITIONS)[CapabilityKey]]
    >
  ).flatMap(([key, definition]) => {
    const cues = definition.cues.filter((cue) => containsCue(text, normalize(cue)));
    return cues.length > 0 ? [{ key, label: definition.label, cues: [...cues] }] : [];
  });
}

const SPECIFIC_TOOL_TERMS = new Set([
  "sql",
  "excel",
  "python",
  "tableau",
  "power bi",
  "figma",
  "axure",
  "java",
  "javascript",
  "typescript",
  "react",
  "vue",
  "c++",
  "go",
  "matlab",
  "spss",
  "photoshop",
  "illustrator",
  "sketch",
  "cad",
  "solidworks",
  "sap",
]);

export function isSpecificToolTerm(term: string): boolean {
  return SPECIFIC_TOOL_TERMS.has(normalize(term));
}
