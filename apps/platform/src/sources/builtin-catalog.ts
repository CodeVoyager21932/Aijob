import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { z } from "zod";
import { readLocalRefreshControl } from "./local-refresh-control.js";
import { getRepositoryRoot, loadSourceConfig } from "./source-config.js";
import {
  disableLocalSourceRefresh,
  enableLocalSourceRefresh,
} from "./source-refresh-operations.js";

const schema = z.object({
  version: z.string(),
  reviewedAt: z.string(),
  sources: z.array(
    z.object({
      sourceKey: z.string(),
      name: z.string(),
      officialUrl: z.string().url(),
      description: z.string(),
      configurationSha256: z.string(),
    }),
  ),
});
export async function builtinSourceCatalog(workspaceRoot: string) {
  const catalog = schema.parse(
    JSON.parse(
      await readFile(path.join(getRepositoryRoot(), "config/source-catalog.json"), "utf8"),
    ),
  );
  const control = readLocalRefreshControl(workspaceRoot);
  return { ...catalog, enabled: control.enabled, selected: control.sourceKeys ?? [] };
}
/** Only the desktop's private operator child calls this command. No public admin route. */
export async function selectBuiltinSources(
  db: Kysely<Database>,
  workspaceRoot: string,
  raw: unknown,
) {
  const request = z
    .object({
      sourceKeys: z.array(z.string()).max(100),
      enabled: z.boolean(),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  const catalog = await builtinSourceCatalog(workspaceRoot);
  for (const key of request.sourceKeys) {
    const item = catalog.sources.find((s) => s.sourceKey === key);
    if (!item) throw Error("SOURCE_NOT_IN_REVIEWED_CATALOG");
    const contents = await readFile(
      path.join(getRepositoryRoot(), "config/sources", `${key}.json`),
    );
    if (createHash("sha256").update(contents).digest("hex") !== item.configurationSha256)
      throw Error("SOURCE_CATALOG_VERSION_CHANGED");
    const effective = await loadSourceConfig(key);
    const builtin = await loadSourceConfig(
      key,
      path.join(getRepositoryRoot(), "config/sources", ".") + path.sep,
    );
    if (JSON.stringify(effective) !== JSON.stringify(builtin))
      throw Error("SOURCE_OVERRIDE_NEEDS_OPERATOR_REVIEW");
  }
  const input = { db, appEnv: "local" as const, workspaceRoot };
  if (request.enabled) {
    if (!request.sourceKeys.length) throw Error("SOURCE_SELECTION_REQUIRED");
    await enableLocalSourceRefresh({ ...input, sourceKeys: request.sourceKeys });
  } else await disableLocalSourceRefresh(input);
  return builtinSourceCatalog(workspaceRoot);
}
