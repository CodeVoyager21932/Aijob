import { describe, it, expect } from "vitest";
import { AssistedSemanticsSchema, validateAssistedSemantics } from "./semantic-enrichment.js";
const source = {
  jobVersionId: "fixture",
  title: "数据分析实习生",
  requirements: "SQL 优先；无需 Python 经验",
  responsibilities: "制作数据报告",
};
const base = AssistedSemanticsSchema.parse({
  primaryFamily: "data_ai",
  families: ["data_ai"],
  subrole: "data_analysis",
  domains: [],
  roleQuote: { section: "title", text: source.title },
  atoms: [
    {
      key: "tool:sql",
      label: "SQL",
      kind: "tool",
      necessity: "preferred",
      negated: false,
      condition: null,
      sourceText: "SQL 优先",
      section: "requirements",
      sourceSpan: { start: 0, end: 6 },
    },
  ],
});
describe("evidence-bound assisted semantics", () => {
  it("accepts exact original spans with separate preference", () =>
    expect(() => validateAssistedSemantics(source, base)).not.toThrow());
  it("rejects missing source quotes and invented hard qualifications", () => {
    expect(() => validateAssistedSemantics(source, { ...base, roleQuote: null })).toThrow(
      "AI_ROLE_EVIDENCE_MISSING",
    );
    const atom = base.atoms[0]!;
    expect(() =>
      validateAssistedSemantics(source, {
        ...base,
        atoms: [{ ...atom, sourceText: "熟练掌握 SQL" }],
      }),
    ).toThrow("AI_QUOTE_NOT_IN_SOURCE");
    expect(() =>
      validateAssistedSemantics(source, { ...base, atoms: [{ ...atom, necessity: "required" }] }),
    ).toThrow("AI_UNSUPPORTED_HARD_REQUIREMENT");
    expect(() =>
      validateAssistedSemantics(source, { ...base, atoms: [{ ...atom, kind: "education" }] }),
    ).toThrow("AI_CANNOT_REWRITE_QUALIFICATIONS");
  });
  it("never turns a responsibility into a hard requirement", () => {
    expect(() =>
      validateAssistedSemantics(source, {
        ...base,
        atoms: [
          {
            ...base.atoms[0]!,
            key: "deliverable:report",
            kind: "deliverable",
            sourceText: source.responsibilities,
            sourceSpan: { start: 0, end: source.responsibilities.length },
            section: "responsibilities",
            necessity: "required",
          },
        ],
      }),
    ).toThrow("AI_RESPONSIBILITY_AS_QUALIFICATION");
  });
});
