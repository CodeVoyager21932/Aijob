import { createDatabase } from "@aijob/database";
import { loadPlatformConfig } from "./config/platform-config.js";
import { builtinSourceCatalog, selectBuiltinSources } from "./sources/builtin-catalog.js";

const config = loadPlatformConfig(),
  db = createDatabase(config.databaseUrl);
try {
  const raw = process.env.AIJOB_SOURCE_SELECTION;
  const result = raw
    ? await selectBuiltinSources(db, config.workspaceRoot, JSON.parse(raw))
    : await builtinSourceCatalog(config.workspaceRoot);
  process.send?.({ type: "sources", result });
} catch (error) {
  process.send?.({
    type: "sources",
    error: error instanceof Error ? error.message : "SOURCE_SELECTION_FAILED",
  });
} finally {
  await db.destroy();
  process.disconnect?.();
}
