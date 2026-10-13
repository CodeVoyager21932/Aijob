import { classifyJobReachability } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { classifyOfficialJobFamily } from "./job-family-classifier.js";

describe("ADR-0037 role and student scope corpus", () => {
  it.each([
    ["产品运营实习生", "operations", "product_operations"],
    ["AI产品经理", "product", "ai_product"],
    ["数据分析工程师", "data_ai", "data_analysis"],
    ["供应链质量工程师", "supply_chain_manufacturing", "supply_quality"],
    ["用户研究实习生", "research_consulting", "user_research"],
  ])("classifies mixed role %s without fabricating a conflict", (title, family, subrole) => {
    const result = classifyOfficialJobFamily({ title, sourceEvidenceRef: "synthetic:title" });
    expect(result.value).toMatchObject({ state: "known", value: family });
    expect(result.requiresManualReview).toBe(false);
    expect(result.interpretation.subrole).toBe(subrole);
    expect(result.interpretation.evidenceRefs).toEqual(["synthetic:title"]);
  });
  it.each([
    "硕士及以上学历",
    "博士在读优先",
    "本科及以上，不限985、211",
    "本科及以上，985院校优先",
    "本科或硕士",
    "本科，3年工作经验优先",
    "本科，无需3年工作经验",
    "本科，3年工作经验或优秀应届生",
    "本科，1-3年工作经验",
  ])("keeps student opportunity: %s", (requirements) => {
    expect(classifyJobReachability({ requirements })).toBe("reachable");
  });
  it.each(["需3年工作经验", "至少三年相关工作经验", "2至5年行业经验", "具备多年相关工作经验"])(
    "keeps explicit professional experience outside student scope: %s",
    (requirements) => {
      expect(classifyJobReachability({ requirements })).toBe("not_reachable_experience_required");
    },
  );
});
