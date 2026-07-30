import type { JobFamily } from "@aijob/contracts";
import type { EvidenceField } from "./normalized-official-job.js";
import { known, unknown } from "./normalized-official-job.js";

const exactSourceLabels: Readonly<Record<string, JobFamily>> = {
  产品: "product",
  运营: "operations",
  技术: "engineering",
  研发: "engineering",
  工程技术: "engineering",
  数据与AI: "data_ai",
  数据: "data_ai",
  算法: "data_ai",
  设计: "design",
  市场: "marketing",
  市场营销: "marketing",
  销售: "sales_business",
  商务: "sales_business",
  财务: "finance",
  人力资源: "people_admin_legal",
  行政: "people_admin_legal",
  法务: "people_admin_legal",
  研究: "research_consulting",
  咨询: "research_consulting",
  供应链: "supply_chain_manufacturing",
  制造: "supply_chain_manufacturing",
  其他: "other",
};

const titleRules: ReadonlyArray<{ family: JobFamily; pattern: RegExp }> = [
  { family: "product", pattern: /产品(?!质|控)/i },
  { family: "operations", pattern: /运营|用户增长|内容审核/i },
  { family: "data_ai", pattern: /数据分析|数据科学|算法|机器学习|人工智能|大模型|\bAI\b/i },
  {
    family: "engineering",
    pattern: /开发|研发|工程师|测试|运维|前端|后端|客户端|基础架构|网络安全/i,
  },
  { family: "design", pattern: /设计|视觉|交互|用户体验|\bUX\b|\bUI\b/i },
  { family: "marketing", pattern: /市场|营销|品牌|公关|传播|广告|媒介/i },
  { family: "sales_business", pattern: /销售|商务|商业拓展|客户成功|渠道|\bBD\b/i },
  { family: "finance", pattern: /财务|会计|审计|税务|资金/i },
  { family: "people_admin_legal", pattern: /人力|招聘|行政|法务|合规|\bHR\b/i },
  { family: "research_consulting", pattern: /研究|咨询|战略|行业分析/i },
  {
    family: "supply_chain_manufacturing",
    pattern: /供应链|采购|制造|生产|工艺|物流|质量工程/i,
  },
];

function normalizeLabel(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[\s/_-]+/g, "");
}

export function classifyOfficialJobFamily(input: {
  title: string;
  sourceLabels?: string[];
  sourceEvidenceRef: string;
  titleEvidenceRef?: string;
}): { value: EvidenceField<JobFamily>; requiresManualReview: boolean } {
  const sourceFamilies = new Set(
    (input.sourceLabels ?? [])
      .map((label) => exactSourceLabels[normalizeLabel(label)])
      .filter((family): family is JobFamily => Boolean(family)),
  );
  const titleFamilies = new Set(
    titleRules.filter((rule) => rule.pattern.test(input.title)).map((rule) => rule.family),
  );
  const combinedFamilies = new Set([...sourceFamilies, ...titleFamilies]);
  const sourceEvidenceRefs = [...sourceFamilies].map(() => input.sourceEvidenceRef);
  const titleEvidenceRefs = [...titleFamilies].map(
    () => input.titleEvidenceRef ?? input.sourceEvidenceRef,
  );

  if (combinedFamilies.size > 1) {
    return {
      value: {
        state: "conflict",
        rawValues: [...combinedFamilies],
        evidenceRefs: [...sourceEvidenceRefs, ...titleEvidenceRefs],
      },
      requiresManualReview: true,
    };
  }
  const [family] = combinedFamilies;
  if (!family) {
    return { value: unknown("needs_manual_review"), requiresManualReview: true };
  }
  const evidenceRefs = [...new Set([...sourceEvidenceRefs, ...titleEvidenceRefs])];
  return {
    value: known(family, evidenceRefs),
    requiresManualReview: sourceFamilies.size === 0,
  };
}
