import type { ResearchJob } from "./types";

/**
 * Only coco or a designated human reviewer may add rows here, and only after the
 * corresponding official page has been checked and the manual sample record is
 * marked confirmed. The current collector candidates deliberately do not appear
 * in this research catalog.
 */
export const approvedResearchJobs: readonly ResearchJob[] = [];

export async function loadApprovedResearchJobs(signal?: AbortSignal): Promise<ResearchJob[]> {
  if (signal?.aborted) {
    throw new DOMException("The research catalog request was aborted", "AbortError");
  }
  return approvedResearchJobs.filter(
    (job) => job.activityState.state === "known" && job.activityState.value === "active",
  );
}

export async function findApprovedResearchJob(
  id: string,
  signal?: AbortSignal,
): Promise<ResearchJob | null> {
  const jobs = await loadApprovedResearchJobs(signal);
  return jobs.find((job) => job.id === id) ?? null;
}
