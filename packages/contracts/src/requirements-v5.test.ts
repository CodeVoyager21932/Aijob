import { describe, expect, it } from "vitest";

import {
  JobRequirementSchema,
  JobRequirementSetSchema,
  JobRequirementSetV5Schema,
  JobRequirementV5Schema,
  RequirementSourceUnitSchema,
} from "./index.js";

const sourceSpan = { start: 0, end: 12, excerptHash: "a".repeat(64) };
const sourceUnits = [
  {
    id: "source-jd-1",
    origin: { kind: "jd_clause" as const },
    section: "requirements" as const,
    text: "每周到岗 4 天",
    sourceSpan,
    evidenceRefs: ["revision-1#requirements"],
  },
  {
    id: "source-field-1",
    origin: { kind: "structured_field" as const, field: "weekly_attendance_days" as const },
    text: "4",
    sourceSpan: null,
    evidenceRefs: ["revision-1#weekly_attendance_days"],
  },
  {
    id: "source-private-1",
    origin: { kind: "private_jd_clause" as const },
    section: "requirements" as const,
    text: "熟悉 SQL",
    sourceSpan: null,
    evidenceRefs: ["private-jd-1"],
  },
];

const requirement = {
  id: "requirement-1",
  kind: "weekly_attendance" as const,
  operator: "at_least" as const,
  expectedValue: 4,
  sourceText: "每周到岗 4 天",
  evidenceRefs: ["revision-1#requirements"],
  sourceSpan,
  sourceUnitId: "source-jd-1",
  necessity: "required" as const,
};

const requirementSet = {
  id: "requirement-set-1",
  publishedJobVersionId: "version-1",
  schemaVersion: "job-requirements-v5",
  sourceUnits,
  requirements: [requirement],
  contentHash: "b".repeat(64),
  createdAt: "2026-09-01T00:00:00.000Z",
};

describe("job requirement v5 contracts", () => {
  it("represents JD clauses, structured fields and legacy private JD clauses explicitly", () => {
    for (const sourceUnit of sourceUnits) {
      expect(RequirementSourceUnitSchema.safeParse(sourceUnit).success).toBe(true);
    }
    expect(
      RequirementSourceUnitSchema.safeParse({
        ...sourceUnits[1],
        sourceSpan,
      }).success,
    ).toBe(false);
  });

  it("keeps v4 requirements and sets readable while defaulting source units", () => {
    const { sourceUnitId: _sourceUnitId, ...legacyRequirementInput } = requirement;
    const legacyRequirement = JobRequirementSchema.parse({
      ...legacyRequirementInput,
      necessity: undefined,
      required: true,
    });
    expect(legacyRequirement).toMatchObject({ necessity: "required", sourceSpan });
    expect(legacyRequirement).not.toHaveProperty("sourceUnitId");

    const legacySet = JobRequirementSetSchema.parse({
      ...requirementSet,
      sourceUnits: undefined,
      requirements: [legacyRequirement],
      schemaVersion: "job-requirements-v4",
    });
    expect(legacySet.sourceUnits).toEqual([]);
  });

  it("requires sourceUnitId on every v5 assertion", () => {
    expect(JobRequirementV5Schema.safeParse(requirement).success).toBe(true);
    expect(
      JobRequirementV5Schema.safeParse({ ...requirement, sourceUnitId: undefined }).success,
    ).toBe(false);
  });

  it("validates v5 source references and unique source/assertion IDs", () => {
    expect(JobRequirementSetV5Schema.safeParse(requirementSet).success).toBe(true);
    expect(
      JobRequirementSetV5Schema.safeParse({
        ...requirementSet,
        requirements: [{ ...requirement, sourceUnitId: "missing-source" }],
      }).success,
    ).toBe(false);
    expect(
      JobRequirementSetV5Schema.safeParse({
        ...requirementSet,
        sourceUnits: [...sourceUnits, sourceUnits[0]],
      }).success,
    ).toBe(false);
    expect(
      JobRequirementSetV5Schema.safeParse({
        ...requirementSet,
        requirements: [requirement, { ...requirement, sourceUnitId: "source-field-1" }],
      }).success,
    ).toBe(false);
  });
});
