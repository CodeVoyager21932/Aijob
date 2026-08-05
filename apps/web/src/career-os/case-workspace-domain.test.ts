import { describe, expect, it } from "vitest";
import { careerCases } from "./domain";
import { getCareerCaseWorkspace, requirementGroups } from "./case-workspace-domain";

describe("Career OS Phase 1B static workspace contract", () => {
  it("provides all three requirement groups for every static case", () => {
    for (const careerCase of careerCases) {
      const workspace = getCareerCaseWorkspace(careerCase.id);
      expect(new Set(workspace.requirements.map((item) => item.group))).toEqual(
        new Set(requirementGroups.map((group) => group.value)),
      );
      expect(workspace.requirements.every((item) => item.sourceText.length > 0)).toBe(true);
      expect(workspace.requirements.every((item) => item.sourceLabel.length > 0)).toBe(true);
    }
  });

  it("keeps resume block ids stable and unique inside each case", () => {
    for (const careerCase of careerCases) {
      const blocks = getCareerCaseWorkspace(careerCase.id).resume.sections.flatMap(
        (section) => section.blocks,
      );
      expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
      expect(blocks.every((block) => block.sectionId.length > 0)).toBe(true);
    }
  });

  it("does not introduce matching grades or claim to use real data", () => {
    const serialized = JSON.stringify(careerCases.map((item) => getCareerCaseWorkspace(item.id)));
    expect(serialized).not.toMatch(/匹配(度|良好|中|差)|适合度/);
    expect(serialized).toContain("静态");
  });
});
