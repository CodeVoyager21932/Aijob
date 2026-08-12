import type { QueryClient } from "@tanstack/react-query";

export function removeConfirmedResumeAnalysisCache(
  queryClient: QueryClient,
  analysisId: string,
): void {
  queryClient.removeQueries({
    queryKey: ["product", "resume-analysis", analysisId],
    exact: true,
  });
}

export function clearDeletedOwnerCache(queryClient: QueryClient): void {
  queryClient.clear();
}

export function clearSessionBoundaryCache(queryClient: QueryClient): void {
  queryClient.getQueryCache().clear();
}
