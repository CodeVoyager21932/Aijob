import type { JobSemanticAtom } from "@aijob/contracts";
import { inferCapabilities, isSpecificToolTerm } from "../matching/capabilities.js";
import { classifyOfficialJobFamily } from "../sources/job-family-classifier.js";
import { decomposeTextualJobRequirements, splitRequirementAtoms } from "./requirements.js";

export const JOB_SEMANTICS_VERSION = "role-semantics-v1";
const deliverables = [
  "PRD",
  "需求文档",
  "数据看板",
  "实验报告",
  "研究论文",
  "原型",
  "活动方案",
  "测试报告",
  "财务报表",
  "销售方案",
  "合同",
  "招聘计划",
];
const keyText = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Rebuildable semantic index over immutable official text; it is never a personal fact. */
export function interpretOfficialJob(input: {
  jobVersionId: string;
  title: string;
  requirements: string;
  responsibilities: string;
  unstructured?: boolean;
}) {
  const role = classifyOfficialJobFamily({
    title: input.title,
    sourceEvidenceRef: input.jobVersionId,
  }).interpretation;
  const atoms: JobSemanticAtom[] = [];
  const educationLevels = new Set<string>();
  for (const section of ["requirements", "responsibilities"] as const) {
    const source = input[section];
    let mixedSection: "requirements" | "responsibilities" | "unknown" = "unknown";
    for (const clause of splitRequirementAtoms(source)) {
      if (input.unstructured) {
        if (/^(?:岗位职责|工作职责|工作内容|职位描述)[:：\s]/u.test(clause.text))
          mixedSection = "responsibilities";
        if (/^(?:任职要求|岗位要求|职位要求|基本要求|必备条件|任职资格)[:：\s]/u.test(clause.text))
          mixedSection = "requirements";
      }
      let position = 0;
      for (const fragment of clause.text.split(
        /[，,]|(?:并且|而且|但是|然而)|(?<!包括)但(?!不限于)|且/u,
      )) {
        const text = fragment.trim();
        const localOffset = clause.text.indexOf(fragment, position);
        position = localOffset + fragment.length;
        if (!text) continue;
        const start = clause.start + localOffset + fragment.indexOf(text);
        const negated =
          /(?:不要求|无需|不需要|非必须|不是必须|不限制|不限定|不限(?!于)|非985|非211)/u.test(text);
        const condition = /或|任选|任一|如果|若|对于|者可|二者之一/u.test(text) ? text : null;
        const preferred =
          /优先|加分|更佳|为佳|preferred/iu.test(text) || clause.necessity === "preferred";
        const necessity =
          section === "responsibilities" ||
          (input.unstructured && mixedSection !== "requirements") ||
          condition
            ? ("unknown" as const)
            : negated
              ? ("optional" as const)
              : preferred
                ? ("preferred" as const)
                : ("required" as const);
        const add = (key: string, label: string, kind: JobSemanticAtom["kind"]) => {
          if (
            atoms.some(
              (atom) =>
                atom.key === key && atom.section === section && atom.sourceSpan.start === start,
            )
          )
            return;
          atoms.push({
            key,
            label,
            kind,
            necessity,
            negated,
            condition,
            sourceText: text,
            section,
            sourceSpan: { start, end: start + text.length },
          });
        };
        const requirements = decomposeTextualJobRequirements({
          publishedJobVersionId: input.jobVersionId,
          sourceText: text,
          evidenceRefPrefix: "semantic",
        }).requirements;
        for (const requirement of requirements) {
          const values = Array.isArray(requirement.expectedValue)
            ? requirement.expectedValue.map(String)
            : [String(requirement.expectedValue ?? "")];
          if (requirement.kind === "education" && !negated) {
            for (const value of values)
              if (["大专", "本科", "硕士", "博士"].includes(value)) educationLevels.add(value);
            if (values.length)
              add(`education:${values.join("|")}`, values.join(" / "), "education");
          }
          if (requirement.kind === "skill" || requirement.kind === "experience") {
            for (const value of values.filter(isSpecificToolTerm))
              add(`tool:${keyText(value)}`, value, "tool");
          }
          if (
            [
              "student_status",
              "weekly_attendance",
              "duration",
              "graduation_year",
              "major",
              "language",
            ].includes(requirement.kind) &&
            requirement.operator !== "unknown"
          ) {
            add(
              `qualification:${requirement.kind}:${keyText(values.join("|"))}`,
              text,
              "qualification",
            );
          }
        }
        for (const capability of inferCapabilities(text))
          add(`task:${capability.key}`, capability.label, "task");
        for (const deliverable of deliverables)
          if (text.toLowerCase().includes(deliverable.toLowerCase()))
            add(`deliverable:${keyText(deliverable)}`, deliverable, "deliverable");
        if (section === "requirements") {
          for (const school of text.match(/985|211|双一流/g) ?? [])
            add(`school:${school}`, school, "school");
          // Negated education is still a mention, never a hard requirement.
          if (negated)
            for (const level of text.match(/本科|硕士|博士/g) ?? [])
              add(`education:${level}`, level, "education");
        }
      }
    }
  }
  return { version: JOB_SEMANTICS_VERSION, role, educationLevels: [...educationLevels], atoms };
}
