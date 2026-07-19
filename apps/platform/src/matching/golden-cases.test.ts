import type {
  JobPreference,
  JobRequirement,
  MatchRunResult,
  ProfileFact,
  ResumeEvidence,
} from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { evaluateThreeAxisMatch, type MatchableJob } from "./engine.js";
import { compareRecommendations, recommendationReasonCodes } from "./ranking.js";

const sourceRef = "job-version-1#requirements";

const baseJob: MatchableJob = {
  companyName: "示例公司",
  jobFamily: { state: "known", value: "product", evidenceRefs: ["job#family"] },
  locations: { state: "known", value: ["深圳"], evidenceRefs: ["job#locations"] },
  weeklyAttendanceDays: { state: "known", value: 4, evidenceRefs: ["job#attendance"] },
  durationMonths: { state: "known", value: 3, evidenceRefs: ["job#duration"] },
  workMode: { state: "known", value: "hybrid", evidenceRefs: ["job#work-mode"] },
};

const noPreferences: JobPreference = {
  cities: [],
  jobFamilies: [],
  companyNames: [],
  workModes: [],
};

function requirement(
  input: Partial<JobRequirement> & Pick<JobRequirement, "id" | "kind" | "expectedValue">,
): JobRequirement {
  return {
    operator: "equals",
    sourceText: "岗位原文中的明确要求",
    evidenceRefs: [sourceRef],
    required: true,
    ...input,
  };
}

function evidence(
  id: string,
  input: Partial<Omit<ResumeEvidence, "id" | "confirmed">> = {},
): ResumeEvidence {
  return {
    id,
    resumeAnalysisId: null,
    section: "项目经历",
    originalText: "负责用户研究并使用 SQL 分析转化漏斗",
    claim: "分析用户行为与转化漏斗",
    skills: ["用户研究", "SQL"],
    outcomes: ["输出研究报告"],
    confirmed: true,
    ...input,
  };
}

type AxisStatus = {
  eligibility: MatchRunResult["eligibility"]["status"];
  evidence: MatchRunResult["evidence"]["status"];
  preference: MatchRunResult["preference"]["status"];
};

interface GoldenExpectation extends AxisStatus {
  eligibilityReasonCodes: string[];
  evidenceReasonCodes: string[];
  preferenceReasonCodes: string[];
  unknownRequirementIds: string[];
}

interface GoldenCase {
  id: string;
  name: string;
  requirements?: JobRequirement[];
  confirmedFacts?: ProfileFact[];
  confirmedEvidence?: ResumeEvidence[];
  preferences?: JobPreference;
  job?: MatchableJob;
  expected: GoldenExpectation;
}

function expected(
  eligibility: AxisStatus["eligibility"],
  evidenceStatus: AxisStatus["evidence"],
  preference: AxisStatus["preference"],
  detail: Partial<
    Pick<
      GoldenExpectation,
      | "eligibilityReasonCodes"
      | "evidenceReasonCodes"
      | "preferenceReasonCodes"
      | "unknownRequirementIds"
    >
  > = {},
): GoldenExpectation {
  return {
    eligibility,
    evidence: evidenceStatus,
    preference,
    eligibilityReasonCodes: detail.eligibilityReasonCodes ?? [],
    evidenceReasonCodes:
      detail.evidenceReasonCodes ??
      (evidenceStatus === "insufficient_information"
        ? ["JOB_HAS_NO_EXPLICIT_EVIDENCE_REQUIREMENT"]
        : evidenceStatus === "explicit_evidence"
          ? ["RESUME_EVIDENCE_FOUND"]
          : []),
    preferenceReasonCodes: detail.preferenceReasonCodes ?? [],
    unknownRequirementIds: detail.unknownRequirementIds ?? [],
  };
}

