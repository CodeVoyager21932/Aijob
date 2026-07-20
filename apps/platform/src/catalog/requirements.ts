import { createHash } from "node:crypto";
import type {
  FieldValue,
  JobRequirement,
  RequirementKind,
  RequirementNecessity,
} from "@aijob/contracts";
import { JobRequirementSchema } from "@aijob/contracts";

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
}

interface RequirementDescriptor<T> {
  kind: RequirementKind;
  operator: JobRequirement["operator"];
  field: RequirementField<T> | undefined;
}

export interface RequirementClause {
  text: string;
  start: number;
  end: number;
}

function stableId(
  publishedJobVersionId: string,
  kind: RequirementKind,
  sourceText: string,
  expectedValue: unknown,
): string {
  const hash = createHash("sha256")
    .update(JSON.stringify([publishedJobVersionId, kind, sourceText, expectedValue]))
    .digest("hex")
    .slice(0, 20);
  return `requirement-${kind}-${hash}`;
}

function createRequirement<T>(
  publishedJobVersionId: string,
  descriptor: RequirementDescriptor<T>,
): JobRequirement | null {
  const { field } = descriptor;
  if (!field || field.value.state === "unknown") return null;
  const sourceText =
    field.sourceText?.trim() ||
    (field.value.state === "conflict" ? field.value.rawValues.join(" / ") : "");
  if (!sourceText) return null;

  if (field.value.state === "conflict") {
    return JobRequirementSchema.parse({
      id: stableId(publishedJobVersionId, descriptor.kind, sourceText, field.value.rawValues),
      kind: descriptor.kind,
      operator: "unknown",
      expectedValue: field.value.rawValues,
      sourceText,
      evidenceRefs: field.value.evidenceRefs,
      sourceSpan: null,
      necessity: field.necessity,
    });
  }

  const sourceExpectation =
    descriptor.kind === "graduation_year" &&
    /20\d{2}/.test(sourceText) &&
    /(?:届|毕业)/.test(sourceText)
      ? graduationYearExpectation(sourceText)
      : undefined;
  const operator = sourceExpectation?.operator ?? descriptor.operator;
  const expectedValue = sourceExpectation?.expectedValue ?? field.value.value;

  return JobRequirementSchema.parse({
    id: stableId(publishedJobVersionId, descriptor.kind, sourceText, expectedValue),
    kind: descriptor.kind,
    operator,
    expectedValue,
    sourceText,
    evidenceRefs: field.value.evidenceRefs,
    sourceSpan: null,
    necessity: field.necessity,
  });
}

/**
 * Builds only requirements that already have a structured known value and an
 * exact source excerpt. Unknown/conflicting values and free text are deliberately
 * not guessed into hard conditions.
 */
export function decomposeKnownJobRequirements(
  input: DeterministicRequirementInput,
): JobRequirement[] {
  const descriptors: RequirementDescriptor<unknown>[] = [
    { kind: "city", operator: "one_of", field: input.locations },
    {
      kind: "arrival_date",
      operator: "before_or_on",
      field: input.earliestStartDate,
    },
    {
      kind: "weekly_attendance",
      operator: "at_least",
      field: input.weeklyAttendanceDays,
    },
    { kind: "duration", operator: "at_least", field: input.durationMonths },
    {
      kind: "graduation_year",
      operator: "one_of",
      field: input.graduationYears,
    },
    { kind: "education", operator: "one_of", field: input.educationLevels },
    { kind: "major", operator: "one_of", field: input.majors },
    { kind: "language", operator: "one_of", field: input.languages },
  ];

  return descriptors
    .map((descriptor) => createRequirement(input.publishedJobVersionId, descriptor))
    .filter((requirement): requirement is JobRequirement => requirement !== null);
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
  "中文",
  "外语",
] as const;

