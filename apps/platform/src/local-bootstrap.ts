import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AppConfig } from "@aijob/config";
import { createDatabase, type Database, migrateToLatest } from "@aijob/database";
import type { Kysely } from "kysely";
import { z } from "zod";
import { materializeLocalCatalog } from "./catalog/materialize.js";
import { importManualBrowserSnapshot } from "./ingestion/manual-browser-import.js";
import { runSourceProbe } from "./ingestion/probe.js";
import { loadSourceConfig } from "./sources/source-config.js";
import { registerSourceConfig } from "./sources/source-registry.js";

const sourceKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const bootstrapSourceSchema = z.discriminatedUnion("mode", [
  z.object({
    sourceKey: sourceKeySchema,
    mode: z.literal("probe"),
    limit: z.number().int().positive(),
  }),
  z.object({
    sourceKey: sourceKeySchema,
    mode: z.literal("browser_snapshot"),
    file: z.string().min(1),
  }),
]);

export const localBootstrapManifestSchema = z
  .object({
    schemaVersion: z.literal("aijob-local-bootstrap-v1"),
    sources: z.array(bootstrapSourceSchema).min(1),
    expectedCatalog: z.object({
      totalSupply: z.number().int().nonnegative(),
      visible: z.number().int().nonnegative(),
      companies: z.number().int().nonnegative(),
      publicJobs: z.literal(0),
    }),
  })
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    for (const [index, source] of manifest.sources.entries()) {
      if (seen.has(source.sourceKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sources", index, "sourceKey"],
          message: "sourceKey must be unique",
        });
      }
      seen.add(source.sourceKey);
    }
  });

export type LocalBootstrapManifest = z.infer<typeof localBootstrapManifestSchema>;

