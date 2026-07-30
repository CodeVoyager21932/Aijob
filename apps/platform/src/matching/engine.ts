import {
  type EligibilityResult,
  type EvidenceMatchResult,
  type FieldValue,
  type JobFamily,
  type JobPreference,
  type JobRequirement,
  type MatchGap,
  type MatchRunResult,
  normalizeCityPreferences,
  type PreferenceMatchResult,
  type ProfileFact,
  type ResumeEvidence,
} from "@aijob/contracts";
import { inferCapabilities, isSpecificToolTerm } from "./capabilities.js";

type ComparableValue = boolean | number | string | string[];

export interface MatchableJob {
  companyName: string;
  jobFamily: FieldValue<JobFamily>;
  locations: FieldValue<string[]>;
  weeklyAttendanceDays: FieldValue<number>;
  durationMonths: FieldValue<number>;
  workMode: FieldValue<string>;
}

interface RequirementEvaluation {
  outcome: "met" | "conflict" | "unknown";
  explanation: string;
}

interface EligibilityEvaluation {
  result: EligibilityResult;
  coverage: MatchRunResult["coverage"]["eligibility"];
  gaps: MatchGap[];
}

interface EvidenceEvaluation {
  result: EvidenceMatchResult;
  coverage: MatchRunResult["coverage"]["evidence"];
  gaps: MatchGap[];
}

