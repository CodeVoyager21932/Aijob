import { describe, expect, it } from "vitest";
import {
  classifyJobReachability,
  isReachableVerdict,
  JobReachabilityVerdictSchema,
  MINIMUM_REACHABLE_VISIBLE_JOB_RATIO,
} from "./job-reachability.js";

const verdict = (requirements: string, responsibilities = "") =>
  classifyJobReachability({ requirements, responsibilities });

describe("job reachability contract (ADR-0032)", () => {
  it("freezes the four verdict values", () => {
    expect(JobReachabilityVerdictSchema.options).toEqual([
      "reachable",
      "not_reachable_school_restricted",
      "not_reachable_postgrad_only",
      "unknown",
    ]);
  });

  it("freezes the reachable ratio threshold at 50 percent", () => {
    expect(MINIMUM_REACHABLE_VISIBLE_JOB_RATIO).toBe(0.5);
  });

  it("counts only reachable toward the quota, never unknown", () => {
    expect(isReachableVerdict("reachable")).toBe(true);
    expect(isReachableVerdict("unknown")).toBe(false);
    expect(isReachableVerdict("not_reachable_postgrad_only")).toBe(false);
    expect(isReachableVerdict("not_reachable_school_restricted")).toBe(false);
  });
});

describe("reachable classification", () => {
  it("accepts the real undergraduate phrasings seen in stored job text", () => {
    expect(verdict("学历要求：本科及以上")).toBe("reachable");
    expect(verdict("本科在读，2027 届")).toBe("reachable");
    expect(verdict("学士学位及以上")).toBe("reachable");
    expect(verdict("本科,硕士,博士")).toBe("reachable");
  });

  it("treats explicitly stated no-limit as reachable", () => {
    expect(verdict("学历不限")).toBe("reachable");
    expect(verdict("专业不限，欢迎跨专业投递")).toBe("reachable");
    expect(verdict("不限专业")).toBe("reachable");
  });

  it("treats college level as reachable", () => {
    expect(verdict("大专及以上学历")).toBe("reachable");
    expect(verdict("专科及以上")).toBe("reachable");
  });

  it("reads education stated in the responsibilities section", () => {
    expect(verdict("能长期实习", "面向本科三年级学生的培养岗")).toBe("reachable");
  });
});

describe("not reachable classification", () => {
  it("rejects postgraduate-only requirements", () => {
    expect(verdict("硕士及以上学历")).toBe("not_reachable_postgrad_only");
    expect(verdict("博士在读优先")).toBe("not_reachable_postgrad_only");
    expect(verdict("研究生学历")).toBe("not_reachable_postgrad_only");
  });

  it("keeps postgraduate mentions reachable when undergraduate is also accepted", () => {
    expect(verdict("本科及以上，硕士优先")).toBe("reachable");
    expect(verdict("学历要求：本科、硕士、博士")).toBe("reachable");
  });

  it("rejects explicit school-tier restrictions with highest priority", () => {
    expect(verdict("985/211 院校本科及以上")).toBe("not_reachable_school_restricted");
    expect(verdict("双一流高校在读")).toBe("not_reachable_school_restricted");
    expect(verdict("重点院校本科")).toBe("not_reachable_school_restricted");
    expect(verdict("QS 前 100 院校")).toBe("not_reachable_school_restricted");
    expect(verdict("国内名校本科在读")).toBe("not_reachable_school_restricted");
  });

  it("lets school restriction win over an otherwise reachable undergraduate signal", () => {
    expect(verdict("本科及以上，限 985 院校")).toBe("not_reachable_school_restricted");
    expect(verdict("学历不限，但需 211 背景")).toBe("not_reachable_school_restricted");
  });
});

describe("unknown is never inferred away", () => {
  it("returns unknown when no education signal is stated at all", () => {
    expect(verdict("负责数据看板搭建，熟悉 SQL")).toBe("unknown");
    expect(verdict("")).toBe("unknown");
    expect(verdict("每周到岗 4 天，实习 3 个月以上")).toBe("unknown");
  });

  it("does not infer 'no school restriction' from absence of 985/211", () => {
    // 正文未出现限校词，也未出现任何学历层次 → 必须是 unknown，不得当作可达。
    expect(verdict("熟悉 Python，有项目经历")).toBe("unknown");
  });

  it("tolerates missing responsibilities without changing the verdict", () => {
    expect(classifyJobReachability({ requirements: "本科及以上" })).toBe("reachable");
    expect(classifyJobReachability({ requirements: "熟悉 Excel" })).toBe("unknown");
  });
});
