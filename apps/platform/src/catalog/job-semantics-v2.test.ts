import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GraphAtomV2Schema, JobGraphScopeSchema } from "@aijob/contracts";
import { interpretJobV2 } from "./job-semantics-v2.js";
import { SEMANTIC_V2_CORPUS, SEMANTIC_V2_HOLDOUT } from "./semantic-v2.corpus.js";
import { aggregateGraphV2, type GraphRecordV2 } from "../insights/graph-v2.js";

const parse = (text: string, duty = false) => interpretJobV2({ jobVersionId: randomUUID(), title: "产品实习生", requirements: duty ? "" : text, responsibilities: duty ? text : "" });
describe("versioned direction semantics", () => {
  it('keeps an AI product domain out of the algorithm function while allowing explicit cross-functions',()=>{
    const product=interpretJobV2({jobVersionId:randomUUID(),title:'AI 产品实习生',requirements:'熟悉人工智能产品',responsibilities:'整理需求文档'});
    expect(product.role.primaryFamily).toBe('product');
    expect(product.role.families).not.toContain('data_ai');
    expect(product.role.domains).toContain('ai');
    const algorithm=interpretJobV2({jobVersionId:randomUUID(),title:'AI 算法工程师实习',requirements:'',responsibilities:'训练模型'});
    expect(algorithm.role.families).toContain('data_ai');
  });
  for (const row of SEMANTIC_V2_CORPUS) it(`${row.title} / ${row.text}`, () => {
    const duty = "duty" in row && row.duty;
    const result = interpretJobV2({ jobVersionId: randomUUID(), title: row.title, requirements: duty ? "" : row.text, responsibilities: duty ? row.text : "" });
    const keys = result.atoms.map((a) => a.key);
    for (const key of row.yes) expect(keys).toContain(key);
    for (const key of row.no) expect(keys).not.toContain(key);
    for (const atom of result.atoms) {
      expect(GraphAtomV2Schema.safeParse(atom).success).toBe(true);
      expect(row.text.slice(atom.sourceSpan.start, atom.sourceSpan.end)).toBe(atom.sourceText);
      expect(row.text.slice(atom.clauseSpan.start, atom.clauseSpan.end)).toBe(atom.clauseText);
      if (duty) expect(atom.necessity).not.toBe("required");
    }
  });
  for (const row of SEMANTIC_V2_HOLDOUT) it(`held-out / ${row.text}`, () => {
    const keys = interpretJobV2({ jobVersionId: randomUUID(), title: row.title, requirements: "", responsibilities: row.text }).atoms.map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining([...row.yes]));
  });
  it.each([
    ["不要求相关实习经验", "qualification:experience:实习经验", "optional", true],
    ["硕士优先", "qualification:education:硕士", "preferred", false],
    ["不要求985背景，本科及以上学历", "qualification:education:本科", "required", false],
    ["无需985背景，211高校优先", "qualification:school:211", "preferred", false],
    ["使用包括但不限于Excel的工具", "tool:excel", "required", false],
  ])("assertion scope / %s", (text, key, necessity, negated) => {
    expect(parse(text).atoms.find((a) => a.key === key)).toMatchObject({ necessity, negated });
  });
  it.each(["熟悉 Python 或 Java", "Python、Java 任一语言", "至少掌握 Python、Java 其中一门", "Python，Java，至少一种语言"])("choice group / %s", (text) => {
    const atoms = parse(text).atoms.filter((a) => a.kind === "tool");
    expect(atoms).toHaveLength(2);
    for (const a of atoms) expect(a).toMatchObject({ necessity: "unknown", choiceGroup: { operator: "any", keys: ["tool:python", "tool:java"] } });
  });
  it("does not spread an alternative across an independent degree requirement", () => {
    const result = parse("本科及以上，熟悉 Python 或 Java");
    expect(result.atoms.find((a) => a.key === "qualification:education:本科")).toMatchObject({ necessity: "required", choiceGroup: null });
  });
  it('keeps independent required tools out of an optional language group',()=>{
    const result=parse('掌握 Python、Java 任一语言，同时熟练使用 SQL');
    expect(result.atoms.find(a=>a.key==='tool:sql')).toMatchObject({necessity:'required',condition:null,choiceGroup:null});
    expect(result.atoms.find(a=>a.key==='tool:python')?.choiceGroup?.keys).toEqual(['tool:python','tool:java']);
  });
  it('uses product context for a requirements document without inferring a skill from a language',()=>{
    const result=parse('编写需求文档；掌握 Python');
    expect(result.atoms.some(a=>a.key==='deliverable:prd')).toBe(true);
    expect(result.atoms.some(a=>a.key==='task:data_analysis')).toBe(false);
    expect(parse('不要求985背景，本科及以上学历').educationLevels).toContain('本科');
  });
  it("keeps private headings and unknown paragraphs", () => {
    const r = interpretJobV2({ jobVersionId: randomUUID(), title: "研究实习生", requirements: "岗位职责：\n使用SQL制作数据看板\n任职要求：\n硕士及以上学历\n协助整理馆藏标本", responsibilities: "", unstructured: true });
    expect(r.atoms.find((a) => a.key === "tool:sql")).toMatchObject({ section: "responsibilities", necessity: "unknown" });
    expect(r.atoms.find((a) => a.key === "qualification:education:硕士")).toMatchObject({ necessity: "required" });
    expect(r.atoms.find((a) => a.kind === "unclassified")?.clauseText).toBe("协助整理馆藏标本");
  });
  it("counts positive job unions separately from negation and repeated sentences", () => {
    const atom = parse("掌握SQL").atoms.find((a) => a.key === "tool:sql")!;
    const negative = parse("不要求SQL").atoms.find((a) => a.key === "tool:sql")!;
    const rows: GraphRecordV2[] = Array.from({ length: 40 }, (_, i) => ({ jobId: randomUUID(), jobVersionId: randomUUID(), companyId: "large", companyName: "大企业", title: `岗位${i}`, verifiedAt: null, parsed: true, atoms: [atom, atom] }));
    rows.push({ ...rows[0]!, jobId: randomUUID(), companyId: "small", atoms: [negative] }); rows.push(rows[0]!);
    const graph = aggregateGraphV2(rows, JobGraphScopeSchema.parse({}), "fixture");
    expect(graph.sample).toMatchObject({ jobCount: 41, companyCount: 2 });
    expect(graph.groups.find((g) => g.kind === "tool")!.items[0]).toMatchObject({ jobCount: 40, companyCount: 1, mentionRate: 40 / 41, companyCoverage: 0.5, negatedJobCount: 1 });
    expect(aggregateGraphV2([], JobGraphScopeSchema.parse({}), "empty").sample.jobCount).toBe(0);
  });
  it("counts parent tasks as a union and retains children", () => {
    const atoms = parse("负责用户访谈；完成用户调研", true).atoms;
    const graph = aggregateGraphV2([{ jobId: randomUUID(), jobVersionId: randomUUID(), companyId: "one", companyName: "公司", title: "用户研究", verifiedAt: null, parsed: true, atoms }], JobGraphScopeSchema.parse({}), "one");
    expect(graph.groups[0]!.items.find((i) => i.key === "task:user_research")?.jobCount).toBe(1);
    expect(graph.groups[0]!.items.find((i) => i.key === "task:user_interviews")?.parentKeys).toContain("task:user_research");
  });
});
