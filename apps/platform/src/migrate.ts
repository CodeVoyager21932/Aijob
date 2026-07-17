import { appConfig } from "@aijob/config";
import { createDatabase, migrateToLatest } from "@aijob/database";

const db = createDatabase(appConfig.databaseUrl);
try {
  await migrateToLatest(db);
} finally {
  await db.destroy();
}
