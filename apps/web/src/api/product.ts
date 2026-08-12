import type {
  ConfirmResumeProfileRequest,
  ConfirmResumeProfileResponse,
  CreateJobInsightRunRequest,
  CreateMatchRunRequest,
  CreateRecommendationRunRequest,
  CreateResumeTailoringRequest,
  CurrentResumeDocument,
  JobDecision,
  JobDetail,
  JobInsightRun,
  JobPreferenceRevision,
  JobSearchResponse,
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
  ResumeEvidenceRevision,
  ResumeExport,
  ResumeTailoringRun,
} from "@aijob/contracts";
import { MAX_RECOMMENDATION_CANDIDATES } from "@aijob/contracts";
import { apiRequest, createIdempotencyKey } from "./client";

export interface ResumeAnalysisResultPayload {
  version: "resume-analysis-v2";
  redactedText: string;
  document: {
    schemaVersion: "resume-document-v1";
    sections: Array<{
      id: string;
      ordinal: number;
      title: string;
      blocks: Array<{ id: string; ordinal: number; text: string }>;
    }>;
  };
  candidateFacts: Array<Record<string, unknown> & { key: string; confirmed: false }>;
  candidateEvidence: Array<{
    id: string;
    sourceBlockId: string;
    section: string;
    evidenceType:
      | "education"
      | "internship"
      | "project"
      | "campus"
      | "competition"
      | "volunteer"
      | "skill"
      | "certificate"
      | "other";
    statement: string;
    skills: string[];
    outcomes: string[];
    confirmed: false;
  }>;
}

export interface LegacyResumeAnalysisResultPayload {
  version: "resume-analysis-v1";
  redactedText: string;
  candidateFacts: Array<Record<string, unknown> & { key: string; confirmed: false }>;
  candidateEvidence: Array<{
    id: string;
    section: string;
    originalText: string;
    claim: string;
    skills: string[];
    outcomes: string[];
    confirmed: false;
  }>;
}

export interface ResumeAnalysisView {
  id: string;
  ownerId: string;
  inputKind: "pdf" | "docx" | "pasted_text";
  status: "queued" | "processing" | "needs_input" | "succeeded" | "failed" | "deleted";
  piiFindings: Array<{
    kind: "phone" | "email" | "national_id" | "address" | "other";
    count: number;
  }>;
  requiresPrivacyConfirmation: boolean;
  purgeAfter: string;
  confirmedAt: string | null;
  purgedAt: string | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  result: ResumeAnalysisResultPayload | LegacyResumeAnalysisResultPayload | null;
}

export interface EmptyProfileFacts {
  revision: 0;
  facts: [];
}

export interface EmptyProfilePreferences {
  revision: 0;
  preferences: null;
}

export interface EmptyProfileEvidence {
  revision: 0;
  resumeAnalysisId: null;
  schemaVersion: "resume-evidence-v2";
  documentRevisionId: null;
  evidence: [];
}

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
  cursor?: string;
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
  return apiRequest<JobSearchResponse>(jobSearchPath(filters), { signal });
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
  return apiRequest<JobDetail>(`/v1/jobs/${encodeURIComponent(jobId)}`, { signal });
}

export function createJobInsightRun(body: CreateJobInsightRunRequest) {
  return apiRequest<JobInsightRun>("/v1/job-insight-runs", {
    method: "POST",
    body,
    idempotencyKey: createIdempotencyKey("job-insight"),
  });
}

export function getJobInsightRun(id: string, signal?: AbortSignal) {
  return apiRequest<JobInsightRun>(`/v1/job-insight-runs/${encodeURIComponent(id)}`, {
    signal,
  });
}

export function submitResumeText(text: string) {
  return apiRequest<ResumeAnalysisView>("/v1/resume-analyses", {
    method: "POST",
    body: { inputKind: "pasted_text", text },
    idempotencyKey: createIdempotencyKey("resume-text"),
  });
}

export function submitResumeFile(file: File) {
  const body = new FormData();
  body.append("file", file);
  return apiRequest<ResumeAnalysisView>("/v1/resume-analyses", {
    method: "POST",
    body,
    idempotencyKey: createIdempotencyKey("resume-file"),
  });
}

export function getResumeAnalysis(id: string, signal?: AbortSignal) {
  return apiRequest<ResumeAnalysisView>(`/v1/resume-analyses/${encodeURIComponent(id)}`, {
    signal,
  });
}

