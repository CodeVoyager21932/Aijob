import type {
  ApplicationBoardResponse,
  ApplicationCaseCommandResponse,
  ApplicationCaseJobVersionDiffResponse,
  ApplicationCaseMutationResponse,
  ApplicationCaseRequirements,
  ApplicationCaseSort,
  ApplicationCaseWithJobContext,
  CareerDataScopeResponse,
  CaseMatchState,
  CaseStage,
  ConfirmCaseDebriefRequest,
  ConfirmCaseDebriefResponse,
  CreateApplicationCaseResponse,
  CreateApplicationCaseWithJobContextRequest,
  CreateCaseQuestionRequest,
  CreateInterviewSessionRequest,
  CreateInterviewSessionResponse,
  CreateResumeDocumentRequest,
  CreateResumeDocumentResponse,
  CreateResumeReviewRequest,
  CreateResumeReviewResponse,
  CurrentResumeReviewResponse,
  DecideResumeReviewSuggestionRequest,
  DecideResumeReviewSuggestionResponse,
  DeleteApplicationCaseRequest,
  DeleteApplicationCaseResponse,
  DeleteDebriefRequest,
  DeleteDebriefResponse,
  DeleteInterviewSessionRequest,
  DeleteInterviewSessionResponse,
  DeleteResumeDocumentRequest,
  DeleteResumeDocumentResponse,
  GetCaseDebriefResponse,
  InterviewSessionDetail,
  LegacyResumeContentConversion,
  ListApplicationCaseEventsResponse,
  ListApplicationCasesResponse,
  ListInterviewSessionsResponse,
  ListResumeDocumentContentRevisionsResponse,
  ListResumeDocumentLayoutRevisionsResponse,
  ListResumeDocumentsResponse,
  PrepareCaseDebriefRequest,
  PrepareCaseDebriefResponse,
  PutCaseRequirementEvidenceLinksRequest,
  PutCaseRequirementStateRequest,
  PutResumeDocumentContentRevisionRequest,
  PutResumeDocumentContentRevisionResponse,
  PutResumeDocumentLayoutRevisionRequest,
  PutResumeDocumentLayoutRevisionResponse,
  RecordManualApplicationRequest,
  ResumeDocument,
  ResumeEvidenceRevision,
  SubmitInterviewAnswerRequest,
  SubmitInterviewAnswerResponse,
  TransitionApplicationCaseRequest,
  UpdateCaseQuestionRequest,
  UpgradeApplicationCaseJobVersionRequest,
} from "@aijob/contracts";
import {
  ApplicationBoardResponseSchema,
  ApplicationCaseCommandResponseSchema,
  ApplicationCaseJobVersionDiffResponseSchema,
  ApplicationCaseWithJobContextSchema,
  CaseMatchStateSchema,
  CreateApplicationCaseResponseSchema,
  CreateResumeDocumentResponseSchema,
  CreateResumeReviewResponseSchema,
  CurrentResumeReviewResponseSchema,
  DecideResumeReviewSuggestionResponseSchema,
  DeleteResumeDocumentResponseSchema,
  LegacyResumeContentConversionSchema,
  ListApplicationCasesResponseSchema,
  ListResumeDocumentContentRevisionsResponseSchema,
  ListResumeDocumentLayoutRevisionsResponseSchema,
  ListResumeDocumentsResponseSchema,
  PutResumeDocumentContentRevisionResponseSchema,
  PutResumeDocumentLayoutRevisionResponseSchema,
  ResumeDocumentSchema,
} from "@aijob/contracts";
import { apiRequest } from "./client";

