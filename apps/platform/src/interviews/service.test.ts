import { JobRequirementSchema } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { buildTemplateInterviewQuestions } from "./service.js";

function requirement(input: {
  id: string;
  kind: "skill" | "experience" | "other";
  operator: "contains" | "unknown";
  sourceText: string;
}) {
  return JobRequirementSchema.parse({
    ...input,
    expectedValue: null,
    evidenceRefs: [`fixture#${input.id}`],
    necessity: input.operator === "unknown" ? "unknown" : "required",
  });
}

describe("deterministic interview template", () => {
  it("uses only persisted, explicit fixed requirements in stable order", () => {
    const questions = buildTemplateInterviewQuestions({
      requirements: [
        requirement({
          id: "sql",
          kind: "skill",
          operator: "contains",
          sourceText: "掌握 SQL",
        }),
        requirement({
          id: "project",
          kind: "experience",
          operator: "contains",
          sourceText: "有完整项目经历",
        }),
        requirement({
          id: "unknown",
          kind: "other",
          operator: "unknown",
          sourceText: "有良好的自驱力",
        }),
      ],
      persistedRequirementIds: new Set(["sql", "project", "unknown"]),
    });

    expect(questions.map(({ requirementIds }) => requirementIds)).toEqual([
      ["sql"],
      ["project"],
      [],
    ]);
    expect(questions[0]?.content).toContain("掌握 SQL");
    expect(questions.at(-1)?.content).toContain("真实经历");
  });

  it("falls back to one general question without inventing user facts", () => {
    const questions = buildTemplateInterviewQuestions({
      requirements: [
        requirement({
          id: "sql",
          kind: "skill",
          operator: "contains",
          sourceText: "掌握 SQL",
        }),
      ],
      persistedRequirementIds: new Set(),
    });
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ requirementIds: [] });
    expect(questions[0]?.content).toContain("如果暂无合适经历，请直接说明");
  });

  it("bounds an unusually long JD line without changing the stored requirement", () => {
    const sourceText = `掌握 SQL ${"与数据分析".repeat(2_000)}`;
    const questions = buildTemplateInterviewQuestions({
      requirements: [
        requirement({ id: "long", kind: "skill", operator: "contains", sourceText }),
      ],
      persistedRequirementIds: new Set(["long"]),
    });
    expect(questions[0]?.content.length).toBeLessThan(20_000);
    expect(questions[0]?.content).toContain("完整内容仍保留在要求页");
    expect(sourceText.length).toBeGreaterThan(6_000);
  });
});
