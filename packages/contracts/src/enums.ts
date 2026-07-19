import { z } from "zod";

export const SourceTypeSchema = z.enum([
  "organization_career_site",
  "official_ats",
  "university_employment_site",
]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const ProvenanceLevelSchema = z.enum([
  "organization_owned",
  "verified_ats_tenant",
  "university_published",
  "official_account_link",
  "unverified",
]);
export type ProvenanceLevel = z.infer<typeof ProvenanceLevelSchema>;

export const PolicyStatusSchema = z.enum([
  "pending_review",
  "approved",
  "paused",
  "blocked",
  "retired",
]);
export type PolicyStatus = z.infer<typeof PolicyStatusSchema>;

export const AcquisitionModeSchema = z.enum([
  "public_api",
  "json_ld",
  "deterministic_html",
  "browser_required",
]);
export type AcquisitionMode = z.infer<typeof AcquisitionModeSchema>;

export const FreshnessStateSchema = z.enum(["fresh", "due", "stale", "unknown"]);
export type FreshnessState = z.infer<typeof FreshnessStateSchema>;

export const IngestionStateSchema = z.enum(["discovered", "parsed", "validated", "rejected"]);
export type IngestionState = z.infer<typeof IngestionStateSchema>;

export const PublicationStateSchema = z.enum([
  "draft",
  "review",
  "published",
  "suppressed",
  "archived",
]);
export type PublicationState = z.infer<typeof PublicationStateSchema>;

export const ActivityStateSchema = z.enum(["active", "uncertain", "closed"]);
export type ActivityState = z.infer<typeof ActivityStateSchema>;

export const JobDisplayStatusSchema = z.enum(["recruiting", "pending_review", "closed", "unknown"]);
export type JobDisplayStatus = z.infer<typeof JobDisplayStatusSchema>;

export const ImportModeSchema = z.enum(["collector", "manual"]);
export type ImportMode = z.infer<typeof ImportModeSchema>;

export const IngestionRunModeSchema = z.enum(["scheduled", "manual", "probe", "fixture_replay"]);
export type IngestionRunMode = z.infer<typeof IngestionRunModeSchema>;

export const CrawlCompletionSchema = z.enum(["complete", "partial", "failed"]);
export type CrawlCompletion = z.infer<typeof CrawlCompletionSchema>;

export const TaskStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "dead"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskTypeSchema = z.enum([
  "crawl",
  "resume_analysis",
  "match_run",
  "recommendation_run",
  "resume_tailoring",
  "resume_export",
  "owner_deletion",
]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const JobFamilySchema = z.enum(["product", "operations", "other"]);
export type JobFamily = z.infer<typeof JobFamilySchema>;

export const OwnerStatusSchema = z.enum(["active", "deletion_pending", "deleted"]);
export type OwnerStatus = z.infer<typeof OwnerStatusSchema>;

export const AsyncRunStatusSchema = z.enum([
  "queued",
  "processing",
  "needs_input",
  "succeeded",
  "failed",
  "deleted",
]);
export type AsyncRunStatus = z.infer<typeof AsyncRunStatusSchema>;

export const ResumeInputKindSchema = z.enum(["pdf", "docx", "pasted_text"]);
export type ResumeInputKind = z.infer<typeof ResumeInputKindSchema>;

export const EligibilityStatusSchema = z.enum([
  "no_explicit_conflict",
  "explicit_conflict",
  "needs_information",
]);
export type EligibilityStatus = z.infer<typeof EligibilityStatusSchema>;

export const EvidenceMatchStatusSchema = z.enum([
  "explicit_evidence",
  "partial_evidence",
  "not_in_resume",
  "insufficient_information",
]);
export type EvidenceMatchStatus = z.infer<typeof EvidenceMatchStatusSchema>;

export const PreferenceMatchStatusSchema = z.enum(["fits", "does_not_fit", "not_set"]);
export type PreferenceMatchStatus = z.infer<typeof PreferenceMatchStatusSchema>;

export const JobDecisionStatusSchema = z.enum([
  "undecided",
  "saved",
  "preparing_to_apply",
  "applied",
  "abandoned",
]);
export type JobDecisionStatus = z.infer<typeof JobDecisionStatusSchema>;

export const TailoringSegmentDecisionSchema = z.enum(["pending", "accepted", "rejected", "edited"]);
export type TailoringSegmentDecision = z.infer<typeof TailoringSegmentDecisionSchema>;

export const DeletionStatusSchema = z.enum(["queued", "processing", "succeeded", "failed"]);
export type DeletionStatus = z.infer<typeof DeletionStatusSchema>;
