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
      "022_match_worker_owner_deletion_privileges":
        matchWorkerOwnerDeletionPrivilegesMigration,
    };
  }
}

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new StaticMigrationProvider(),
  });

  const { error, results } = await migrator.migrateToLatest();
  for (const result of results ?? []) {
    const message = `${result.migrationName}: ${result.status}`;
    if (result.status === "Error") {
      console.error(message);
    } else {
      console.info(message);
    }
  }

  if (error) {
    throw error;
  }
}
