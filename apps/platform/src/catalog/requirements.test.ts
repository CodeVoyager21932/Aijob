import type { FieldValue } from "@aijob/contracts";
import { JobRequirementSetV5Schema } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  decomposeKnownJobRequirements,
  decomposeTextualJobRequirements,
  splitRequirementClauses,
} from "./requirements.js";

function known<T>(value: T, field: string): FieldValue<T> {
  return { state: "known", value, evidenceRefs: [`revision#${field}`] };
}

/**
 * Asserts the combined structured + textual output forms a valid v5 requirement set:
 * unique source unit IDs and every assertion referencing an existing source unit.
 */
function assertReferentialIntegrity(
  structured: ReturnType<typeof decomposeKnownJobRequirements>,
  textual: ReturnType<typeof decomposeTextualJobRequirements>,
): void {
  const sourceUnits = [...structured.sourceUnits, ...textual.sourceUnits];
  const requirements = [...structured.requirements, ...textual.requirements];
  const ids = sourceUnits.map((unit) => unit.id);
  expect(new Set(ids).size).toBe(ids.length);
  const known = new Set(ids);
  for (const requirement of requirements) {
    expect(known.has(requirement.sourceUnitId)).toBe(true);
  }
  expect(() =>
    JobRequirementSetV5Schema.parse({
      id: "requirement-set-1",
      publishedJobVersionId: requirements[0]?.sourceUnitId
        ? "version-integrity"
        : "version-integrity",
      schemaVersion: "job-requirements-v5",
      sourceUnits,
      requirements,
      contentHash: "a".repeat(64),
      createdAt: new Date().toISOString(),
    }),
  ).not.toThrow();
}

describe("structured job requirement decomposition", () => {
  it("keeps the exact source excerpt, stable evidence and a structured_field source unit", () => {
    const input = {
      publishedJobVersionId: "version-1",
      weeklyAttendanceDays: {
        value: known(4, "weeklyAttendanceDays"),
        sourceText: "每周至少实习 4 天",
        necessity: "required" as const,
      },
      educationLevels: {
        value: known(["本科"], "educationLevels"),
        sourceText: "本科及以上学历",
        necessity: "preferred" as const,
      },
      locations: {
        value: known(["深圳"], "locations"),
        sourceText: "工作地点：深圳",
        necessity: "preferred" as const,
      },
    };
    const first = decomposeKnownJobRequirements(input);
    const second = decomposeKnownJobRequirements(input);

    expect(first).toEqual(second);
    expect(first.requirements).toHaveLength(3);
    expect(first.sourceUnits).toHaveLength(3);
    // Structured fields never claim to be JD quotes; they carry an explicit field origin.
    for (const unit of first.sourceUnits) {
      expect(unit.origin.kind).toBe("structured_field");
      expect(unit.sourceSpan).toBeNull();
    }
    const attendance = first.requirements.find(({ kind }) => kind === "weekly_attendance");
    expect(attendance).toMatchObject({
      kind: "weekly_attendance",
      operator: "at_least",
      expectedValue: 4,
      sourceText: "每周至少实习 4 天",
      evidenceRefs: ["revision#weeklyAttendanceDays"],
      necessity: "required",
    });
    const attendanceUnit = first.sourceUnits.find((unit) => unit.id === attendance?.sourceUnitId);
    expect(attendanceUnit?.origin).toEqual({
      kind: "structured_field",
      field: "weekly_attendance_days",
    });
    expect(first.requirements.find(({ kind }) => kind === "city")).toMatchObject({
      necessity: "preferred",
      expectedValue: ["深圳"],
    });
    assertReferentialIntegrity(
      first,
      decomposeTextualJobRequirements({
        publishedJobVersionId: "version-1",
        evidenceRefPrefix: "source-job-revision:version-1:requirements",
        sourceText: "",
      }),
    );
  });

  it("keeps structured conflicts unknown and ignores unknown or unquoted fields", () => {
    const { requirements } = decomposeKnownJobRequirements({
      publishedJobVersionId: "version-2",
      graduationYears: {
        value: { state: "unknown", reason: "source_not_stated" },
        sourceText: "未说明",
        necessity: "required",
      },
      majors: {
        value: {
          state: "conflict",
          rawValues: ["不限", "计算机"],
          evidenceRefs: ["revision#major-a", "revision#major-b"],
        },
        sourceText: "来源中存在冲突",
        necessity: "required",
      },
    });
    // Unknown graduation years are dropped; a structured conflict stays unknown; a known
    // structured language value becomes a structured_field assertion (not a JD quote).
    expect(requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "major",
          operator: "unknown",
          expectedValue: ["不限", "计算机"],
          evidenceRefs: ["revision#major-a", "revision#major-b"],
          necessity: "required",
        }),
      ]),
    );
    expect(requirements.some(({ kind }) => kind === "graduation_year")).toBe(false);
  });

  it("uses the quoted graduation range instead of keeping only structured endpoints", () => {
    const { requirements } = decomposeKnownJobRequirements({
      publishedJobVersionId: "version-structured-range",
      graduationYears: {
        value: known([2026, 2028], "graduationYears"),
        sourceText: "2026-2028 届毕业生",
        necessity: "required",
      },
    });

    expect(requirements[0]).toMatchObject({
      kind: "graduation_year",
      operator: "one_of",
      expectedValue: [2026, 2027, 2028],
      sourceText: "2026-2028 届毕业生",
      evidenceRefs: ["revision#graduationYears"],
    });
  });
});

