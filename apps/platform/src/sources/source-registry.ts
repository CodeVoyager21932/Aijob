import { randomUUID } from "node:crypto";
import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { canonicalJson, hashCanonicalJson } from "../lib/canonical-json.js";
import { assessSource, type SourceConfig } from "./source-config.js";

export interface RegisteredSource {
  organizationId: string;
  sourceCandidateId: string;
  sourceId: string;
  policyVersion: number;
}

interface ComparableTarget {
  method: string;
  scheme: string;
  host: string;
  port: number;
  pathPrefix?: string;
  path_prefix?: string;
  allowRedirects?: boolean;
  allow_redirects?: boolean;
  allowedQueryParameters?: readonly string[];
  allowed_query_parameters?: readonly string[];
}

export function policyTargetSetComparable(targets: readonly ComparableTarget[]): string {
  const normalized = targets
    .map((target) => ({
      method: target.method,
      scheme: target.scheme,
      host: target.host.toLowerCase(),
      port: target.port,
      path_prefix: target.pathPrefix ?? target.path_prefix,
      allow_redirects: target.allowRedirects ?? target.allow_redirects ?? false,
      allowed_query_parameters: [
        ...(target.allowedQueryParameters ?? target.allowed_query_parameters ?? []),
      ].sort(),
    }))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  return canonicalJson(normalized);
}

export function assertPolicyVersionCanAdvance(
  currentPolicyVersion: number,
  requestedPolicyVersion: number,
): void {
  if (requestedPolicyVersion < currentPolicyVersion) {
    throw new Error("POLICY_VERSION_ROLLBACK_FORBIDDEN");
  }
}

function policyComparable(
  config: SourceConfig,
  targetSets: {
    fetchTargets: readonly ComparableTarget[];
    applyTargets: readonly ComparableTarget[];
  },
): string {
  return canonicalJson({
    policy_status: config.policy.status,
    provenance_level: config.candidate.provenanceLevel,
    acquisition_mode: config.candidate.acquisitionMode,
    adapter_key: config.policy.adapterKey,
    adapter_version: config.policy.adapterVersion,
    entrypoints: config.policy.entrypoints,
    crawl_interval: config.policy.crawlInterval,
    policy_notes: config.policy.policyNotes,
    reviewed_at: config.policy.reviewedAt,
    fetch_targets: JSON.parse(policyTargetSetComparable(targetSets.fetchTargets)),
    apply_targets: JSON.parse(policyTargetSetComparable(targetSets.applyTargets)),
  });
}

