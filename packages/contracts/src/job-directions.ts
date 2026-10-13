import type { JobFamily } from "./enums.js";

export const JOB_DIRECTION_VERSION = "job-directions-v3";
export type JobDirection = { id: string; family: JobFamily; label: string; titlePattern: string };
/** Ordered most-specific first; shared labels keep filters and classification aligned. */
export const JOB_DIRECTIONS: readonly JobDirection[] = [
  { id: "ai_product", family: "product", label: "AI 产品", titlePattern: "(?:AI|人工智能|大模型).*产品|产品.*(?:AI|大模型)" },
  { id: "product_operations", family: "operations", label: "产品运营", titlePattern: "产品运营" },
  { id: "content_operations", family: "operations", label: "内容与新媒体运营", titlePattern: "内容.*运营|新媒体|编辑|文案" },
  { id: "user_operations", family: "operations", label: "用户与社区运营", titlePattern: "用户运营|社群|社区.*运营" },
  { id: "business_operations", family: "operations", label: "业务与平台运营", titlePattern: "商业化运营|平台运营|电商运营|商家运营|运营" },
  { id: "product_management", family: "product", label: "产品策划与管理", titlePattern: "产品经理|产品助理|产品策划|产品实习" },
  { id: "data_analysis", family: "data_ai", label: "数据分析", titlePattern: "数据分析|商业分析|数据科学" },
  { id: "algorithm_research", family: "data_ai", label: "算法与机器学习", titlePattern: "算法|机器学习|深度学习|大模型|人工智能" },
  { id: "frontend", family: "engineering", label: "前端开发", titlePattern: "前端|Web开发" },
  { id: "backend", family: "engineering", label: "后端开发", titlePattern: "后端|服务端|Java开发|Go开发|Python开发" },
  { id: "client", family: "engineering", label: "客户端开发", titlePattern: "客户端|Android|iOS|移动端" },
  { id: "software_test", family: "engineering", label: "测试与质量", titlePattern: "软件测试|测试开发|测试工程|质量保障" },
  { id: "infrastructure", family: "engineering", label: "基础架构与安全", titlePattern: "运维|基础架构|网络安全|信息安全|云计算" },
  { id: "hardware", family: "engineering", label: "硬件与嵌入式", titlePattern: "嵌入式|硬件|电路|芯片|电子工程" },
  { id: "software_development", family: "engineering", label: "软件研发", titlePattern: "软件|开发|研发工程" },
  { id: "ux_design", family: "design", label: "交互与体验设计", titlePattern: "交互|用户体验|UX|UI" },
  { id: "visual_design", family: "design", label: "视觉与创意设计", titlePattern: "视觉|平面|动画|设计" },
  { id: "brand_marketing", family: "marketing", label: "品牌与市场营销", titlePattern: "品牌|市场|营销|公关|媒介|广告" },
  { id: "sales", family: "sales_business", label: "销售与客户服务", titlePattern: "销售|客户成功|客户服务|售前" },
  { id: "business_development", family: "sales_business", label: "商务拓展", titlePattern: "商务|商业拓展|渠道|\\bBD\\b" },
  { id: "accounting", family: "finance", label: "财务与会计", titlePattern: "财务|会计|资金" },
  { id: "audit_tax", family: "finance", label: "审计与税务", titlePattern: "审计|税务" },
  { id: "recruiting", family: "people_admin_legal", label: "人力与招聘", titlePattern: "人力|招聘|\\bHR\\b" },
  { id: "legal", family: "people_admin_legal", label: "法务与合规", titlePattern: "法务|合规|法律" },
  { id: "administration", family: "people_admin_legal", label: "行政支持", titlePattern: "行政|秘书|办公室" },
  { id: "user_research", family: "research_consulting", label: "用户研究", titlePattern: "用户研究|用户调研" },
  { id: "industry_research", family: "research_consulting", label: "行业研究与咨询", titlePattern: "行业研究|行业分析|咨询|战略" },
  { id: "scientific_research", family: "research_consulting", label: "科研与实验", titlePattern: "科研|研究助理|实验|研究员|研究实习" },
  { id: "supply_quality", family: "supply_chain_manufacturing", label: "质量与工艺", titlePattern: "质量工程|工艺|品质" },
  { id: "supply_chain", family: "supply_chain_manufacturing", label: "供应链与采购", titlePattern: "供应链|采购|物流|仓储" },
  { id: "manufacturing", family: "supply_chain_manufacturing", label: "生产与制造", titlePattern: "生产|制造" },
];
export const JOB_FAMILY_NAMES: Record<JobFamily, string> = {
  product: "产品", operations: "运营", engineering: "工程技术", data_ai: "数据与 AI",
  design: "设计", marketing: "市场营销", sales_business: "销售与商务", finance: "财务",
  people_admin_legal: "人力、行政与法务", research_consulting: "研究与咨询",
  supply_chain_manufacturing: "供应链与制造", other: "其他",
};
