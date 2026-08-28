import type {
  ConfirmResumeProfileRequest,
  ConfirmResumeProfileResponse,
  CreateJobInsightRunRequest,
  CreateMatchRunRequest,
  CreateRecommendationRunFromSearchRequest,
  CreateRecommendationRunRequest,
  CreateResumeTailoringRequest,
  CurrentProfileEvidence,
  CurrentProfileFacts,
  CurrentProfilePreferences,
  CurrentResumeDocument,
  JobDecision,
  JobDetail,
  JobInsightRun,
  JobPreferenceRevision,
  JobRecommendationRunView,
  JobSearchResponse,
  LegacyResumeAnalysisResult,
  MatchRun,
  ProfileDeletion,
  ProfileFactRevision,
  PutJobDecisionRequest,
  PutJobPreferencesRequest,
  PutProfileFactsRequest,
  PutResumeEvidenceRequest,
  PutSavedResumeEvidenceSelectionRequest,
  PutTailoringSegmentRequest,
  RecommendationRun,
  ResumeAnalysisResult,
  ResumeAnalysisView,
  ResumeEvidenceRevision,
  ResumeExport,
  ResumeTailoringRun,
} from "@aijob/contracts";
import {
  ConfirmResumeProfileResponseSchema,
  CurrentProfileEvidenceSchema,
  CurrentProfileFactsSchema,
  CurrentProfilePreferencesSchema,
  CurrentResumeDocumentSchema,
  JobDecisionSchema,
  JobDetailSchema,
  JobInsightRunSchema,
  JobPreferenceRevisionSchema,
  JobRecommendationRunViewSchema,
  JobSearchResponseSchema,
  MAX_RECOMMENDATION_CANDIDATES,
  MatchRunSchema,
  ProfileDeletionSchema,
  ProfileFactRevisionSchema,
  RecommendationRunSchema,
  ResumeAnalysisViewSchema,
  ResumeEvidenceRevisionSchema,
  ResumeExportSchema,
  ResumeTailoringRunSchema,
  ResumeTailoringSegmentSchema,
} from "@aijob/contracts";
import { apiRequest, createIdempotencyKey } from "./client";

export type ResumeAnalysisResultPayload = ResumeAnalysisResult;
export type LegacyResumeAnalysisResultPayload = LegacyResumeAnalysisResult;

function appendList(params: URLSearchParams, key: string, values: string[]) {
  if (values.length > 0) params.set(key, values.join(","));
}

export interface JobFilters {
  keyword: string;
  companies: string[];
  cities: string[];
  jobFamilies: string[];
  recruitmentBatches: string[];
  availableWeeklyAttendanceDays: string;
  availableDurationMonths: string;
  latestStartDate: string;
  graduationYears: string[];
  educationLevels: string[];
  majors: string[];
  minimumSalary: string;
  salaryPeriods: string[];
  workModes: string[];
  sources: string[];
  sourceTypes: string[];
  freshness: string;
  includeUnknownHardConditions: boolean;
  cursor?: string | undefined;
}

export function jobSearchPath(filters: JobFilters): string {
  const params = new URLSearchParams();
  if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
  appendList(params, "companies", filters.companies);
  appendList(params, "cities", filters.cities);
  appendList(params, "jobFamilies", filters.jobFamilies);
  appendList(params, "recruitmentBatches", filters.recruitmentBatches);
  appendList(params, "graduationYears", filters.graduationYears);
  appendList(params, "educationLevels", filters.educationLevels);
  appendList(params, "majors", filters.majors);
  appendList(params, "salaryPeriods", filters.salaryPeriods);
  appendList(params, "workModes", filters.workModes);
  appendList(params, "sources", filters.sources);
  appendList(params, "sourceTypes", filters.sourceTypes);
  if (filters.availableWeeklyAttendanceDays) {
    params.set("availableWeeklyAttendanceDays", filters.availableWeeklyAttendanceDays);
  }
  if (filters.availableDurationMonths) {
    params.set("availableDurationMonths", filters.availableDurationMonths);
  }
  if (filters.latestStartDate) params.set("latestStartDate", filters.latestStartDate);
  if (filters.minimumSalary) params.set("minimumSalary", filters.minimumSalary);
  if (filters.freshness) params.set("freshness", filters.freshness);
  params.set("includeUnknownHardConditions", String(filters.includeUnknownHardConditions));
  params.set("limit", "100");
  if (filters.cursor) params.set("cursor", filters.cursor);
  return `/v1/jobs?${params.toString()}`;
}

export function getJobs(filters: JobFilters, signal?: AbortSignal) {
  return apiRequest<JobSearchResponse>(jobSearchPath(filters), {
    signal,
    responseSchema: JobSearchResponseSchema,
  });
}

