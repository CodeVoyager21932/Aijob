import { JobFamilySchema, type JobFamily } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  auditSourceBatchPlan,
  type CatalogSupplyMetrics,
  planSourceBatch,
} from "./source-batch-planner.js";
import type { SourceCandidateLedgerRow } from "./source-candidate-ledger.js";
import {
  loadSourceCandidateRegistry,
  type SourceCandidateOverride,
  TARGET_ALPHA_CITIES,
} from "./source-candidates.js";

function baseline(
  overrides: Partial<CatalogSupplyMetrics> = {},
): CatalogSupplyMetrics {
  return {
    totalSupply: 0,
    visibleJobs: 0,
    companies: 0,
    reachableVisibleJobs: 0,
    reachableCompanies: 0,
    smeVisibleJobs: 0,
    smeCompanies: 0,
    manualVisibleJobs: 0,
    manualCompanies: 0,
    publicJobs: 0,
    jobFamilies: Object.fromEntries(
      JobFamilySchema.options.map((family) => [family, 0]),
    ) as Record<JobFamily, number>,
    cities: Object.fromEntries(TARGET_ALPHA_CITIES.map((city) => [city, 0])) as Record<
      (typeof TARGET_ALPHA_CITIES)[number],
      number
    >,
    companyNames: [],
    registeredOrganizationNames: [],
    ...overrides,
  };
}

function ledgerRow(
  candidateId: string,
  companyName: string,
  overrides: Partial<SourceCandidateLedgerRow> = {},
): SourceCandidateLedgerRow {
  return {
    candidateId,
    companyName,
    activityState: "active_explicit",
    applicationSignal: "official_url",
    evidenceUrl: `https://careers.example.com/jobs/${candidateId}`,
    closeDate: "rolling",
    reviewState: "application_chain_checked",
    lastReviewed: "2026-08-02",
    notes: "",
    priorityTracks: [],
    sourceLedger: "planner-test.csv",
    ...overrides,
  };
}

function approvedOverride(index: number): SourceCandidateOverride {
  return {
    companyKey: `approved-company-${index}`,
    displayName: `Approved Company ${index}`,
    aliases: [],
    assessmentStatus: "preflight_ready",
    sourceKeys: [],
    scaleBand: "small",
    scaleEvidenceRef: "https://example.com/scale-evidence",
    adapterFamily: "beisen-zhiye-public-api",
    jobFamilyHints: [],
    cityHints: [],
    alphaDisplayStatus: "approved",
    pauseReasons: [],
    assessmentEvidenceRefs: [],
    lane: "capacity",
    automationMode: "deterministic",
    capacity: {
      verifiedActiveInternships: 10,
      completeJdInternships: 10,
      reachableInternships: 10,
      verifiedAt: "2026-08-02",
      evidenceRef: "docs/evidence/capacity.md",
    },
  };
}

/**
 * 容量已核验但其中没有可达岗位。ADR-0035 之后这**不再**减半配额、也不再受本批可达比例下限
 * 约束——可达性判据已下沉到逐岗位，「非可达企业」不是有意义的分类。此处保留该形态，用于钉住
 * 「证据里 reachableInternships 为 0 的候选照样能入选」。
 */
function nonReachableOverride(index: number): SourceCandidateOverride {
  return {
    ...approvedOverride(index),
    companyKey: `non-reachable-company-${index}`,
    displayName: `Non Reachable Company ${index}`,
    capacity: {
      verifiedActiveInternships: 10,
      completeJdInternships: 10,
      reachableInternships: 0,
      verifiedAt: "2026-08-02",
      evidenceRef: "docs/evidence/capacity.md",
    },
  };
}