function withinDirectory(candidate: string, directory: string): boolean {
  const pathFromRoot = relative(directory, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..");
}

export async function loadLocalBootstrapManifest(input: {
  workspaceRoot: string;
  manifestPath: string;
}): Promise<{ manifest: LocalBootstrapManifest; manifestPath: string }> {
  const manifestPath = isAbsolute(input.manifestPath)
    ? resolve(input.manifestPath)
    : resolve(input.workspaceRoot, input.manifestPath);
  const dataRoot = resolve(input.workspaceRoot, ".data");
  if (!withinDirectory(manifestPath, dataRoot)) {
    throw new Error("LOCAL_BOOTSTRAP_MANIFEST_OUTSIDE_DATA");
  }
  const manifest = localBootstrapManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const browserImportRoot = resolve(dataRoot, "browser-imports");
  for (const source of manifest.sources) {
    if (source.mode !== "browser_snapshot") continue;
    const snapshotPath = isAbsolute(source.file)
      ? resolve(source.file)
      : resolve(input.workspaceRoot, source.file);
    if (!withinDirectory(snapshotPath, browserImportRoot)) {
      throw new Error("LOCAL_BOOTSTRAP_SNAPSHOT_OUTSIDE_BROWSER_IMPORTS");
    }
    try {
      await access(snapshotPath);
    } catch {
      throw new Error(`LOCAL_BOOTSTRAP_SNAPSHOT_MISSING:${source.sourceKey}`);
    }
  }
  return { manifest, manifestPath };
}

function startInfrastructure(workspaceRoot: string): void {
  const result = spawnSync(
    "docker",
    ["compose", "-f", "infra/compose.yaml", "up", "-d", "--wait"],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("LOCAL_BOOTSTRAP_INFRASTRUCTURE_FAILED");
}

export interface LocalBootstrapCatalogStats {
  totalSupply: number;
  visible: number;
  companies: number;
  publicJobs: number;
}

export async function readLocalBootstrapCatalogStats(
  db: Kysely<Database>,
): Promise<LocalBootstrapCatalogStats> {
  const totalSupplyRow = await db
    .selectFrom("catalog.internal_job_previews")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("ingestion_state", "=", "validated")
    .where("publication_state", "in", ["review", "published"])
    .where("policy_status", "in", ["pending_review", "approved"])
    .executeTakeFirstOrThrow();
  const quotaRows = await db
    .selectFrom("catalog.company_quota_selections")
    .select(["company_name", "selected"])
    .execute();
  const selectedRows = quotaRows.filter((row) => row.selected);
  const publicJobsRow = await db
    .selectFrom("catalog.published_jobs as job")
    .innerJoin("catalog.published_job_versions as version", "version.id", "job.current_version_id")
    .innerJoin(
      "ingestion.source_job_revisions as revision",
      "revision.id",
      "version.source_job_revision_id",
    )
    .innerJoin(
      "ingestion.source_job_records as record",
      "record.id",
      "revision.source_job_record_id",
    )
    .innerJoin("source_control.sources as source", "source.id", "record.source_id")
    .innerJoin("source_control.source_policy_versions as policy", "policy.source_id", "source.id")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .whereRef("policy.version", "=", "source.current_policy_version")
    .where("policy.policy_status", "=", "approved")
    .where("revision.ingestion_state", "=", "validated")
    .where("revision.publication_state", "=", "published")
    .executeTakeFirstOrThrow();
  return {
    totalSupply: Number(totalSupplyRow.count),
    visible: selectedRows.length,
    companies: new Set(selectedRows.map((row) => row.company_name)).size,
    publicJobs: Number(publicJobsRow.count),
  };
}

export async function runLocalBootstrap(input: {
  appConfig: AppConfig;
  manifestPath: string;
}): Promise<{
  manifestPath: string;
  sources: Array<{ sourceKey: string; mode: string; reused: boolean }>;
  materialization: Awaited<ReturnType<typeof materializeLocalCatalog>>;
  catalog: LocalBootstrapCatalogStats;
}> {
  const loaded = await loadLocalBootstrapManifest({
    workspaceRoot: input.appConfig.workspaceRoot,
    manifestPath: input.manifestPath,
  });
  if (input.appConfig.appEnv !== "local" || !input.appConfig.enableLocalMvp) {
    throw new Error("LOCAL_BOOTSTRAP_LOCAL_ONLY");
  }
  startInfrastructure(input.appConfig.workspaceRoot);
  const db = createDatabase(input.appConfig.databaseUrl);
  try {
    await migrateToLatest(db);
    const sourceResults: Array<{ sourceKey: string; mode: string; reused: boolean }> = [];
    for (const source of loaded.manifest.sources) {
      const sourceConfig = await loadSourceConfig(source.sourceKey);
      await registerSourceConfig(db, sourceConfig);
      if (source.mode === "probe") {
        const result = await runSourceProbe({
          db,
          runtime: {
            appEnv: input.appConfig.appEnv,
            enableSourceProbe: input.appConfig.enableSourceProbe,
            snapshotDir: input.appConfig.snapshotDirectory,
            probeRequestIntervalMs: input.appConfig.probeRequestIntervalMs,
          },
          sourceKey: source.sourceKey,
          limit: source.limit,
        });
        if (result.completion === "failed") {
          throw new Error(`LOCAL_BOOTSTRAP_SOURCE_FAILED:${source.sourceKey}`);
        }
        sourceResults.push({
          sourceKey: source.sourceKey,
          mode: source.mode,
          reused: result.reused,
        });
      } else {
        const result = await importManualBrowserSnapshot({
          db,
          appEnv: input.appConfig.appEnv,
          enableLocalMvp: input.appConfig.enableLocalMvp,
          workspaceRoot: input.appConfig.workspaceRoot,
          snapshotDirectory: input.appConfig.snapshotDirectory,
          sourceKey: source.sourceKey,
          filePath: source.file,
        });
        sourceResults.push({
          sourceKey: source.sourceKey,
          mode: source.mode,
          reused: result.reused,
        });
      }
    }
    const materialization = await materializeLocalCatalog(db);
    const catalog = await readLocalBootstrapCatalogStats(db);
    if (catalog.publicJobs !== 0) throw new Error("LOCAL_BOOTSTRAP_PUBLIC_CATALOG_NOT_EMPTY");
    if (
      catalog.totalSupply !== loaded.manifest.expectedCatalog.totalSupply ||
      catalog.visible !== loaded.manifest.expectedCatalog.visible ||
      catalog.companies !== loaded.manifest.expectedCatalog.companies
    ) {
      throw new Error(
        `LOCAL_BOOTSTRAP_CATALOG_MISMATCH:${JSON.stringify({
          expected: loaded.manifest.expectedCatalog,
          actual: catalog,
        })}`,
      );
    }
    return {
      manifestPath: loaded.manifestPath,
      sources: sourceResults,
      materialization,
      catalog,
    };
  } finally {
    await db.destroy();
  }
}
