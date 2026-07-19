import type { ColumnType, Generated } from "kysely";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type ResumeAnalysisStorageMetadata = {
  version: "resume-analysis-storage-v1";
  candidateEvidenceCount: number;
};
// PostgreSQL drivers return `Date` for timestamptz. Keep generated timestamps as
// `Generated<Date>` rather than nesting one ColumnType inside another.
export type Timestamp = Date;
export type BinaryValue = ColumnType<Uint8Array, Uint8Array, Uint8Array>;

export interface OrganizationTable {
  id: string;
  slug: string;
  name: string;
  official_domain: string;
  created_at: Generated<Timestamp>;
}

export interface SourceCandidateTable {
  id: string;
  organization_id: string;
  source_key: string;
  name: string;
  entrypoint_url: string;
  provenance_level: string;
  acquisition_mode: string;
  candidate_status: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface SourceAssessmentTable {
  id: string;
  source_candidate_id: string;
  assessment_hash: string;
  assessor: string;
  hard_gates: JsonValue;
  scores: JsonValue;
  total_score: number;
  decision: string;
  evidence_notes: string;
  assessed_at: Generated<Timestamp>;
}

export interface SourceTable {
  id: string;
  organization_id: string;
  source_candidate_id: string | null;
  source_key: string;
  source_type: string;
  name: string;
  current_policy_version: number;
  created_at: Generated<Timestamp>;
}

export interface SourcePolicyVersionTable {
  source_id: string;
  version: number;
  policy_status: string;
  provenance_level: string;
  acquisition_mode: string;
  adapter_key: string;
  adapter_version: string;
  entrypoints: JsonValue;
  crawl_interval: string | null;
  policy_notes: string;
  reviewed_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface SourceTargetTable {
  id: string;
  source_id: string;
  policy_version: number;
  method: string;
  scheme: string;
  host: string;
  port: number;
  path_prefix: string;
  allow_redirects: Generated<boolean>;
  allowed_query_parameters: Generated<string[]>;
  created_at: Generated<Timestamp>;
}

export interface SourceRuntimeStateTable {
  source_id: string;
  policy_version: number;
  freshness_state: string;
  last_complete_run_at: Timestamp | null;
  consecutive_failures: number;
  last_error_code: string | null;
  next_due_at: Timestamp | null;
  updated_at: Generated<Timestamp>;
}

export interface TaskTable {
  id: string;
  task_type: string;
  source_id: Generated<string | null>;
  policy_version: Generated<number | null>;
  adapter_version: Generated<string | null>;
  run_mode: Generated<string | null>;
  owner_id: Generated<string | null>;
  owner_epoch: Generated<number | null>;
  payload: Generated<JsonValue>;
  idempotency_key: string;
  status: string;
  attempt: number;
  max_attempts: number;
  available_at: Timestamp;
  backoff_policy: JsonValue;
  lease_owner: string | null;
  lease_until: Timestamp | null;
  heartbeat_at: Timestamp | null;
  fencing_token: Generated<number>;
  last_error_code: string | null;
  last_error_summary: string | null;
  created_at: Generated<Timestamp>;
  completed_at: Timestamp | null;
}

export type CrawlTaskTable = TaskTable;

export interface CrawlRunTable {
  id: string;
  task_id: string;
  source_id: string;
  policy_version: number;
  adapter_version: string;
  run_mode: string;
  completion: string | null;
  reported_totals: JsonValue;
  request_count: number;
  discovered_count: number;
  normalized_count: number;
  rejected_count: number;
  error_summary: JsonValue;
  started_at: Generated<Timestamp>;
  finished_at: Timestamp | null;
}

export interface SnapshotObjectTable {
  id: string;
  source_id: string;
  content_hash: string;
  object_key: string;
  original_byte_size: number;
  stored_byte_size: number;
  content_type: string;
  content_encoding: string;
  created_at: Generated<Timestamp>;
}

export interface CrawlFetchTable {
  id: string;
  crawl_run_id: string;
  snapshot_object_id: string | null;
  method: string;
  request_url: string;
  final_url: string;
  request_fingerprint: string;
  http_status: number | null;
  content_type: string | null;
  response_headers: JsonValue;
  fetch_result: string;
  error_code: string | null;
  fetched_at: Generated<Timestamp>;
}

export interface SourceJobRecordTable {
  id: string;
  source_id: string;
  source_job_id: string;
  canonical_source_url: string;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
}

export interface SourceJobRevisionTable {
  id: string;
  source_job_record_id: string;
  revision_content_hash: string;
  import_mode: string;
  adapter_version: string;
  normalizer_version: string;
  company_name: string;
  title: string;
  job_family: JsonValue;
  locations: JsonValue;
  business_groups: JsonValue;
  entry_scope: string;
  source_project_name: string | null;
  recruit_label_name: string | null;
  recruitment_type: JsonValue;
  department: Generated<JsonValue>;
  job_code: Generated<JsonValue>;
  employment_type: Generated<JsonValue>;
  recruitment_batch: Generated<JsonValue>;
  weekly_attendance_days: Generated<JsonValue>;
  duration_months: Generated<JsonValue>;
  earliest_start_date: Generated<JsonValue>;
  graduation_years: Generated<JsonValue>;
  education_levels: Generated<JsonValue>;
  majors: Generated<JsonValue>;
  languages: Generated<JsonValue>;
  salary: Generated<JsonValue>;
  work_mode: Generated<JsonValue>;
  posted_at: Generated<JsonValue>;
  deadline_at: Generated<JsonValue>;
  responsibilities: string;
  requirements: string;
  structured_fields: JsonValue;
  ingestion_state: string;
  publication_state: string;
  activity_state: string;
  source_url: string;
  apply_url: string | null;
  quality_flags: JsonValue;
  created_at: Generated<Timestamp>;
}

export interface SourceJobRevisionEvidenceTable {
  id: string;
  revision_id: string;
  crawl_fetch_id: string;
  evidence_role: string;
  field_name: string;
  json_pointer: string;
  raw_value_hash: string;
  created_at: Generated<Timestamp>;
}

export interface ReviewItemTable {
  id: string;
  revision_id: string;
  reason_code: string;
  status: string;
  details: JsonValue;
  created_at: Generated<Timestamp>;
  resolved_at: Timestamp | null;
}

export interface PublishedJobTable {
  id: string;
  current_version_id: string | null;
  created_at: Generated<Timestamp>;
}

export interface PublishedJobVersionTable {
  id: string;
  published_job_id: string;
  source_job_revision_id: string;
  content_hash: string;
  company_name: string;
  title: string;
  job_family: JsonValue;
  locations: JsonValue;
  department: Generated<JsonValue>;
  job_code: Generated<JsonValue>;
  recruitment_type: Generated<JsonValue>;
  employment_type: Generated<JsonValue>;
  recruitment_batch: Generated<JsonValue>;
  weekly_attendance_days: Generated<JsonValue>;
  duration_months: Generated<JsonValue>;
  earliest_start_date: Generated<JsonValue>;
  graduation_years: Generated<JsonValue>;
  education_levels: Generated<JsonValue>;
  majors: Generated<JsonValue>;
  languages: Generated<JsonValue>;
  salary: Generated<JsonValue>;
  work_mode: Generated<JsonValue>;
  posted_at: Generated<JsonValue>;
  deadline_at: Generated<JsonValue>;
  responsibilities: string;
  requirements: string;
  structured_fields: JsonValue;
  activity_state: string;
  source_url: string;
  apply_url: string | null;
  effective_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface PublishedJobVersionRevisionLinkTable {
  published_job_version_id: string;
  source_job_revision_id: string;
  created_at: Generated<Timestamp>;
}

export interface JobRequirementSetTable {
  id: string;
  published_job_version_id: string;
  schema_version: string;
  requirements: JsonValue;
  content_hash: string;
  created_at: Generated<Timestamp>;
}

export interface AuditEventTable {
  id: string;
  event_type: string;
  actor_type: string;
  subject_type: string;
  subject_id: string;
  metadata: JsonValue;
  created_at: Generated<Timestamp>;
}

export interface OwnerTable {
  id: string;
  status: Generated<string>;
  epoch: Generated<number>;
  retention_expires_at: Generated<Timestamp>;
  created_at: Generated<Timestamp>;
  last_seen_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface OwnerSessionTable {
  id: string;
  owner_id: string;
  owner_epoch: number;
  token_hash: string;
  csrf_token_hash: string;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  last_seen_at: Generated<Timestamp>;
}

export interface ResumeAnalysisTable {
  id: string;
  owner_id: string;
  owner_epoch: number;
  input_kind: string;
  status: string;
  original_filename: string | null;
  media_type: string | null;
  byte_size: number;
  content_sha256: string;
  encryption_key_version: string;
  raw_ciphertext: BinaryValue | null;
  raw_nonce: BinaryValue | null;
  raw_auth_tag: BinaryValue | null;
  extracted_text_ciphertext: BinaryValue | null;
  extracted_text_nonce: BinaryValue | null;
  extracted_text_auth_tag: BinaryValue | null;
  pii_summary: Generated<JsonValue>;
  analysis_result: JsonValue | null;
  privacy_confirmed_at: Timestamp | null;
  purge_after: Generated<Timestamp>;
  purged_at: Timestamp | null;
  failure_code: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ProfileFactRevisionTable {
  id: string;
  owner_id: string;
  owner_epoch: number;
  revision: number;
  base_revision: number | null;
  facts: JsonValue;
  content_hash: string;
  confirmed_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface JobPreferenceRevisionTable {
  id: string;
  owner_id: string;
  owner_epoch: number;
  revision: number;
  base_revision: number | null;
  preferences: JsonValue;
  content_hash: string;
  confirmed_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface ResumeEvidenceRevisionTable {
  id: string;
  owner_id: string;
  owner_epoch: number;
  resume_analysis_id: string | null;
  revision: number;
  base_revision: number | null;
  evidence: JsonValue;
  content_hash: string;
  confirmed_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface MatchRunTable {
  id: string;
  owner_id: string;
  owner_epoch: number;
  published_job_version_id: string;
  requirement_set_id: string;
  profile_fact_revision_id: string;
  preference_revision_id: string;
  evidence_revision_id: string;
  rule_version: string;
  dictionary_version: string;
  template_version: string;
  status: string;
  request_hash: string;
  idempotency_key: string;
  result: JsonValue | null;
  failure_code: string | null;
  created_at: Generated<Timestamp>;
  completed_at: Timestamp | null;
}

export interface RecommendationRunTable {
  id: string;
  owner_id: string;
  owner_epoch: number;
  profile_fact_revision_id: string;
  preference_revision_id: string;
  evidence_revision_id: string;
  candidate_job_version_ids: JsonValue;
  candidate_freshness_snapshots: JsonValue | null;
  candidate_set_hash: string;
  strategy_version: string;
  status: string;
  request_hash: string;
  idempotency_key: string;
  failure_code: string | null;
  created_at: Generated<Timestamp>;
  completed_at: Timestamp | null;
}

export interface RecommendationItemTable {
  owner_id: string;
  recommendation_run_id: string;
  ordinal: number;
  published_job_version_id: string;
  match_run_id: string;
  reason_codes: JsonValue;
  unknown_requirement_ids: JsonValue;
}

export interface ResumeTailoringRunTable {
  id: string;
  owner_id: string;
  owner_epoch: number;
  resume_analysis_id: string;
  published_job_version_id: string;
  requirement_set_id: string;
  evidence_revision_id: string;
  provider_adapter: string;
  model: string;
  prompt_version: string;
  schema_version: string;
  template_version: string;
  privacy_consent_at: Timestamp;
  used_template_fallback: Generated<boolean>;
  status: string;
  request_hash: string;
  idempotency_key: string;
  failure_code: string | null;
  created_at: Generated<Timestamp>;
  completed_at: Timestamp | null;
}

export interface ResumeTailoringSegmentTable {
  id: string;
  tailoring_run_id: string;
  ordinal: number;
  original_text: string;
  suggested_text: string;
  reason: string;
  requirement_ids: JsonValue;
  evidence_ids: JsonValue;
  decision: Generated<string>;
  edited_text: string | null;
  updated_at: Generated<Timestamp>;
}

export interface ResumeExportTable {
  id: string;
  owner_id: string;
  owner_epoch: number;
  tailoring_run_id: string;
  status: string;
  file_name: string;
  media_type: string;
  byte_size: number | null;
  encryption_key_version: string;
  ciphertext: BinaryValue | null;
  nonce: BinaryValue | null;
  auth_tag: BinaryValue | null;
  expires_at: Generated<Timestamp>;
  failure_code: string | null;
  created_at: Generated<Timestamp>;
  completed_at: Timestamp | null;
}

export interface JobDecisionTable {
  owner_id: string;
  owner_epoch: number;
  published_job_id: string;
  status: string;
  reason: string | null;
  revision: Generated<number>;
  official_link_opened_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface OwnerDeletionTable {
  id: string;
  owner_id: string;
  requested_owner_epoch: number;
  status: string;
  failure_code: string | null;
  requested_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  completed_at: Timestamp | null;
}

export interface InternalJobPreviewView {
  job_id: string;
  revision_id: string;
  source_job_id: string;
  source_id: string;
  source_key: string;
  source_name: string;
  company_name: string;
  official_domain: string;
  source_type: string;
  provenance_level: string;
  policy_status: string;
  title: string;
  job_family: JsonValue;
  locations: JsonValue;
  business_groups: JsonValue;
  entry_scope: string;
  source_project_name: string | null;
  recruit_label_name: string | null;
  recruitment_type: JsonValue;
  responsibilities: string;
  requirements: string;
  import_mode: string;
  structured_fields: JsonValue;
  ingestion_state: string;
  publication_state: string;
  activity_state: string;
  source_url: string;
  apply_url: string | null;
  quality_flags: JsonValue;
  review_reasons: JsonValue;
  first_seen_at: Timestamp;
  last_verified_at: Timestamp;
}

export interface Database {
  "source_control.organizations": OrganizationTable;
  "source_control.source_candidates": SourceCandidateTable;
  "source_control.source_assessments": SourceAssessmentTable;
  "source_control.sources": SourceTable;
  "source_control.source_policy_versions": SourcePolicyVersionTable;
  "source_control.source_fetch_targets": SourceTargetTable;
  "source_control.source_apply_targets": SourceTargetTable;
  "source_control.source_runtime_states": SourceRuntimeStateTable;
  "task_queue.tasks": TaskTable;
  "ingestion.crawl_runs": CrawlRunTable;
  "ingestion.snapshot_objects": SnapshotObjectTable;
  "ingestion.crawl_fetches": CrawlFetchTable;
  "ingestion.source_job_records": SourceJobRecordTable;
  "ingestion.source_job_revisions": SourceJobRevisionTable;
  "ingestion.source_job_revision_evidence": SourceJobRevisionEvidenceTable;
  "ingestion.review_items": ReviewItemTable;
  "catalog.published_jobs": PublishedJobTable;
  "catalog.published_job_versions": PublishedJobVersionTable;
  "catalog.published_job_version_revision_links": PublishedJobVersionRevisionLinkTable;
  "catalog.job_requirement_sets": JobRequirementSetTable;
  "catalog.internal_job_previews": InternalJobPreviewView;
  "identity.owners": OwnerTable;
  "identity.owner_sessions": OwnerSessionTable;
  "profile.resume_analyses": ResumeAnalysisTable;
  "profile.profile_fact_revisions": ProfileFactRevisionTable;
  "profile.job_preference_revisions": JobPreferenceRevisionTable;
  "profile.resume_evidence_revisions": ResumeEvidenceRevisionTable;
  "matching.match_runs": MatchRunTable;
  "matching.recommendation_runs": RecommendationRunTable;
  "matching.recommendation_items": RecommendationItemTable;
  "matching.resume_tailoring_runs": ResumeTailoringRunTable;
  "matching.resume_tailoring_segments": ResumeTailoringSegmentTable;
  "matching.resume_exports": ResumeExportTable;
  "decision.job_decisions": JobDecisionTable;
  "decision.owner_deletions": OwnerDeletionTable;
  "decision_feedback_audit.audit_events": AuditEventTable;
}
