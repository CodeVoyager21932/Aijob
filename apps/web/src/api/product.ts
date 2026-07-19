import type {
  CreateMatchRunRequest,
  CreateRecommendationRunRequest,
  CreateResumeTailoringRequest,
  JobDecision,
  JobDetail,
  JobPreferenceRevision,
  JobSearchResponse,
  MatchRun,
  ProfileDeletion,
  ProfileFactRevision,
  PutJobDecisionRequest,
  PutJobPreferencesRequest,
  PutProfileFactsRequest,
  PutResumeEvidenceRequest,
  PutTailoringSegmentRequest,
  RecommendationRun,
  ResumeEvidenceRevision,
  ResumeExport,
  ResumeTailoringRun,
} from "@aijob/contracts";
import { apiRequest, createIdempotencyKey } from "./client";

export interface ResumeAnalysisResultPayload {
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
  result: ResumeAnalysisResultPayload | null;
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

export function getJob(jobId: string, signal?: AbortSignal) {
  return apiRequest<JobDetail>(`/v1/jobs/${encodeURIComponent(jobId)}`, { signal });
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
