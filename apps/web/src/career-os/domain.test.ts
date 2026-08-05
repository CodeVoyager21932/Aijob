import { describe, expect, it } from "vitest";
import { careerCases, caseStages, caseTabs } from "./domain";

describe("Career OS static prototype contract", () => {
  it("uses the fixed five stages and six case tabs", () => {
    expect(caseStages.map((stage) => stage.value)).toEqual([
      "interested",
      "preparing",
      "applied",
      "interviewing",
      "resolved",
    ]);
    expect(caseTabs.map((tab) => tab.value)).toEqual([
      "overview",
      "requirements",
      "resume",
      "application",
      "interview",
      "debrief",
    ]);
  });

  it("uses only the three accepted evidence states", () => {
    const states = new Set(
      careerCases.flatMap((careerCase) => careerCase.evidence.map((item) => item.state)),
    );
    expect(states).toEqual(new Set(["confirmed", "needs_work", "unconfirmed"]));
  });

  it("keeps fixtures clearly fictional and avoids a combined match judgement", () => {
    for (const careerCase of careerCases) {
      expect(careerCase.companyName).toMatch(/^示例·/);
      expect(JSON.stringify(careerCase)).not.toMatch(/匹配(度|良好|中|差)/);
    }
  });
});
