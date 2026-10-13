import type { Migration } from "kysely";
import { sql } from "kysely";

// Current eligibility changes; immutable jobs and Case snapshots remain intact.
export const studentScopeSemanticsMigration: Migration = {
  async up(db) {
    await sql
      .raw(String.raw`
      CREATE OR REPLACE FUNCTION catalog.job_reachability_verdict(requirements text, responsibilities text)
      RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
      DECLARE corpus text; clause text; matched text[];
      BEGIN
        corpus := COALESCE(requirements, '') || ' ' || COALESCE(responsibilities, '');
        FOREACH clause IN ARRAY regexp_split_to_array(COALESCE(requirements, ''), '[。；;，,\n]') LOOP
          IF clause ~ '(实习经验|无需|不要求|不需要|不限经验|经验不限|不限制|优先|加分|或|应届|在校)' THEN CONTINUE; END IF;
          matched := regexp_match(clause, '([0-9]+|[一二三四五六七八九十两]+)([-~～至到]([0-9]+|[一二三四五六七八九十两]+))?\s*年[^。；;，,\n]{0,12}经验');
          IF (matched IS NOT NULL AND matched[1] !~ '^(0|1|一)$') OR clause ~ '多年[^。；;，,\n]{0,12}经验' THEN
            RETURN 'not_reachable_experience_required';
          END IF;
        END LOOP;
        IF corpus ~ '(本科|学士|大专|专科|硕士|研究生|博士|学历不限|不限学历|专业不限|不限专业|在校生|应届生)' THEN RETURN 'reachable'; END IF;
        RETURN 'unknown';
      END;
      $$;
    `)
      .execute(db);
    await sql`ALTER TABLE matching.job_insight_runs DROP CONSTRAINT job_insight_runs_algorithm_version_check`.execute(
      db,
    );
    await sql`ALTER TABLE matching.job_insight_runs ADD CONSTRAINT job_insight_runs_algorithm_version_check CHECK (algorithm_version IN ('job-market-insight-v1', 'job-market-insight-v2'))`.execute(
      db,
    );
  },
  // Rolling back application code must not restore superseded exclusions.
  async down() {
    throw new Error(
      "Forward-only migration; restore a verified backup to roll back database state.",
    );
  },
};
