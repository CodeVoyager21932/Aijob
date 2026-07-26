import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

/**
 * ADR-0021：按企业规模证据分级的单家目录配额。
 * 选择结果由目录物化确定性计算并整表重写；岗位版本与来源修订保持不可变，
 * 被压缩的供给仅在读取层隐藏并公开缺口分母。
 */
export const companyQuotaSelectionsMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      CREATE TABLE catalog.company_quota_selections (
        published_job_id uuid PRIMARY KEY REFERENCES catalog.published_jobs(id) ON DELETE CASCADE,
        company_name text NOT NULL,
        scale_band text NOT NULL,
        quota integer NOT NULL CHECK (quota > 0),
        supply integer NOT NULL CHECK (supply >= 0),
        selection_rank integer NOT NULL CHECK (selection_rank > 0),
        selected boolean NOT NULL,
        computed_at timestamptz NOT NULL DEFAULT now()
      );
    `.execute(db);
    await sql`
      CREATE INDEX company_quota_selections_company_idx
        ON catalog.company_quota_selections (company_name, selected);
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`DROP TABLE catalog.company_quota_selections;`.execute(db);
  },
};
