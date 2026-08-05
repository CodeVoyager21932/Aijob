import type { CareerCase, CareerCaseEvidence, EvidenceStateValue } from "./domain";
import { careerCases } from "./domain";

export type RequirementGroup = "hard" | "capability" | "unknown";

export interface CareerCaseRequirement {
  id: string;
  group: RequirementGroup;
  title: string;
  sourceLabel: string;
  sourceText: string;
  state: EvidenceStateValue;
  evidenceIds: string[];
  nextStep: string;
}

export interface ResumeSuggestion {
  requirementId: string;
  evidenceIds: string[];
  suggestedText: string;
}

export interface CareerResumeBlock {
  id: string;
  sectionId: string;
  title: string;
  meta: string;
  bullets: string[];
  suggestion?: ResumeSuggestion;
}

export interface CareerResumeSection {
  id: string;
  label: string;
  blocks: CareerResumeBlock[];
}

export interface CareerCaseWorkspace {
  requirements: CareerCaseRequirement[];
  resume: {
    candidateName: string;
    targetLabel: string;
    sections: CareerResumeSection[];
  };
}

export const requirementGroups = [
  {
    value: "hard",
    label: "明确硬条件",
    description: "只展示示例岗位原文明示的学历、身份或到岗条件。",
  },
  {
    value: "capability",
    label: "职责与能力",
    description: "逐项核对已确认经历，不把暂未体现解释为不具备。",
  },
  {
    value: "unknown",
    label: "未知待确认",
    description: "岗位原文没有说明时保持未知，等待用户主动确认。",
  },
] as const satisfies ReadonlyArray<{
  value: RequirementGroup;
  label: string;
  description: string;
}>;

interface RoleRequirementProfile {
  hardTitle: string;
  hardSourceText: string;
}

const roleRequirementProfiles: Record<string, RoleRequirementProfile> = {
  "case-starbridge-product": {
    hardTitle: "专业与在校身份",
    hardSourceText: "示例岗位原文：本科及以上学历，产品、商科或相关专业在校生。",
  },
  "case-greenfield-operations": {
    hardTitle: "在校身份与文字表达",
    hardSourceText: "示例岗位原文：面向在校学生，能够完成中文内容编辑与基础校对。",
  },
  "case-northstar-data": {
    hardTitle: "数据相关专业基础",
    hardSourceText: "示例岗位原文：统计、数学、计算机或相关专业本科及以上在校生。",
  },
  "case-farsight-engineering": {
    hardTitle: "计算机相关学习背景",
    hardSourceText: "示例岗位原文：计算机、软件工程或相关专业本科及以上在校生。",
  },
  "case-clearpath-market": {
    hardTitle: "研究与书面表达基础",
    hardSourceText: "示例岗位原文：本科及以上在校生，能够独立完成资料检索与书面整理。",
  },
  "case-spring-ai": {
    hardTitle: "算法相关专业基础",
    hardSourceText: "示例岗位原文：计算机、数学或相关专业本科及以上在校生。",
  },
};

function getEvidenceNextStep(evidence: CareerCaseEvidence): string {
  if (evidence.state === "confirmed") {
    return `保留「${evidence.label}」的原始证据，在后续简历中只使用已确认内容。`;
  }
  if (evidence.state === "needs_work") {
    return `补充「${evidence.label}」的具体动作或结果；没有确认的数字暂不写入。`;
  }
  return `先确认是否存在「${evidence.label}」相关经历，再决定是否用于岗位准备。`;
}

function buildRequirements(careerCase: CareerCase): CareerCaseRequirement[] {
  const profile = roleRequirementProfiles[careerCase.id] ?? {
    hardTitle: "在校身份与学习背景",
    hardSourceText: "示例岗位原文：本科及以上在校生，具备岗位相关学习背景。",
  };
  const capabilityRequirements = careerCase.evidence.map((evidence, index) => ({
    id: `requirement-${careerCase.id}-${evidence.id}`,
    group: "capability" as const,
    title: evidence.label,
    sourceLabel: `官方 JD 静态示例 · 岗位职责 ${index + 1}`,
    sourceText: `示例岗位原文：能够在岗位任务中运用「${evidence.label}」相关能力，并说明具体承担的工作。`,
    state: evidence.state,
    evidenceIds: [evidence.id],
    nextStep: getEvidenceNextStep(evidence),
  }));

  return [
    {
      id: `requirement-${careerCase.id}-education`,
      group: "hard",
      title: profile.hardTitle,
      sourceLabel: "官方 JD 静态示例 · 任职要求 1",
      sourceText: profile.hardSourceText,
      state: "unconfirmed",
      evidenceIds: [],
      nextStep: "等待用户确认学历、专业与在校状态；当前静态原型不保存这些事实。",
    },
    {
      id: `requirement-${careerCase.id}-availability`,
      group: "hard",
      title: "到岗安排",
      sourceLabel: "官方 JD 静态示例 · 任职要求 2",
      sourceText: "示例岗位原文：可稳定参与实习，具体每周到岗天数需进一步确认。",
      state: "unconfirmed",
      evidenceIds: [],
      nextStep: "先由用户确认自己的到岗安排，再与岗位明示条件分别核对。",
    },
    ...capabilityRequirements,
    {
      id: `requirement-${careerCase.id}-weekly-days`,
      group: "unknown",
      title: "每周到岗天数是否有明确下限？",
      sourceLabel: "官方 JD 静态示例 · 原文未说明",
      sourceText: "岗位原文未明确说明每周最低到岗天数。",
      state: "unconfirmed",
      evidenceIds: [],
      nextStep: "保持未知；可以把它加入后续沟通问题，但不能由系统补写答案。",
    },
    {
      id: `requirement-${careerCase.id}-duration`,
      group: "unknown",
      title: "连续实习周期是否有明确要求？",
      sourceLabel: "官方 JD 静态示例 · 原文未说明",
      sourceText: "岗位原文未明确说明连续实习月数。",
      state: "unconfirmed",
      evidenceIds: [],
      nextStep: "保持未知；在用户确认前不把持续周期用于资格判断。",
    },
  ];
}