export function getProfileFacts(signal?: AbortSignal) {
  return apiRequest<ProfileFactRevision | EmptyProfileFacts>("/v1/profile/facts", {
    signal,
  });
}

export function putProfileFacts(body: PutProfileFactsRequest) {
  return apiRequest<ProfileFactRevision>("/v1/profile/facts", {
    method: "PUT",
    body,
  });
}

export function getProfilePreferences(signal?: AbortSignal) {
  return apiRequest<JobPreferenceRevision | EmptyProfilePreferences>("/v1/profile/preferences", {
    signal,
  });
}

export function putProfilePreferences(body: PutJobPreferencesRequest) {
  return apiRequest<JobPreferenceRevision>("/v1/profile/preferences", {
    method: "PUT",
    body,
  });
}

export function getProfileEvidence(signal?: AbortSignal) {
  return apiRequest<ResumeEvidenceRevision | EmptyProfileEvidence>("/v1/profile/evidence", {
    signal,
  });
}

export function putProfileEvidence(body: PutResumeEvidenceRequest) {
  return apiRequest<ResumeEvidenceRevision>("/v1/profile/evidence", {
    method: "PUT",
    body,
  });
}

export function confirmResumeProfile(body: ConfirmResumeProfileRequest) {
  return apiRequest<ConfirmResumeProfileResponse>("/v1/profile/confirmation", {
    method: "PUT",
    body,
  });
}

export function getProfileDocument(signal?: AbortSignal) {
  return apiRequest<CurrentResumeDocument>("/v1/profile/document", { signal });
}

export function putSavedResumeEvidenceSelection(body: PutSavedResumeEvidenceSelectionRequest) {
  return apiRequest<ResumeEvidenceRevision>("/v1/profile/evidence-selection", {
    method: "PUT",
    body,
  });
}

export function createMatchRun(body: CreateMatchRunRequest) {
  return apiRequest<MatchRun>("/v1/match-runs", {
    method: "POST",
    body,
    idempotencyKey: createIdempotencyKey("match"),
  });
}

export function getMatchRun(id: string, signal?: AbortSignal) {
  return apiRequest<MatchRun>(`/v1/match-runs/${encodeURIComponent(id)}`, {
    signal,
  });
}

export function createRecommendationRun(body: CreateRecommendationRunRequest) {
  return apiRequest<RecommendationRun>("/v1/recommendation-runs", {
    method: "POST",
    body,
    idempotencyKey: createIdempotencyKey("recommendation"),
  });
}

export function getRecommendationRun(id: string, signal?: AbortSignal) {
  return apiRequest<RecommendationRun>(`/v1/recommendation-runs/${encodeURIComponent(id)}`, {
    signal,
  });
}

export function getJobDecisions(signal?: AbortSignal) {
  return apiRequest<JobDecision[]>("/v1/job-decisions", { signal });
}

export function putJobDecision(jobId: string, body: PutJobDecisionRequest) {
  return apiRequest<JobDecision>(`/v1/job-decisions/${encodeURIComponent(jobId)}`, {
    method: "PUT",
    body,
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
  });
}

export function getResumeTailoring(id: string, signal?: AbortSignal) {
  return apiRequest<ResumeTailoringRun>(`/v1/resume-tailorings/${encodeURIComponent(id)}`, {
    signal,
  });
}

export function putTailoringSegment(
  runId: string,
  segmentId: string,
  body: PutTailoringSegmentRequest,
) {
  return apiRequest<ResumeTailoringRun["segments"][number]>(
    `/v1/resume-tailorings/${encodeURIComponent(runId)}/segments/${encodeURIComponent(segmentId)}`,
    { method: "PUT", body },
  );
}

export function createResumeExport(runId: string) {
  return apiRequest<ResumeExport>(`/v1/resume-tailorings/${encodeURIComponent(runId)}/exports`, {
    method: "POST",
    idempotencyKey: createIdempotencyKey("resume-export"),
  });
}

export function getResumeExport(id: string, signal?: AbortSignal) {
  return apiRequest<ResumeExport>(`/v1/resume-exports/${encodeURIComponent(id)}`, {
    signal,
  });
}

export function deleteProfile() {
  return apiRequest<ProfileDeletion>("/v1/profile", { method: "DELETE" });
}

export function getProfileDeletion(signal?: AbortSignal) {
  return apiRequest<ProfileDeletion>("/v1/profile/deletion", { signal });
}
