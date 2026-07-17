import type { Kysely } from "kysely";
import { type Migration, type MigrationProvider, Migrator } from "kysely";
import { initialMigration } from "./migrations/001_initial.js";
import { hardenSourceAndCatalogIntegrityMigration } from "./migrations/002_harden_source_and_catalog_integrity.js";
import { persistSourceTargetPolicyMigration } from "./migrations/003_persist_source_target_policy.js";
import type { Database } from "./types.js";

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return {
      "001_initial": initialMigration,
      "002_harden_source_and_catalog_integrity": hardenSourceAndCatalogIntegrityMigration,
      "003_persist_source_target_policy": persistSourceTargetPolicyMigration,
    };
  }
}

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new StaticMigrationProvider(),
  });

  const { error, results } = await migrator.migrateToLatest();
  for (const result of results ?? []) {
    const message = `${result.migrationName}: ${result.status}`;
    if (result.status === "Error") {
      console.error(message);
    } else {
      console.info(message);
    }
  }

  if (error) {
    throw error;
  }
}