function buildResume(careerCase: CareerCase, requirements: CareerCaseRequirement[]) {
  const firstEvidence = careerCase.evidence[0];
  if (!firstEvidence) {
    throw new Error(`Static Career OS case has no evidence: ${careerCase.id}`);
  }
  const confirmedEvidence =
    careerCase.evidence.find((item) => item.state === "confirmed") ?? firstEvidence;
  const needsWorkEvidence =
    careerCase.evidence.find((item) => item.state === "needs_work") ?? firstEvidence;
  const suggestionRequirement =
    requirements.find((item) => item.evidenceIds.includes(needsWorkEvidence.id)) ??
    requirements.find((item) => item.group === "capability");
  if (!suggestionRequirement) {
    throw new Error(`Static Career OS case has no capability requirement: ${careerCase.id}`);
  }

  return {
    candidateName: "示例候选人",
    targetLabel: `${careerCase.roleTitle} · 岗位定制草稿`,
    sections: [
      {
        id: "basics",
        label: "基本信息",
        blocks: [
          {
            id: `resume-${careerCase.id}-basics`,
            sectionId: "basics",
            title: "示例候选人",
            meta: "基础信息 · 静态原型",
            bullets: [
              `求职方向：${careerCase.roleTitle}`,
              "联系方式与真实身份信息不会进入本静态原型。",
            ],
          },
        ],
      },
      {
        id: "education",
        label: "教育经历",
        blocks: [
          {
            id: `resume-${careerCase.id}-education`,
            sectionId: "education",
            title: "示例大学 · 本科",
            meta: "2023.09–2027.06",
            bullets: ["专业、课程和成绩将在 Resume V2 阶段只由用户已确认事实生成。"],
          },
        ],
      },
      {
        id: "projects",
        label: "项目经历",
        blocks: [
          {
            id: `resume-${careerCase.id}-project`,
            sectionId: "projects",
            title: `${confirmedEvidence.label}案例项目`,
            meta: "项目经历 · 静态演示",
            bullets: [
              `围绕「${confirmedEvidence.label}」完成一次可追溯的示例任务。`,
              "当前原型不写入未经确认的结果数字。",
            ],
            suggestion: {
              requirementId: suggestionRequirement.id,
              evidenceIds: [confirmedEvidence.id],
              suggestedText: `基于已确认的「${confirmedEvidence.label}」证据，按任务、动作和结果三部分补充与「${needsWorkEvidence.label}」相关的表达；尚未确认的数字暂不写入。`,
            },
          },
        ],
      },
      {
        id: "experience",
        label: "实践经历",
        blocks: [
          {
            id: `resume-${careerCase.id}-experience`,
            sectionId: "experience",
            title: "校园实践示例",
            meta: "实践经历 · 静态演示",
            bullets: ["使用已确认的职责范围描述协作过程，不把参与升级为负责。"],
          },
        ],
      },
      {
        id: "skills",
        label: "技能",
        blocks: [
          {
            id: `resume-${careerCase.id}-skills`,
            sectionId: "skills",
            title: "能力关键词",
            meta: "只展示证据状态，不生成能力结论",
            bullets: careerCase.evidence.map((item) => `${item.label}：${item.state}`),
          },
        ],
      },
    ] satisfies CareerResumeSection[],
  };
}

const workspaceByCaseId = new Map<string, CareerCaseWorkspace>(
  careerCases.map((careerCase) => {
    const requirements = buildRequirements(careerCase);
    return [
      careerCase.id,
      {
        requirements,
        resume: buildResume(careerCase, requirements),
      },
    ];
  }),
);

export function getCareerCaseWorkspace(caseId: string): CareerCaseWorkspace {
  const workspace = workspaceByCaseId.get(caseId);
  if (!workspace) {
    throw new Error(`Unknown static Career OS case: ${caseId}`);
  }
  return workspace;
}

export function getRequirementGroupLabel(group: RequirementGroup): string {
  return requirementGroups.find((item) => item.value === group)?.label ?? "未说明";
}