const goldenCases: GoldenCase[] = [
  {
    id: "GOLD-001",
    name: "岗位没有明确硬条件时只陈述未发现明确冲突",
    expected: expected("no_explicit_conflict", "insufficient_information", "not_set"),
  },
  {
    id: "GOLD-002",
    name: "毕业年份缺少已确认事实时保持需补充信息",
    requirements: [
      requirement({
        id: "req-graduation-2027",
        kind: "graduation_year",
        operator: "one_of",
        expectedValue: [2027],
      }),
    ],
    expected: expected("needs_information", "insufficient_information", "not_set", {
      eligibilityReasonCodes: ["REQUIRED_FACT_NOT_CONFIRMED"],
      unknownRequirementIds: ["req-graduation-2027"],
    }),
  },
  {
    id: "GOLD-003",
    name: "毕业年份包含于岗位批次时没有明确冲突",
    requirements: [
      requirement({
        id: "req-graduation-2027",
        kind: "graduation_year",
        operator: "one_of",
        expectedValue: [2027, 2028],
      }),
    ],
    confirmedFacts: [{ key: "graduation_year", value: 2027 }],
    expected: expected("no_explicit_conflict", "insufficient_information", "not_set"),
  },
  {
    id: "GOLD-004",
    name: "毕业年份不在明确批次中时产生可追溯硬冲突",
    requirements: [
      requirement({
        id: "req-graduation-2027",
        kind: "graduation_year",
        operator: "one_of",
        expectedValue: [2027],
      }),
    ],
    confirmedFacts: [{ key: "graduation_year", value: 2026 }],
    expected: expected("explicit_conflict", "insufficient_information", "not_set", {
      eligibilityReasonCodes: ["CONFIRMED_FACT_CONFLICT"],
    }),
  },
  {
    id: "GOLD-005",
    name: "学历比较忽略首尾空格和英文大小写",
    requirements: [
      requirement({ id: "req-education", kind: "education", expectedValue: " BACHELOR " }),
    ],
    confirmedFacts: [{ key: "education_level", value: "bachelor" }],
    expected: expected("no_explicit_conflict", "insufficient_information", "not_set"),
  },
  {
    id: "GOLD-006",
    name: "学历低于岗位明确要求时产生硬冲突而不是证据缺失",
    requirements: [requirement({ id: "req-education", kind: "education", expectedValue: "硕士" })],
    confirmedFacts: [{ key: "education_level", value: "本科" }],
    expected: expected("explicit_conflict", "insufficient_information", "not_set", {
      eligibilityReasonCodes: ["CONFIRMED_FACT_CONFLICT"],
    }),
  },
  {
    id: "GOLD-007",
    name: "工作地点不使用用户现居城市制造硬资格判断",
    requirements: [
      requirement({ id: "req-city", kind: "city", operator: "one_of", expectedValue: ["深圳"] }),
    ],
    confirmedFacts: [{ key: "current_city", value: "深圳" }],
    expected: expected("no_explicit_conflict", "insufficient_information", "not_set"),
  },
  {
    id: "GOLD-008",
    name: "用户现居城市不同也不会被错误判为硬资格冲突",
    requirements: [
      requirement({ id: "req-city", kind: "city", operator: "one_of", expectedValue: ["深圳"] }),
    ],
    confirmedFacts: [{ key: "current_city", value: "北京" }],
    expected: expected("no_explicit_conflict", "insufficient_information", "not_set"),
  },
  {
    id: "GOLD-009",
    name: "每周可出勤天数恰好达到下限",
    requirements: [
      requirement({
        id: "req-attendance",
        kind: "weekly_attendance",
        operator: "at_least",
        expectedValue: 4,
      }),
    ],
    confirmedFacts: [{ key: "weekly_attendance_days", value: 4 }],
    expected: expected("no_explicit_conflict", "insufficient_information", "not_set"),
  },
  {
    id: "GOLD-010",
    name: "每周可出勤天数低于明确下限时产生硬冲突",
    requirements: [
      requirement({
        id: "req-attendance",
        kind: "weekly_attendance",
        operator: "at_least",
        expectedValue: 5,
      }),
    ],
    confirmedFacts: [{ key: "weekly_attendance_days", value: 4 }],
    expected: expected("explicit_conflict", "insufficient_information", "not_set", {
      eligibilityReasonCodes: ["CONFIRMED_FACT_CONFLICT"],
    }),
  },
  {
    id: "GOLD-011",
    name: "可持续实习月数达到岗位下限",
    requirements: [
      requirement({
        id: "req-duration",
        kind: "duration",
        operator: "at_least",
        expectedValue: 3,
      }),
    ],
    confirmedFacts: [{ key: "duration_months", value: 3 }],
    expected: expected("no_explicit_conflict", "insufficient_information", "not_set"),
  },
  {
    id: "GOLD-012",
    name: "可持续实习月数低于岗位下限时产生硬冲突",
    requirements: [
      requirement({
        id: "req-duration",
        kind: "duration",
        operator: "at_least",
        expectedValue: 6,
      }),
    ],
    confirmedFacts: [{ key: "duration_months", value: 3 }],
    expected: expected("explicit_conflict", "insufficient_information", "not_set", {
      eligibilityReasonCodes: ["CONFIRMED_FACT_CONFLICT"],
    }),
  },
  {
    id: "GOLD-013",
    name: "最早到岗日期恰好等于岗位截止日期",
    requirements: [
      requirement({
        id: "req-arrival",
        kind: "arrival_date",
        operator: "before_or_on",
        expectedValue: "2026-08-01",
      }),
    ],
    confirmedFacts: [{ key: "available_from", value: "2026-08-01" }],
    expected: expected("no_explicit_conflict", "insufficient_information", "not_set"),
  },
  {
    id: "GOLD-014",
    name: "最早到岗日期晚于岗位明确截止日期时产生硬冲突",
    requirements: [
      requirement({
        id: "req-arrival",
        kind: "arrival_date",
        operator: "before_or_on",
        expectedValue: "2026-08-01",
      }),
    ],
    confirmedFacts: [{ key: "available_from", value: "2026-08-02" }],
    expected: expected("explicit_conflict", "insufficient_information", "not_set", {
      eligibilityReasonCodes: ["CONFIRMED_FACT_CONFLICT"],
    }),
  },
  {
    id: "GOLD-015",
    name: "缺少到岗日期时不能假定可到岗",
    requirements: [
      requirement({
        id: "req-arrival",
        kind: "arrival_date",
        operator: "before_or_on",
        expectedValue: "2026-08-01",
      }),
    ],
    expected: expected("needs_information", "insufficient_information", "not_set", {
      eligibilityReasonCodes: ["REQUIRED_FACT_NOT_CONFIRMED"],
      unknownRequirementIds: ["req-arrival"],
    }),
  },
  {
    id: "GOLD-016",
    name: "岗位要求未能可靠结构化时即使用户有事实也保持未知",
    requirements: [
      requirement({
        id: "req-unknown-graduation",
        kind: "graduation_year",
        operator: "unknown",
        expectedValue: null,
      }),
    ],
    confirmedFacts: [{ key: "graduation_year", value: 2027 }],
    expected: expected("needs_information", "insufficient_information", "not_set", {
      eligibilityReasonCodes: ["REQUIRED_FACT_NOT_CONFIRMED"],
      unknownRequirementIds: ["req-unknown-graduation"],
    }),
  },
  {
    id: "GOLD-017",
    name: "优先项而非硬条件时不得产生资格冲突",
    requirements: [
      requirement({
        id: "req-optional-language",
        kind: "language",
        operator: "contains",
        expectedValue: ["英语"],
        required: false,
      }),
    ],
    confirmedFacts: [{ key: "languages", value: ["日语"] }],
    expected: expected("no_explicit_conflict", "insufficient_information", "not_set"),
  },
  {
    id: "GOLD-018",
    name: "一个明确冲突与一个未知并存时冲突优先但未知仍可追溯",
    requirements: [
      requirement({
        id: "req-attendance",
        kind: "weekly_attendance",
        operator: "at_least",
        expectedValue: 5,
      }),
      requirement({
        id: "req-graduation",
        kind: "graduation_year",
        operator: "one_of",
        expectedValue: [2027],
      }),
    ],
    confirmedFacts: [{ key: "weekly_attendance_days", value: 4 }],
    expected: expected("explicit_conflict", "insufficient_information", "not_set", {
      eligibilityReasonCodes: ["CONFIRMED_FACT_CONFLICT", "REQUIRED_FACT_NOT_CONFIRMED"],
      unknownRequirementIds: ["req-graduation"],
    }),
  },
  {
    id: "GOLD-019",
    name: "未确认毕业年份不进入 confirmedFacts 时不得参与确定结论",
    requirements: [
      requirement({
        id: "req-graduation",
        kind: "graduation_year",
        operator: "one_of",
        expectedValue: [2027],
      }),
    ],
    confirmedFacts: [],
    expected: expected("needs_information", "insufficient_information", "not_set", {
      eligibilityReasonCodes: ["REQUIRED_FACT_NOT_CONFIRMED"],
      unknownRequirementIds: ["req-graduation"],
    }),
  },
  {
    id: "GOLD-020",
    name: "专业属于岗位允许集合时没有明确冲突",
    requirements: [
      requirement({
        id: "req-major",
        kind: "major",
        operator: "one_of",
        expectedValue: ["计算机", "信息管理"],
      }),
    ],
    confirmedFacts: [{ key: "majors", value: ["信息管理"] }],
    expected: expected("no_explicit_conflict", "insufficient_information", "not_set"),
  },
  {
    id: "GOLD-021",
    name: "一项技能要求由确认经历完整支持",
    requirements: [
      requirement({ id: "req-sql", kind: "skill", operator: "contains", expectedValue: ["SQL"] }),
    ],
    confirmedEvidence: [evidence("evidence-sql")],
    expected: expected("no_explicit_conflict", "explicit_evidence", "not_set"),
  },
  {
    id: "GOLD-022",
    name: "同一要求仅覆盖部分技能词时是部分证据",
    requirements: [
      requirement({
        id: "req-research-sql",
        kind: "skill",
        operator: "contains",
        expectedValue: ["SQL", "Python"],
      }),
    ],
    confirmedEvidence: [evidence("evidence-sql")],
    expected: expected("no_explicit_conflict", "partial_evidence", "not_set", {
      evidenceReasonCodes: ["RESUME_EVIDENCE_PARTIAL"],
    }),
  },
  {
    id: "GOLD-023",
    name: "确认经历未体现技能时只标记简历暂未体现",
    requirements: [
      requirement({
        id: "req-python",
        kind: "skill",
        operator: "contains",
        expectedValue: ["Python"],
      }),
    ],
    confirmedEvidence: [evidence("evidence-sql")],
    expected: expected("no_explicit_conflict", "not_in_resume", "not_set", {
      evidenceReasonCodes: ["RESUME_EVIDENCE_NOT_FOUND"],
    }),
  },
  {
    id: "GOLD-024",
    name: "岗位证据要求没有可比较文本时是信息不足",
    requirements: [requirement({ id: "req-unstructured", kind: "other", expectedValue: null })],
    confirmedEvidence: [evidence("evidence-sql")],
    expected: expected("no_explicit_conflict", "insufficient_information", "not_set", {
      evidenceReasonCodes: ["EVIDENCE_REQUIREMENT_NOT_STRUCTURED"],
      unknownRequirementIds: ["req-unstructured"],
    }),
  },
  {
    id: "GOLD-025",
    name: "一个证据要求完整覆盖而另一个缺失时整体为部分证据",
    requirements: [
      requirement({ id: "req-sql", kind: "skill", operator: "contains", expectedValue: ["SQL"] }),
      requirement({
        id: "req-python",
        kind: "skill",
        operator: "contains",
        expectedValue: ["Python"],
      }),
    ],
    confirmedEvidence: [evidence("evidence-sql")],
    expected: expected("no_explicit_conflict", "partial_evidence", "not_set", {
      evidenceReasonCodes: ["RESUME_EVIDENCE_FOUND", "RESUME_EVIDENCE_NOT_FOUND"],
    }),
  },
  {
    id: "GOLD-026",
    name: "未确认经历不进入 confirmedEvidence 时不得产生明确证据",
    requirements: [
      requirement({ id: "req-sql", kind: "skill", operator: "contains", expectedValue: ["SQL"] }),
    ],
    confirmedEvidence: [],
    expected: expected("no_explicit_conflict", "not_in_resume", "not_set", {
      evidenceReasonCodes: ["RESUME_EVIDENCE_NOT_FOUND"],
    }),
  },
  {
    id: "GOLD-027",
    name: "已设置城市偏好且岗位城市命中时偏好符合",
    preferences: { ...noPreferences, cities: ["深圳"] },
    expected: expected("no_explicit_conflict", "insufficient_information", "fits"),
  },
  {
    id: "GOLD-028",
    name: "城市偏好不符只影响偏好轴而不制造资格冲突",
    preferences: { ...noPreferences, cities: ["北京"] },
    expected: expected("no_explicit_conflict", "insufficient_information", "does_not_fit", {
      preferenceReasonCodes: ["CITY_PREFERENCE_CONFLICT"],
    }),
  },
  {
    id: "GOLD-029",
    name: "岗位方向偏好不符时给出具体偏好理由",
    preferences: { ...noPreferences, jobFamilies: ["operations"] },
    expected: expected("no_explicit_conflict", "insufficient_information", "does_not_fit", {
      preferenceReasonCodes: ["JOB_FAMILY_PREFERENCE_CONFLICT"],
    }),
  },
  {
    id: "GOLD-030",
    name: "公司偏好不符时不改变资格或证据轴",
    preferences: { ...noPreferences, companyNames: ["目标公司"] },
    expected: expected("no_explicit_conflict", "insufficient_information", "does_not_fit", {
      preferenceReasonCodes: ["COMPANY_PREFERENCE_CONFLICT"],
    }),
  },
  {
    id: "GOLD-031",
    name: "工作方式偏好不符时给出偏好冲突",
    preferences: { ...noPreferences, workModes: ["remote"] },
    expected: expected("no_explicit_conflict", "insufficient_information", "does_not_fit", {
      preferenceReasonCodes: ["WORK_MODE_PREFERENCE_CONFLICT"],
    }),
  },
  {
    id: "GOLD-032",
    name: "岗位工作方式未知时不能把已设置偏好标记为符合",
    preferences: { ...noPreferences, workModes: ["remote"] },
    job: { ...baseJob, workMode: { state: "unknown", reason: "source_not_stated" } },
    expected: expected("no_explicit_conflict", "insufficient_information", "not_set", {
      preferenceReasonCodes: ["WORK_MODE_PREFERENCE_UNKNOWN"],
    }),
  },
];

