import { createHash } from "node:crypto";
import type {
  FieldValue,
  JobRequirement,
  JobRequirementV5,
  RequirementKind,
  RequirementNecessity,
  RequirementSourceUnit,
  StructuredRequirementField,
} from "@aijob/contracts";
import { JobRequirementV5Schema, RequirementSourceUnitSchema } from "@aijob/contracts";

export interface RequirementField<T> {
  value: FieldValue<T>;
  sourceText?: string;
  necessity: RequirementNecessity;
}

export interface DeterministicRequirementInput {
  publishedJobVersionId: string;
  locations?: RequirementField<string[]>;
  earliestStartDate?: RequirementField<string>;
  weeklyAttendanceDays?: RequirementField<number>;
  durationMonths?: RequirementField<number>;
  graduationYears?: RequirementField<number[]>;
  educationLevels?: RequirementField<string[]>;
  majors?: RequirementField<string[]>;
  languages?: RequirementField<string[]>;
}

export interface TextualRequirementInput {
  publishedJobVersionId: string;
  sourceText: string;
  evidenceRefPrefix: string;
  origin?: "jd_clause" | "private_jd_clause";
}

export interface RequirementDecomposition {
  sourceUnits: RequirementSourceUnit[];
  requirements: JobRequirementV5[];
}

interface RequirementDescriptor<T> {
  kind: RequirementKind;
  operator: JobRequirement["operator"];
  fieldName: StructuredRequirementField;
  field: RequirementField<T> | undefined;
}