export const careerOsQueryKeys = {
  all: ["career-os"] as const,
  cases: ["career-os", "application-cases"] as const,
  caseList: (filters?: { stage?: CaseStage | "all"; city?: string; sort?: ApplicationCaseSort }) =>
    filters
      ? ([
          "career-os",
          "application-cases",
          "list",
          filters.stage ?? "all",
          filters.city ?? "all",
          filters.sort ?? "updated",
        ] as const)
      : (["career-os", "application-cases", "list"] as const),
  applicationBoard: (filters: { city?: string; sort: ApplicationCaseSort }) =>
    ["career-os", "application-cases", "board", filters.city ?? "all", filters.sort] as const,
  caseDetail: (caseId: string) => ["career-os", "application-cases", "detail", caseId] as const,
  caseEvents: (caseId: string) => ["career-os", "application-cases", caseId, "events"] as const,
  caseMatchState: (caseId: string) =>
    ["career-os", "application-cases", caseId, "match-state"] as const,
  caseJobVersionDiff: (caseId: string) =>
    ["career-os", "application-cases", caseId, "job-version-diff"] as const,
  requirements: (caseId: string) =>
    ["career-os", "application-cases", caseId, "requirements"] as const,
  evidence: ["career-os", "profile", "evidence"] as const,
  evidenceRevision: (evidenceRevisionId: string) =>
    ["career-os", "profile", "evidence", evidenceRevisionId] as const,
  dataScope: ["career-os", "profile", "data-scope"] as const,
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
  interviewSessions: (caseId: string) =>
    ["career-os", "application-cases", caseId, "interview-sessions"] as const,
  interviewSession: (caseId: string, sessionId: string) =>
    ["career-os", "application-cases", caseId, "interview-sessions", sessionId] as const,
  caseDebrief: (caseId: string) => ["career-os", "application-cases", caseId, "debrief"] as const,
};

export function getCareerDataScope(signal?: AbortSignal) {
  return apiRequest<CareerDataScopeResponse>("/v1/profile/data-scope", { signal });
}

export interface ListApplicationCasesInput {
  cursor?: string;
  limit?: number;
  stage?: CaseStage;
  city?: string;
  sort?: ApplicationCaseSort;
}

export function applicationCaseListPath(input: ListApplicationCasesInput = {}): string {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 100));
  if (input.stage) params.set("stage", input.stage);
  if (input.city) params.set("city", input.city);
  if (input.sort) params.set("sort", input.sort);
  if (input.cursor) params.set("cursor", input.cursor);
  return `/v1/application-cases?${params.toString()}`;
}

export function listApplicationCases(input: ListApplicationCasesInput = {}, signal?: AbortSignal) {
  return apiRequest<ListApplicationCasesResponse>(applicationCaseListPath(input), {
    signal,
    responseSchema: ListApplicationCasesResponseSchema,
  });
}

export interface ApplicationBoardInput {
  city?: string;
  sort?: ApplicationCaseSort;
  limitPerStage?: number;
}

export function applicationBoardPath(input: ApplicationBoardInput = {}): string {
  const params = new URLSearchParams();
  if (input.city) params.set("city", input.city);
  params.set("sort", input.sort ?? "updated");
  params.set("limitPerStage", String(input.limitPerStage ?? 20));
  return `/v1/application-cases/board?${params.toString()}`;
}

export function getApplicationBoard(input: ApplicationBoardInput = {}, signal?: AbortSignal) {
  return apiRequest<ApplicationBoardResponse>(applicationBoardPath(input), {
    signal,
    responseSchema: ApplicationBoardResponseSchema,
  });
}

export function getApplicationCase(caseId: string, signal?: AbortSignal) {
  return apiRequest<ApplicationCaseWithJobContext>(
    `/v1/application-cases/${encodeURIComponent(caseId)}`,
    { signal, responseSchema: ApplicationCaseWithJobContextSchema },
  );
}

export function getCaseMatchState(caseId: string, signal?: AbortSignal) {
  return apiRequest<CaseMatchState>(
    `/v1/application-cases/${encodeURIComponent(caseId)}/match-state`,
    { signal, responseSchema: CaseMatchStateSchema },
  );
}

export function createCaseMatchRun(
  caseId: string,
  expectedCaseRevision: number,
  idempotencyKey: string,
) {
  return apiRequest<CaseMatchState>(
    `/v1/application-cases/${encodeURIComponent(caseId)}/match-runs`,
    {
      method: "POST",
      body: { expectedCaseRevision },
      idempotencyKey,
      responseSchema: CaseMatchStateSchema,
    },
  );
}

export function getApplicationCaseJobVersionDiff(caseId: string, signal?: AbortSignal) {
  return apiRequest<ApplicationCaseJobVersionDiffResponse>(
    `/v1/application-cases/${encodeURIComponent(caseId)}/job-version-diff`,
    { signal, responseSchema: ApplicationCaseJobVersionDiffResponseSchema },
  );
}

export function upgradeApplicationCaseJobVersion(
  caseId: string,
  request: UpgradeApplicationCaseJobVersionRequest,
  idempotencyKey: string,
) {
  return apiRequest<ApplicationCaseCommandResponse>(
    `/v1/application-cases/${encodeURIComponent(caseId)}/job-version-upgrades`,
    {
      method: "POST",
      body: request,
      idempotencyKey,
      responseSchema: ApplicationCaseCommandResponseSchema,
    },
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
    responseSchema: CreateApplicationCaseResponseSchema,
  });
}

