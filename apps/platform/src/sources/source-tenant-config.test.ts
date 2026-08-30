import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getRepositoryRoot, loadSourceConfig, parseSourceConfigValue } from "./source-config.js";
import { expandTenantSourceConfig, isTenantSourceConfigShape } from "./source-tenant-config.js";
import { renderVendorTemplate, vendorSourceConfigSchema } from "./source-vendor-config.js";

const repositoryRoot = getRepositoryRoot();

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"));
}

const beisenVendor = () => readJson("config/source-vendors/beisen-zhiye.json");

/**
 * 迁移前的完整配置原文，逐字节冻结在 `fixtures/source-configs/legacy-beisen/`。
 *
 * 基线必须冻结：若继续读 `config/sources/`，那些文件已经是两层形状，「展开后与完整形状等价」
 * 就退化成自我比较，证明当场失效。
 */
const legacyFull = (sourceKey: string) =>
  readJson(`fixtures/source-configs/legacy-beisen/${sourceKey}.json`);

/**
 * 把一份既有完整配置改写成租户形状。用于证明两层形式不丢信息——参数全部取自那份完整配置，
 * 不引入任何新事实。
 */
function tenantShapeFrom(
  full: Record<string, any>,
  tenantParameters: Record<string, string>,
  extra: { profile?: string; localProbeEnabled?: boolean } = {},
): Record<string, unknown> {
  return {
    schemaVersion: "tenant-1.0.0",
    vendor: "beisen-zhiye",
    sourceKey: full.sourceKey,
    tenantParameters,
    ...(extra.profile === undefined ? {} : { profile: extra.profile }),
    ...(extra.localProbeEnabled === undefined
      ? {}
      : { overrides: { localProbeEnabled: extra.localProbeEnabled } }),
    organization: full.organization,
    candidate: {
      name: full.candidate.name,
      assessor: full.candidate.assessor,
      gates: {
        officialIdentity: full.candidate.hardGates.officialIdentity,
        targetSupply: full.candidate.hardGates.targetSupply,
        stableIdentityAndFields: full.candidate.hardGates.stableIdentityAndFields,
      },
      scores: {
        targetSupply: full.candidate.scores.targetSupply,
        freshnessMaintenance: full.candidate.scores.freshnessMaintenance,
        diversity: full.candidate.scores.diversity,
      },
      evidenceNotes: full.candidate.evidenceNotes,
    },
    policy: {
      version: full.policy.version,
      status: full.policy.status,
      reviewedAt: full.policy.reviewedAt,
      crawlIntervalEnabled: full.policy.crawlInterval.enabled,
      policyNotes: [],
    },
    queryStreams: full.localProbe.queryStreams,
  };
}

/** 北森族 5 个租户的参数，全部可从其既有配置的 URL 读出。 */
const beisenTenants = [
  { sourceKey: "shining3d-internships", tenant: "shining3d", category: "3", applyPath: "/intern/jobs", profile: "organization_owned", probeEnabled: true },
  { sourceKey: "onerobotics-internships", tenant: "woanhome", category: "3", applyPath: "/intern/jobs", profile: "organization_owned", probeEnabled: true },
  { sourceKey: "adaps-photonics-internships", tenant: "adaps-ph", category: "3", applyPath: "/intern/jobs", profile: "verified_ats_tenant", probeEnabled: true },
  { sourceKey: "pudutech-internships", tenant: "pudutech", category: "3", applyPath: "/intern/jobs", profile: "verified_ats_tenant", probeEnabled: true },
  { sourceKey: "huice-campus-internships", tenant: "huicecom", category: "2", applyPath: "/campus/jobs", profile: "verified_ats_tenant", probeEnabled: false },
] as const;