describe("high-risk three-axis golden cases", () => {
  for (const golden of goldenCases) {
    it(`${golden.id} ${golden.name}`, () => {
      const result = evaluateThreeAxisMatch({
        requirements: golden.requirements ?? [],
        confirmedFacts: golden.confirmedFacts ?? [],
        confirmedEvidence: golden.confirmedEvidence ?? [],
        preferences: golden.preferences ?? noPreferences,
        job: golden.job ?? baseJob,
      });

      expect(
        {
          eligibility: result.eligibility.status,
          evidence: result.evidence.status,
          preference: result.preference.status,
        },
        `${golden.id} 三轴状态`,
      ).toEqual({
        eligibility: golden.expected.eligibility,
        evidence: golden.expected.evidence,
        preference: golden.expected.preference,
      });
      expect(
        result.eligibility.reasons.map((reason) => reason.code),
        `${golden.id} 资格理由`,
      ).toEqual(golden.expected.eligibilityReasonCodes);
      expect(
        result.evidence.reasons.map((reason) => reason.code),
        `${golden.id} 证据理由`,
      ).toEqual(golden.expected.evidenceReasonCodes);
      expect(
        result.preference.reasons.map((reason) => reason.code),
        `${golden.id} 偏好理由`,
      ).toEqual(golden.expected.preferenceReasonCodes);
      expect(result.unknownRequirementIds, `${golden.id} 未知要求`).toEqual(
        golden.expected.unknownRequirementIds,
      );
      for (const reason of [
        ...result.eligibility.reasons,
        ...result.evidence.reasons,
        ...result.preference.reasons,
      ]) {
        expect(reason.explanation.trim().length, `${golden.id} 理由必须可读`).toBeGreaterThan(0);
      }
    });
  }

  it("golden 集固定至少覆盖 20 个高风险案例", () => {
    expect(goldenCases.length).toBeGreaterThanOrEqual(20);
  });
});

