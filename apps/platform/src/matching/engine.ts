import type {
  EligibilityResult,
  EvidenceMatchResult,
  FieldValue,
  JobPreference,
  JobRequirement,
  MatchRunResult,
  PreferenceMatchResult,
  ProfileFact,
  ResumeEvidence,
} from "@aijob/contracts";

type ComparableValue = boolean | number | string | string[];

export interface MatchableJob {
  companyName: string;
  jobFamily: FieldValue<"product" | "operations" | "other">;
  locations: FieldValue<string[]>;
  weeklyAttendanceDays: FieldValue<number>;
  durationMonths: FieldValue<number>;
  workMode: FieldValue<string>;
}

interface RequirementEvaluation {
  outcome: "met" | "conflict" | "unknown";
  explanation: string;
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

function asArray(value: ComparableValue): Array<boolean | number | string> {
  return Array.isArray(value) ? value : [value];
}

function valuesEqual(left: boolean | number | string, right: unknown): boolean {
  if (typeof left === "string" && typeof right === "string") {
    return normalizeText(left) === normalizeText(right);
  }
  return left === right;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateValue(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

function compareRequirement(
  actual: ComparableValue | undefined,
  requirement: JobRequirement,
): RequirementEvaluation {
  if (actual === undefined || requirement.operator === "unknown") {
    return {
      outcome: "unknown",
      explanation: "岗位或用户已确认信息不足，暂时无法核对该条件。",
    };
  }

  const actualValues = asArray(actual);
  const expectedValues = Array.isArray(requirement.expectedValue)
    ? requirement.expectedValue
    : [requirement.expectedValue];
  let met: boolean | null = null;

  switch (requirement.operator) {
    case "equals":
      met = actualValues.some((value) => valuesEqual(value, requirement.expectedValue));
      break;
    case "one_of":
      met = actualValues.some((actualValue) =>
        expectedValues.some((expectedValue) => valuesEqual(actualValue, expectedValue)),
      );
      break;
    case "at_least": {
      const expected = numeric(requirement.expectedValue);
      const actualNumber = numeric(actualValues[0]);
      met = expected === null || actualNumber === null ? null : actualNumber >= expected;
      break;
    }
    case "at_most": {
      const expected = numeric(requirement.expectedValue);
      const actualNumber = numeric(actualValues[0]);
      met = expected === null || actualNumber === null ? null : actualNumber <= expected;
      break;
    }
    case "before_or_on": {
      const expected = dateValue(requirement.expectedValue);
      const actualDate = dateValue(actualValues[0]);
      met = expected === null || actualDate === null ? null : actualDate <= expected;
      break;
    }
    case "after_or_on": {
      const expected = dateValue(requirement.expectedValue);
      const actualDate = dateValue(actualValues[0]);
      met = expected === null || actualDate === null ? null : actualDate >= expected;
      break;
    }
    case "contains":
      met = expectedValues.every((expectedValue) =>
        actualValues.some((actualValue) => {
          if (typeof actualValue !== "string" || typeof expectedValue !== "string") return false;
          return normalizeText(actualValue).includes(normalizeText(expectedValue));
        }),
      );
      break;
    default:
      met = null;
  }

  if (met === null) {
    return {
      outcome: "unknown",
      explanation: "该条件的结构化值不足以进行可靠比较。",
    };
  }
  return met
    ? { outcome: "met", explanation: "已确认信息未显示与该条件冲突。" }
    : { outcome: "conflict", explanation: "已确认信息与岗位明确条件存在冲突。" };
}

function confirmedFactMap(facts: ProfileFact[]): Map<ProfileFact["key"], ComparableValue> {
  return new Map(facts.map((fact) => [fact.key, fact.value]));
}

function factForRequirement(
  facts: Map<ProfileFact["key"], ComparableValue>,
  requirement: JobRequirement,
): ComparableValue | undefined {
  switch (requirement.kind) {
    case "student_status":
      return facts.get("current_student");
    case "graduation_year":
      return facts.get("graduation_year");
    case "arrival_date":
      return facts.get("available_from");
    case "weekly_attendance":
      return facts.get("weekly_attendance_days");
    case "duration":
      return facts.get("duration_months");
    case "education":
      return facts.get("education_level");
    case "major":
      return facts.get("majors");
    case "language":
      return facts.get("languages");
    default:
      return undefined;
  }
}

function evaluateEligibility(
  requirements: JobRequirement[],
  facts: ProfileFact[],
): EligibilityResult {
  const factMap = confirmedFactMap(facts);
  const reasons: EligibilityResult["reasons"] = [];
  let hasConflict = false;
  let hasUnknown = false;

  for (const requirement of requirements) {
    if (
      !requirement.required ||
      requirement.kind === "city" ||
      requirement.kind === "skill" ||
      requirement.kind === "experience" ||
      requirement.kind === "other"
    ) {
      continue;
    }
    const evaluation = compareRequirement(factForRequirement(factMap, requirement), requirement);
    if (evaluation.outcome === "met") continue;
    hasConflict ||= evaluation.outcome === "conflict";
    hasUnknown ||= evaluation.outcome === "unknown";
    reasons.push({
      code:
        evaluation.outcome === "conflict"
          ? "CONFIRMED_FACT_CONFLICT"
          : "REQUIRED_FACT_NOT_CONFIRMED",
      requirementIds: [requirement.id],
      evidenceIds: [],
      explanation: evaluation.explanation,
    });
  }

  return {
    status: hasConflict
      ? "explicit_conflict"
      : hasUnknown
        ? "needs_information"
        : "no_explicit_conflict",
    reasons,
  };
}

function evidenceTerms(expectedValue: unknown): string[] {
  const rawValues = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
  return rawValues
    .filter((value): value is string => typeof value === "string")
    .map(normalizeText)
    .filter(Boolean);
}

function evidenceTextContainsTerm(text: string, term: string): boolean {
  if (!/[a-z]/i.test(term) || /\p{Script=Han}/u.test(term)) return text.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_])${escaped}($|[^a-z0-9_])`, "i").test(text);
}

function evaluateEvidence(
  requirements: JobRequirement[],
  evidence: ResumeEvidence[],
): EvidenceMatchResult {
  const evidenceRequirements = requirements.filter(
    (requirement) =>
      requirement.required &&
      (requirement.kind === "skill" ||
        requirement.kind === "experience" ||
        requirement.kind === "other"),
  );
  if (evidenceRequirements.length === 0) {
    return {
      status: "insufficient_information",
      reasons: [
        {
          code: "JOB_HAS_NO_EXPLICIT_EVIDENCE_REQUIREMENT",
          requirementIds: [],
          evidenceIds: [],
          explanation: "岗位原文没有足够明确的经历或技能要求，暂不判断简历证据覆盖。",
        },
      ],
    };
  }

  const searchableEvidence = evidence.map((item) => ({
    id: item.id,
    text: normalizeText(
      [item.originalText, item.claim, ...item.skills, ...item.outcomes].join(" "),
    ),
  }));
  const reasons: EvidenceMatchResult["reasons"] = [];
  let fullMatches = 0;
  let partialMatches = 0;
  let missing = 0;
  let unknown = 0;

  for (const requirement of evidenceRequirements) {
    const terms = evidenceTerms(requirement.expectedValue);
    if (terms.length === 0) {
      unknown += 1;
      reasons.push({
        code: "EVIDENCE_REQUIREMENT_NOT_STRUCTURED",
        requirementIds: [requirement.id],
        evidenceIds: [],
        explanation: "岗位要求尚未拆成可核对的证据项。",
      });
      continue;
    }
    const matchingEvidence = searchableEvidence.filter((item) =>
      terms.some((term) => evidenceTextContainsTerm(item.text, term)),
    );
    const matchedTerms = terms.filter((term) =>
      searchableEvidence.some((item) => evidenceTextContainsTerm(item.text, term)),
    );
    if (matchedTerms.length === terms.length) {
      fullMatches += 1;
      reasons.push({
        code: "RESUME_EVIDENCE_FOUND",
        requirementIds: [requirement.id],
        evidenceIds: [...new Set(matchingEvidence.map((item) => item.id))],
        explanation: "当前已确认的简历证据能够回指并覆盖这项岗位要求。",
      });
      continue;
    }
    if (matchedTerms.length > 0) {
      partialMatches += 1;
      reasons.push({
        code: "RESUME_EVIDENCE_PARTIAL",
        requirementIds: [requirement.id],
        evidenceIds: matchingEvidence.map((item) => item.id),
        explanation: "简历中能找到部分相关证据，但还没有覆盖岗位要求的全部要点。",
      });
      continue;
    }
    missing += 1;
    reasons.push({
      code: "RESUME_EVIDENCE_NOT_FOUND",
      requirementIds: [requirement.id],
      evidenceIds: [],
      explanation: "当前已确认的简历证据中暂未体现该岗位要求。",
    });
  }

  let status: EvidenceMatchResult["status"];
  if (fullMatches === evidenceRequirements.length) status = "explicit_evidence";
  else if (fullMatches > 0 || partialMatches > 0) status = "partial_evidence";
  else if (missing > 0) status = "not_in_resume";
  else if (unknown > 0) status = "insufficient_information";
  else status = "insufficient_information";

  return { status, reasons };
}

function knownTextList(value: FieldValue<string[]>): string[] | null {
  return value.state === "known" ? value.value.map(normalizeText) : null;
}

function knownText(value: FieldValue<string>): string | null {
  return value.state === "known" ? normalizeText(value.value) : null;
}

function includesNormalized(values: string[], expected: string): boolean {
  const normalizedExpected = normalizeText(expected);
  return values.some((value) => value === normalizedExpected);
}

function evaluatePreference(job: MatchableJob, preferences: JobPreference): PreferenceMatchResult {
  const reasons: PreferenceMatchResult["reasons"] = [];
  let configured = 0;
  let comparable = 0;
  let conflicts = 0;

  const check = (
    configuredValues: string[],
    actualValues: string[] | null,
    code: string,
    explanation: string,
    unknownCode: string,
    unknownExplanation: string,
  ) => {
    if (configuredValues.length === 0) return;
    configured += 1;
    if (!actualValues) {
      reasons.push({
        code: unknownCode,
        requirementIds: [],
        evidenceIds: [],
        explanation: unknownExplanation,
      });
      return;
    }
    comparable += 1;
    if (!configuredValues.some((expected) => includesNormalized(actualValues, expected))) {
      conflicts += 1;
      reasons.push({
        code,
        requirementIds: [],
        evidenceIds: [],
        explanation,
      });
    }
  };

  check(
    preferences.cities,
    knownTextList(job.locations),
    "CITY_PREFERENCE_CONFLICT",
    "岗位城市不在你设置的偏好范围内。",
    "CITY_PREFERENCE_UNKNOWN",
    "岗位没有明确说明城市，暂时无法核对这项偏好。",
  );
  check(
    preferences.jobFamilies,
    job.jobFamily.state === "known" ? [normalizeText(job.jobFamily.value)] : null,
    "JOB_FAMILY_PREFERENCE_CONFLICT",
    "岗位方向不在你设置的偏好范围内。",
    "JOB_FAMILY_PREFERENCE_UNKNOWN",
    "岗位方向尚未可靠分类，暂时无法核对这项偏好。",
  );
  check(
    preferences.companyNames,
    [normalizeText(job.companyName)],
    "COMPANY_PREFERENCE_CONFLICT",
    "该公司不在你设置的公司偏好内。",
    "COMPANY_PREFERENCE_UNKNOWN",
    "岗位没有可核对的公司主体，暂时无法核对这项偏好。",
  );
  check(
    preferences.workModes,
    knownText(job.workMode) ? [knownText(job.workMode) as string] : null,
    "WORK_MODE_PREFERENCE_CONFLICT",
    "岗位工作方式不符合你设置的偏好。",
    "WORK_MODE_PREFERENCE_UNKNOWN",
    "岗位没有说明工作方式，暂时无法核对这项偏好。",
  );

  return {
    status:
      conflicts > 0
        ? "does_not_fit"
        : configured === 0 || comparable < configured
          ? "not_set"
          : "fits",
    reasons,
  };
}

export function evaluateThreeAxisMatch(input: {
  requirements: JobRequirement[];
  confirmedFacts: ProfileFact[];
  preferences: JobPreference;
  confirmedEvidence: ResumeEvidence[];
  job: MatchableJob;
}): MatchRunResult {
  const eligibility = evaluateEligibility(input.requirements, input.confirmedFacts);
  const evidence = evaluateEvidence(input.requirements, input.confirmedEvidence);
  const preference = evaluatePreference(input.job, input.preferences);
  const unknownRequirementIds = input.requirements
    .filter((requirement) => {
      if (requirement.operator === "unknown") return true;
      if (!requirement.required) return false;
      if (
        requirement.kind === "skill" ||
        requirement.kind === "experience" ||
        requirement.kind === "other"
      ) {
        return evidence.reasons.some(
          (reason) =>
            reason.code === "EVIDENCE_REQUIREMENT_NOT_STRUCTURED" &&
            reason.requirementIds.includes(requirement.id),
        );
      }
      return eligibility.reasons.some(
        (reason) =>
          reason.code === "REQUIRED_FACT_NOT_CONFIRMED" &&
          reason.requirementIds.includes(requirement.id),
      );
    })
    .map((requirement) => requirement.id);

  return { eligibility, evidence, preference, unknownRequirementIds };
}
