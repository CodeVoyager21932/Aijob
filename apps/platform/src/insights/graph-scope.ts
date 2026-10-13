import { catalogSourceForRecord } from "../catalog/source-context.js";
import type { JobGraphScope } from "@aijob/contracts";
import { sql } from "kysely";
import { eligibleJobVersions } from "../catalog/eligibility-query.js";
import { JOB_SEMANTICS_VERSION } from "../catalog/job-semantics.js";
import { AI_JOB_SEMANTICS_VERSION } from "../catalog/semantic-enrichment.js";

export function scopedJobs(scope: JobGraphScope, local: boolean, semanticVersion?: string) {
  const family = !scope.jobFamily
    ? sql``
    : scope.jobFamily === "unclassified"
      ? sql`AND semantics.primary_family IS NULL`
      : sql`AND ${scope.jobFamily} = ANY(semantics.families)`;
  const city = !scope.cities.length
    ? sql``
    : sql`AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(CASE WHEN COALESCE(projection.locations, version.locations)->>'state' = 'known'
      AND jsonb_typeof(COALESCE(projection.locations, version.locations)->'value') = 'array'
      THEN COALESCE(projection.locations, version.locations)->'value' ELSE '[]'::jsonb END) AS location(value), unnest(${scope.cities}::text[]) AS wanted(value)
    WHERE strpos(location.value, wanted.value) > 0)`;
  const education = !scope.educationLevels.length
    ? sql``
    : sql`AND (
    semantics.education_levels && ${scope.educationLevels.filter((value) => value !== "unknown")}::text[]
    OR (${scope.educationLevels.includes("unknown")} AND COALESCE(cardinality(semantics.education_levels), 0) = 0))`;
  const patterns = {
    internship: "实习|intern",
    campus: "校招|校园|campus",
    new_grad: "应届|毕业生|graduate",
    management_trainee: "管培|培训生|trainee",
  };
  const recruitmentPatterns = scope.recruitmentTypes
    .filter((value): value is keyof typeof patterns => value !== "unknown")
    .map((value) => patterns[value]);
  const recruitment = !scope.recruitmentTypes.length
    ? sql``
    : sql`AND (
    ${recruitmentPatterns.length ? sql`COALESCE(version.recruitment_type->>'value', '') ~* ${recruitmentPatterns.join("|")}` : sql`false`}
    OR (${scope.recruitmentTypes.includes("unknown")} AND COALESCE(version.recruitment_type->>'state', 'unknown') <> 'known'))`;
  return sql`
    FROM catalog.published_jobs job
    JOIN catalog.published_job_versions version ON version.id = ${sql.ref(local ? "job.current_version_id" : "job.public_version_id")}
    JOIN (${eligibleJobVersions(local)}) eligibility ON eligibility.published_job_version_id = version.id
    JOIN ingestion.source_job_revisions revision ON revision.id = version.source_job_revision_id
    JOIN ingestion.source_job_records record ON record.id = revision.source_job_record_id
    JOIN LATERAL (${catalogSourceForRecord(sql`record.source_id`)}) source ON true
    LEFT JOIN catalog.job_condition_projections projection ON projection.published_job_version_id = version.id AND projection.requirement_set_id = version.active_requirement_set_id
    LEFT JOIN LATERAL (SELECT * FROM catalog.job_semantic_indexes candidate WHERE candidate.job_version_id=version.id AND ${semanticVersion ? sql`candidate.extraction_version=${semanticVersion}` : sql`candidate.extraction_version IN (${JOB_SEMANTICS_VERSION},${AI_JOB_SEMANTICS_VERSION})`} ORDER BY (candidate.mode='ai') DESC LIMIT 1) semantics ON true
    WHERE eligibility.effective_activity_state <> 'closed' AND revision.ingestion_state = 'validated'
      AND revision.publication_state IN ('review','published')
      AND ${local ? sql`source.policy_status IN ('approved','pending_review')` : sql`source.policy_status = 'approved'`}
      ${family} ${city} ${education} ${recruitment}
      ${scope.subrole ? sql`AND semantics.subrole = ${scope.subrole}` : sql``}
      ${scope.batch ? sql`AND version.recruitment_batch->>'state' = 'known' AND version.recruitment_batch->>'value' = ${scope.batch}` : sql``}
  `;
}