export function applicationCaseTransitionPath(caseId: string): string {
  return `/v1/application-cases/${encodeURIComponent(caseId)}/transitions`;
}

export function transitionApplicationCase(
  caseId: string,
  request: TransitionApplicationCaseRequest,
  idempotencyKey: string,
) {
  return apiRequest<ApplicationCaseCommandResponse>(applicationCaseTransitionPath(caseId), {
    method: "POST",
    body: request,
    idempotencyKey,
    responseSchema: ApplicationCaseCommandResponseSchema,
  });
}

export function deleteApplicationCase(caseId: string, request: DeleteApplicationCaseRequest) {
  return apiRequest<DeleteApplicationCaseResponse>(
    `/v1/application-cases/${encodeURIComponent(caseId)}`,
    { method: "DELETE", body: request },
  );
}

export interface ListApplicationCaseEventsInput {
  cursor?: string;
  limit?: number;
}

export function applicationCaseEventsPath(
  caseId: string,
  input: ListApplicationCaseEventsInput = {},
): string {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 50));
  if (input.cursor) params.set("cursor", input.cursor);
  return `/v1/application-cases/${encodeURIComponent(caseId)}/events?${params.toString()}`;
}

export function listApplicationCaseEvents(
  caseId: string,
  input: ListApplicationCaseEventsInput = {},
  signal?: AbortSignal,
) {
  return apiRequest<ListApplicationCaseEventsResponse>(applicationCaseEventsPath(caseId, input), {
    signal,
  });
}

export function recordManualApplication(
  caseId: string,
  request: RecordManualApplicationRequest,
  idempotencyKey: string,
) {
  return apiRequest<ApplicationCaseCommandResponse>(
    `/v1/application-cases/${encodeURIComponent(caseId)}/manual-applications`,
    { method: "POST", body: request, idempotencyKey },
  );
}

export interface ListInterviewSessionsInput {
  cursor?: string;
  limit?: number;
}

export function interviewSessionListPath(
  caseId: string,
  input: ListInterviewSessionsInput = {},
): string {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 20));
  if (input.cursor) params.set("cursor", input.cursor);
  return `/v1/application-cases/${encodeURIComponent(caseId)}/interview-sessions?${params.toString()}`;
}

export function listInterviewSessions(
  caseId: string,
  input: ListInterviewSessionsInput = {},
  signal?: AbortSignal,
) {
  return apiRequest<ListInterviewSessionsResponse>(interviewSessionListPath(caseId, input), {
    signal,
  });
}

export function createInterviewSession(
  caseId: string,
  request: CreateInterviewSessionRequest,
  idempotencyKey: string,
) {
  return apiRequest<CreateInterviewSessionResponse>(
    `/v1/application-cases/${encodeURIComponent(caseId)}/interview-sessions`,
    { method: "POST", body: request, idempotencyKey },
  );
}

export function getInterviewSession(caseId: string, sessionId: string, signal?: AbortSignal) {
  return apiRequest<InterviewSessionDetail>(
    `/v1/application-cases/${encodeURIComponent(caseId)}/interview-sessions/${encodeURIComponent(sessionId)}`,
    { signal },
  );
}

export function submitInterviewAnswer(
  caseId: string,
  sessionId: string,
  request: SubmitInterviewAnswerRequest,
  idempotencyKey: string,
) {
  return apiRequest<SubmitInterviewAnswerResponse>(
    `/v1/application-cases/${encodeURIComponent(caseId)}/interview-sessions/${encodeURIComponent(sessionId)}/answers`,
    { method: "POST", body: request, idempotencyKey },
  );
}

