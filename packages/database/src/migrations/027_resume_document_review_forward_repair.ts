import type { Kysely, Migration } from "kysely";

import { applyResumeDocumentReviewForwardContract } from "../forward-contract/024f_resume_document_review.js";
import type { Database } from "../types.js";

export const resumeDocumentReviewForwardRepairMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await applyResumeDocumentReviewForwardContract(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // Forward-only repair: never destroy resume history or review decisions.
  },
};
