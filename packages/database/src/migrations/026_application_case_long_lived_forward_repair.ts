import type { Kysely, Migration } from "kysely";

import { applyApplicationCaseForwardContract } from "../forward-contract/023f_application_case_long_lived.js";
import type { Database } from "../types.js";

export const applicationCaseLongLivedForwardRepairMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await applyApplicationCaseForwardContract(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // Forward-only repair: private JD and immutable Case history must not be destroyed.
  },
};
