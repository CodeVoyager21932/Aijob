import type { MatchRunResult } from "@aijob/contracts";

const ELIGIBILITY_ORDER: Record<MatchRunResult["eligibility"]["status"], number> = {
  no_explicit_conflict: 0,
  needs_information: 1,
  explicit_conflict: 2,
};

const PREFERENCE_ORDER: Record<MatchRunResult["preference"]["status"], number> = {
  fits: 0,
  not_set: 1,
  does_not_fit: 2,
};

const EVIDENCE_ORDER: Record<MatchRunResult["evidence"]["status"], number> = {
  explicit_evidence: 0,
  partial_evidence: 1,
  not_in_resume: 2,
  insufficient_information: 3,
};

export interface RankableRecommendation {
  publishedJobVersionId: string;
  result: MatchRunResult;
  lastVerifiedAt: Date;
}

export function compareRecommendations(
  left: RankableRecommendation,
  right: RankableRecommendation,
): number {
  const tupleComparisons = [
    ELIGIBILITY_ORDER[left.result.eligibility.status] -
      ELIGIBILITY_ORDER[right.result.eligibility.status],
    PREFERENCE_ORDER[left.result.preference.status] -
      PREFERENCE_ORDER[right.result.preference.status],
    EVIDENCE_ORDER[left.result.evidence.status] - EVIDENCE_ORDER[right.result.evidence.status],
    right.lastVerifiedAt.getTime() - left.lastVerifiedAt.getTime(),
  ];

  for (const comparison of tupleComparisons) {
    if (comparison !== 0) return comparison;
  }
  return left.publishedJobVersionId.localeCompare(right.publishedJobVersionId);
}

export function recommendationReasonCodes(result: MatchRunResult): string[] {
  const codes = new Set<string>();
  if (result.eligibility.status === "no_explicit_conflict") {
    codes.add("NO_EXPLICIT_ELIGIBILITY_CONFLICT");
  }
  if (result.preference.status === "fits") codes.add("PREFERENCES_FIT");
  if (result.evidence.status === "explicit_evidence") codes.add("EXPLICIT_RESUME_EVIDENCE");
  if (result.evidence.status === "partial_evidence") codes.add("PARTIAL_RESUME_EVIDENCE");
  for (const reason of [
    ...result.eligibility.reasons,
    ...result.evidence.reasons,
    ...result.preference.reasons,
  ]) {
    codes.add(reason.code);
  }
  return [...codes].sort();
}
