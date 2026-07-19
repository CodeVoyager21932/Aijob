import type { ResumeEvidence } from "@aijob/contracts";
import type { ResumeAnalysisResultPayload } from "../api/product";

export function buildConfirmedEvidence(
  candidates: ResumeAnalysisResultPayload["candidateEvidence"],
  selectedIds: ReadonlySet<string>,
  analysisId: string,
): ResumeEvidence[] {
  return candidates
    .filter((item) => selectedIds.has(item.id))
    .map((item) => ({
      ...item,
      resumeAnalysisId: analysisId,
      confirmed: true as const,
    }));
}

export function profileConfirmationError(input: {
  resultAvailable: boolean;
  privacyConfirmed: boolean;
}): string | null {
  if (!input.resultAvailable) return "简历解析结果尚未准备好。";
  if (!input.privacyConfirmed) return "请确认去标识化内容后再保存。";
  return null;
}
