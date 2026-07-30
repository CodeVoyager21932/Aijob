import type { JobFamily } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_DICTIONARY_VERSION,
  CAPABILITY_KEYS_BY_JOB_FAMILY,
  inferCapabilities,
  isSpecificToolTerm,
} from "./capabilities.js";

describe("versioned all-function capability dictionary", () => {
  it("keeps an explicit family index for every job family", () => {
    const families: JobFamily[] = [
      "product",
      "operations",
      "engineering",
      "data_ai",
      "design",
      "marketing",
      "sales_business",
      "finance",
      "people_admin_legal",
      "research_consulting",
      "supply_chain_manufacturing",
      "other",
    ];
    expect(CAPABILITY_DICTIONARY_VERSION).toBe("capability-ontology-v2");
    expect(Object.keys(CAPABILITY_KEYS_BY_JOB_FAMILY)).toEqual(families);
  });

  it.each([
    ["完成接口开发与单元测试", "software_engineering"],
    ["完成模型训练与离线评估", "model_development"],
    ["建立交互设计和设计规范", "user_experience_design"],
    ["参与品牌策划与整合营销", "brand_marketing"],
    ["负责客户开发与商机管理", "business_development"],
    ["编制财务报表并做成本分析", "financial_operations"],
    ["支持人才招聘和员工关系", "people_operations"],
    ["完成法律检索与合同审核", "legal_compliance"],
    ["通过专家访谈形成研究报告", "strategic_research"],
    ["负责供应商管理和库存管理", "supply_chain_operations"],
    ["推进工艺优化和质量分析", "manufacturing_quality"],
  ])("maps atomic evidence %s to %s", (statement, capability) => {
    expect(inferCapabilities(statement).map((match) => match.key)).toContain(capability);
  });

  it("does not infer capabilities from generic internship prose", () => {
    expect(inferCapabilities("协助团队完成实习期间安排")).toEqual([]);
  });

  it.each(["SQL", "Java", "Figma", "SAP"])("keeps named tool %s on the exact-term path", (tool) => {
    expect(isSpecificToolTerm(tool)).toBe(true);
  });
});
