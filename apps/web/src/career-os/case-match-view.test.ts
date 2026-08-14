import type { MatchRunResult } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  caseMatchCatalogLabels,
  caseMatchStaleReasonLabels,
  shortVersionId,
  toCaseMatchAxes,
} from "./case-match-view";

const result: MatchRunResult = {
  eligibility: {
    status: "needs_information",
    reasons: [
      {
        code: "FACT_MISSING",
        requirementIds: ["requirement-1"],
        evidenceIds: [],
        explanation: "毕业年份尚未确认。",
      },
    ],
  },
  evidence: {
    status: "partial_evidence",
    reasons: [
      {
        code: "EVIDENCE_PARTIAL",
        requirementIds: ["requirement-2"],
        evidenceIds: ["evidence-1"],
        explanation: "已有项目证据，但缺少结果描述。",
      },
    ],
  },
  preference: { status: "not_set", reasons: [] },
  basisState: "partial",
  coverage: {
    eligibility: { required: 1, evaluated: 0, met: 0, conflicts: 0, unknown: 1 },
    evidence: { applicable: 1, supported: 0, partial: 1, missing: 0, unknown: 0 },
    preference: { configured: 0, compared: 0, conflicts: 0, unknown: 0 },
  },
  gaps: [],
  unknownRequirementIds: ["requirement-1"],
};

describe("Case match view", () => {
  it("keeps the three axes separate and preserves deterministic explanations", () => {
    expect(toCaseMatchAxes(result)).toEqual([
      expect.objectContaining({
        key: "eligibility",
        value: "需要补充信息",
        tone: "warning",
        explanations: ["毕业年份尚未确认。"],
      }),
      expect.objectContaining({
        key: "evidence",
        value: "部分证据待补充",
        tone: "warning",
      }),
      expect.objectContaining({
        key: "preference",
        value: "偏好尚未设置",
        tone: "muted",
      }),
    ]);
  });

  it("does not turn catalog or stale input state into a combined match judgement", () => {
    expect(caseMatchCatalogLabels.stale).toBe("目录已有新版本");
    expect(caseMatchStaleReasonLabels.profile_facts).toBe("求职事实已有新修订");
    expect(Object.values(caseMatchCatalogLabels).join(" ")).not.toMatch(/匹配良好|匹配度|总分/);
  });

  it("shortens immutable identifiers without changing their traceable ends", () => {
    expect(shortVersionId("12345678-abcd-efgh-ijkl-1234567890ab")).toBe("12345678…90ab");
    expect(shortVersionId("short-id")).toBe("short-id");
  });
});
