import type {
  ApplicationCaseMutationResponse,
  ApplicationCaseRequirements,
  ApplicationCaseWithJobContext,
  CreateApplicationCaseResponse,
  CreateApplicationCaseWithJobContextRequest,
  CreateCaseQuestionRequest,
  CreateResumeDocumentRequest,
  CreateResumeDocumentResponse,
  CreateResumeReviewRequest,
  CreateResumeReviewResponse,
  CurrentResumeReviewResponse,
  DecideResumeReviewSuggestionRequest,
  DecideResumeReviewSuggestionResponse,
  LegacyResumeContentConversion,
  ListApplicationCasesResponse,
  ListResumeDocumentContentRevisionsResponse,
  ListResumeDocumentLayoutRevisionsResponse,
  ListResumeDocumentsResponse,
  PutCaseRequirementEvidenceLinksRequest,
  PutCaseRequirementStateRequest,
  PutResumeDocumentContentRevisionRequest,
  PutResumeDocumentContentRevisionResponse,
  PutResumeDocumentLayoutRevisionRequest,
  PutResumeDocumentLayoutRevisionResponse,
  ResumeDocument,
  ResumeEvidenceRevision,
  UpdateCaseQuestionRequest,
} from "@aijob/contracts";
import { apiRequest } from "./client";

export const careerOsQueryKeys = {
  all: ["career-os"] as const,
  cases: ["career-os", "application-cases"] as const,
  caseList: () => ["career-os", "application-cases", "list"] as const,
  caseDetail: (caseId: string) => ["career-os", "application-cases", "detail", caseId] as const,
  requirements: (caseId: string) =>
    ["career-os", "application-cases", caseId, "requirements"] as const,
  evidence: ["career-os", "profile", "evidence"] as const,
  evidenceRevision: (evidenceRevisionId: string) =>
    ["career-os", "profile", "evidence", evidenceRevisionId] as const,
  resumeDocumentLists: ["career-os", "resume-documents", "list"] as const,
  resumeDocuments: (filters: { kind?: "base" | "case_derived"; caseId?: string } = {}) =>
    [
      "career-os",
      "resume-documents",
      "list",
      filters.kind ?? "all",
      filters.caseId ?? "all",
    ] as const,
  resumeDocument: (documentId: string) =>
    ["career-os", "resume-documents", "detail", documentId] as const,
  legacyResumeSource: (legacySourceRevisionId: string) =>
    ["career-os", "resume-documents", "legacy-source", legacySourceRevisionId] as const,
  resumeContent: (documentId: string) =>
    ["career-os", "resume-documents", documentId, "content"] as const,
  resumeLayout: (documentId: string) =>
    ["career-os", "resume-documents", documentId, "layout"] as const,
  resumeReview: (documentId: string) =>
    ["career-os", "resume-documents", documentId, "review"] as const,
};

export interface ListApplicationCasesInput {
  cursor?: string;
  limit?: number;
}

export function applicationCaseListPath(input: ListApplicationCasesInput = {}): string {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 100));
  if (input.cursor) params.set("cursor", input.cursor);
  return `/v1/application-cases?${params.toString()}`;
}

export function listApplicationCases(input: ListApplicationCasesInput = {}, signal?: AbortSignal) {
  return apiRequest<ListApplicationCasesResponse>(applicationCaseListPath(input), { signal });
}

export function getApplicationCase(caseId: string, signal?: AbortSignal) {
  return apiRequest<ApplicationCaseWithJobContext>(
    `/v1/application-cases/${encodeURIComponent(caseId)}`,
    { signal },
  );
}

export function createApplicationCase(
  request: CreateApplicationCaseWithJobContextRequest,
  idempotencyKey: string,
) {
  return apiRequest<CreateApplicationCaseResponse>("/v1/application-cases", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export function getApplicationCaseRequirements(caseId: string, signal?: AbortSignal) {
  return apiRequest<ApplicationCaseRequirements>(
    `/v1/application-cases/${encodeURIComponent(caseId)}/requirements`,
    { signal },
  );
}

export function putApplicationCaseRequirementState(
  caseId: string,
  requirementId: string,
  request: PutCaseRequirementStateRequest,
) {
  return apiRequest<ApplicationCaseMutationResponse>(
    `/v1/application-cases/${encodeURIComponent(caseId)}/requirements/${encodeURIComponent(requirementId)}`,
    { method: "PUT", body: request },
  );
}

export function putApplicationCaseRequirementEvidence(
  caseId: string,
  requirementId: string,
  request: PutCaseRequirementEvidenceLinksRequest,
) {
  return apiRequest<ApplicationCaseMutationResponse>(
    `/v1/application-cases/${encodeURIComponent(caseId)}/requirements/${encodeURIComponent(requirementId)}/evidence-links`,
    { method: "PUT", body: request },
  );
}

export function createApplicationCaseQuestion(
  caseId: string,
  request: CreateCaseQuestionRequest,
  idempotencyKey: string,
) {
  return apiRequest<ApplicationCaseMutationResponse>(
    `/v1/application-cases/${encodeURIComponent(caseId)}/questions`,
    { method: "POST", body: request, idempotencyKey },
  );
}

export function updateApplicationCaseQuestion(
  caseId: string,
  questionId: string,
  request: UpdateCaseQuestionRequest,
) {
  return apiRequest<ApplicationCaseMutationResponse>(
    `/v1/application-cases/${encodeURIComponent(caseId)}/questions/${encodeURIComponent(questionId)}`,
    { method: "PUT", body: request },
  );
}

export type CareerOsEvidenceResponse =
  | ResumeEvidenceRevision
  | {
      revision: 0;
      resumeAnalysisId: null;
      schemaVersion: "resume-evidence-v2";
      documentRevisionId: null;
      evidence: [];
    };

export function getCareerOsEvidence(signal?: AbortSignal) {
  return apiRequest<CareerOsEvidenceResponse>("/v1/profile/evidence", { signal });
}

export function getCareerOsEvidenceRevision(evidenceRevisionId: string, signal?: AbortSignal) {
  return apiRequest<ResumeEvidenceRevision>(
    `/v1/profile/evidence/${encodeURIComponent(evidenceRevisionId)}`,
    { signal },
  );
}

export interface ListResumeDocumentsInput {
  kind?: "base" | "case_derived";
  caseId?: string;
  cursor?: string;
  limit?: number;
}

export function resumeDocumentListPath(input: ListResumeDocumentsInput = {}): string {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 100));
  if (input.kind) params.set("kind", input.kind);
  if (input.caseId) params.set("caseId", input.caseId);
  if (input.cursor) params.set("cursor", input.cursor);
  return `/v1/resume-documents?${params.toString()}`;
}

