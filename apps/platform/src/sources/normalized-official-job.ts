import type { JobFamily } from "@aijob/contracts";

export type EvidenceField<T> =
  | { state: "known"; value: T; evidenceRefs: string[] }
  | {
      state: "unknown";
      reason: "source_not_stated" | "parse_failed" | "not_yet_verified";
    }
  | { state: "conflict"; rawValues: string[]; evidenceRefs: string[] };

export interface NormalizedOfficialJob {
  sourceJobId: string;
  companyName: string;
  title: string;
  jobFamily: EvidenceField<JobFamily>;
  locations: EvidenceField<string[]>;
  businessGroups: string[];
  entryScope: string;
  sourceProjectName: string | null;
  recruitLabelName: string | null;
  recruitmentType: EvidenceField<string>;
  responsibilities: string;
  requirements: string;
  structuredFields: {
    arrivalTime: EvidenceField<string>;
    weeklyAttendanceDays: EvidenceField<number>;
    durationMonths: EvidenceField<number>;
    graduationYears: EvidenceField<number[]>;
    recruitmentBatch: EvidenceField<string>;
    publishedAt: EvidenceField<string>;
    deadline: EvidenceField<string>;
  };
  ingestionState: "validated";
  publicationState: "review";
  activityState: "active";
  sourceUrl: string;
  applyUrl: string | null;
  qualityFlags: Array<{ code: string; detail: string }>;
  reviewReasons: Array<{ code: string; details: Record<string, unknown> }>;
  revisionContentHash: string;
  evidence: Array<{
    role: "list" | "detail";
    fieldName: string;
    jsonPointer: string;
    rawValueHash: string;
  }>;
}

export function known<T>(value: T, evidenceRefs: string[]): EvidenceField<T> {
  return { state: "known", value, evidenceRefs };
}

export function unknown<T>(
  reason: "source_not_stated" | "parse_failed" | "needs_manual_review" = "source_not_stated",
): EvidenceField<T> {
  return {
    state: "unknown",
    reason: reason === "needs_manual_review" ? "not_yet_verified" : reason,
  };
}

export function semanticRevisionValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(semanticRevisionValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "evidenceRefs")
        .map(([key, nestedValue]) => [key, semanticRevisionValue(nestedValue)]),
    );
  }
  return value;
}
