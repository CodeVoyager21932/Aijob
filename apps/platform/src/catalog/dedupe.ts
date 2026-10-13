import type { FieldValue } from "@aijob/contracts";

export interface DuplicateCandidateJob {
  id: string;
  sourceId: string;
  companyName: string;
  title: string;
  locations: FieldValue<string[]>;
  officialDomain?: string;
}

export interface SuspectedDuplicatePair {
  leftJobId: string;
  rightJobId: string;
  score: number;
  reasons: string[];
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function bigrams(value: string): Set<string> {
  const chars = [...normalized(value)];
  if (chars.length < 2) return new Set(chars);
  return new Set(chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const intersection = [...left].filter((value) => right.has(value)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function knownLocationOverlap(
  left: FieldValue<string[]>,
  right: FieldValue<string[]>,
): boolean | null {
  if (left.state !== "known" || right.state !== "known") return null;
  const rightLocations = new Set(right.value.map(normalized));
  return left.value.some((location) => rightLocations.has(normalized(location)));
}

/**
 * Produces a review queue only. It never merges or suppresses jobs.
 */
export function findCrossSourceDuplicateCandidates(
  jobs: DuplicateCandidateJob[],
): SuspectedDuplicatePair[] {
  const candidates: SuspectedDuplicatePair[] = [];

  // Compare only companies/domains that could match, and never within one source.
  const buckets = new Map<string, Map<string, number[]>>();
  jobs.forEach((job, index) => {
    const keys = [`company:${normalized(job.companyName)}`];
    if (job.officialDomain !== undefined) keys.push(`domain:${normalized(job.officialDomain)}`);
    for (const key of keys) {
      const sources = buckets.get(key) ?? new Map<string, number[]>();
      const indices = sources.get(job.sourceId) ?? [];
      indices.push(index);
      sources.set(job.sourceId, indices);
      buckets.set(key, sources);
    }
  });
  const pairs = new Set<string>();
  for (const sources of buckets.values()) {
    const groups = [...sources.values()];
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++)
        for (const left of groups[i] ?? [])
          for (const right of groups[j] ?? [])
            pairs.add(`${Math.min(left, right)}:${Math.max(left, right)}`);
  }
  const titles = jobs.map((job) => bigrams(job.title));
  for (const pair of pairs) {
    const [leftIndex, rightIndex] = pair.split(":").map(Number);
    const left = jobs[leftIndex ?? -1],
      right = jobs[rightIndex ?? -1];
    if (!left || !right) continue;
    const leftDomain = left.officialDomain;
    const rightDomain = right.officialDomain;
    const sameDomain =
      leftDomain !== undefined &&
      rightDomain !== undefined &&
      normalized(leftDomain) === normalized(rightDomain);
    const sameCompany = normalized(left.companyName) === normalized(right.companyName);
    if (!sameCompany && !sameDomain) continue;

    const titleSimilarity = jaccard(
      titles[leftIndex ?? -1] ?? new Set(),
      titles[rightIndex ?? -1] ?? new Set(),
    );
    if (titleSimilarity < 0.72) continue;

    const locationOverlap = knownLocationOverlap(left.locations, right.locations);
    if (locationOverlap === false) continue;

    const reasons = [
      sameDomain ? "same_official_domain" : "same_normalized_company",
      "similar_normalized_title",
      locationOverlap === true ? "overlapping_location" : "location_unknown",
    ];
    const score = Math.min(
      1,
      0.45 + titleSimilarity * 0.4 + (locationOverlap === true ? 0.15 : 0.05),
    );
    const leftJobId = left.id.localeCompare(right.id) <= 0 ? left.id : right.id;
    const rightJobId = left.id.localeCompare(right.id) <= 0 ? right.id : left.id;
    candidates.push({
      leftJobId,
      rightJobId,
      score: Number(score.toFixed(4)),
      reasons,
    });
  }

  return candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.leftJobId.localeCompare(right.leftJobId) ||
      left.rightJobId.localeCompare(right.rightJobId),
  );
}
