import type { JobRequirement, RequirementSourceUnit } from "@aijob/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { requirementAssertionLabel } from "../requirements-view";
import { ApplicationHandoffLink } from "./ApplicationHandoffLink";
import { RequirementSourceUnits } from "./RequirementSourceUnits";

describe("job fact fidelity presentation", () => {
  it("keeps one whole clause with independently selectable hard and preferred assertions", () => {
    const text = "每周至少到岗3天，至少实习3个月，实习6个月优先";
    const sourceUnits: RequirementSourceUnit[] = [
      {
        id: "clause",
        text,
        origin: { kind: "private_jd_clause" },
        section: "requirements",
        sourceSpan: null,
        evidenceRefs: ["private"],
      },
      {
        id: "unclassified",
        text: "具备良好的自驱力",
        origin: { kind: "private_jd_clause" },
        section: "requirements",
        sourceSpan: null,
        evidenceRefs: ["private"],
      },
    ];
    const requirements: JobRequirement[] = [
      { id: "weekly", kind: "weekly_attendance", expectedValue: 3, necessity: "required" },
      { id: "minimum", kind: "duration", expectedValue: 3, necessity: "required" },
      { id: "preferred", kind: "duration", expectedValue: 6, necessity: "preferred" },
    ].map((item) => ({
      ...item,
      operator: "at_least",
      sourceText: text,
      sourceSpan: null,
      sourceUnitId: "clause",
      evidenceRefs: ["private"],
    })) as JobRequirement[];
    const html = renderToStaticMarkup(
      <RequirementSourceUnits
        data={{ sourceUnits, requirements }}
        renderAssertion={(requirement) => (
          <button type="button" data-id={requirement.id}>
            {requirementAssertionLabel(requirement)}
          </button>
        )}
      />,
    );
    expect(html.split(text)).toHaveLength(2);
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain("必须 · 至少3");
    expect(html).toContain("优先 · 至少6");
    expect(html).toContain("具备良好的自驱力");
    expect(html).toContain("尚无可可靠拆解的核对项");
  });

  it("labels a list as a lookup handoff and never invents a link for a missing target", () => {
    const exact = renderToStaticMarkup(
      <ApplicationHandoffLink
        handoff={{ kind: "exact", url: "https://official.example/jobs/1" }}
      />,
    );
    expect(exact).toContain("打开官方投递页面");
    const fallback = renderToStaticMarkup(
      <ApplicationHandoffLink
        handoff={{
          kind: "official_list_fallback",
          url: "https://official.example/jobs",
          locator: { title: "产品实习生", sourceJobId: "job-123" },
        }}
      />,
    );
    expect(fallback).toContain("前往官方列表查找岗位");
    expect(fallback).toContain("产品实习生");
    expect(fallback).toContain("job-123");
    expect(fallback).not.toContain("打开官方投递页面");
    const missing = renderToStaticMarkup(
      <ApplicationHandoffLink
        handoff={{ kind: "missing", reasonCode: "APPLICATION_LINK_MISSING" }}
      />,
    );
    expect(missing).not.toContain("href=");
    expect(missing).toContain("当前没有已核验");
  });
});
