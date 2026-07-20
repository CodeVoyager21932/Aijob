import type {
  EligibilityStatus,
  EvidenceMatchStatus,
  FieldValue,
  JobDecisionStatus,
  JobFamily,
  PreferenceMatchStatus,
} from "@aijob/contracts";

export interface DisplayValue {
  text: string;
  state: "known" | "unknown" | "conflict";
  note: string;
}

export function displayField<T>(
  field: FieldValue<T> | undefined,
  format: (value: T) => string = String,
): DisplayValue {
  if (!field || field.state === "unknown") {
    return {
      text: "未说明",
      state: "unknown",
      note: "官方页面没有明确说明，不能当作符合。",
    };
  }
  if (field.state === "conflict") {
    return {
      text: "待核对",
      state: "conflict",
      note: "不同来源片段存在冲突，暂不作结论。",
    };
  }
  return {
    text: format(field.value),
    state: "known",
    note: "来自当前岗位版本的官方页面。",
  };
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "未说明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "待核对";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export const axisLabels = {
  eligibility: {
    no_explicit_conflict: "未发现明确冲突",
    explicit_conflict: "存在明确冲突",
    needs_information: "需补充信息",
  } satisfies Record<EligibilityStatus, string>,
  evidence: {
    explicit_evidence: "有明确证据",
    partial_evidence: "部分证据",
    not_in_resume: "简历暂未体现",
    insufficient_information: "信息不足",
  } satisfies Record<EvidenceMatchStatus, string>,
  preference: {
    fits: "符合",
    does_not_fit: "不符合",
    not_set: "未设置",
  } satisfies Record<PreferenceMatchStatus, string>,
};

export function preferenceStatusLabel(
  status: PreferenceMatchStatus,
  reasonCodes: readonly string[] = [],
): string {
  if (status === "not_set" && reasonCodes.some((code) => code.endsWith("_PREFERENCE_UNKNOWN"))) {
    return "岗位信息待核对";
  }
  return axisLabels.preference[status];
}

export function preferenceStatusTone(
  status: PreferenceMatchStatus,
  reasonCodes: readonly string[] = [],
): "positive" | "warning" | "danger" | "muted" {
  if (status === "not_set" && reasonCodes.some((code) => code.endsWith("_PREFERENCE_UNKNOWN"))) {
    return "warning";
  }
  return axisTone(status);
}

export function axisTone(status: string): "positive" | "warning" | "danger" | "muted" {
  if (status === "no_explicit_conflict" || status === "explicit_evidence" || status === "fits") {
    return "positive";
  }
  if (status === "explicit_conflict" || status === "not_in_resume" || status === "does_not_fit") {
    return "danger";
  }
  if (status === "needs_information" || status === "partial_evidence") return "warning";
  return "muted";
}

export const decisionLabels: Record<JobDecisionStatus, string> = {
  undecided: "未决定",
  saved: "已保存",
  preparing_to_apply: "准备投递",
  applied: "已投递",
  abandoned: "已放弃",
};

export const sourceTypeLabels: Record<string, string> = {
  organization_career_site: "企业官网",
  official_ats: "官方 ATS",
  university_employment_site: "高校就业网",
};

export const salaryPeriodLabels: Record<string, string> = {
  hour: "每小时",
  day: "每天",
  week: "每周",
  month: "每月",
  year: "每年",
  other: "其他周期",
};

export const jobFamilyLabels: Record<JobFamily, string> = {
  product: "产品",
  operations: "运营",
  engineering: "工程技术",
  data_ai: "数据与 AI",
  design: "设计",
  marketing: "市场营销",
  sales_business: "销售与商务",
  finance: "财务",
  people_admin_legal: "人力、行政与法务",
  research_consulting: "研究与咨询",
  supply_chain_manufacturing: "供应链与制造",
  other: "其他",
};

export function piiLabel(kind: string): string {
  const labels: Record<string, string> = {
    phone: "手机号",
    email: "邮箱",
    national_id: "身份证号",
    address: "详细地址",
    other: "其他个人信息",
  };
  return labels[kind] || "个人信息";
}

export interface BrowserPiiFinding {
  kind: "phone" | "email" | "national_id";
  count: number;
}

export function detectBrowserPii(text: string): BrowserPiiFinding[] {
  const patterns: Array<[BrowserPiiFinding["kind"], RegExp]> = [
    ["phone", /(?<!\d)1[3-9]\d{9}(?!\d)/g],
    ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
    [
      "national_id",
      /(?<!\d)\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g,
    ],
  ];
  return patterns.flatMap(([kind, pattern]) => {
    const count = text.match(pattern)?.length ?? 0;
    return count > 0 ? [{ kind, count }] : [];
  });
}

export function splitList(value: string): string[] {
  return value
    .split(/[，,、；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
