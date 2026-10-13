import { describe, expect, it } from "vitest";
import { decomposeTextualJobRequirements } from "./requirements.js";

function read(sourceText: string) {
  return decomposeTextualJobRequirements({
    publishedJobVersionId: "fixture-student-v2",
    sourceText,
    evidenceRefPrefix: "official",
  });
}
describe("student qualification semantics", () => {
  it.each(["不要求硕士学历", "博士不是必须", "无需硕士学历"])(
    "preserves negation without inventing a qualification: %s",
    (text) => {
      const result = read(text);
      expect(result.sourceUnits[0]?.text).toBe(text);
      expect(result.requirements.filter((item) => item.kind === "education")).toEqual([]);
    },
  );
  it("keeps minimum education separate from a preferred higher degree", () => {
    const result = read("本科及以上学历，硕士优先");
    expect(result.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "education",
          expectedValue: ["本科", "硕士", "博士"],
          necessity: "required",
        }),
        expect.objectContaining({
          kind: "education",
          expectedValue: ["硕士"],
          necessity: "preferred",
        }),
      ]),
    );
  });
  it("represents same-kind alternatives as one_of", () => {
    expect(read("硕士或博士学历").requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "education",
          expectedValue: ["硕士", "博士"],
          operator: "one_of",
        }),
      ]),
    );
  });
  it("does not turn cross-kind alternatives into a conjunction", () => {
    const result = read("本科学历或具备3年相关工作经验");
    expect(result.requirements.length).toBeGreaterThan(0);
    expect(
      result.requirements.every(
        (item) => item.necessity === "unknown" && item.operator === "unknown",
      ),
    ).toBe(true);
  });
  it.each(["不要求985院校，本科及以上学历", "985院校优先，本科及以上学历"])(
    "keeps school commentary separate: %s",
    (text) => {
      expect(read(text).requirements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "education",
            necessity: "required",
            expectedValue: ["本科", "硕士", "博士"],
          }),
        ]),
      );
    },
  );
});
