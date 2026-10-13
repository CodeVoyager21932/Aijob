import { sql } from "kysely";
/** Evaluate the authoritative eligibility view once before joining catalogue projections.
 * The barrier avoids repeatedly evaluating its nested policy/freshness joins per result row. */
export function eligibleJobVersions(local: boolean) {
  return sql`WITH eligible AS MATERIALIZED (
    SELECT published_job_version_id,effective_activity_state FROM catalog.job_version_eligibility
    WHERE ${local ? sql`eligible_for_local_mvp` : sql`eligible_for_alpha`}
  ) SELECT published_job_version_id,effective_activity_state FROM eligible`;
}