describe("two-layer source admission (ADR-0034 section 3)", () => {
  it("detects the tenant shape without touching the existing full shape", async () => {
    expect(isTenantSourceConfigShape({ schemaVersion: "tenant-1.0.0" })).toBe(true);
    expect(isTenantSourceConfigShape({ schemaVersion: "1.0.0" })).toBe(false);
    expect(isTenantSourceConfigShape(null)).toBe(false);
  });

  it.each(beisenTenants)(
    "expands $sourceKey to the same admission decision as its existing full config",
    async ({ sourceKey, profile, probeEnabled }) => {
      const full = await legacyFull(sourceKey);

      // 左边是冻结的迁移前完整配置；右边是仓库里现行的两层配置，经 loadSourceConfig 展开。
      const fromFull = parseSourceConfigValue(full, sourceKey);
      const fromTenant = await loadSourceConfig(sourceKey);
      expect(fromTenant.localProbe.enabled, sourceKey).toBe(probeEnabled);
      expect(
        (await readJson(`config/sources/${sourceKey}.json`)).profile,
        `${sourceKey} must select the ${profile} profile`,
      ).toBe(profile);

      // 逐字段相等，只有三道厂商级门的 note 措辞不同——那是同一判断的不同写法，
      // 正是 ADR-0034 第三条要消掉的重复。status 必须相等。
      const inheritedGates = ["noAuthBypass", "officialApplyLink", "accessPolicyAccepted"] as const;
      for (const gate of inheritedGates) {
        expect(fromTenant.candidate.hardGates[gate], gate).toBe(
          fromFull.candidate.hardGates[gate],
        );
      }
      expect(fromTenant.candidate.hardGates).toEqual(fromFull.candidate.hardGates);
      expect(fromTenant.policy.fetchTargets).toEqual(fromFull.policy.fetchTargets);
      expect(fromTenant.policy.applyTargets).toEqual(fromFull.policy.applyTargets);
      expect(fromTenant.policy.adapterKey).toBe(fromFull.policy.adapterKey);
      expect(fromTenant.policy.adapterVersion).toBe(fromFull.policy.adapterVersion);
      expect(fromTenant.policy.crawlInterval).toEqual(fromFull.policy.crawlInterval);
      expect(fromTenant.policy.refreshCoverage).toBe(fromFull.policy.refreshCoverage);
      expect(fromTenant.policy.absencePolicy).toBe(fromFull.policy.absencePolicy);
      expect(fromTenant.localProbe.requestBudget).toEqual(fromFull.localProbe.requestBudget);
      expect(fromTenant.localProbe.requestDefaults).toEqual(fromFull.localProbe.requestDefaults);
      expect(fromTenant.candidate.scores).toEqual(fromFull.candidate.scores);
      expect(fromTenant.organization).toEqual(fromFull.organization);
      expect(fromTenant.policy.entrypoints).toEqual(fromFull.policy.entrypoints);
      expect(fromTenant.candidate.entrypointUrl).toBe(fromFull.candidate.entrypointUrl);
      expect(fromTenant.sourceType).toBe(fromFull.sourceType);
      expect(fromTenant.catalogRole).toBe(fromFull.catalogRole);
      expect(fromTenant.runtimeScope).toBe(fromFull.runtimeScope);
      expect(fromTenant.candidate.provenanceLevel).toBe(fromFull.candidate.provenanceLevel);
      expect(fromTenant.localProbe.queryStreams).toEqual(fromFull.localProbe.queryStreams);

      // 政策说明有意去重与重排：厂商层的三条共享说明不再逐租户重复。因此正确的命题不是
      // 「逐字节相同」，而是**一条旧约束都没丢**。
      for (const note of fromFull.policy.policyNotes) {
        expect(fromTenant.policy.policyNotes, `${sourceKey} lost policy note: ${note}`).toContain(
          note,
        );
      }

      // 证据文本里会拼接门槛与评分说明，而厂商级门的措辞由厂商层统一给出（并带证据引用），
      // 因此这里同样只要求逐租户事实没丢。三道厂商级门的**判定**已在上面逐项比对相等。
      for (const note of fromFull.candidate.evidenceNotes.split("\n")) {
        if (/^(noAuthBypass|officialApplyLink|accessPolicyAccepted|structure|policyAccess)[=]/.test(note)) {
          continue;
        }
        expect(
          fromTenant.candidate.evidenceNotes,
          `${sourceKey} lost evidence note: ${note}`,
        ).toContain(note);
      }
    },
  );

  it("refuses a tenant config whose vendor reference does not match the vendor file", async () => {
    const full = await legacyFull("shining3d-internships");
    const tenant = tenantShapeFrom(full as Record<string, any>, {
      tenant: "shining3d",
      category: "3",
      applyPath: "/intern/jobs",
    });
    await expect(
      (async () =>
        expandTenantSourceConfig({
          tenant: { ...tenant, vendor: "moka-public" },
          vendor: await beisenVendor(),
        }))(),
    ).rejects.toThrow("VENDOR_KEY_MISMATCH:moka-public:beisen-zhiye");
  });

  it("refuses an unresolved template rather than emitting a placeholder host", async () => {
    const full = await legacyFull("shining3d-internships");
    const tenant = tenantShapeFrom(full as Record<string, any>, { category: "3" });
    await expect(
      (async () => expandTenantSourceConfig({ tenant, vendor: await beisenVendor() }))(),
    ).rejects.toThrow("VENDOR_TEMPLATE_PARAMETER_MISSING:tenant");
  });

  it("keeps per-tenant robots verification for per-tenant-subdomain vendors", async () => {
    const vendor = vendorSourceConfigSchema.parse(await beisenVendor());
    // 北森是 `<租户>.zhiye.com`，robots 必须逐主机核验，厂商层不得代为通过。
    expect(vendor.robotsHostModel).toBe("per_tenant_subdomain");
    expect(vendor.inheritedGates.accessPolicyAccepted.status).not.toBe("pass");
    // 厂商级结论必须带证据引用，否则继承会把单点错误放大到全族。
    for (const gate of Object.values(vendor.inheritedGates)) {
      expect(gate.evidenceRefs.length).toBeGreaterThan(0);
    }
  });

  it("renders only known placeholders", () => {
    expect(renderVendorTemplate("{tenant}.zhiye.com", { tenant: "x" })).toBe("x.zhiye.com");
    expect(() => renderVendorTemplate("{missing}", {})).toThrow(
      "VENDOR_TEMPLATE_PARAMETER_MISSING:missing",
    );
  });
});
