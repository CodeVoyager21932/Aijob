import type {
  ApplicationCaseRequirements,
  JobRequirement,
  RequirementEvidenceState,
} from "@aijob/contracts";

export type RequirementGroup = "hard" | "capability" | "unknown";

export const requirementGroups = [
  {
    value: "hard",
    label: "硬条件",
    description: "只处理岗位明确写出的资格、时间与地点条件。",
  },
  {
    value: "capability",
    label: "职责与能力",
    description: "核对技能、经历与明确职责表达，不推断未写出的要求。",
  },
  {
    value: "unknown",
    label: "未知待确认",
    description: "原文存在，但暂时无法可靠结构化或需要你进一步确认。",
  },
] as const satisfies ReadonlyArray<{
  value: RequirementGroup;
  label: string;
  description: string;
}>;

const hardKinds = new Set<JobRequirement["kind"]>([
  "graduation_year",
  "student_status",
  "city",
  "arrival_date",
  "weekly_attendance",
  "duration",
  "education",
  "major",
  "language",
]);

const requirementKindLabels = {
  graduation_year: "毕业年份",
  student_status: "在校状态",
  city: "工作城市",
  arrival_date: "到岗时间",
  weekly_attendance: "每周出勤",
  duration: "实习时长",
  education: "学历",
  major: "专业",
  language: "语言",
  skill: "技能",
  experience: "经历与职责",
  other: "其他原文",
} as const satisfies Record<JobRequirement["kind"], string>;

export function requirementKindLabel(kind: JobRequirement["kind"]): string {
  return requirementKindLabels[kind];
}

export function requirementGroup(requirement: JobRequirement): RequirementGroup {
  if (requirement.operator === "unknown" || requirement.kind === "other") return "unknown";
  if (hardKinds.has(requirement.kind)) return "hard";
  return "capability";
}

export function getRequirementState(
  data: ApplicationCaseRequirements,
  requirementId: string,
): { state: RequirementEvidenceState; userNote: string; persisted: boolean } {
  const state = data.states.find((item) => item.requirementId === requirementId);
  return {
    state: state?.state ?? "unconfirmed",
    userNote: state?.userNote ?? "",
    persisted: state?.persisted ?? false,
  };
}

export function getRequirementEvidenceIds(
  data: ApplicationCaseRequirements,
  requirementId: string,
): string[] {
  return data.evidenceLinks
    .filter((link) => link.requirementId === requirementId && link.removedAt === null)
    .map((link) => link.evidenceId)
    .sort();
}

export function requirementNextStep(
  state: RequirementEvidenceState,
  evidenceCount: number,
): string {
  if (state === "unconfirmed") return "先确认这项要求与你的真实情况，不让未知信息参与结论。";
  if (state === "needs_work") return "保留差距并补充真实证据或备注，不自动改写为已满足。";
  if (evidenceCount === 0) return "状态已确认；如有已确认经历，可选择关联为依据。";
  return `已确认并关联 ${evidenceCount} 项证据，可继续核对下一项要求。`;
}

export function summarizeRequirementProgress(data: ApplicationCaseRequirements) {
  const states = new Map(data.states.map((item) => [item.requirementId, item.state]));
  let confirmed = 0;
  let needsWork = 0;
  let unconfirmed = 0;
  for (const requirement of data.requirements) {
    const state = states.get(requirement.id) ?? "unconfirmed";
    if (state === "confirmed") confirmed += 1;
    else if (state === "needs_work") needsWork += 1;
    else unconfirmed += 1;
  }
  return {
    total: data.requirements.length,
    confirmed,
    needsWork,
    unconfirmed,
    linkedEvidenceCount: data.evidenceLinks.filter((link) => link.removedAt === null).length,
  };
}

export function requirementSourceLabel(data: ApplicationCaseRequirements): string {
  return data.requirementContext.kind === "public"
    ? "固定岗位版本 · JD 原文"
    : "用户私有 JD · 原文";
}