function uniqueTerms(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function splitRequirementAtoms(sourceText: string): RequirementClause[] {
  const atoms: RequirementClause[] = [];
  const matcher = /[^\r\n；;，,。！？!?]+/g;
  for (const match of sourceText.matchAll(matcher)) {
    const raw = match[0];
    const rawStart = match.index ?? 0;
    const withoutMarker = raw.replace(/^\s*(?:[（(]?\d{1,2}[）)、.．:]|[-•])\s*/, "");
    const text = withoutMarker.trim();
    if (text.length < 2) continue;
    const textOffset = raw.indexOf(text);
    const start = rawStart + Math.max(0, textOffset);
    atoms.push({ text, start, end: start + text.length });
  }
  return atoms;
}

export function splitRequirementClauses(sourceText: string): string[] {
  return splitRequirementAtoms(sourceText).map(({ text }) => text);
}

function textualKinds(clause: string): RequirementKind[] {
  if (/(?:不限专业|专业不限|不限学历|学历不限|经验不限|无经验要求)/.test(clause)) {
    return [];
  }
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
  if (internshipMonths(clause) !== undefined) {
    kinds.push("duration");
  }
  if (/(?:学历|大专|专科|本科|硕士|博士)/.test(clause)) kinds.push("education");
  if (/(?:专业)/.test(clause)) kinds.push("major");
  if (/(?:英语|语言|CET[- ]?[46]|雅思|托福|TOEFL|IELTS)/i.test(clause)) {
    kinds.push("language");
  }

  const hasEvidenceTerm = evidenceTermDictionary.some((term) =>
    clause.toLocaleLowerCase("zh-CN").includes(term.toLocaleLowerCase("zh-CN")),
  );
  if (/(?:经历|经验|实习|项目)/.test(clause) && !kinds.includes("duration")) {
    kinds.push("experience");
  } else if (hasEvidenceTerm || /(?:熟悉|掌握|熟练|了解|能力)/.test(clause)) {
    kinds.push("skill");
  }
  return kinds.length > 0 ? [...new Set(kinds)] : ["other"];
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
    if (count < 1 || count > 20) {
      return { operator: "unknown", expectedValue: [] };
    }
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
  if (kind === "graduation_year") {
    return graduationYearExpectation(clause);
  }
  if (kind === "student_status") {
    return { operator: "equals", expectedValue: true };
  }
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
    if (/(?:专业不限|不限专业)/.test(clause)) {
      return { operator: "unknown", expectedValue: [] };
    }
    const majors = uniqueTerms(majorTermDictionary.filter((term) => clause.includes(term)));
    return majors.length === 1
      ? { operator: "contains", expectedValue: majors[0] }
      : { operator: "unknown", expectedValue: majors };
  }
  if (kind === "language") {
    const hasLevel = /(?:四级|六级|CET[- ]?[46]|雅思|托福|TOEFL|IELTS)/i.test(clause);
    return !hasLevel && clause.includes("英语")
      ? { operator: "contains", expectedValue: "英语" }
      : { operator: "unknown", expectedValue: [] };
  }
  const terms = evidenceTerms(clause);
  return terms.length > 0
    ? { operator: "contains", expectedValue: terms }
    : { operator: "unknown", expectedValue: [] };
}

/**
 * Conservatively splits explicit JD requirement clauses. It only extracts a
 * small audited dictionary and simple hard facts; everything else remains an
 * `unknown` requirement with its exact source excerpt instead of being guessed.
 */
export function decomposeTextualJobRequirements(input: TextualRequirementInput): JobRequirement[] {
  return splitRequirementAtoms(input.sourceText).flatMap((clause, index) =>
    textualKinds(clause.text).map((kind) => {
      const sourceText = clause.text;
      const expectation = textualExpectation(sourceText, kind);
      const necessity: RequirementNecessity = /(?:优先|加分|更佳|为佳|preferred)/i.test(sourceText)
        ? "preferred"
        : /(?:可选|非必须|不作要求|无需)/.test(sourceText)
          ? "optional"
          : "required";
      return JobRequirementSchema.parse({
        id: stableId(input.publishedJobVersionId, kind, sourceText, expectation.expectedValue),
        kind,
        operator: expectation.operator,
        expectedValue: expectation.expectedValue,
        sourceText,
        evidenceRefs: [`${input.evidenceRefPrefix}:${index + 1}`],
        sourceSpan: {
          start: clause.start,
          end: clause.end,
          excerptHash: createHash("sha256").update(sourceText).digest("hex"),
        },
        necessity,
      });
    }),
  );
}