export interface RequirementClause {
  text: string;
  start: number;
  end: number;
  necessity: RequirementNecessity;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableSourceUnitId(
  publishedJobVersionId: string,
  identity: Record<string, unknown>,
): string {
  return `source-unit-${sha256(JSON.stringify([publishedJobVersionId, identity])).slice(0, 20)}`;
}

function stableRequirementId(
  publishedJobVersionId: string,
  sourceUnitId: string,
  kind: RequirementKind,
  sourceText: string,
  expectedValue: unknown,
): string {
  const hash = sha256(
    JSON.stringify([publishedJobVersionId, sourceUnitId, kind, sourceText, expectedValue]),
  ).slice(0, 20);
  return `requirement-${kind}-${hash}`;
}

function sourceTextForField(field: RequirementField<unknown>): string {
  const explicit = field.sourceText?.trim();
  if (explicit) return explicit;
  if (field.value.state === "conflict") return field.value.rawValues.join(" / ");
  if (field.value.state !== "known") return "";
  const value = field.value.value;
  return Array.isArray(value) ? value.map(String).join("、") : String(value);
}

function createStructuredRequirement<T>(
  publishedJobVersionId: string,
  descriptor: RequirementDescriptor<T>,
): { sourceUnit: RequirementSourceUnit; requirement: JobRequirementV5 } | null {
  const { field } = descriptor;
  if (!field || field.value.state === "unknown") return null;
  const sourceText = sourceTextForField(field as RequirementField<unknown>);
  if (!sourceText) return null;

  const sourceUnitId = stableSourceUnitId(publishedJobVersionId, {
    origin: "structured_field",
    field: descriptor.fieldName,
    text: sourceText,
  });
  const sourceUnit = RequirementSourceUnitSchema.parse({
    id: sourceUnitId,
    text: sourceText,
    origin: { kind: "structured_field", field: descriptor.fieldName },
    evidenceRefs: field.value.evidenceRefs,
    sourceSpan: null,
  });

  const sourceExpectation =
    field.value.state === "known" &&
    descriptor.kind === "graduation_year" &&
    /20\d{2}/.test(sourceText) &&
    /(?:届|毕业)/.test(sourceText)
      ? graduationYearExpectation(sourceText)
      : undefined;
  const operator =
    field.value.state === "conflict"
      ? "unknown"
      : (sourceExpectation?.operator ?? descriptor.operator);
  const expectedValue =
    field.value.state === "conflict"
      ? field.value.rawValues
      : (sourceExpectation?.expectedValue ?? field.value.value);

  return {
    sourceUnit,
    requirement: JobRequirementV5Schema.parse({
      id: stableRequirementId(
        publishedJobVersionId,
        sourceUnitId,
        descriptor.kind,
        sourceText,
        expectedValue,
      ),
      kind: descriptor.kind,
      operator,
      expectedValue,
      sourceText,
      evidenceRefs: field.value.evidenceRefs,
      sourceSpan: null,
      sourceUnitId,
      necessity: field.necessity,
    }),
  };
}

/** Builds assertions from structured fields without presenting synthetic values as JD quotes. */
export function decomposeKnownJobRequirements(
  input: DeterministicRequirementInput,
): RequirementDecomposition {
  const descriptors: RequirementDescriptor<unknown>[] = [
    { kind: "city", operator: "one_of", fieldName: "locations", field: input.locations },
    {
      kind: "arrival_date",
      operator: "before_or_on",
      fieldName: "earliest_start_date",
      field: input.earliestStartDate,
    },
    {
      kind: "weekly_attendance",
      operator: "at_least",
      fieldName: "weekly_attendance_days",
      field: input.weeklyAttendanceDays,
    },
    {
      kind: "duration",
      operator: "at_least",
      fieldName: "duration_months",
      field: input.durationMonths,
    },
    {
      kind: "graduation_year",
      operator: "one_of",
      fieldName: "graduation_years",
      field: input.graduationYears,
    },
    {
      kind: "education",
      operator: "one_of",
      fieldName: "education_levels",
      field: input.educationLevels,
    },
    { kind: "major", operator: "one_of", fieldName: "majors", field: input.majors },
    { kind: "language", operator: "one_of", fieldName: "languages", field: input.languages },
  ];
  const created = descriptors
    .map((descriptor) => createStructuredRequirement(input.publishedJobVersionId, descriptor))
    .filter(
      (value): value is { sourceUnit: RequirementSourceUnit; requirement: JobRequirementV5 } =>
        value !== null,
    );
  return {
    sourceUnits: created.map(({ sourceUnit }) => sourceUnit),
    requirements: created.map(({ requirement }) => requirement),
  };
}

const evidenceTermDictionary = [
  "Power BI",
  "Tableau",
  "Axure",
  "Figma",
  "Python",
  "Excel",
  "SQL",
  "用户研究",
  "用户访谈",
  "用户需求",
  "需求分析",
  "数据分析",
  "数据监控",
  "产品设计",
  "产品规划",
  "项目管理",
  "活动运营",
  "内容运营",
  "社区运营",
  "增长运营",
  "用户运营",
  "市场分析",
  "竞品分析",
  "实验设计",
  "逻辑思维",
  "系统分析",
  "文字组织",
  "沟通",
  "协调",
  "写作",
] as const;

const majorTermDictionary = [
  "计算机",
  "软件",
  "新闻",
  "传播",
  "市场营销",
  "工商管理",
  "心理学",
  "统计",
  "数学",
  "经济",
  "金融",
  "设计",
  "汉语言",
  "中文",
  "外语",
] as const;

function uniqueTerms(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stripListMarker(raw: string): { text: string; offset: number } {
  const marker = raw.match(/^\s*(?:[（(]?\d{1,2}[）)、.．:]|[-•])\s*/)?.[0] ?? "";
  const remainder = raw.slice(marker.length);
  const leading = remainder.length - remainder.trimStart().length;
  return { text: remainder.trim(), offset: marker.length + leading };
}

/** Numbering/newlines are authoritative; punctuation splits clauses except commas. */
export function splitRequirementAtoms(sourceText: string): RequirementClause[] {
  const boundaries = new Set<number>([0, sourceText.length]);
  const separators = /\r?\n|[；;。！？!?]+/g;
  for (const match of sourceText.matchAll(separators)) {
    const start = match.index ?? 0;
    boundaries.add(start);
    boundaries.add(start + match[0].length);
  }
  const numbered = /(?:^|[\s；;。！？!?])(?=[（(]?\d{1,2}[）)、.．:]\s*)/g;
  for (const match of sourceText.matchAll(numbered)) {
    boundaries.add((match.index ?? 0) + match[0].length);
  }

  const points = [...boundaries].sort((left, right) => left - right);
  const clauses: RequirementClause[] = [];
  let scopedNecessity: RequirementNecessity = "required";
  for (let index = 0; index < points.length - 1; index += 1) {
    const segmentStart = points[index];
    const segmentEnd = points[index + 1];
    if (segmentStart === undefined || segmentEnd === undefined) continue;
    const raw = sourceText.slice(segmentStart, segmentEnd).replace(/^[\r\n；;。！？!?]+/, "");
    const rawOffset = sourceText.slice(segmentStart, segmentEnd).indexOf(raw);
    const stripped = stripListMarker(raw.replace(/[\r\n；;。！？!?]+$/, ""));
    if (stripped.text.length < 2) continue;
    const isPreferredHeading = /^(?:加分项|优先条件|加分条件)(?:\s*[:：]|$)/i.test(stripped.text);
    const isRequiredHeading = /^(?:任职要求|基本要求|必备条件|岗位要求)(?:\s*[:：]|$)/.test(
      stripped.text,
    );
    if (isPreferredHeading) scopedNecessity = "preferred";
    if (isRequiredHeading) scopedNecessity = "required";
    const localStart = Math.max(0, rawOffset) + stripped.offset;
    const start = segmentStart + localStart;
    // The clause carries only the heading-scoped necessity. Inline "优先"/"可选" markers are
    // resolved per comma atom in decomposeTextualJobRequirements so a trailing marker never
    // rewrites the hard facts stated earlier in the same visible clause.
    clauses.push({
      text: stripped.text,
      start,
      end: start + stripped.text.length,
      necessity: scopedNecessity,
    });
  }
  return clauses;
}

export function splitRequirementClauses(sourceText: string): string[] {
  return splitRequirementAtoms(sourceText).map(({ text }) => text);
}

/**
 * Splits a visible clause into comma-delimited assertion atoms. Commas never create a new
 * visible source unit, but each fact and its necessity must be judged on its own atom so a
 * trailing "优先" does not silently downgrade the hard facts stated earlier in the same clause.
 */
function splitAssertionAtoms(clauseText: string): string[] {
  return clauseText
    .split(/[，,]/)
    .map((atom) => atom.trim())
    .filter((atom) => atom.length >= 2);
}

function atomNecessity(
  atomText: string,
  clauseNecessity: RequirementNecessity,
): RequirementNecessity {
  if (/(?:优先|加分|更佳|为佳|preferred)/i.test(atomText)) return "preferred";
  if (/(?:可选|非必须|不作要求|无需)/.test(atomText)) return "optional";
  return clauseNecessity;
}

function kindIsNegated(clause: string, kind: RequirementKind): boolean {
  if (/(?:不限专业|专业不限)/.test(clause) && kind === "major") return true;
  if (/(?:不限学历|学历不限)/.test(clause) && kind === "education") return true;
  if (
    /(?:经验不限|无经验要求|无需[^，,；;。]{0,8}(?:经验|经历))/.test(clause) &&
    kind === "experience"
  ) {
    return true;
  }
  if (
    /(?:语言不限|无语言要求|不要求[^，,；;。]{0,8}(?:英语|外语|语言能力))/.test(clause) &&
    kind === "language"
  ) {
    return true;
  }
  return false;
}

function textualKinds(clause: string): RequirementKind[] {
  const kinds: RequirementKind[] = [];
  if (/(?:20\d{2}).{0,8}(?:届|毕业)|(?:届|毕业).{0,8}(?:20\d{2})/.test(clause)) {
    kinds.push("graduation_year");
  }
  if (/(?:在校生|在读学生|在读本科|在读硕士|学历在读|本科[^，,；;。]{0,8}在读)/.test(clause)) {
    kinds.push("student_status");
  }
  if (/(?:每周|一周).{0,12}(?:[1-7]|一|二|三|四|五|六|七).{0,2}(?:天|工作日)/.test(clause)) {
    kinds.push("weekly_attendance");
  }
  if (internshipMonths(clause) !== undefined) kinds.push("duration");
  if (/(?:学历|大专|专科|本科|硕士|博士)/.test(clause)) kinds.push("education");
  if (/专业/.test(clause)) kinds.push("major");
  if (/(?:英语|外语|语言能力|CET[- ]?[46]|雅思|托福|TOEFL|IELTS)/i.test(clause)) {
    kinds.push("language");
  }

  const hasEvidenceTerm = evidenceTermDictionary.some((term) =>
    clause.toLocaleLowerCase("zh-CN").includes(term.toLocaleLowerCase("zh-CN")),
  );
  const hasExperience =
    !/(?:未经验证|未经[^，,；;。]{0,8}验证)/.test(clause) &&
    /(?:经验|经历|(?:互联网|产品|行业|工作|项目|相关)实习)/.test(clause);
  if (hasExperience && !kinds.includes("duration")) {
    kinds.push("experience");
  } else if (hasEvidenceTerm || /(?:熟悉|掌握|熟练|了解|能力)/.test(clause)) {
    kinds.push("skill");
  }
  const filtered = [...new Set(kinds)].filter((kind) => !kindIsNegated(clause, kind));
  return filtered.length > 0 ? filtered : [];
}

function educationValues(clause: string): string[] {
  const levels = ["大专", "专科", "本科", "硕士", "博士"].filter((level) => clause.includes(level));
  if (!/(?:及以上|或以上|以上学历)/.test(clause) || levels.length === 0) {
    return uniqueTerms(levels.map((level) => (level === "专科" ? "大专" : level)));
  }
  const rank = ["大专", "本科", "硕士", "博士"];
  const minimum = levels.includes("专科") ? "大专" : (levels[0] as string);
  const start = rank.indexOf(minimum);
  return start >= 0 ? rank.slice(start) : [];
}

function evidenceTerms(clause: string): string[] {
  const lower = clause.toLocaleLowerCase("zh-CN");
  return uniqueTerms(
    evidenceTermDictionary.filter((term) => lower.includes(term.toLocaleLowerCase("zh-CN"))),
  );
}

const chineseNumberValues: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
};

function attendanceDays(clause: string): number | undefined {
  const match = clause.match(
    /(?:每周|一周).{0,12}?([1-7]|一|二|三|四|五|六|七)\s*(?:天|个?工作日)/,
  );
  if (!match?.[1]) return undefined;
  return /^\d$/.test(match[1]) ? Number(match[1]) : chineseNumberValues[match[1]];
}

function internshipMonths(clause: string): number | undefined {
  const amount = String.raw`(?:\d{1,2}|[一二两三四五六七八九十]{1,3})`;
  const patterns = [
    new RegExp(
      String.raw`(?:实习(?:期|时间|时长)?|连续|至少|不少于|不低于|最少).{0,12}?(${amount})\s*(?:个)?月`,
    ),
    new RegExp(String.raw`^\s*(${amount})\s*(?:个)?月(?:以上)?\s*$`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(clause);
    if (!match?.[1] || match.index === undefined) continue;
    const amountOffset = match.index + match[0].lastIndexOf(match[1]);
    const beforeAmount = clause.slice(Math.max(0, amountOffset - 10), amountOffset);
    const afterAmount = clause.slice(amountOffset + match[1].length);
    const describesPastExperience =
      /(?:经验|经历)\s*(?:至少|不少于|不低于|最少)?\s*$/.test(beforeAmount) ||
      /^\s*(?:个)?月(?:以上)?\s*(?:的)?\s*(?:相关|工作|实习|项目)?(?:经验|经历)/.test(afterAmount);
    if (describesPastExperience) continue;
    const parsed = parseChineseOrArabicInteger(match[1]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function parseChineseOrArabicInteger(value: string): number | undefined {
  if (/^\d{1,2}$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : undefined;
  }
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (value.length === 1) return digits[value];
  const parts = value.split("十");
  if (parts.length !== 2) return undefined;
  const [tensText, onesText] = parts;
  if (tensText === undefined || onesText === undefined) return undefined;
  const tens = tensText === "" ? 1 : tensText === "两" ? undefined : digits[tensText];
  const ones = onesText === "" ? 0 : digits[onesText];
  if (tens === undefined || ones === undefined) return undefined;
  const parsed = tens * 10 + ones;
  return parsed > 0 && parsed <= 99 ? parsed : undefined;
}

function graduationYearExpectation(
  clause: string,
): Pick<JobRequirement, "operator" | "expectedValue"> {
  const range = clause.match(
    /(20\d{2})\s*(?:年)?\s*(?:-|–|—|~|～|至|到)\s*(20\d{2})\s*(?:年)?(?=\s*(?:届|毕业))/,
  );
  if (range?.[1] && range[2]) {
    const first = Number(range[1]);
    const last = Number(range[2]);
    const count = last - first + 1;
    if (count < 1 || count > 20) return { operator: "unknown", expectedValue: [] };
    return {
      operator: "one_of",
      expectedValue: Array.from({ length: count }, (_, index) => first + index),
    };
  }
  const years = uniqueTerms(clause.match(/20\d{2}/g) ?? []).map(Number);
  const operator = /(?:及以后|以后毕业|不早于)/.test(clause)
    ? "at_least"
    : /(?:及以前|以前毕业|不晚于)/.test(clause)
      ? "at_most"
      : "one_of";
  return years.length > 0
    ? { operator, expectedValue: operator === "one_of" ? years : years[0] }
    : { operator: "unknown", expectedValue: [] };
}

function textualExpectation(
  clause: string,
  kind: RequirementKind,
): Pick<JobRequirement, "operator" | "expectedValue"> {
  if (kind === "graduation_year") return graduationYearExpectation(clause);
  if (kind === "student_status") return { operator: "equals", expectedValue: true };
  if (kind === "education") {
    const levels = educationValues(clause);
    return levels.length > 0
      ? { operator: "one_of", expectedValue: levels }
      : { operator: "unknown", expectedValue: [] };
  }
  if (kind === "weekly_attendance") {
    const days = attendanceDays(clause);
    return days
      ? { operator: "at_least", expectedValue: days }
      : { operator: "unknown", expectedValue: [] };
  }
  if (kind === "duration") {
    const months = internshipMonths(clause);
    return months
      ? { operator: "at_least", expectedValue: months }
      : { operator: "unknown", expectedValue: [] };
  }
  if (kind === "major") {
    const majors = uniqueTerms(majorTermDictionary.filter((term) => clause.includes(term)));
    return majors.length === 1
      ? { operator: "contains", expectedValue: majors[0] }
      : { operator: "unknown", expectedValue: majors };
  }
  if (kind === "language") {
    const hasLevel = /(?:四级|六级|CET[- ]?[46]|雅思|托福|TOEFL|IELTS)/i.test(clause);
    return !hasLevel && /(?:英语|外语|语言能力)/.test(clause)
      ? { operator: "contains", expectedValue: clause.includes("英语") ? "英语" : "外语" }
      : { operator: "unknown", expectedValue: [] };
  }
  const terms = evidenceTerms(clause);
  return terms.length > 0
    ? { operator: "contains", expectedValue: terms }
    : { operator: "unknown", expectedValue: [] };
}

export function decomposeTextualJobRequirements(
  input: TextualRequirementInput,
): RequirementDecomposition {
  const origin = input.origin ?? "jd_clause";
  const sourceUnits: RequirementSourceUnit[] = [];
  const requirements: JobRequirementV5[] = [];
  for (const [index, clause] of splitRequirementAtoms(input.sourceText).entries()) {
    const evidenceRefs = [`${input.evidenceRefPrefix}:${index + 1}`];
    const sourceSpan = { start: clause.start, end: clause.end, excerptHash: sha256(clause.text) };
    const sourceUnitId = stableSourceUnitId(input.publishedJobVersionId, {
      origin,
      text: clause.text,
      start: clause.start,
      end: clause.end,
    });
    sourceUnits.push(
      RequirementSourceUnitSchema.parse({
        id: sourceUnitId,
        text: clause.text,
        origin: { kind: origin },
        section: "requirements",
        evidenceRefs,
        sourceSpan,
      }),
    );
    const seen = new Map<string, JobRequirementV5>();
    for (const atomText of splitAssertionAtoms(clause.text)) {
      const necessity = atomNecessity(atomText, clause.necessity);
      for (const kind of textualKinds(atomText)) {
        const expectation = textualExpectation(atomText, kind);
        const requirement = JobRequirementV5Schema.parse({
          id: stableRequirementId(
            input.publishedJobVersionId,
            sourceUnitId,
            kind,
            atomText,
            expectation.expectedValue,
          ),
          kind,
          operator: expectation.operator,
          expectedValue: expectation.expectedValue,
          // The visible source excerpt is always the whole clause, never the internal atom.
          sourceText: clause.text,
          evidenceRefs,
          sourceSpan,
          sourceUnitId,
          necessity,
        });
        // A hard fact stated as required elsewhere in the clause must not be downgraded to
        // preferred only because a later atom carried 优先, and vice versa.
        const dedupeKey = `${kind}:${JSON.stringify(expectation.expectedValue)}`;
        const existing = seen.get(dedupeKey);
        if (!existing || (necessity === "required" && existing.necessity !== "required")) {
          seen.set(dedupeKey, requirement);
        }
      }
    }
    requirements.push(...seen.values());
  }
  return { sourceUnits, requirements };
}
