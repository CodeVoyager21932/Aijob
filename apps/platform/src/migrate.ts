import {
  assertDatabaseRoleMembership,
  createDatabase,
  DatabaseRuntimeRole,
  migrateToLatest,
} from "@aijob/database";
import { databaseUrlForRuntime, loadPlatformConfig } from "./config/platform-config.js";

const appConfig = loadPlatformConfig();
const db = createDatabase(databaseUrlForRuntime(appConfig, "migrator"));
try {
  await migrateToLatest(db);
  await assertDatabaseRoleMembership({
    db,
    role: DatabaseRuntimeRole.migrator,
    required: appConfig.appEnv === "alpha" || appConfig.appEnv === "production",
  });
} finally {
  await db.destroy();
}