describe("conflicting jobs remain inspectable without persuasion or percentages", () => {
  it("keeps a conflicting job in the deterministic recommendation collection", () => {
    const conflict = evaluateThreeAxisMatch({
      requirements: [
        requirement({
          id: "req-attendance",
          kind: "weekly_attendance",
          operator: "at_least",
          expectedValue: 5,
        }),
      ],
      confirmedFacts: [{ key: "weekly_attendance_days", value: 4 }],
      confirmedEvidence: [],
      preferences: noPreferences,
      job: baseJob,
    });
    const inspectableItems = [
      {
        publishedJobVersionId: "job-conflict",
        result: conflict,
        lastVerifiedAt: new Date("2026-07-18T00:00:00Z"),
      },
      {
        publishedJobVersionId: "job-unknown",
        result: evaluateThreeAxisMatch({
          requirements: [],
          confirmedFacts: [],
          confirmedEvidence: [],
          preferences: noPreferences,
          job: baseJob,
        }),
        lastVerifiedAt: new Date("2026-07-17T00:00:00Z"),
      },
    ].sort(compareRecommendations);

    expect(inspectableItems).toHaveLength(2);
    expect(inspectableItems.map((item) => item.publishedJobVersionId)).toContain("job-conflict");
    expect(recommendationReasonCodes(conflict)).toContain("CONFIRMED_FACT_CONFLICT");
  });

  it("does not expose a total score, percentage, admission probability, or discouragement label", () => {
    const result = evaluateThreeAxisMatch({
      requirements: [
        requirement({
          id: "req-attendance",
          kind: "weekly_attendance",
          operator: "at_least",
          expectedValue: 5,
        }),
      ],
      confirmedFacts: [{ key: "weekly_attendance_days", value: 4 }],
      confirmedEvidence: [],
      preferences: noPreferences,
      job: baseJob,
    });
    const serialized = JSON.stringify({ result, reasonCodes: recommendationReasonCodes(result) });

    expect(serialized).not.toMatch(/percentage|percent|score|probability|recommendationLabel/i);
    expect(serialized).not.toMatch(/匹配度|录用概率|不建议|劝退|自动隐藏/);
    expect(result).not.toHaveProperty("hidden");
  });
});