interface PreferenceEvaluation {
  result: PreferenceMatchResult;
  coverage: MatchRunResult["coverage"]["preference"];
  gaps: MatchGap[];
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
): EligibilityEvaluation {
  const factMap = confirmedFactMap(facts);
  const reasons: EligibilityResult["reasons"] = [];
  let hasConflict = false;
  let hasUnknown = false;
  let evaluated = 0;
  let met = 0;
  let conflicts = 0;
  let unknown = 0;
  const gaps: MatchGap[] = [];
  const applicable = requirements.filter(
    (requirement) =>
      requirement.necessity === "required" &&
      requirement.kind !== "city" &&
      requirement.kind !== "skill" &&
      requirement.kind !== "experience" &&
      requirement.kind !== "other",
  );

  for (const requirement of applicable) {
    const actual = factForRequirement(factMap, requirement);
    const evaluation = compareRequirement(actual, requirement);
    if (evaluation.outcome === "met") {
      evaluated += 1;
      met += 1;
      continue;
    }
    hasConflict ||= evaluation.outcome === "conflict";
    hasUnknown ||= evaluation.outcome === "unknown";
    if (evaluation.outcome === "conflict") {
      evaluated += 1;
      conflicts += 1;
    } else {
      unknown += 1;
    }
    gaps.push({
      axis: "eligibility",
      type:
        evaluation.outcome === "conflict"
          ? "explicit_conflict"
          : requirement.operator === "unknown"
            ? "missing_job_value"
            : actual === undefined
              ? "missing_user_fact"
              : "unstructured_job_requirement",
      requirementId: requirement.id,
      explanation: evaluation.explanation,
    });
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
    result: {
      status: hasConflict
        ? "explicit_conflict"
        : hasUnknown
          ? "needs_information"
          : "no_explicit_conflict",
      reasons,
    },
    coverage: {
      required: applicable.length,
      evaluated,
      met,
      conflicts,
      unknown,
    },
    gaps,
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
): EvidenceEvaluation {
  const evidenceRequirements = requirements.filter(
    (requirement) =>
      (requirement.necessity === "required" || requirement.necessity === "preferred") &&
      (requirement.kind === "skill" ||
        requirement.kind === "experience" ||
        requirement.kind === "other"),
  );
  if (evidenceRequirements.length === 0) {
    return {
      result: {
        status: "insufficient_information",
        reasons: [
          {
            code: "JOB_HAS_NO_EXPLICIT_EVIDENCE_REQUIREMENT",
            requirementIds: [],
            evidenceIds: [],
            explanation: "岗位原文没有足够明确的经历或技能要求，暂不判断简历证据覆盖。",
          },
        ],
      },
      coverage: { applicable: 0, supported: 0, partial: 0, missing: 0, unknown: 0 },
      gaps: [],
    };
  }

  const searchableEvidence = evidence.map((item) => ({
    id: item.id,
    text: normalizeText([item.statement, ...item.skills, ...item.outcomes].join(" ")),
    capabilities: inferCapabilities([item.statement, ...item.skills, ...item.outcomes].join(" ")),
  }));
  const reasons: EvidenceMatchResult["reasons"] = [];
  let fullMatches = 0;
  let partialMatches = 0;
  let missing = 0;
  let unknown = 0;
  const gaps: MatchGap[] = [];

  for (const requirement of evidenceRequirements) {
    const terms = evidenceTerms(requirement.expectedValue);
    const requiredCapabilities = inferCapabilities([requirement.sourceText, ...terms].join(" "));
    if (terms.length === 0 && requiredCapabilities.length === 0) {
      unknown += 1;
      reasons.push({
        code: "EVIDENCE_REQUIREMENT_NOT_STRUCTURED",
        requirementIds: [requirement.id],
        evidenceIds: [],
        explanation: "岗位要求尚未拆成可核对的证据项。",
      });
      gaps.push({
        axis: "evidence",
        type: "unstructured_job_requirement",
        requirementId: requirement.id,
        explanation: "岗位要求尚未拆成可核对的原子证据项。",
      });
      continue;
    }
    const requiredCapabilityKeys = new Set(requiredCapabilities.map((item) => item.key));
    const exactMatchingEvidence = searchableEvidence.filter((item) =>
      terms.some((term) => evidenceTextContainsTerm(item.text, term)),
    );
    const semanticMatchingEvidence = searchableEvidence.filter((item) =>
      item.capabilities.some((capability) => requiredCapabilityKeys.has(capability.key)),
    );
    const matchingEvidence = [
      ...new Map(
        [...exactMatchingEvidence, ...semanticMatchingEvidence].map((item) => [item.id, item]),
      ).values(),
    ];
    const matchedTerms = terms.filter((term) =>
      searchableEvidence.some((item) => evidenceTextContainsTerm(item.text, term)),
    );
    const coveredCapabilities = requiredCapabilities.filter((required) =>
      searchableEvidence.some((item) =>
        item.capabilities.some((capability) => capability.key === required.key),
      ),
    );
    const unmatchedSpecificTools = terms.filter(
      (term) => isSpecificToolTerm(term) && !matchedTerms.includes(term),
    );
    const canUseSemanticBridge =
      terms.length === 0 || terms.some((term) => !isSpecificToolTerm(term));
    const exactFullMatch = terms.length > 0 && matchedTerms.length === terms.length;
    const semanticFullMatch =
      canUseSemanticBridge &&
      requiredCapabilities.length > 0 &&
      coveredCapabilities.length === requiredCapabilities.length &&
      unmatchedSpecificTools.length === 0;
    if (exactFullMatch || semanticFullMatch) {
      fullMatches += 1;
      const semanticLabels = coveredCapabilities.map((item) => item.label);
      reasons.push({
        code: exactFullMatch ? "RESUME_EVIDENCE_FOUND" : "RESUME_SEMANTIC_EVIDENCE_FOUND",
        requirementIds: [requirement.id],
        evidenceIds: [...new Set(matchingEvidence.map((item) => item.id))],
        explanation: exactFullMatch
          ? "当前已确认的简历证据能够回指并覆盖这项岗位要求。"
          : `岗位要求可归一为“${semanticLabels.join("、")}”，已确认经历中存在同类行为证据。`,
      });
      continue;
    }
    if (matchedTerms.length > 0 || (canUseSemanticBridge && coveredCapabilities.length > 0)) {
      partialMatches += 1;
      const coveredLabels = coveredCapabilities.map((item) => item.label);
      reasons.push({
        code:
          matchedTerms.length > 0 ? "RESUME_EVIDENCE_PARTIAL" : "RESUME_SEMANTIC_EVIDENCE_PARTIAL",
        requirementIds: [requirement.id],
        evidenceIds: (matchedTerms.length > 0 ? exactMatchingEvidence : matchingEvidence).map(
          (item) => item.id,
        ),
        explanation:
          matchedTerms.length === 0 && coveredLabels.length > 0
            ? `已确认经历能支持“${coveredLabels.join("、")}”，但尚未覆盖岗位要求中的全部明确要点。`
            : "简历中能找到部分相关证据，但还没有覆盖岗位要求的全部要点。",
      });
      gaps.push({
        axis: "evidence",
        type: "partial_resume_evidence",
        requirementId: requirement.id,
        explanation: "已确认证据只覆盖了这项要求的一部分。",
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
    gaps.push({
      axis: "evidence",
      type: "missing_resume_evidence",
      requirementId: requirement.id,
      explanation: "当前已确认的原子证据中没有找到支持。",
    });
  }

  let status: EvidenceMatchResult["status"];
  if (fullMatches === evidenceRequirements.length) status = "explicit_evidence";
  else if (fullMatches > 0 || partialMatches > 0) status = "partial_evidence";
  else if (missing > 0) status = "not_in_resume";
  else if (unknown > 0) status = "insufficient_information";
  else status = "insufficient_information";

  return {
    result: { status, reasons },
    coverage: {
      applicable: evidenceRequirements.length,
      supported: fullMatches,
      partial: partialMatches,
      missing,
      unknown,
    },
    gaps,
  };
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

function evaluatePreference(job: MatchableJob, preferences: JobPreference): PreferenceEvaluation {
  const reasons: PreferenceMatchResult["reasons"] = [];
  let configured = 0;
  let comparable = 0;
  let conflicts = 0;
  const gaps: MatchGap[] = [];

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
      gaps.push({
        axis: "preference",
        type: "preference_not_comparable",
        requirementId: null,
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
    normalizeCityPreferences(preferences.cities).cities,
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
    result: {
      status:
        conflicts > 0
          ? "does_not_fit"
          : configured === 0 || comparable < configured
            ? "not_set"
            : "fits",
      reasons,
    },
    coverage: {
      configured,
      compared: comparable,
      conflicts,
      unknown: configured - comparable,
    },
    gaps,
  };
}

export function evaluateThreeAxisMatch(input: {
  requirements: JobRequirement[];
  confirmedFacts: ProfileFact[];
  preferences: JobPreference;
  confirmedEvidence: ResumeEvidence[];
  job: MatchableJob;
}): MatchRunResult {
  const eligibilityEvaluation = evaluateEligibility(input.requirements, input.confirmedFacts);
  const evidenceEvaluation = evaluateEvidence(input.requirements, input.confirmedEvidence);
  const preferenceEvaluation = evaluatePreference(input.job, input.preferences);
  const eligibility = eligibilityEvaluation.result;
  const evidence = evidenceEvaluation.result;
  const preference = preferenceEvaluation.result;
  const unknownRequirementIds = input.requirements
    .filter((requirement) => {
      if (requirement.necessity !== "required") return false;
      if (requirement.operator === "unknown") return true;
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

  const coverage = {
    eligibility: eligibilityEvaluation.coverage,
    evidence: evidenceEvaluation.coverage,
    preference: preferenceEvaluation.coverage,
  };
  const gaps = [
    ...eligibilityEvaluation.gaps,
    ...evidenceEvaluation.gaps,
    ...preferenceEvaluation.gaps,
  ];
  const totalBasis =
    coverage.eligibility.required + coverage.evidence.applicable + coverage.preference.configured;
  const unknownBasis =
    coverage.eligibility.unknown + coverage.evidence.unknown + coverage.preference.unknown;
  const basisState: MatchRunResult["basisState"] =
    totalBasis === 0 || unknownBasis === totalBasis
      ? "insufficient"
      : unknownBasis > 0
        ? "partial"
        : "complete";

  return {
    eligibility,
    evidence,
    preference,
    basisState,
    coverage,
    gaps,
    unknownRequirementIds,
  };
}
