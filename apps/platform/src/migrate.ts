import { loadAppConfig } from "@aijob/config";
import { createDatabase, migrateToLatest } from "@aijob/database";

const appConfig = loadAppConfig();
const db = createDatabase(appConfig.databaseUrl);
try {
  await migrateToLatest(db);
} finally {
  await db.destroy();
}
