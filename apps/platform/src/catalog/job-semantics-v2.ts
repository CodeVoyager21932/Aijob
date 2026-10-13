import { JOB_DIRECTIONS, JOB_DIRECTION_VERSION, JOB_SEMANTICS_V2, type GraphAtomV2 } from "@aijob/contracts";
import { classifyOfficialJobFamily } from "../sources/job-family-classifier.js";
import { CONCEPT_BY_KEY, CONCEPT_DICTIONARY } from "./concept-dictionary.js";
import { decomposeTextualJobRequirements } from "./requirements.js";

export type SemanticInputV2 = { jobVersionId: string; title: string; requirements: string; responsibilities: string; unstructured?: boolean; sourceLabels?: string[] };
function* clauses(text: string) {
  const re = /[^。；;\r\n]+/gu;
  for (const match of text.matchAll(re)) {
    const raw = match[0], value = raw.trim(), start = match.index + raw.indexOf(value);
    if (value) yield { text: value, start, end: start + value.length };
  }
}
function segment(text: string, index: number) {
  // Local assertion scope; the full sentence remains attached to every concept.
  const re = /[，,]|(?:并且|但是|然而)|(?<!包括)但(?!不限于)|且/gu;
  const separators = [...text.matchAll(re)].filter((m) => !(/^[，,]$/.test(m[0]) && /^(?:\s*[A-Za-z][A-Za-z0-9+#/.]*(?=\s*(?:[，,、]|任一|任意|或|至少|$))|\s*(?:至少一|任一|其中一))/u.test(text.slice(m.index + 1))));
  let start = 0, end = text.length;
  for (const m of separators) {
    if (m.index < index) start = m.index + m[0].length;
    else { end = m.index; break; }
  }
  const raw = text.slice(start, end), value = raw.trim();
  return { text: value, start: start + raw.indexOf(value) };
}
const negation = /不要求|无需|不需要|非必须|不是必须|不限制|不限定|不限(?!于)|非985|非211/u;
const preference = /优先|加分|更佳|为佳|preferred/iu;
const alternative = /或者|或|任选|任一|至少一种|至少一门|其中一种|其中一门|其一|二者之一|择一/u;

export function interpretJobV2(input: SemanticInputV2) {
  const oldRole = classifyOfficialJobFamily({ title: input.title, sourceEvidenceRef: input.jobVersionId, ...(input.sourceLabels ? { sourceLabels: input.sourceLabels } : {}) }).interpretation;
  const direction = JOB_DIRECTIONS.find((r) => new RegExp(r.titlePattern, "iu").test(input.title));
  // AI may describe the product/domain. A second data/algorithm function needs
  // functional wording; it cannot follow from the domain label alone.
  const dataFunction=/数据(?:分析|科学|挖掘|工程)|算法|机器学习|(?:AI|人工智能|大模型).{0,6}(?:开发|研发|研究|工程师)/iu.test(input.title);
  const families=oldRole.families.filter(family=>family!=='data_ai'||direction?.family==='data_ai'||dataFunction);
  const role = { ...oldRole, version: JOB_DIRECTION_VERSION, primaryFamily: direction?.family ?? (oldRole.primaryFamily && families.includes(oldRole.primaryFamily) ? oldRole.primaryFamily : null),
    families: [...new Set([...families, ...(direction ? [direction.family] : [])])], subrole: direction?.id ?? null };
  const atoms: GraphAtomV2[] = [], educationLevels = new Set<string>();
  for (const inputSection of ["requirements", "responsibilities"] as const) {
    let mixedSection: "requirements" | "responsibilities" | "unknown" = "unknown";
    for (const clause of clauses(input[inputSection])) {
      if (/^(岗位职责|工作职责|工作内容|职位描述)[:：]?/u.test(clause.text)) mixedSection = "responsibilities";
      if (/^(任职要求|岗位要求|职位要求|基本要求|必备条件|任职资格)[:：]?/u.test(clause.text)) mixedSection = "requirements";
      if (/^(岗位职责|工作职责|工作内容|职位描述|任职要求|岗位要求|职位要求|基本要求|必备条件|任职资格)[:：]?$/u.test(clause.text)) continue;
      const duty = inputSection === "responsibilities" || (input.unstructured && mixedSection !== "requirements");
      const section = duty ? "responsibilities" as const : "requirements" as const;
      const sentenceAtoms: GraphAtomV2[] = [];
      const add = (key: string, label: string, kind: GraphAtomV2["kind"], index: number, parents: string[] = []) => {
        const local = segment(clause.text, index);
        const start = clause.start + local.start;
        if (sentenceAtoms.some((a) => a.key === key && a.sourceSpan.start === start)) return;
        const negated = negation.test(local.text);
        const condition = alternative.test(local.text) || /如果|若|对于|满足.*条件/u.test(local.text) ? local.text : null;
        const necessity = negated ? "optional" as const : duty ? "unknown" as const : preference.test(local.text) ? "preferred" as const : condition ? "unknown" as const : "required" as const;
        sentenceAtoms.push({ key, label, kind, section, necessity, negated, condition, sourceText: local.text,
          sourceSpan: { start, end: start + local.text.length }, clauseText: clause.text, clauseSpan: { start: clause.start, end: clause.end }, parentKeys: parents, relatedKeys: [], choiceGroup: null });
      };
      for (const rule of CONCEPT_DICTIONARY) {
        for (const match of clause.text.matchAll(new RegExp(rule.pattern.source, `${rule.pattern.flags}g`))) {
          const local = segment(clause.text, match.index);
          const majorEnd = local.text.indexOf("专业");
          const inMajor = majorEnd >= 0 && match.index - local.start <= majorEnd && !/专业(?:知识|能力|技能)/u.test(local.text);
          if (inMajor && ["task", "knowledge", "domain"].includes(rule.kind)) continue;
          if (rule.key === "deliverable:requirements_document" && /\bPRD\b|产品/iu.test(`${input.title} ${clause.text}`)) {
            add("deliverable:prd", "产品需求文档（PRD）", "deliverable", match.index); continue;
          }
          add(rule.key, rule.label, rule.kind, match.index, rule.parentKeys ?? []);
          for (const key of rule.parentKeys ?? []) {
            const parent = CONCEPT_BY_KEY.get(key);
            if (parent) add(parent.key, parent.label, parent.kind, match.index);
          }
        }
      }
      if (!duty) {
        for (const match of clause.text.matchAll(/大专|本科|硕士|博士|985|211|双一流/gu))
          add(`qualification:${/985|211|双一流/u.test(match[0]) ? "school" : "education"}:${match[0]}`, match[0], "qualification", match.index);
        const qualifications = decomposeTextualJobRequirements({ publishedJobVersionId: input.jobVersionId, sourceText: clause.text, evidenceRefPrefix: "semantic-v2" }).requirements;
        for (const q of qualifications) {
          const values = Array.isArray(q.expectedValue) ? q.expectedValue.map(String) : [String(q.expectedValue ?? "")];
          if (q.kind === "education" && !negation.test(clause.text)) for (const v of values) if (["大专", "本科", "硕士", "博士"].includes(v)) educationLevels.add(v);
          if (["major", "student_status", "weekly_attendance", "duration", "graduation_year", "language"].includes(q.kind) && q.operator !== "unknown") {
            const raw = q.sourceText ?? clause.text;
            const index = Math.max(0, clause.text.indexOf(raw));
            add(`qualification:${q.kind}:${values.join("|").normalize("NFKC").toLowerCase()}`, raw, "qualification", index);
          }
        }
        const exp = clause.text.match(/(?:相关)?(?:实习|工作|项目)经验/u);
        if (exp?.index !== undefined) add(`qualification:experience:${exp[0].replace(/^相关/u, "")}`, exp[0].replace(/^相关/u, ""), "qualification", exp.index);
      }
      const alternatives = sentenceAtoms.filter((a) => a.kind === "tool" || a.kind === "qualification");
      if (alternative.test(clause.text) && alternatives.length > 1) {
        // Alternatives only group concepts of the same category, not an unrelated degree and a tool.
        const categoryOf = (a: GraphAtomV2) => `${a.sourceSpan.start}:${a.kind === 'tool' ? 'tool' : a.key.split(':')[1]}`;
        const categories = new Set(alternatives.filter((a) => alternative.test(a.sourceText)).map(categoryOf));
        for (const category of categories) {
          const members = alternatives.filter((a) => categoryOf(a) === category);
          if (members.length < 2) continue;
          const keys = [...new Set(members.map((a) => a.key))];
          for (const a of members) {
            a.choiceGroup = { id: `${inputSection}:${clause.start}:${category}`, operator: "any", keys, text: clause.text };
            a.condition = a.sourceText;
            if (a.necessity === "required") a.necessity = "unknown";
          }
        }
      }
      for (const atom of sentenceAtoms) atom.relatedKeys = [...new Set(sentenceAtoms.filter((a) => a.key !== atom.key && !a.negated).map((a) => a.key))];
      if (!sentenceAtoms.length) add(`unclassified:${clause.text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").slice(0, 180)}`, clause.text, "unclassified", 0);
      atoms.push(...sentenceAtoms);
    }
  }
  for(const atom of atoms) if(atom.key.startsWith('qualification:education:')&&!atom.negated) educationLevels.add(atom.label);
  return { version: JOB_SEMANTICS_V2, role, atoms, educationLevels: [...educationLevels] };
}