describe("textual job requirement decomposition", () => {
  it("splits numbered official text while preserving exact requirement excerpts", () => {
    expect(
      splitRequirementClauses(
        "1、本科及以上学历；2、具备数据分析和沟通能力；3、有互联网实习经验优先。",
      ),
    ).toEqual(["本科及以上学历", "具备数据分析和沟通能力", "有互联网实习经验优先"]);
  });

  it("emits one source unit per visible clause and never splits on commas", () => {
    const { sourceUnits } = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-comma",
      evidenceRefPrefix: "source-job-revision:comma:requirements",
      sourceText: "本科及以上学历在读，至少实习 3 个月，每周不少于 4 天。",
    });
    // The whole sentence is one visible clause even though it packs several facts.
    expect(sourceUnits).toHaveLength(1);
    expect(sourceUnits[0]?.text).toBe("本科及以上学历在读，至少实习 3 个月，每周不少于 4 天");
    expect(sourceUnits[0]?.origin).toEqual({ kind: "jd_clause" });
  });

  it("decomposes hard facts and evidence terms without inventing missing values", () => {
    const { requirements } = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-text-1",
      evidenceRefPrefix: "source-job-revision:revision-1:requirements",
      sourceText:
        "1、本科及以上学历；2、2027 届在校生；3、具备数据分析、系统分析和沟通能力；4、有互联网项目经验优先；5、英语六级。",
    });

    expect(requirements.find(({ kind }) => kind === "education")).toMatchObject({
      operator: "one_of",
      expectedValue: ["本科", "硕士", "博士"],
      necessity: "required",
      evidenceRefs: ["source-job-revision:revision-1:requirements:1"],
    });
    expect(requirements.find(({ kind }) => kind === "graduation_year")).toMatchObject({
      operator: "one_of",
      expectedValue: [2027],
    });
    expect(requirements.find(({ kind }) => kind === "student_status")).toMatchObject({
      operator: "equals",
      expectedValue: true,
    });
    expect(requirements.find(({ kind }) => kind === "skill")).toMatchObject({
      operator: "contains",
      expectedValue: ["数据分析", "系统分析", "沟通"],
    });
    expect(requirements.find(({ kind }) => kind === "experience")).toMatchObject({
      necessity: "preferred",
      operator: "unknown",
      expectedValue: [],
    });
    // Every assertion carries the source unit id of the clause it came from.
    const { sourceUnits } = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-text-1",
      evidenceRefPrefix: "source-job-revision:revision-1:requirements",
      sourceText:
        "1、本科及以上学历；2、2027 届在校生；3、具备数据分析、系统分析和沟通能力；4、有互联网项目经验优先；5、英语六级。",
    });
    const unitIds = new Set(sourceUnits.map((unit) => unit.id));
    for (const requirement of requirements) {
      expect(unitIds.has(requirement.sourceUnitId)).toBe(true);
    }
  });

  it("keeps hard facts atomic when a later comma-delimited clause is preferred", () => {
    const { requirements } = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-meituan-target",
      evidenceRefPrefix: "source-job-revision:meituan:requirements",
      sourceText: "本科及以上学历在读，至少实习 3 个月，每周不少于 4 天，有互联网产品经验优先。",
    });

    expect(requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "education", necessity: "required" }),
        expect.objectContaining({ kind: "student_status", necessity: "required" }),
        expect.objectContaining({ kind: "duration", expectedValue: 3, necessity: "required" }),
        expect.objectContaining({
          kind: "weekly_attendance",
          expectedValue: 4,
          necessity: "required",
        }),
        expect.objectContaining({ kind: "experience", necessity: "preferred" }),
      ]),
    );
  });

  it("keeps ambiguous majors as unknown instead of treating alternatives as cumulative", () => {
    const { requirements } = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-text-2",
      evidenceRefPrefix: "source-job-revision:revision-2:requirements",
      sourceText: "计算机、软件或设计相关专业",
    });
    expect(requirements[0]).toMatchObject({
      kind: "major",
      operator: "unknown",
      expectedValue: ["计算机", "软件", "设计"],
    });
  });

  it("extracts attendance and duration while preserving range semantics for graduation", () => {
    const { requirements } = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-text-3",
      evidenceRefPrefix: "source-job-revision:revision-3:requirements",
      sourceText: "2027 届及以后在校生；每周至少出勤四天；连续实习 3 个月。",
    });
    expect(requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "graduation_year",
          operator: "at_least",
          expectedValue: 2027,
        }),
        expect.objectContaining({
          kind: "student_status",
          operator: "equals",
          expectedValue: true,
        }),
        expect.objectContaining({
          kind: "weekly_attendance",
          operator: "at_least",
          expectedValue: 4,
        }),
        expect.objectContaining({ kind: "duration", operator: "at_least", expectedValue: 3 }),
      ]),
    );
  });

  it("scopes a 加分项 heading to the numbered clauses that follow it", () => {
    const { requirements } = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-preferred-scope",
      evidenceRefPrefix: "source-job-revision:scope:requirements",
      sourceText: "任职要求：\n1、本科及以上学历。\n加分项：\n1、有数据分析经验。\n2、熟悉 SQL。",
    });
    const education = requirements.find(({ kind }) => kind === "education");
    const experience = requirements.find(({ kind }) => kind === "experience");
    const skill = requirements.find(({ kind }) => kind === "skill");
    expect(education?.necessity).toBe("required");
    expect(experience?.necessity).toBe("preferred");
    expect(skill?.necessity).toBe("preferred");
  });

  it.each(["2026-2028 届在校生", "2026 至 2028 届在校生"])(
    "expands the explicit continuous graduation range in %s",
    (sourceText) => {
      const { requirements } = decomposeTextualJobRequirements({
        publishedJobVersionId: "version-graduation-range",
        evidenceRefPrefix: "source-job-revision:range:requirements",
        sourceText,
      });
      const graduation = requirements.find(({ kind }) => kind === "graduation_year");

      expect(graduation).toMatchObject({
        operator: "one_of",
        expectedValue: [2026, 2027, 2028],
        sourceText,
        evidenceRefs: ["source-job-revision:range:requirements:1"],
      });
    },
  );

  it.each([
    ["连续实习三个月", 3],
    ["至少三个月", 3],
    ["实习不少于十二个月", 12],
  ])("extracts the explicit Chinese duration in %s", (sourceText, expectedMonths) => {
    const { requirements } = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-chinese-duration",
      evidenceRefPrefix: "source-job-revision:duration:requirements",
      sourceText,
    });
    const duration = requirements.find(({ kind }) => kind === "duration");

    expect(duration).toMatchObject({
      operator: "at_least",
      expectedValue: expectedMonths,
      sourceText,
      evidenceRefs: ["source-job-revision:duration:requirements:1"],
    });
  });

  it("keeps malformed ranges and past-experience durations out of known hard conditions", () => {
    const malformedRange = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-malformed-range",
      evidenceRefPrefix: "source-job-revision:malformed:requirements",
      sourceText: "2028-2026 届毕业生",
    }).requirements.find(({ kind }) => kind === "graduation_year");
    const experienceDuration = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-experience-duration",
      evidenceRefPrefix: "source-job-revision:experience:requirements",
      sourceText: "至少三个月工作经验",
    }).requirements;

    expect(malformedRange).toMatchObject({
      operator: "unknown",
      expectedValue: [],
      sourceText: "2028-2026 届毕业生",
      evidenceRefs: ["source-job-revision:malformed:requirements:1"],
    });
    expect(experienceDuration.some(({ kind }) => kind === "duration")).toBe(false);
  });

  it("does not turn an explicit no-restriction statement into a blocking assertion", () => {
    const { requirements, sourceUnits } = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-text-4",
      evidenceRefPrefix: "source-job-revision:revision-4:requirements",
      sourceText: "专业不限；无经验要求。",
    });
    // The clauses stay visible as source units, but they generate no blocking assertions.
    expect(requirements).toEqual([]);
    expect(sourceUnits.map((unit) => unit.text)).toEqual(["专业不限", "无经验要求"]);
  });

  it("does not classify 汉语言 majors as a language requirement", () => {
    const { requirements } = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-hanyu",
      evidenceRefPrefix: "source-job-revision:hanyu:requirements",
      sourceText: "汉语言文学专业本科在读。",
    });
    expect(requirements.some(({ kind }) => kind === "language")).toBe(false);
    expect(requirements.find(({ kind }) => kind === "major")).toMatchObject({
      operator: "contains",
      expectedValue: "汉语言",
    });
  });

  it("does not read 经验 out of the fixed phrase 未经验证", () => {
    const { requirements } = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-weijing",
      evidenceRefPrefix: "source-job-revision:weijing:requirements",
      sourceText: "提交的作品集为本人原创且未经验证的除外。",
    });
    expect(requirements.some(({ kind }) => kind === "experience")).toBe(false);
  });

  it("does not treat 实习时间 schedule wording as prior experience", () => {
    const { requirements } = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-shixi-time",
      evidenceRefPrefix: "source-job-revision:shixi:requirements",
      sourceText: "实习时间：每周到岗四天，可实习六个月及以上者优先。",
    });
    expect(requirements.some(({ kind }) => kind === "experience")).toBe(false);
    expect(requirements.find(({ kind }) => kind === "weekly_attendance")).toMatchObject({
      operator: "at_least",
      expectedValue: 4,
    });
    expect(requirements.find(({ kind }) => kind === "duration")).toMatchObject({
      operator: "at_least",
      expectedValue: 6,
      necessity: "preferred",
    });
  });
});
