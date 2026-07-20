import type { FieldValue } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  decomposeKnownJobRequirements,
  decomposeTextualJobRequirements,
  splitRequirementClauses,
} from "./requirements.js";

function known<T>(value: T, field: string): FieldValue<T> {
  return { state: "known", value, evidenceRefs: [`revision#${field}`] };
}

describe("deterministic job requirement decomposition", () => {
  it("keeps the exact source excerpt and stable evidence references", () => {
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
    expect(first).toHaveLength(3);
    expect(first.find(({ kind }) => kind === "weekly_attendance")).toMatchObject({
      kind: "weekly_attendance",
      operator: "at_least",
      expectedValue: 4,
      sourceText: "每周至少实习 4 天",
      evidenceRefs: ["revision#weeklyAttendanceDays"],
      necessity: "required",
    });
    expect(first.find(({ kind }) => kind === "city")).toMatchObject({
      necessity: "preferred",
      expectedValue: ["深圳"],
    });
  });

  it("keeps structured conflicts unknown and ignores unknown or unquoted fields", () => {
    const requirements = decomposeKnownJobRequirements({
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
      languages: {
        value: known(["英语"], "languages"),
        necessity: "required",
      },
    });
    expect(requirements).toEqual([
      expect.objectContaining({
        kind: "major",
        operator: "unknown",
        expectedValue: ["不限", "计算机"],
        evidenceRefs: ["revision#major-a", "revision#major-b"],
        necessity: "required",
      }),
    ]);
  });

  it("uses the quoted graduation range instead of keeping only structured endpoints", () => {
    const [graduation] = decomposeKnownJobRequirements({
      publishedJobVersionId: "version-structured-range",
      graduationYears: {
        value: known([2026, 2028], "graduationYears"),
        sourceText: "2026-2028 届毕业生",
        necessity: "required",
      },
    });

    expect(graduation).toMatchObject({
      kind: "graduation_year",
      operator: "one_of",
      expectedValue: [2026, 2027, 2028],
      sourceText: "2026-2028 届毕业生",
      evidenceRefs: ["revision#graduationYears"],
    });
  });

  it("splits numbered official text while preserving exact requirement excerpts", () => {
    expect(
      splitRequirementClauses(
        "1、本科及以上学历；2、具备数据分析和沟通能力；3、有互联网实习经验优先。",
      ),
    ).toEqual(["本科及以上学历", "具备数据分析和沟通能力", "有互联网实习经验优先"]);
  });

  it("decomposes hard facts and evidence terms without inventing missing values", () => {
    const requirements = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-text-1",
      evidenceRefPrefix: "source-job-revision:revision-1:requirements",
      sourceText:
        "1、本科及以上学历；2、2027 届在校生；3、具备数据分析、系统分析和沟通能力；4、有互联网项目经验优先；5、英语六级。",
    });

    expect(requirements).toHaveLength(6);
    expect(requirements[0]).toMatchObject({
      kind: "education",
      operator: "one_of",
      expectedValue: ["本科", "硕士", "博士"],
      necessity: "required",
      evidenceRefs: ["source-job-revision:revision-1:requirements:1"],
    });
    expect(requirements[1]).toMatchObject({
      kind: "graduation_year",
      operator: "one_of",
      expectedValue: [2027],
    });
    expect(requirements[2]).toMatchObject({
      kind: "student_status",
      operator: "equals",
      expectedValue: true,
    });
    expect(requirements[3]).toMatchObject({
      kind: "skill",
      operator: "contains",
      expectedValue: ["数据分析", "系统分析", "沟通"],
    });
    expect(requirements[4]).toMatchObject({
      kind: "experience",
      necessity: "preferred",
      operator: "unknown",
      expectedValue: [],
    });
    expect(requirements[5]).toMatchObject({
      kind: "language",
      operator: "unknown",
      expectedValue: [],
    });
  });

  it("keeps hard facts atomic when a later comma-delimited clause is preferred", () => {
    const requirements = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-meituan-target",
      evidenceRefPrefix: "source-job-revision:meituan:requirements",
      sourceText: "本科及以上学历在读，至少实习 3 个月，每周不少于 4 天，有互联网产品经验优先。",
    });

    expect(requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "education", necessity: "required" }),
        expect.objectContaining({ kind: "student_status", necessity: "required" }),
        expect.objectContaining({
          kind: "duration",
          expectedValue: 3,
          necessity: "required",
        }),
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
    const [requirement] = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-text-2",
      evidenceRefPrefix: "source-job-revision:revision-2:requirements",
      sourceText: "计算机、软件或设计相关专业",
    });
    expect(requirement).toMatchObject({
      kind: "major",
      operator: "unknown",
      expectedValue: ["计算机", "软件", "设计"],
    });
  });

  it("extracts attendance and duration while preserving range semantics for graduation", () => {
    const requirements = decomposeTextualJobRequirements({
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
        expect.objectContaining({
          kind: "duration",
          operator: "at_least",
          expectedValue: 3,
        }),
      ]),
    );
  });

  it.each(["2026-2028 届在校生", "2026 至 2028 届在校生"])(
    "expands the explicit continuous graduation range in %s",
    (sourceText) => {
      const requirements = decomposeTextualJobRequirements({
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
    const requirements = decomposeTextualJobRequirements({
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
    }).find(({ kind }) => kind === "graduation_year");
    const experienceDuration = decomposeTextualJobRequirements({
      publishedJobVersionId: "version-experience-duration",
      evidenceRefPrefix: "source-job-revision:experience:requirements",
      sourceText: "至少三个月工作经验",
    });

    expect(malformedRange).toMatchObject({
      operator: "unknown",
      expectedValue: [],
      sourceText: "2028-2026 届毕业生",
      evidenceRefs: ["source-job-revision:malformed:requirements:1"],
    });
    expect(experienceDuration.some(({ kind }) => kind === "duration")).toBe(false);
  });

  it("does not turn an explicit no-restriction statement into a blocking unknown", () => {
    expect(
      decomposeTextualJobRequirements({
        publishedJobVersionId: "version-text-4",
        evidenceRefPrefix: "source-job-revision:revision-4:requirements",
        sourceText: "专业不限；无经验要求。",
      }),
    ).toEqual([]);
  });
});
