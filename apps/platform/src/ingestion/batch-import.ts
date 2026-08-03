import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { materializeLocalCatalog } from "../catalog/materialize.js";
import { getOfficialSourceAdapterDescriptor } from "../sources/official-source-adapters.js";
import { loadSourceCandidateRegistry } from "../sources/source-candidates.js";
import { assessSource, loadSourceConfig, type SourceConfig } from "../sources/source-config.js";
import {
  isRetryableProbeErrorCode,
  type ProbeResult,
  type ProbeRuntimeConfig,
  runSourceProbe,
} from "./probe.js";
import { isTransportErrorCode } from "./refresh-scheduler.js";

export const DEFAULT_BATCH_IMPORT_LIMIT = 5;
export const DEFAULT_BATCH_TRANSPORT_FAILURE_LIMIT = 3;

export type BatchImportSourceState = "ran" | "reused" | "failed" | "skipped";

export interface BatchImportSourceResult {
  sourceKey: string;
  state: BatchImportSourceState;
  limit?: number;
  result?: ProbeResult;
  reason?: string;
  error?: string;
}

export interface BatchImportResult {
  sourceKeys: string[];
  items: BatchImportSourceResult[];
  normalizedCount: number;
  rejectedCount: number;
  transportFailureCount: number;
  stoppedByTransportCircuit: boolean;
  materialization?: Awaited<ReturnType<typeof materializeLocalCatalog>>;
  materializationError?: string;
}

interface BatchImportDependencies {
  loadConfig?: typeof loadSourceConfig;
  runProbe?: typeof runSourceProbe;
  materialize?: typeof materializeLocalCatalog;
}

export function normalizeBatchSourceKeys(sourceKeys: readonly string[]): string[] {
  return [...new Set(sourceKeys.map((sourceKey) => sourceKey.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function transportCodeFromText(value: string): string | undefined {
  const match = value.match(/\b[A-Z][A-Z0-9_]+\b/g);
  return match?.find((code) => isTransportErrorCode(code));
}

function sourceSkipReason(config: SourceConfig): string | undefined {
  if (config.policy.status !== "pending_review") return "SOURCE_POLICY_NOT_PROBE_AUTHORIZED";
  if (config.candidate.acquisitionMode === "browser_required") {
    return "BROWSER_FALLBACK_REQUIRED";
  }
  if (config.policy.refreshCoverage === "manual_snapshot") {
    return "MANUAL_SNAPSHOT_ONLY";
  }
  if (!config.localProbe.enabled) return "SOURCE_PROBE_DISABLED";
  const descriptor = getOfficialSourceAdapterDescriptor(config.policy.adapterKey);
  if (descriptor.probeHandler === null) return "ADAPTER_PROBE_HANDLER_MISSING";
  if (assessSource(config).hardGatesPassed) {
    return "SOURCE_ALREADY_APPROVED_USE_SCHEDULED_REFRESH";
  }
  return undefined;
}

export async function runBatchImport(input: {
  db: Kysely<Database>;
  runtime: ProbeRuntimeConfig;
  enableLocalMvp?: boolean;
  sourceKeys: readonly string[];
  limit?: number;
  liveProbeApproved?: boolean;
  maxSources?: number;
  transportFailureLimit?: number;
  registry?: Awaited<ReturnType<typeof loadSourceCandidateRegistry>>;
  dependencies?: BatchImportDependencies;
}): Promise<BatchImportResult> {
  const registry = input.registry ?? (await loadSourceCandidateRegistry());
  const sourceKeys = normalizeBatchSourceKeys(input.sourceKeys);
  const maxSources = input.maxSources ?? registry.batchPolicy.maxCompanies;
  const transportFailureLimit =
    input.transportFailureLimit ?? DEFAULT_BATCH_TRANSPORT_FAILURE_LIMIT;
  const requestedLimit = input.limit ?? DEFAULT_BATCH_IMPORT_LIMIT;

  if (sourceKeys.length === 0) throw new Error("SOURCE_BATCH_KEYS_REQUIRED");
  if (sourceKeys.length > maxSources) throw new Error("SOURCE_BATCH_TOO_LARGE");
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error("SOURCE_BATCH_LIMIT_INVALID");
  }
  if (!Number.isInteger(transportFailureLimit) || transportFailureLimit < 1) {
    throw new Error("SOURCE_BATCH_TRANSPORT_LIMIT_INVALID");
  }
  if (registry.liveProbeRequiresExplicitApproval && !input.liveProbeApproved) {
    throw new Error("SOURCE_BATCH_LIVE_APPROVAL_REQUIRED");
  }
  if (input.runtime.appEnv !== "local" || !input.runtime.enableSourceProbe) {
    throw new Error("SOURCE_BATCH_PROBE_LOCAL_ONLY");
  }

  const loadConfig = input.dependencies?.loadConfig ?? loadSourceConfig;
  const runProbe = input.dependencies?.runProbe ?? runSourceProbe;
  const materialize = input.dependencies?.materialize ?? materializeLocalCatalog;
  const items: BatchImportSourceResult[] = [];
  let normalizedCount = 0;
  let rejectedCount = 0;
  let transportFailureCount = 0;
  let stoppedByTransportCircuit = false;

  for (const sourceKey of sourceKeys) {
    if (transportFailureCount >= transportFailureLimit) {
      stoppedByTransportCircuit = true;
      items.push({
        sourceKey,
        state: "skipped",
        reason: "GLOBAL_TRANSPORT_CIRCUIT_OPEN",
      });
      continue;
    }

    let config: SourceConfig;
    try {
      config = await loadConfig(sourceKey);
    } catch (error) {
      items.push({
        sourceKey,
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const reason = sourceSkipReason(config);
    if (reason) {
      items.push({ sourceKey, state: "skipped", reason });
      continue;
    }

    const limit = Math.min(requestedLimit, config.localProbe.requestBudget.maxItems);
    try {
      const result = await runProbe({
        db: input.db,
        runtime: input.runtime,
        sourceKey,
        limit,
        liveProbeApproved: input.liveProbeApproved === true,
      });
      const runTransportErrors = result.errors.filter(({ code }) => isTransportErrorCode(code));
      transportFailureCount += runTransportErrors.length;
      normalizedCount += result.normalizedCount;
      rejectedCount += result.rejectedCount;
      items.push({
        sourceKey,
        state: result.completion === "failed" ? "failed" : result.reused ? "reused" : "ran",
        limit,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transportCode = transportCodeFromText(message);
      if (transportCode && isRetryableProbeErrorCode(transportCode)) {
        transportFailureCount += 1;
      }
      items.push({ sourceKey, state: "failed", limit, error: message });
    }
  }

  if (transportFailureCount >= transportFailureLimit) stoppedByTransportCircuit = true;

  const attempted = items.some((item) => item.state === "ran" || item.state === "reused");
  if (attempted && input.enableLocalMvp !== false) {
    try {
      const materialization = await materialize(input.db);
      return {
        sourceKeys,
        items,
        normalizedCount,
        rejectedCount,
        transportFailureCount,
        stoppedByTransportCircuit,
        materialization,
      };
    } catch (error) {
      return {
        sourceKeys,
        items,
        normalizedCount,
        rejectedCount,
        transportFailureCount,
        stoppedByTransportCircuit,
        materializationError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    sourceKeys,
    items,
    normalizedCount,
    rejectedCount,
    transportFailureCount,
    stoppedByTransportCircuit,
  };
}
