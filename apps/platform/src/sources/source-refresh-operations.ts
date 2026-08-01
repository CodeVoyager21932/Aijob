import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";
import {
  loadSourceRefreshStatus,
  requestImmediateSourceRefresh,
} from "../ingestion/refresh-scheduler.js";
import { waitForCollectorIdle } from "../workers/collector-worker.js";
import { readLocalRefreshControl, writeLocalRefreshControl } from "./local-refresh-control.js";
import { listSourceKeys, loadSourceConfig } from "./source-config.js";
import {
  assertSourceRefreshStaggerHours,
  staggerDueSourceRefreshes,
} from "./source-refresh-stagger.js";
import { registerSourceConfig } from "./source-registry.js";

type AppEnvironment = "local" | "test" | "alpha" | "production";

interface SourceRefreshOperationDependencies {
  listSourceKeys: typeof listSourceKeys;
  loadSourceConfig: typeof loadSourceConfig;
  registerSourceConfig: typeof registerSourceConfig;
  readLocalRefreshControl: typeof readLocalRefreshControl;
  writeLocalRefreshControl: typeof writeLocalRefreshControl;
  loadSourceRefreshStatus: typeof loadSourceRefreshStatus;
  requestImmediateSourceRefresh: typeof requestImmediateSourceRefresh;
  staggerDueSourceRefreshes: typeof staggerDueSourceRefreshes;
  waitForCollectorIdle: typeof waitForCollectorIdle;
}

const defaultDependencies: SourceRefreshOperationDependencies = {
  listSourceKeys,
  loadSourceConfig,
  registerSourceConfig,
  readLocalRefreshControl,
  writeLocalRefreshControl,
  loadSourceRefreshStatus,
  requestImmediateSourceRefresh,
  staggerDueSourceRefreshes,
  waitForCollectorIdle,
};

function dependencies(
  overrides: Partial<SourceRefreshOperationDependencies> | undefined,
): SourceRefreshOperationDependencies {
  return { ...defaultDependencies, ...overrides };
}

function assertLocalEnvironment(appEnv: AppEnvironment): void {
  if (appEnv !== "local") throw new Error("SOURCE_REFRESH_LOCAL_ONLY");
}

export async function enableLocalSourceRefresh(input: {
  db: Kysely<Database>;
  appEnv: AppEnvironment;
  workspaceRoot: string;
  staggerHours?: number;
  now?: Date;
  dependencies?: Partial<SourceRefreshOperationDependencies>;
}) {
  assertLocalEnvironment(input.appEnv);
  const staggerHours = input.staggerHours ?? 0;
  assertSourceRefreshStaggerHours(staggerHours);
  const deps = dependencies(input.dependencies);
  const controlTime = input.now;
  deps.writeLocalRefreshControl({
    rootDirectory: input.workspaceRoot,
    enabled: false,
    ...(controlTime ? { now: controlTime } : {}),
  });
  await deps.waitForCollectorIdle(input.db);
  const configs = await Promise.all(
    (await deps.listSourceKeys()).map((sourceKey) => deps.loadSourceConfig(sourceKey)),
  );
  const enabledConfigs = configs.filter((config) => config.policy.crawlInterval.enabled);
  if (enabledConfigs.length === 0) throw new Error("NO_SOURCE_REFRESH_CONFIGURED");

  const registeredSources = [];
  for (const config of enabledConfigs) {
    const registered = await deps.registerSourceConfig(input.db, config);
    registeredSources.push({
      sourceKey: config.sourceKey,
      refreshCoverage: config.policy.refreshCoverage,
      minimumHours: config.policy.crawlInterval.minimumHours,
      ...registered,
    });
  }

  const schedulingNow = input.now ?? new Date();
  const staggeredSources = await deps.staggerDueSourceRefreshes({
    db: input.db,
    staggerHours,
    now: schedulingNow,
    sources: registeredSources
      .filter((source) => source.refreshCoverage !== "manual_snapshot")
      .map((source) => ({
        sourceId: source.sourceId,
        sourceKey: source.sourceKey,
        policyVersion: source.policyVersion,
        refreshCoverage: source.refreshCoverage,
      })),
  });

  const control = deps.writeLocalRefreshControl({
    rootDirectory: input.workspaceRoot,
    enabled: true,
    ...(controlTime ? { now: controlTime } : {}),
  });
  return { control, registeredSources, staggerHours, staggeredSources };
}

export async function disableLocalSourceRefresh(input: {
  db: Kysely<Database>;
  appEnv: AppEnvironment;
  workspaceRoot: string;
  now?: Date;
  dependencies?: Partial<SourceRefreshOperationDependencies>;
}) {
  assertLocalEnvironment(input.appEnv);
  const deps = dependencies(input.dependencies);
  const control = deps.writeLocalRefreshControl({
    rootDirectory: input.workspaceRoot,
    enabled: false,
    ...(input.now ? { now: input.now } : {}),
  });
  await deps.waitForCollectorIdle(input.db);
  return control;
}

export async function getLocalSourceRefreshStatus(input: {
  db: Kysely<Database>;
  appEnv: AppEnvironment;
  workspaceRoot: string;
  dependencies?: Partial<SourceRefreshOperationDependencies>;
}) {
  assertLocalEnvironment(input.appEnv);
  const deps = dependencies(input.dependencies);
  const [control, database] = await Promise.all([
    Promise.resolve(deps.readLocalRefreshControl(input.workspaceRoot)),
    deps.loadSourceRefreshStatus(input.db),
  ]);
  return { control, ...database };
}

export async function requestLocalSourceRefresh(input: {
  db: Kysely<Database>;
  appEnv: AppEnvironment;
  workspaceRoot: string;
  sourceKey?: string;
  now?: Date;
  dependencies?: Partial<SourceRefreshOperationDependencies>;
}) {
  assertLocalEnvironment(input.appEnv);
  const deps = dependencies(input.dependencies);
  if (!deps.readLocalRefreshControl(input.workspaceRoot).enabled) {
    throw new Error("SOURCE_REFRESH_DISABLED");
  }

  if (input.sourceKey) {
    const config = await deps.loadSourceConfig(input.sourceKey);
    if (!config.policy.crawlInterval.enabled) {
      throw new Error("SOURCE_SCHEDULED_REFRESH_NOT_AUTHORIZED");
    }
  }

  const sourceKeys = input.sourceKey
    ? [input.sourceKey]
    : (
        await Promise.all(
          (await deps.listSourceKeys()).map((sourceKey) => deps.loadSourceConfig(sourceKey)),
        )
      )
        .filter((config) => config.policy.crawlInterval.enabled)
        .map((config) => config.sourceKey);

  const results = [];
  for (const sourceKey of sourceKeys) {
    try {
      results.push(
        await deps.requestImmediateSourceRefresh({
          db: input.db,
          sourceKey,
          ...(input.now ? { now: input.now } : {}),
        }),
      );
    } catch (error) {
      if (input.sourceKey) throw error;
      results.push({
        sourceKey,
        scheduled: false,
        manualSnapshotRequired: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return input.sourceKey ? results[0] : { sources: results };
}