export function deleteInterviewSession(sessionId: string, request: DeleteInterviewSessionRequest) {
  return apiRequest<DeleteInterviewSessionResponse>(
    `/v1/interview-sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE", body: request },
  );
}

export function caseDebriefPath(caseId: string): string {
  return `/v1/application-cases/${encodeURIComponent(caseId)}/debrief`;
}

export function getCaseDebrief(caseId: string, signal?: AbortSignal) {
  return apiRequest<GetCaseDebriefResponse>(caseDebriefPath(caseId), { signal });
}

export function prepareCaseDebrief(
  caseId: string,
  request: PrepareCaseDebriefRequest,
  idempotencyKey: string,
) {
  return apiRequest<PrepareCaseDebriefResponse>(caseDebriefPath(caseId), {
    method: "PUT",
    body: request,
    idempotencyKey,
  });
}

export function caseDebriefConfirmationPath(caseId: string): string {
  return `${caseDebriefPath(caseId)}/confirmations`;
}

export function confirmCaseDebrief(
  caseId: string,
  request: ConfirmCaseDebriefRequest,
  idempotencyKey: string,
) {
  return apiRequest<ConfirmCaseDebriefResponse>(caseDebriefConfirmationPath(caseId), {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export function deleteDebrief(debriefId: string, request: DeleteDebriefRequest) {
  return apiRequest<DeleteDebriefResponse>(`/v1/debriefs/${encodeURIComponent(debriefId)}`, {
    method: "DELETE",
    body: request,
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
  return apiRequest<ListResumeDocumentsResponse>(resumeDocumentListPath(input), {
    signal,
    responseSchema: ListResumeDocumentsResponseSchema,
  });
}

export function createResumeDocument(request: CreateResumeDocumentRequest, idempotencyKey: string) {
  return apiRequest<CreateResumeDocumentResponse>("/v1/resume-documents", {
    method: "POST",
    body: request,
    idempotencyKey,
    responseSchema: CreateResumeDocumentResponseSchema,
  });
}

export function getResumeDocument(documentId: string, signal?: AbortSignal) {
  return apiRequest<ResumeDocument>(`/v1/resume-documents/${encodeURIComponent(documentId)}`, {
    signal,
    responseSchema: ResumeDocumentSchema,
  });
}

export function deleteResumeDocument(documentId: string, request: DeleteResumeDocumentRequest) {
  return apiRequest<DeleteResumeDocumentResponse>(
    `/v1/resume-documents/${encodeURIComponent(documentId)}`,
    { method: "DELETE", body: request, responseSchema: DeleteResumeDocumentResponseSchema },
  );
}

export function getLegacyResumeContentConversion(
  legacySourceRevisionId: string,
  signal?: AbortSignal,
) {
  return apiRequest<LegacyResumeContentConversion>(
    `/v1/resume-documents/legacy-source/${encodeURIComponent(legacySourceRevisionId)}`,
    { signal, responseSchema: LegacyResumeContentConversionSchema },
  );
}

export function listResumeDocumentContent(documentId: string, signal?: AbortSignal) {
  return apiRequest<ListResumeDocumentContentRevisionsResponse>(
    `/v1/resume-documents/${encodeURIComponent(documentId)}/revisions`,
    { signal, responseSchema: ListResumeDocumentContentRevisionsResponseSchema },
  );
}

export function listResumeDocumentLayout(documentId: string, signal?: AbortSignal) {
  return apiRequest<ListResumeDocumentLayoutRevisionsResponse>(
    `/v1/resume-documents/${encodeURIComponent(documentId)}/layout-revisions`,
    { signal, responseSchema: ListResumeDocumentLayoutRevisionsResponseSchema },
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
    {
      method: "POST",
      body: request,
      idempotencyKey,
      responseSchema: PutResumeDocumentContentRevisionResponseSchema,
    },
  );
}

export function putResumeDocumentLayout(
  documentId: string,
  request: PutResumeDocumentLayoutRevisionRequest,
  idempotencyKey: string,
) {
  return apiRequest<PutResumeDocumentLayoutRevisionResponse>(
    `/v1/resume-documents/${encodeURIComponent(documentId)}/layout-revisions`,
    {
      method: "POST",
      body: request,
      idempotencyKey,
      responseSchema: PutResumeDocumentLayoutRevisionResponseSchema,
    },
  );
}

export function getCurrentResumeReview(documentId: string, signal?: AbortSignal) {
  return apiRequest<CurrentResumeReviewResponse>(
    `/v1/resume-documents/${encodeURIComponent(documentId)}/review`,
    { signal, responseSchema: CurrentResumeReviewResponseSchema },
  );
}

export function createResumeReview(
  documentId: string,
  request: CreateResumeReviewRequest,
  idempotencyKey: string,
) {
  return apiRequest<CreateResumeReviewResponse>(
    `/v1/resume-documents/${encodeURIComponent(documentId)}/reviews`,
    {
      method: "POST",
      body: request,
      idempotencyKey,
      responseSchema: CreateResumeReviewResponseSchema,
    },
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
    {
      method: "POST",
      body: request,
      responseSchema: DecideResumeReviewSuggestionResponseSchema,
    },
  );
}
