import { sql, type RawBuilder } from "kysely";

/** Resolve current source metadata once per query, instead of per job. */
export function catalogSourceContext() {
  return sql`WITH source_context AS MATERIALIZED (
    SELECT source.id,source.name,source.source_type,source.organization_id,
      organization.official_domain,organization.scale_band,organization.scale_evidence_url,
      organization.scale_evidence_text,organization.scale_verified_at,
      policy.provenance_level,policy.policy_status,
      COALESCE(runtime.freshness_state,'unknown') AS freshness_state
    FROM source_control.sources source
    JOIN source_control.organizations organization ON organization.id=source.organization_id
    JOIN source_control.source_policy_versions policy
      ON policy.source_id=source.id AND policy.version=source.current_policy_version
    LEFT JOIN source_control.source_runtime_states runtime ON runtime.source_id=source.id
  ) SELECT * FROM source_context`;
}

/** Keep the source-key condition inside the source lookup. This avoids passing
 * every source row through the outer job join while retaining current policy
 * and metadata from the same SQL snapshot. OFFSET 0 preserves that boundary. */
export function catalogSourceForRecord(sourceId: RawBuilder<unknown>) {
  return sql`SELECT * FROM (${catalogSourceContext()}) metadata
    WHERE metadata.id=${sourceId} OFFSET 0`;
}
