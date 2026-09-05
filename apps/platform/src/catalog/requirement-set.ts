import {
  type JobRequirement,
  JobRequirementSetSchema,
  JobRequirementSetV5Schema,
  type RequirementSourceUnit,
} from "@aijob/contracts";
import type { JsonValue } from "@aijob/database";

interface StoredRequirementSetRow {
  id: string;
  published_job_version_id: string;
  schema_version: string;
  source_units: JsonValue;
  requirements: JsonValue;
  content_hash: string;
  created_at: Date;
}

function parseJson(value: JsonValue): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export interface ParsedStoredRequirementSet {
  schemaVersion: string;
  sourceUnits: RequirementSourceUnit[];
  requirements: JobRequirement[];
}

/** Reads immutable requirement sets without silently weakening v5 provenance validation. */
export function parseStoredRequirementSet(
  row: StoredRequirementSetRow,
): ParsedStoredRequirementSet {
  const common = {
    id: row.id,
    publishedJobVersionId: row.published_job_version_id,
    schemaVersion: row.schema_version,
    contentHash: row.content_hash,
    createdAt: row.created_at.toISOString(),
  };
  if (row.schema_version === "job-requirements-v5") {
    const parsed = JobRequirementSetV5Schema.parse({
      ...common,
      sourceUnits: parseJson(row.source_units),
      requirements: parseJson(row.requirements),
    });
    return {
      schemaVersion: parsed.schemaVersion,
      sourceUnits: parsed.sourceUnits,
      requirements: parsed.requirements,
    };
  }
  const parsed = JobRequirementSetSchema.parse({
    ...common,
    sourceUnits: [],
    requirements: parseJson(row.requirements),
  });
  return {
    schemaVersion: parsed.schemaVersion,
    sourceUnits: [],
    requirements: parsed.requirements,
  };
}