describe("source batch planner", () => {
  it("holds a source on the Shanghai day after its deadline", async () => {
    const registry = await loadSourceCandidateRegistry();
    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      registry,
      ledgerRows: [
        ledgerRow("DATE-001", "Deadline Company", { closeDate: "2026-08-01" }),
      ],
      now: new Date("2026-08-02T00:01:00+08:00"),
    });

    expect(plan.candidatePool.holds.deadline_expired?.count).toBe(1);
    expect(plan.candidatePool.preflightQueue).toHaveLength(0);
  });

  it("recognizes an already registered organization through an explicit alias", async () => {
    const registry = await loadSourceCandidateRegistry();
    const plan = planSourceBatch({
      baseline: baseline({
        registeredOrganizationNames: ["北京道泰量合私募基金管理有限公司"],
      }),
      milestone: 40,
      registry,
      ledgerRows: [ledgerRow("ALIAS-001", "DTL量化")],
      now: new Date("2026-08-02T08:00:00+08:00"),
    });

    expect(plan.candidatePool.holds.already_in_catalog?.count).toBe(1);
    expect(plan.candidatePool.holds.paused).toBeUndefined();
  });

  it("uses candidate id as the stable final ordering key", async () => {
    const registry = await loadSourceCandidateRegistry();
    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      registry,
      ledgerRows: [
        ledgerRow("ORDER-002", "Ordering Company B"),
        ledgerRow("ORDER-001", "Ordering Company A"),
      ],
      now: new Date("2026-08-02T08:00:00+08:00"),
    });

    expect(
      plan.candidatePool.preflightQueue.map((candidate) => candidate.candidateId),
    ).toEqual(["ORDER-001", "ORDER-002"]);
  });

  it("selects at most ten Alpha-approved companies", async () => {
    const registry = await loadSourceCandidateRegistry();
    const approved = Array.from({ length: 11 }, (_, index) => approvedOverride(index + 1));
    const expandedRegistry = {
      ...registry,
      reserveBatch: [...registry.reserveBatch, ...approved],
    };
    const rows = approved.map((candidate, index) =>
      ledgerRow(`APPROVED-${String(index + 1).padStart(2, "0")}`, candidate.displayName),
    );

    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      limit: 10,
      registry: expandedRegistry,
      ledgerRows: rows,
      now: new Date("2026-08-02T08:00:00+08:00"),
    });

    expect(plan.candidatePool.selected).toHaveLength(10);
    expect(() =>
      planSourceBatch({
        baseline: baseline(),
        milestone: 40,
        limit: 11,
        registry: expandedRegistry,
        ledgerRows: rows,
      }),
    ).toThrow("SOURCE_BATCH_PLAN_LIMIT_OUT_OF_RANGE");
  });

  it("keeps a configured source out until Alpha display is approved", async () => {
    const registry = await loadSourceCandidateRegistry();
    const company: SourceCandidateOverride = {
      companyKey: "configured-not-approved",
      displayName: "Configured Not Approved",
      aliases: [],
      assessmentStatus: "configured",
      sourceKeys: ["configured-not-approved-internships"],
      scaleBand: "unknown",
      scaleEvidenceRef: null,
      adapterFamily: "university-employment-detail-html",
      jobFamilyHints: [],
      cityHints: [],
      alphaDisplayStatus: "not_reviewed",
      pauseReasons: [],
      assessmentEvidenceRefs: [],
      lane: "deferred",
      automationMode: "unknown",
      capacity: null,
    };
    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      registry: { ...registry, reserveBatch: [...registry.reserveBatch, company] },
      ledgerRows: [ledgerRow("ALPHA-001", company.displayName)],
      now: new Date("2026-08-02T08:00:00+08:00"),
    });

    expect(plan.candidatePool.selected).toHaveLength(0);
    expect(plan.candidatePool.preflightQueue[0]?.companyName).toBe(company.displayName);
  });

  it("queues stale activity for read-only recheck but never selects it for import", async () => {
    const registry = await loadSourceCandidateRegistry();
    const company = approvedOverride(99);
    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      registry: { ...registry, reserveBatch: [...registry.reserveBatch, company] },
      ledgerRows: [
        ledgerRow("RECHECK-001", company.displayName, {
          activityState: "active_needs_recheck",
        }),
      ],
      now: new Date("2026-08-02T08:00:00+08:00"),
    });

    expect(plan.candidatePool.selected).toHaveLength(0);
    expect(plan.candidatePool.preflightQueue[0]).toMatchObject({
      candidateId: "RECHECK-001",
      activityState: "active_needs_recheck",
    });
  });

  it("computes the reachable job deficit from the actual denominator", async () => {
    const registry = await loadSourceCandidateRegistry();
    const plan = planSourceBatch({
      baseline: baseline({
        visibleJobs: 149,
        companies: 29,
        reachableVisibleJobs: 22,
        reachableCompanies: 7,
        manualVisibleJobs: 19,
        manualCompanies: 2,
      }),
      milestone: 40,
      registry,
      ledgerRows: [],
      now: new Date("2026-08-03T08:00:00+08:00"),
    });

    // 400 可见岗 × 50% = 200 可达；当前 22 → 还缺 178。
    expect(plan.dynamicRequirements).toMatchObject({
      minimumReachableVisibleJobsAtMilestone: 200,
      minimumAdditionalReachableVisibleJobsAtMilestone: 178,
      minimumDeterministicVisibleJobsBeforeManualExpansion: 190,
      deterministicVisibleJobs: 130,
      manualExpansionAllowed: false,
      reachabilityRecoveryRequired: true,
    });
    expect(plan.deficits.reachableVisibleJobs).toBe(178);
    expect(plan.deficits.manualVisibleJobsOverLimit).toBe(5);
  });

  // ADR-0035 §二：本批可达岗位比例下限已**撤销**。判据下沉到逐岗位后被收录的岗位按构造全部
  // 可投，该比例恒真；留着它的实际效果是「容量证据没记 reachableInternships 的候选被当作 0，
  // 拉低本批比例后被跳过」——用证据缺失做否定推断。可达性只保留为排序信号。
  it("selects non-reachable candidates instead of gating the batch on a reachable-job ratio", async () => {
    const registry = await loadSourceCandidateRegistry();
    const reachable = Array.from({ length: 7 }, (_, index) => approvedOverride(index + 1));
    const nonReachable = Array.from({ length: 3 }, (_, index) =>
      nonReachableOverride(index + 8),
    );
    const candidates = [...reachable, ...nonReachable];
    const plan = planSourceBatch({
      baseline: baseline({
        visibleJobs: 149,
        companies: 29,
        reachableVisibleJobs: 22,
        reachableCompanies: 7,
      }),
      milestone: 40,
      limit: 10,
      registry: { ...registry, reserveBatch: [...registry.reserveBatch, ...candidates] },
      ledgerRows: candidates.map((candidate, index) =>
        ledgerRow(`RECOVERY-${String(index + 1).padStart(2, "0")}`, candidate.displayName),
      ),
      now: new Date("2026-08-03T08:00:00+08:00"),
    });

    expect(plan.candidatePool.selected).toHaveLength(10);
    // 可达候选仍然排序优先——恢复信号保留为排序信号。
    expect(
      plan.candidatePool.selected.filter((candidate) => candidate.reachableCapacity),
    ).toHaveLength(7);
    expect(plan.candidatePool.selected[0]?.reachableCapacity).toBe(true);
    expect(plan.projected.ratios.reachableVisibleJobs).toBeGreaterThan(
      plan.dynamicRequirements.currentRatios.reachableVisibleJobs,
    );
    // 3 个非可达候选全部入选，且不再携带 `batch_reachable_job_floor` 这个判定痕迹。
    expect(
      plan.candidatePool.selected.filter((candidate) => !candidate.reachableCapacity),
    ).toHaveLength(3);
    expect(
      plan.candidatePool.selected.some((candidate) =>
        candidate.selectionReasons.some((reason) =>
          reason.startsWith("batch_reachable_job_floor"),
        ),
      ),
    ).toBe(false);
    // 落后信号仍然如实报出，只是不再改变选择结果。
    expect(plan.dynamicRequirements.reachabilityRecoveryRequired).toBe(true);
  });

  it("holds stale and low-yield capacity evidence out of a runnable batch", async () => {
    const registry = await loadSourceCandidateRegistry();
    const stale = {
      ...approvedOverride(201),
      capacity: {
        verifiedActiveInternships: 10,
        completeJdInternships: 10,
        reachableInternships: 10,
        verifiedAt: "2026-07-20",
        evidenceRef: "docs/evidence/stale.md",
      },
    };
    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      registry: { ...registry, reserveBatch: [...registry.reserveBatch, stale] },
      ledgerRows: [ledgerRow("STALE-001", stale.displayName)],
      now: new Date("2026-08-03T08:00:00+08:00"),
    });

    expect(plan.candidatePool.selected).toHaveLength(0);
    expect(plan.candidatePool.preflightQueue[0]?.readinessBlockers).toContain("capacity_stale");
  });

  // ADR-0035：`CAPACITY_MINIMUM_COMPLETE_JOBS` 从 10 降到 3。10 让只有 9 条完整 JD 的企业永不
  // 入选，而当前全部可信供给是 22 条——按 10 计，一家要独自贡献接近半个基线才够格。3 保留
  // 「一家只有一两条岗位不值得单独接一个适配器」这个真实约束。
  it("admits a three-job company and still holds a two-job one below the capacity floor", async () => {
    const registry = await loadSourceCandidateRegistry();
    const withCompleteJds = (index: number, completeJdInternships: number) => {
      const override = approvedOverride(index);
      return {
        ...override,
        capacity: {
          verifiedActiveInternships: completeJdInternships,
          completeJdInternships,
          reachableInternships: completeJdInternships,
          verifiedAt: "2026-08-02",
          evidenceRef: "docs/evidence/capacity.md",
        },
      };
    };
    const atFloor = withCompleteJds(401, 3);
    const belowFloor = withCompleteJds(402, 2);
    const candidates = [atFloor, belowFloor];
    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      registry: { ...registry, reserveBatch: [...registry.reserveBatch, ...candidates] },
      ledgerRows: candidates.map((candidate, index) =>
        ledgerRow(`FLOOR-${index + 1}`, candidate.displayName),
      ),
      now: new Date("2026-08-03T08:00:00+08:00"),
    });

    expect(plan.candidatePool.selected.map((candidate) => candidate.companyName)).toEqual([
      atFloor.displayName,
    ]);
    expect(
      plan.candidatePool.preflightQueue.find(
        (candidate) => candidate.companyName === belowFloor.displayName,
      )?.readinessBlockers,
    ).toContain("below_capacity_threshold");
  });

  it("groups zero-network audit candidates by reusable adapter family", async () => {
    const registry = await loadSourceCandidateRegistry();
    const candidates = [approvedOverride(301), approvedOverride(302)];
    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      registry: { ...registry, reserveBatch: [...registry.reserveBatch, ...candidates] },
      ledgerRows: candidates.map((candidate, index) =>
        ledgerRow(`AUDIT-${index + 1}`, candidate.displayName),
      ),
      now: new Date("2026-08-03T08:00:00+08:00"),
    });
    const audit = auditSourceBatchPlan(plan);

    expect(audit.familyGroups[0]).toMatchObject({
      adapterFamily: "beisen-zhiye-public-api",
      candidateCount: 2,
      capacityReadyCount: 2,
      reachableReadyCount: 2,
      projectedVisibleJobs: 20,
    });
  });
});
