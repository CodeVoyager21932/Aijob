import { listSourceKeys, loadSourceConfig, type SourceConfig } from "./source-config.js";
import { getOfficialSourceAdapterDescriptor } from "./official-source-adapters.js";

export function inventoryItem(config: SourceConfig) {
  const descriptor = getOfficialSourceAdapterDescriptor(config.policy.adapterKey);
  const kind =
    config.catalogRole === "discovery_only"
      ? "discovery_only"
      : config.candidate.acquisitionMode === "browser_required"
        ? "dynamic_web"
        : /beisen|ats/.test(config.policy.adapterKey)
          ? "ats"
          : config.candidate.acquisitionMode === "public_api"
            ? "structured_api"
            : config.policy.entrypoints.some((url) => /\.(pdf|docx)(?:$|\?)/i.test(url))
              ? "file_notice"
              : "html";
  return {
    sourceKey: config.sourceKey,
    organization: config.organization.name,
    officialDomain: config.organization.officialDomain,
    entrypoints: config.policy.entrypoints,
    kind,
    adapter: config.policy.adapterKey,
    configuredAutomaticPath: descriptor.probeHandler !== null,
    enabled: config.policy.crawlInterval.enabled,
    status: config.policy.status,
    policyVersion: config.policy.version,
    accessEvidence: config.policy.accessPolicyEvidence,
    identity: config.candidate.hardGates.officialIdentity,
    refreshCoverage: config.policy.refreshCoverage,
    absencePolicy: config.policy.absencePolicy,
    requestBudget: config.localProbe.requestBudget,
    observation: "配置能力不代表本轮实测成功；运行证据见刷新记录。",
  };
}
export async function getSourceInventory() {
  return Promise.all(
    (await listSourceKeys()).sort().map(async (key) => inventoryItem(await loadSourceConfig(key))),
  );
}