export async function collectRecommendationCandidateJobs(
  loadPage: (cursor: string | undefined) => Promise<JobSearchResponse>,
) {
  const items: JobSearchResponse["items"] = [];
  const seenJobIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const page = await loadPage(cursor);
    for (const item of page.items) {
      if (seenJobIds.has(item.id)) {
        throw new Error("岗位目录分页返回了重复岗位，已停止生成不完整推荐。");
      }
      seenJobIds.add(item.id);
      items.push(item);
      if (items.length > MAX_RECOMMENDATION_CANDIDATES) {
        throw new Error(
          `当前可信岗位超过 ${MAX_RECOMMENDATION_CANDIDATES} 条推荐容量，请先完成容量升级。`,
        );
      }
    }

    if (!page.nextCursor) return items;
    if (items.length >= MAX_RECOMMENDATION_CANDIDATES) {
      throw new Error(
        `当前可信岗位超过 ${MAX_RECOMMENDATION_CANDIDATES} 条推荐容量，请先完成容量升级。`,
      );
    }
    if (page.items.length === 0 || seenCursors.has(page.nextCursor)) {
      throw new Error("岗位目录分页游标没有前进，已停止生成不完整推荐。");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

export function getRecommendationCandidateJobs(filters: JobFilters, signal?: AbortSignal) {
  const { cursor: _ignoredCursor, ...baseFilters } = filters;
  return collectRecommendationCandidateJobs((cursor) =>
    getJobs({ ...baseFilters, ...(cursor ? { cursor } : {}) }, signal),
  );
}

export function recommendationCandidateVersionIds(items: JobSearchResponse["items"]): string[] {
  const ids = items.map((item) => item.publishedJobVersionId);
  if (ids.some((id) => id === null)) {
    throw new Error("当前岗位目录含有未物化版本，不能生成可复现推荐。");
  }
  const versionIds = ids as string[];
  if (new Set(versionIds).size !== versionIds.length) {
    throw new Error("当前岗位目录含有重复岗位版本，不能生成可复现推荐。");
  }
  return versionIds;
}

export function getJob(jobId: string, signal?: AbortSignal) {
  return apiRequest<JobDetail>(`/v1/jobs/${encodeURIComponent(jobId)}`, {
    signal,
    responseSchema: JobDetailSchema,
  });
}

export function createJobInsightRun(body: CreateJobInsightRunRequest) {
  return apiRequest<JobInsightRun>("/v1/job-insight-runs", {
    method: "POST",
    body,
    idempotencyKey: createIdempotencyKey("job-insight"),
    responseSchema: JobInsightRunSchema,
  });
}

export function getJobInsightRun(id: string, signal?: AbortSignal) {
  return apiRequest<JobInsightRun>(`/v1/job-insight-runs/${encodeURIComponent(id)}`, {
    signal,
    responseSchema: JobInsightRunSchema,
  });
}

export function submitResumeText(text: string) {
  return apiRequest<ResumeAnalysisView>("/v1/resume-analyses", {
    method: "POST",
    body: { inputKind: "pasted_text", text },
    idempotencyKey: createIdempotencyKey("resume-text"),
    responseSchema: ResumeAnalysisViewSchema,
  });
}

export function submitResumeFile(file: File) {
  const body = new FormData();
  body.append("file", file);
  return apiRequest<ResumeAnalysisView>("/v1/resume-analyses", {
    method: "POST",
    body,
    idempotencyKey: createIdempotencyKey("resume-file"),
    responseSchema: ResumeAnalysisViewSchema,
  });
}

export function getResumeAnalysis(id: string, signal?: AbortSignal) {
  return apiRequest<ResumeAnalysisView>(`/v1/resume-analyses/${encodeURIComponent(id)}`, {
    signal,
    responseSchema: ResumeAnalysisViewSchema,
  });
}

export function getProfileFacts(signal?: AbortSignal) {
  return apiRequest<CurrentProfileFacts>("/v1/profile/facts", {
    signal,
    responseSchema: CurrentProfileFactsSchema,
  });
}

export function putProfileFacts(body: PutProfileFactsRequest) {
  return apiRequest<ProfileFactRevision>("/v1/profile/facts", {
    method: "PUT",
    body,
    responseSchema: ProfileFactRevisionSchema,
  });
}

export function getProfilePreferences(signal?: AbortSignal) {
  return apiRequest<CurrentProfilePreferences>("/v1/profile/preferences", {
    signal,
    responseSchema: CurrentProfilePreferencesSchema,
  });
}

export function putProfilePreferences(body: PutJobPreferencesRequest) {
  return apiRequest<JobPreferenceRevision>("/v1/profile/preferences", {
    method: "PUT",
    body,
    responseSchema: JobPreferenceRevisionSchema,
  });
}

export function getProfileEvidence(signal?: AbortSignal) {
  return apiRequest<CurrentProfileEvidence>("/v1/profile/evidence", {
    signal,
    responseSchema: CurrentProfileEvidenceSchema,
  });
}

export function putProfileEvidence(body: PutResumeEvidenceRequest) {
  return apiRequest<ResumeEvidenceRevision>("/v1/profile/evidence", {
    method: "PUT",
    body,
    responseSchema: ResumeEvidenceRevisionSchema,
  });
}

export function confirmResumeProfile(body: ConfirmResumeProfileRequest) {
  return apiRequest<ConfirmResumeProfileResponse>("/v1/profile/confirmation", {
    method: "PUT",
    body,
    responseSchema: ConfirmResumeProfileResponseSchema,
  });
}

export function getProfileDocument(signal?: AbortSignal) {
  return apiRequest<CurrentResumeDocument>("/v1/profile/document", {
    signal,
    responseSchema: CurrentResumeDocumentSchema,
  });
}

export function putSavedResumeEvidenceSelection(body: PutSavedResumeEvidenceSelectionRequest) {
  return apiRequest<ResumeEvidenceRevision>("/v1/profile/evidence-selection", {
    method: "PUT",
    body,
    responseSchema: ResumeEvidenceRevisionSchema,
  });
}

export function createMatchRun(body: CreateMatchRunRequest) {
  return apiRequest<MatchRun>("/v1/match-runs", {
    method: "POST",
    body,
    idempotencyKey: createIdempotencyKey("match"),
    responseSchema: MatchRunSchema,
  });
}

export function getMatchRun(id: string, signal?: AbortSignal) {
  return apiRequest<MatchRun>(`/v1/match-runs/${encodeURIComponent(id)}`, {
    signal,
    responseSchema: MatchRunSchema,
  });
}

export function createRecommendationRun(body: CreateRecommendationRunRequest) {
  return apiRequest<RecommendationRun>("/v1/recommendation-runs", {
    method: "POST",
    body,
    idempotencyKey: createIdempotencyKey("recommendation"),
    responseSchema: RecommendationRunSchema,
  });
}

export function getRecommendationRun(id: string, signal?: AbortSignal) {
  return apiRequest<RecommendationRun>(`/v1/recommendation-runs/${encodeURIComponent(id)}`, {
    signal,
    responseSchema: RecommendationRunSchema,
  });
}

export function createRecommendationRunFromSearch(
  body: CreateRecommendationRunFromSearchRequest,
  idempotencyKey: string,
) {
  return apiRequest<JobRecommendationRunView>("/v1/recommendation-runs/from-search", {
    method: "POST",
    body,
    idempotencyKey,
    responseSchema: JobRecommendationRunViewSchema,
  });
}

export function getRecommendationRunView(id: string, signal?: AbortSignal) {
  return apiRequest<JobRecommendationRunView>(
    `/v1/recommendation-runs/${encodeURIComponent(id)}/view`,
    { signal, responseSchema: JobRecommendationRunViewSchema },
  );
}

export function getJobDecisions(signal?: AbortSignal) {
  return apiRequest<JobDecision[]>("/v1/job-decisions", {
    signal,
    responseSchema: JobDecisionSchema.array(),
  });
}

export function putJobDecision(jobId: string, body: PutJobDecisionRequest) {
  return apiRequest<JobDecision>(`/v1/job-decisions/${encodeURIComponent(jobId)}`, {
    method: "PUT",
    body,
    responseSchema: JobDecisionSchema,
  });
}

export function markOfficialLinkOpened(jobId: string) {
  return apiRequest<void>(`/v1/job-decisions/${encodeURIComponent(jobId)}/official-link-opened`, {
    method: "POST",
  });
}

export function createResumeTailoring(body: CreateResumeTailoringRequest) {
  return apiRequest<ResumeTailoringRun>("/v1/resume-tailorings", {
    method: "POST",
    body,
    idempotencyKey: createIdempotencyKey("tailoring"),
    responseSchema: ResumeTailoringRunSchema,
  });
}

export function getResumeTailoring(id: string, signal?: AbortSignal) {
  return apiRequest<ResumeTailoringRun>(`/v1/resume-tailorings/${encodeURIComponent(id)}`, {
    signal,
    responseSchema: ResumeTailoringRunSchema,
  });
}

export function putTailoringSegment(
  runId: string,
  segmentId: string,
  body: PutTailoringSegmentRequest,
) {
  return apiRequest<ResumeTailoringRun["segments"][number]>(
    `/v1/resume-tailorings/${encodeURIComponent(runId)}/segments/${encodeURIComponent(segmentId)}`,
    { method: "PUT", body, responseSchema: ResumeTailoringSegmentSchema },
  );
}

export function createResumeExport(runId: string) {
  return apiRequest<ResumeExport>(`/v1/resume-tailorings/${encodeURIComponent(runId)}/exports`, {
    method: "POST",
    idempotencyKey: createIdempotencyKey("resume-export"),
    responseSchema: ResumeExportSchema,
  });
}

export function getResumeExport(id: string, signal?: AbortSignal) {
  return apiRequest<ResumeExport>(`/v1/resume-exports/${encodeURIComponent(id)}`, {
    signal,
    responseSchema: ResumeExportSchema,
  });
}

export function deleteProfile() {
  return apiRequest<ProfileDeletion>("/v1/profile", {
    method: "DELETE",
    responseSchema: ProfileDeletionSchema,
  });
}

export function getProfileDeletion(signal?: AbortSignal) {
  return apiRequest<ProfileDeletion>("/v1/profile/deletion", {
    signal,
    responseSchema: ProfileDeletionSchema,
    skipSessionBootstrap: true,
  });
}
