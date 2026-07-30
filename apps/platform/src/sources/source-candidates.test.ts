import { describe, expect, it } from "vitest";
import { loadSourceCandidateRegistry } from "./source-candidates.js";

describe("source candidate registry", () => {
  it("locks the G2 SME expansion targets and bounded batch policy", async () => {
    const registry = await loadSourceCandidateRegistry();

    expect(registry.targets).toEqual({
      visibleJobs: { minimum: 300, maximum: 500 },
      companies: { minimum: 30, maximum: 40 },
      minimumSmeCompanyRatio: 0.6,
      minimumSmeVisibleJobRatio: 0.5,
    });
    expect(registry.batchPolicy).toEqual({
      maxCompanies: 5,
      initialJobsPerCompany: 5,
    });
    expect(registry.priorityBatch).toHaveLength(5);
    expect(registry.priorityBatch.map((candidate) => candidate.displayName)).toEqual([
      "上海孝庸私募基金管理有限公司",
      "上海津洋航运",
      "上海思勰投资管理有限公司",
      "易思维",
      "杭州进迭时空科技有限公司",
    ]);
    expect(registry.liveProbeRequiresExplicitApproval).toBe(true);
  });

  it("keeps unassessed candidates non-runnable and scale claims evidence-backed", async () => {
    const registry = await loadSourceCandidateRegistry();
    const candidates = [...registry.priorityBatch, ...registry.reserveBatch];

    expect(
      candidates
        .filter((candidate) => candidate.assessmentStatus === "not_assessed")
        .every((candidate) => candidate.sourceKeys.length === 0),
    ).toBe(true);
    expect(
      candidates
        .filter((candidate) => candidate.scaleBand !== "unknown")
        .every((candidate) => candidate.scaleEvidenceRef !== null),
    ).toBe(true);
  });
});
