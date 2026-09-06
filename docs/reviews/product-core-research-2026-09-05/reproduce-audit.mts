// Read-only product audit. Synthetic inputs only; no database, network, or secrets.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildJobInsightResult,
  type InsightJobRecord,
} from "../../../apps/platform/src/insights/service.js";
import { classifyOfficialJobFamily } from "../../../apps/platform/src/sources/job-family-classifier.js";
import {
  listSourceKeys,
  loadSourceConfig,
} from "../../../apps/platform/src/sources/source-config.js";
import { classifyJobReachability } from "../../../packages/contracts/src/job-reachability.js";

function records(
  count: number,
  necessity: "required" | "unknown" = "required",
): InsightJobRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    jobId: `audit-job-${i}`,
    jobVersionId: `audit-version-${i}`,
    requirementSetId: `audit-set-${i}`,
    sourceId: `audit-source-${i % 5}`,
    companyId: `audit-company-${i % 5}`,
    companyName: `演示企业${i % 5}`,
    companyScaleBand: "unknown",
    title: "演示数据分析实习",
    jobFamily: "data_ai",
    locations: ["上海"],
    lastVerifiedAt: i === 0 ? "2026-09-05T00:00:00.000Z" : "2026-09-01T00:00:00.000Z",
    requirements: [
      {
        id: `audit-req-${i}`,
        kind: "skill",
        operator: "contains",
        expectedValue: ["SQL"],
        sourceText: "使用SQL进行数据分析",
        necessity,
        evidenceRefs: [`audit-ref-${i}`],
        sourceSpan: null,
      },
    ],
  }));
}
function summary(input: InsightJobRecord[]) {
  const r = buildJobInsightResult(input, null);
  return {
    sample: r.sample,
    dataSufficient: r.dataSufficient,
    reasons: r.insufficiencyReasons,
    hardItems: r.commonHardRequirements.length,
    capabilityItems: r.frequentCapabilities.length,
    preferredItems: r.preferredRequirements.length,
  };
}
const configs = await Promise.all((await listSourceKeys()).map((key) => loadSourceConfig(key)));
const report = {
  generatedAt: new Date().toISOString(),
  codeBaseline: "f385ed5",
  synthetic: true,
  scope:
    "Pure functions and tracked source configurations; no real-site assessment or load benchmark",
  familyClassification: [
    "产品运营实习生",
    "AI产品经理",
    "数据分析工程师",
    "供应链质量工程师",
    "法务实习生",
    "用户研究实习生",
  ].map((title) => ({
    title,
    ...classifyOfficialJobFamily({ title, sourceEvidenceRef: "synthetic-title" }),
  })),
  reachability: [
    "硕士及以上学历",
    "本科及以上，不限985、211",
    "本科及以上，985院校优先",
    "本科及以上学历",
  ].map((requirements) => ({
    requirements,
    verdict: classifyJobReachability({ requirements }),
  })),
  insights: {
    nineteenJobs: summary(records(19)),
    twentyJobs: summary(records(20)),
    unknownNecessity: summary(records(20, "unknown")),
    fourCompanies: summary(
      records(20).map((r, i) => ({
        ...r,
        companyId: `company-${i % 4}`,
        companyName: `演示企业${i % 4}`,
      })),
    ),
  },
  sourceInventory: configs.map((c) => ({
    key: c.sourceKey,
    company: c.organization.name,
    adapter: c.policy.adapterKey,
    status: c.policy.status,
    acquisitionMode: c.candidate.acquisitionMode,
    refreshEnabled: c.policy.crawlInterval.enabled,
    minimumHours: c.policy.crawlInterval.minimumHours,
    accessPolicyStatus: c.candidate.hardGates.accessPolicyAccepted,
  })),
};
const output = fileURLToPath(new URL("./audit-results.json", import.meta.url));
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ ...report, sourceInventory: { total: configs.length, adapters: [...new Set(report.sourceInventory.map((c) => c.adapter))] } }, null, 2)}\n`,
);
