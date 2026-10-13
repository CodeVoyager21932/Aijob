import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { interpretOfficialJob } from "./job-semantics.js";
import { aggregateCurrentGraph, type GraphRecord } from "../insights/current-graph.js";
import { JobGraphScopeSchema } from "@aijob/contracts";
describe("evidence-backed semantic graph", () => {
  const parse = (requirements: string, responsibilities = "") =>
    interpretOfficialJob({
      jobVersionId: randomUUID(),
      title: "产品运营实习生",
      requirements,
      responsibilities,
    });
  it.each([
    ["无需985背景；211高校优先", "school:985", "optional", true],
    ["无需985背景；211高校优先", "school:211", "preferred", false],
    ["熟练掌握SQL且硕士优先", "tool:sql", "required", false],
    ["使用包括但不限于SQL的工具", "tool:sql", "required", false],
    ["熟悉SQL或Python", "tool:sql", "unknown", false],
  ])("preserves necessity and literal offsets: %s", (text, key, necessity, negated) => {
    const result = parse(text);
    const atom = result.atoms.find((value) => value.key === key);
    expect(atom).toMatchObject({ necessity, negated });
    for (const item of result.atoms)
      expect(text.slice(item.sourceSpan.start, item.sourceSpan.end)).toBe(item.sourceText);
  });
  it("keeps responsibilities and unstructured private text separate from hard qualifications", () => {
    expect(
      parse("", "使用SQL制作数据看板").atoms.every((value) => value.necessity === "unknown"),
    ).toBe(true);
    const result = interpretOfficialJob({
      jobVersionId: randomUUID(),
      title: "研究实习生",
      requirements: "岗位职责：\n使用SQL制作数据看板\n任职要求：\n硕士及以上学历",
      responsibilities: "",
      unstructured: true,
    });
    expect(result.atoms.find((value) => value.key === "tool:sql")?.necessity).toBe("unknown");
    expect(result.atoms.find((value) => value.kind === "education")?.necessity).toBe("required");
  });
  it("uses both denominators, keeps every large-company job, deduplicates job mentions and shows empty/one-job samples", () => {
    const atom = parse("熟练掌握SQL").atoms.find((value) => value.key === "tool:sql");
    expect(atom).toBeDefined();
    const records: GraphRecord[] = Array.from({ length: 40 }, () => ({
      jobId: randomUUID(),
      jobVersionId: randomUUID(),
      companyId: "big",
      companyName: "招聘大户",
      title: "数据岗位",
      verifiedAt: new Date().toISOString(),
      parsed: true,
      atoms: [atom as NonNullable<typeof atom>, atom as NonNullable<typeof atom>],
    }));
    records.push({
      ...(records[0] as GraphRecord),
      jobId: randomUUID(),
      companyId: "small",
      companyName: "小公司",
      atoms: [],
    });
    records.push(records[0] as GraphRecord);
    const result = aggregateCurrentGraph(records, JobGraphScopeSchema.parse({}), "1");
    expect(result.sample).toMatchObject({ jobCount: 41, companyCount: 2 });
    expect(result.items[0]).toMatchObject({
      jobCount: 40,
      companyCount: 1,
      companyCoverage: 0.5,
      mentionRate: 40 / 41,
      requiredJobCount: 40,
    });
    expect(
      aggregateCurrentGraph([records[0] as GraphRecord], JobGraphScopeSchema.parse({}), "1").items,
    ).toHaveLength(1);
    expect(aggregateCurrentGraph([], JobGraphScopeSchema.parse({}), "1").sample).toMatchObject({
      jobCount: 0,
      parseCoverage: 0,
    });
  });
});
