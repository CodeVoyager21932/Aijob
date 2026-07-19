const keys = {
  analysisId: "aijob:last-analysis-id",
  recommendationRunId: "aijob:last-recommendation-run-id",
  tailoringRunId: "aijob:last-tailoring-run-id",
  exportId: "aijob:last-export-id",
} as const;

export type LocalJourneyKey = keyof typeof keys;

export function scopedJourneyId(
  expectedScopeId: string,
  storedScopeId: string | null,
  storedValueId: string | null,
): string | null {
  return storedScopeId === expectedScopeId ? storedValueId : null;
}

export function readJourneyId(key: LocalJourneyKey): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(keys[key]);
}

export function writeJourneyId(key: LocalJourneyKey, value: string | null): void {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(keys[key], value);
  else window.localStorage.removeItem(keys[key]);
}

export function clearJourneyState(): void {
  if (typeof window === "undefined") return;
  for (const key of Object.values(keys)) window.localStorage.removeItem(key);
}
