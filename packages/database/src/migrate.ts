import type { Kysely } from "kysely";
import { type Migration, type MigrationProvider, Migrator } from "kysely";
import { initialMigration } from "./migrations/001_initial.js";
import { hardenSourceAndCatalogIntegrityMigration } from "./migrations/002_harden_source_and_catalog_integrity.js";
import { persistSourceTargetPolicyMigration } from "./migrations/003_persist_source_target_policy.js";
import { localCompleteMvpMigration } from "./migrations/004_local_complete_mvp.js";
import { enforceOwnerIsolationMigration } from "./migrations/005_enforce_owner_isolation.js";
import { allowTailoringFallbackOutcomeMigration } from "./migrations/006_allow_tailoring_fallback_outcome.js";
import { freezeRecommendationCandidateFreshnessMigration } from "./migrations/007_freeze_recommendation_candidate_freshness.js";
import { linkSourceRevisionsToPublishedVersionsMigration } from "./migrations/008_link_source_revisions_to_published_versions.js";
import { minimizeResumeAnalysisStorageMigration } from "./migrations/009_minimize_resume_analysis_storage.js";
import { enforcePurgedResumeAnalysisErasureMigration } from "./migrations/010_enforce_purged_resume_analysis_erasure.js";
import { g2CorrectnessFoundationsMigration } from "./migrations/011_g2_correctness_foundations.js";
import { allowResumeAnalysisV2MetadataMigration } from "./migrations/012_allow_resume_analysis_v2_metadata.js";
import { enforceCorrectnessProjectionOwnershipMigration } from "./migrations/013_enforce_correctness_projection_ownership.js";
import { employerScaleAndJobInsightsMigration } from "./migrations/014_employer_scale_and_job_insights.js";
import { freezeJobInsightSourceVerificationsMigration } from "./migrations/015_freeze_job_insight_source_verifications.js";
import { companyQuotaSelectionsMigration } from "./migrations/016_company_quota_selections.js";
import { sourceRefreshAutomationMigration } from "./migrations/017_source_refresh_automation.js";
import { adapterDescriptorsAndManualRunsMigration } from "./migrations/018_adapter_descriptors_and_manual_runs.js";
import { officialSourceCatalogEligibilityMigration } from "./migrations/019_official_source_catalog_eligibility.js";
import { registeredSourceAndJobFreshnessMigration } from "./migrations/020_registered_source_and_job_freshness.js";
import { runtimeDatabaseRolesMigration } from "./migrations/021_runtime_database_roles.js";
import { matchWorkerOwnerDeletionPrivilegesMigration } from "./migrations/022_match_worker_owner_deletion_privileges.js";
import { applicationCaseCoreExpandMigration } from "./migrations/023_application_case_core_expand.js";
import { resumeDocumentV2ExpandMigration } from "./migrations/024_resume_document_v2_expand.js";
import { identityAccountEmailExpandMigration } from "./migrations/025_identity_account_email_expand.js";
import { applicationCaseLongLivedForwardRepairMigration } from "./migrations/026_application_case_long_lived_forward_repair.js";
import { privateRequirementContextForwardRepairMigration } from "./migrations/026b_private_requirement_context_forward_repair.js";
import { resumeDocumentReviewForwardRepairMigration } from "./migrations/027_resume_document_review_forward_repair.js";
import { interviewDebriefKnowledgeExpandMigration } from "./migrations/028_interview_debrief_knowledge_expand.js";
import { caseMutationEventV2ForwardRepairMigration } from "./migrations/029_case_mutation_event_v2_forward_repair.js";
import { resumeRevisionMutationReceiptsMigration } from "./migrations/030_resume_revision_mutation_receipts.js";
import { resumeReviewTaskTypeMigration } from "./migrations/031_resume_review_task_type.js";
import { debriefItemDecisionsMigration } from "./migrations/032_debrief_item_decisions.js";
import { resumeReviewV2ExpandMigration } from "./migrations/033_resume_review_v2_expand.js";
import type { Database } from "./types.js";

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return {
      "001_initial": initialMigration,
      "002_harden_source_and_catalog_integrity": hardenSourceAndCatalogIntegrityMigration,
      "003_persist_source_target_policy": persistSourceTargetPolicyMigration,
      "004_local_complete_mvp": localCompleteMvpMigration,
      "005_enforce_owner_isolation": enforceOwnerIsolationMigration,
      "006_allow_tailoring_fallback_outcome": allowTailoringFallbackOutcomeMigration,
      "007_freeze_recommendation_candidate_freshness":
        freezeRecommendationCandidateFreshnessMigration,
      "008_link_source_revisions_to_published_versions":
        linkSourceRevisionsToPublishedVersionsMigration,
      "009_minimize_resume_analysis_storage": minimizeResumeAnalysisStorageMigration,
      "010_enforce_purged_resume_analysis_erasure": enforcePurgedResumeAnalysisErasureMigration,
      "011_g2_correctness_foundations": g2CorrectnessFoundationsMigration,
      "012_allow_resume_analysis_v2_metadata": allowResumeAnalysisV2MetadataMigration,
      "013_enforce_correctness_projection_ownership":
        enforceCorrectnessProjectionOwnershipMigration,
      "014_employer_scale_and_job_insights": employerScaleAndJobInsightsMigration,
      "015_freeze_job_insight_source_verifications": freezeJobInsightSourceVerificationsMigration,
      "016_company_quota_selections": companyQuotaSelectionsMigration,
      "017_source_refresh_automation": sourceRefreshAutomationMigration,
      "018_adapter_descriptors_and_manual_runs": adapterDescriptorsAndManualRunsMigration,
      "019_official_source_catalog_eligibility": officialSourceCatalogEligibilityMigration,
      "020_registered_source_and_job_freshness": registeredSourceAndJobFreshnessMigration,
      "021_runtime_database_roles": runtimeDatabaseRolesMigration,
      "022_match_worker_owner_deletion_privileges": matchWorkerOwnerDeletionPrivilegesMigration,
      "023_application_case_core_expand": applicationCaseCoreExpandMigration,
      "024_resume_document_v2_expand": resumeDocumentV2ExpandMigration,
      "025_identity_account_email_expand": identityAccountEmailExpandMigration,
      "026_application_case_long_lived_forward_repair":
        applicationCaseLongLivedForwardRepairMigration,
      "026b_private_requirement_context_forward_repair":
        privateRequirementContextForwardRepairMigration,
      "027_resume_document_review_forward_repair": resumeDocumentReviewForwardRepairMigration,
      "028_interview_debrief_knowledge_expand": interviewDebriefKnowledgeExpandMigration,
      "029_case_mutation_event_v2_forward_repair": caseMutationEventV2ForwardRepairMigration,
      "030_resume_revision_mutation_receipts": resumeRevisionMutationReceiptsMigration,
      "031_resume_review_task_type": resumeReviewTaskTypeMigration,
      "032_debrief_item_decisions": debriefItemDecisionsMigration,
      "033_resume_review_v2_expand": resumeReviewV2ExpandMigration,
    };
  }
}

function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({
    db,
    provider: new StaticMigrationProvider(),
  });
}

function assertMigrationResult(input: {
  error?: unknown;
  results?: readonly { migrationName: string; status: string }[];
}): void {
  for (const result of input.results ?? []) {
    const message = `${result.migrationName}: ${result.status}`;
    if (result.status === "Error") {
      console.error(message);
    } else {
      console.info(message);
    }
  }

  if (input.error) {
    throw input.error;
  }
}

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  assertMigrationResult(await createMigrator(db).migrateToLatest());
}

export async function migrateToForTesting(
  db: Kysely<Database>,
  migrationName: string,
): Promise<void> {
  if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") {
    throw new Error("MIGRATE_TO_VERSION_IS_TEST_ONLY");
  }
  assertMigrationResult(await createMigrator(db).migrateTo(migrationName));
}