describe("golden explanation traceability", () => {
  it("binds a hard conflict reason to the exact job requirement", () => {
    const result = evaluateThreeAxisMatch({
      requirements: [
        requirement({
          id: "req-attendance-trace",
          kind: "weekly_attendance",
          operator: "at_least",
          expectedValue: 5,
        }),
      ],
      confirmedFacts: [{ key: "weekly_attendance_days", value: 4 }],
      confirmedEvidence: [],
      preferences: noPreferences,
      job: baseJob,
    });

    expect(result.eligibility.reasons).toEqual([
      expect.objectContaining({
        code: "CONFIRMED_FACT_CONFLICT",
        requirementIds: ["req-attendance-trace"],
        evidenceIds: [],
      }),
    ]);
  });

  it("binds partial evidence to both the requirement and supporting confirmed evidence", () => {
    const result = evaluateThreeAxisMatch({
      requirements: [
        requirement({
          id: "req-sql-python-trace",
          kind: "skill",
          operator: "contains",
          expectedValue: ["SQL", "Python"],
        }),
      ],
      confirmedFacts: [],
      confirmedEvidence: [evidence("evidence-sql-trace")],
      preferences: noPreferences,
      job: baseJob,
    });

    expect(result.evidence.reasons).toEqual([
      expect.objectContaining({
        code: "RESUME_EVIDENCE_PARTIAL",
        requirementIds: ["req-sql-python-trace"],
        evidenceIds: ["evidence-sql-trace"],
      }),
    ]);
  });

  it("binds a missing-evidence reason to the exact requirement without inventing evidence", () => {
    const result = evaluateThreeAxisMatch({
      requirements: [
        requirement({
          id: "req-python-trace",
          kind: "skill",
          operator: "contains",
          expectedValue: ["Python"],
        }),
      ],
      confirmedFacts: [],
      confirmedEvidence: [evidence("evidence-sql-trace")],
      preferences: noPreferences,
      job: baseJob,
    });

    expect(result.evidence.reasons).toEqual([
      expect.objectContaining({
        code: "RESUME_EVIDENCE_NOT_FOUND",
        requirementIds: ["req-python-trace"],
        evidenceIds: [],
      }),
    ]);
  });

  it("明确证据结果返回 requirementIds 与 evidenceIds 的支持关系", () => {
    const result = evaluateThreeAxisMatch({
      requirements: [
        requirement({
          id: "req-sql-found",
          kind: "skill",
          operator: "contains",
          expectedValue: ["SQL"],
        }),
      ],
      confirmedFacts: [],
      confirmedEvidence: [evidence("evidence-sql-found")],
      preferences: noPreferences,
      job: baseJob,
    });
    expect(result.evidence.reasons).toEqual([
      expect.objectContaining({
        code: "RESUME_EVIDENCE_FOUND",
        requirementIds: ["req-sql-found"],
        evidenceIds: ["evidence-sql-found"],
      }),
    ]);
  });

  it("多个已设置偏好中存在岗位未知字段时不把整轴称为符合", () => {
    const result = evaluateThreeAxisMatch({
      requirements: [],
      confirmedFacts: [],
      confirmedEvidence: [],
      preferences: { ...noPreferences, cities: ["深圳"], workModes: ["hybrid"] },
      job: {
        ...baseJob,
        workMode: { state: "unknown", reason: "source_not_stated" },
      },
    });
    expect(result.preference.status).toBe("not_set");
    expect(result.preference.reasons).toEqual([
      expect.objectContaining({ code: "WORK_MODE_PREFERENCE_UNKNOWN" }),
    ]);
  });
});
