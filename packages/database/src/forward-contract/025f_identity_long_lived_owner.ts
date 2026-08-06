import type { Kysely } from "kysely";

import { identityAccountEmailExpandMigration } from "../migrations/025_identity_account_email_expand.js";
import type { Database } from "../types.js";

export async function applyIdentityLongLivedOwnerForwardContract(
  db: Kysely<Database>,
): Promise<void> {
  await identityAccountEmailExpandMigration.up(db);
}
