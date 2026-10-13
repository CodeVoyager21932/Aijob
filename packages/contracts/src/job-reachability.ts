import { z } from "zod";

// Legacy values remain readable; ADR-0037 no longer emits school/degree exclusions.
// This describes catalogue scope, not an individual student's eligibility.
export const JobReachabilityVerdictSchema = z.enum([
  "reachable",
  "not_reachable_school_restricted",
  "not_reachable_postgrad_only",
  "unknown",
  "not_reachable_experience_required",
]);
export type JobReachabilityVerdict = z.infer<typeof JobReachabilityVerdictSchema>;
export interface JobReachabilityInput {
  requirements: string;
  responsibilities?: string;
}
export const STUDENT_EDUCATION_PATTERN =
  "本科|学士|大专|专科|硕士|研究生|博士|学历不限|不限学历|专业不限|不限专业|在校生|应届生";
export const EXPERIENCE_YEARS_PATTERN =
  "([0-9]+|[一二三四五六七八九十两]+)([-~～至到]([0-9]+|[一二三四五六七八九十两]+))?\\s*年[^。；;，,\\n]{0,12}经验";
export const EXPERIENCE_NON_REQUIRED_PATTERN =
  "实习经验|无需|不要求|不需要|不限经验|经验不限|不限制|优先|加分|或";
export function hasRequiredProfessionalExperience(text: string): boolean {
  // A comma immediately introducing an alternative belongs to the same condition.
  // Independent conjunctions stop an education preference changing an experience requirement.
  const conditions = text.replace(/[，,]\s*(或(?:者)?)/gu, "$1");
  for (const clause of conditions.split(/[。；;，,\n]|并且|且|但是|但/u)) {
    if (new RegExp(EXPERIENCE_NON_REQUIRED_PATTERN, "u").test(clause)) continue;
    const match = new RegExp(EXPERIENCE_YEARS_PATTERN, "u").exec(clause);
    if (match && !/^(0|1|一)$/u.test(match[1] ?? "")) return true;
    if (/多年[^。；;，,\n]{0,12}经验/u.test(clause)) return true;
  }
  return false;
}
export function classifyJobReachability(input: JobReachabilityInput): JobReachabilityVerdict {
  const text = `${input.requirements ?? ""} ${input.responsibilities ?? ""}`;
  if (hasRequiredProfessionalExperience(input.requirements ?? ""))
    return "not_reachable_experience_required";
  return new RegExp(STUDENT_EDUCATION_PATTERN, "u").test(text) ? "reachable" : "unknown";
}
export function isReachableVerdict(verdict: JobReachabilityVerdict): boolean {
  return verdict === "reachable";
}
/** Historical reporting constant only, never a current eligibility gate. */
export const MINIMUM_REACHABLE_VISIBLE_JOB_RATIO = 0.5;