export async function registerSourceConfig(
  db: Kysely<Database>,
  config: SourceConfig,
): Promise<RegisteredSource> {
  return db.transaction().execute(async (transaction) => {
    let organization = await transaction
      .selectFrom("source_control.organizations")
      .selectAll()
      .where("slug", "=", config.organization.slug)
      .executeTakeFirst();

    if (!organization) {
      organization = await transaction
        .insertInto("source_control.organizations")
        .values({
          id: randomUUID(),
          slug: config.organization.slug,
          name: config.organization.name,
          official_domain: config.organization.officialDomain,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    const candidateId =
      (
        await transaction
          .selectFrom("source_control.source_candidates")
          .select("id")
          .where("source_key", "=", config.sourceKey)
          .executeTakeFirst()
      )?.id ?? randomUUID();

    const candidate = await transaction
      .insertInto("source_control.source_candidates")
      .values({
        id: candidateId,
        organization_id: organization.id,
        source_key: config.sourceKey,
        name: config.candidate.name,
        entrypoint_url: config.candidate.entrypointUrl,
        provenance_level: config.candidate.provenanceLevel,
        acquisition_mode: config.candidate.acquisitionMode,
        candidate_status: config.candidate.candidateStatus,
      })
      .onConflict((conflict) =>
        conflict.column("source_key").doUpdateSet({
          name: config.candidate.name,
          entrypoint_url: config.candidate.entrypointUrl,
          provenance_level: config.candidate.provenanceLevel,
          acquisition_mode: config.candidate.acquisitionMode,
          candidate_status: config.candidate.candidateStatus,
          updated_at: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    const assessment = assessSource(config);
    const assessmentPayload = {
      assessor: config.candidate.assessor,
      hardGates: config.candidate.hardGates,
      scores: config.candidate.scores,
      evidenceNotes: config.candidate.evidenceNotes,
      decision: assessment.decision,
    };

    await transaction
      .insertInto("source_control.source_assessments")
      .values({
        id: randomUUID(),
        source_candidate_id: candidate.id,
        assessment_hash: hashCanonicalJson(assessmentPayload),
        assessor: config.candidate.assessor,
        hard_gates: canonicalJson(config.candidate.hardGates),
        scores: canonicalJson(config.candidate.scores),
        total_score: assessment.totalScore,
        decision: assessment.decision,
        evidence_notes: config.candidate.evidenceNotes,
      })
      .onConflict((conflict) =>
        conflict.columns(["source_candidate_id", "assessment_hash"]).doNothing(),
      )
      .execute();

    const existingSource = await transaction
      .selectFrom("source_control.sources")
      .selectAll()
      .where("source_key", "=", config.sourceKey)
      .forUpdate()
      .executeTakeFirst();

    const source = existingSource
      ? await (async () => {
          assertPolicyVersionCanAdvance(
            existingSource.current_policy_version,
            config.policy.version,
          );
          return transaction
            .updateTable("source_control.sources")
            .set({
              organization_id: organization.id,
              source_candidate_id: candidate.id,
              source_type: config.sourceType,
              name: config.candidate.name,
              current_policy_version: config.policy.version,
            })
            .where("id", "=", existingSource.id)
            .returningAll()
            .executeTakeFirstOrThrow();
        })()
      : await transaction
          .insertInto("source_control.sources")
          .values({
            id: randomUUID(),
            organization_id: organization.id,
            source_candidate_id: candidate.id,
            source_key: config.sourceKey,
            source_type: config.sourceType,
            name: config.candidate.name,
            current_policy_version: config.policy.version,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

    const existingPolicy = await transaction
      .selectFrom("source_control.source_policy_versions")
      .selectAll()
      .where("source_id", "=", source.id)
      .where("version", "=", config.policy.version)
      .executeTakeFirst();

    if (existingPolicy) {
      const existingFetchTargets = await transaction
        .selectFrom("source_control.source_fetch_targets")
        .select([
          "method",
          "scheme",
          "host",
          "port",
          "path_prefix",
          "allow_redirects",
          "allowed_query_parameters",
        ])
        .where("source_id", "=", source.id)
        .where("policy_version", "=", config.policy.version)
        .execute();
      const existingApplyTargets = await transaction
        .selectFrom("source_control.source_apply_targets")
        .select([
          "method",
          "scheme",
          "host",
          "port",
          "path_prefix",
          "allow_redirects",
          "allowed_query_parameters",
        ])
        .where("source_id", "=", source.id)
        .where("policy_version", "=", config.policy.version)
        .execute();
      const existingComparable = canonicalJson({
        policy_status: existingPolicy.policy_status,
        provenance_level: existingPolicy.provenance_level,
        acquisition_mode: existingPolicy.acquisition_mode,
        adapter_key: existingPolicy.adapter_key,
        adapter_version: existingPolicy.adapter_version,
        entrypoints: existingPolicy.entrypoints,
        crawl_interval: existingPolicy.crawl_interval,
        policy_notes: existingPolicy.policy_notes,
        reviewed_at: existingPolicy.reviewed_at?.toISOString() ?? null,
        fetch_targets: JSON.parse(policyTargetSetComparable(existingFetchTargets)),
        apply_targets: JSON.parse(policyTargetSetComparable(existingApplyTargets)),
      });
      if (
        existingComparable !==
        policyComparable(config, {
          fetchTargets: config.policy.fetchTargets,
          applyTargets: config.policy.applyTargets,
        })
      ) {
        throw new Error("POLICY_VERSION_IMMUTABLE");
      }
    } else {
      await transaction
        .insertInto("source_control.source_policy_versions")
        .values({
          source_id: source.id,
          version: config.policy.version,
          policy_status: config.policy.status,
          provenance_level: config.candidate.provenanceLevel,
          acquisition_mode: config.candidate.acquisitionMode,
          adapter_key: config.policy.adapterKey,
          adapter_version: config.policy.adapterVersion,
          entrypoints: canonicalJson(config.policy.entrypoints),
          crawl_interval: config.policy.crawlInterval,
          policy_notes: config.policy.policyNotes,
          reviewed_at: config.policy.reviewedAt ? new Date(config.policy.reviewedAt) : null,
        })
        .execute();
    }

    for (const target of config.policy.fetchTargets) {
      await transaction
        .insertInto("source_control.source_fetch_targets")
        .values({
          id: randomUUID(),
          source_id: source.id,
          policy_version: config.policy.version,
          method: target.method,
          scheme: target.scheme,
          host: target.host,
          port: target.port,
          path_prefix: target.pathPrefix,
          allow_redirects: target.allowRedirects,
          allowed_query_parameters: target.allowedQueryParameters,
        })
        .onConflict((conflict) =>
          conflict
            .columns([
              "source_id",
              "policy_version",
              "method",
              "scheme",
              "host",
              "port",
              "path_prefix",
            ])
            .doNothing(),
        )
        .execute();
    }

    for (const target of config.policy.applyTargets) {
      await transaction
        .insertInto("source_control.source_apply_targets")
        .values({
          id: randomUUID(),
          source_id: source.id,
          policy_version: config.policy.version,
          method: target.method,
          scheme: target.scheme,
          host: target.host,
          port: target.port,
          path_prefix: target.pathPrefix,
          allow_redirects: target.allowRedirects,
          allowed_query_parameters: target.allowedQueryParameters,
        })
        .onConflict((conflict) =>
          conflict
            .columns([
              "source_id",
              "policy_version",
              "method",
              "scheme",
              "host",
              "port",
              "path_prefix",
            ])
            .doNothing(),
        )
        .execute();
    }

    await transaction
      .insertInto("source_control.source_runtime_states")
      .values({
        source_id: source.id,
        policy_version: config.policy.version,
        freshness_state: "unknown",
        last_complete_run_at: null,
        consecutive_failures: 0,
        last_error_code: null,
        next_due_at: null,
      })
      .onConflict((conflict) =>
        conflict.column("source_id").doUpdateSet({
          policy_version: config.policy.version,
          updated_at: new Date(),
        }),
      )
      .execute();

    return {
      organizationId: organization.id,
      sourceCandidateId: candidate.id,
      sourceId: source.id,
      policyVersion: config.policy.version,
    };
  });
}