export function listResumeDocuments(input: ListResumeDocumentsInput = {}, signal?: AbortSignal) {
  return apiRequest<ListResumeDocumentsResponse>(resumeDocumentListPath(input), { signal });
}

export function createResumeDocument(request: CreateResumeDocumentRequest, idempotencyKey: string) {
  return apiRequest<CreateResumeDocumentResponse>("/v1/resume-documents", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export function getResumeDocument(documentId: string, signal?: AbortSignal) {
  return apiRequest<ResumeDocument>(`/v1/resume-documents/${encodeURIComponent(documentId)}`, {
    signal,
  });
}

export function getLegacyResumeContentConversion(
  legacySourceRevisionId: string,
  signal?: AbortSignal,
) {
  return apiRequest<LegacyResumeContentConversion>(
    `/v1/resume-documents/legacy-source/${encodeURIComponent(legacySourceRevisionId)}`,
    { signal },
  );
}

export function listResumeDocumentContent(documentId: string, signal?: AbortSignal) {
  return apiRequest<ListResumeDocumentContentRevisionsResponse>(
    `/v1/resume-documents/${encodeURIComponent(documentId)}/revisions`,
    { signal },
  );
}

export function listResumeDocumentLayout(documentId: string, signal?: AbortSignal) {
  return apiRequest<ListResumeDocumentLayoutRevisionsResponse>(
    `/v1/resume-documents/${encodeURIComponent(documentId)}/layout-revisions`,
    { signal },
  );
}

export function resumeDocumentDocxPath(input: {
  documentId: string;
  contentRevisionId: string;
  layoutRevisionId: string;
}): string {
  const params = new URLSearchParams({
    contentRevisionId: input.contentRevisionId,
    layoutRevisionId: input.layoutRevisionId,
  });
  return `/v1/resume-documents/${encodeURIComponent(input.documentId)}/docx?${params.toString()}`;
}

export function putResumeDocumentContent(
  documentId: string,
  request: PutResumeDocumentContentRevisionRequest,
  idempotencyKey: string,
) {
  return apiRequest<PutResumeDocumentContentRevisionResponse>(
    `/v1/resume-documents/${encodeURIComponent(documentId)}/revisions`,
    { method: "POST", body: request, idempotencyKey },
  );
}

export function putResumeDocumentLayout(
  documentId: string,
  request: PutResumeDocumentLayoutRevisionRequest,
  idempotencyKey: string,
) {
  return apiRequest<PutResumeDocumentLayoutRevisionResponse>(
    `/v1/resume-documents/${encodeURIComponent(documentId)}/layout-revisions`,
    { method: "POST", body: request, idempotencyKey },
  );
}

export function getCurrentResumeReview(documentId: string, signal?: AbortSignal) {
  return apiRequest<CurrentResumeReviewResponse>(
    `/v1/resume-documents/${encodeURIComponent(documentId)}/review`,
    { signal },
  );
}

export function createResumeReview(
  documentId: string,
  request: CreateResumeReviewRequest,
  idempotencyKey: string,
) {
  return apiRequest<CreateResumeReviewResponse>(
    `/v1/resume-documents/${encodeURIComponent(documentId)}/reviews`,
    { method: "POST", body: request, idempotencyKey },
  );
}

export function decideResumeReviewSuggestion(
  documentId: string,
  reviewRunId: string,
  suggestionId: string,
  request: DecideResumeReviewSuggestionRequest,
) {
  return apiRequest<DecideResumeReviewSuggestionResponse>(
    `/v1/resume-documents/${encodeURIComponent(documentId)}/reviews/${encodeURIComponent(reviewRunId)}/suggestions/${encodeURIComponent(suggestionId)}/decisions`,
    { method: "POST", body: request },
  );
}
