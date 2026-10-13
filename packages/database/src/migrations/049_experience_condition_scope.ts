import { sql, type Migration } from "kysely";

/** Forward repair only: current scope changes, historical facts and Cases stay fixed. */
export const experienceConditionScopeMigration: Migration = {
  async up(db) {
    await sql
      .raw(String.raw`
      CREATE OR REPLACE FUNCTION catalog.job_reachability_verdict(requirements text, responsibilities text)
      RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
      DECLARE corpus text; conditions text; clause text; matched text[];
      BEGIN
        corpus := COALESCE(requirements, '') || ' ' || COALESCE(responsibilities, '');
        conditions := regexp_replace(COALESCE(requirements, ''), '[，,]\s*(或(者)?)', '\1', 'g');
        FOREACH clause IN ARRAY regexp_split_to_array(conditions, '[。；;，,\n]|并且|且|但是|但') LOOP
          IF clause ~ '(实习经验|无需|不要求|不需要|不限经验|经验不限|不限制|优先|加分|或)' THEN CONTINUE; END IF;
          matched := regexp_match(clause, '([0-9]+|[一二三四五六七八九十两]+)([-~～至到]([0-9]+|[一二三四五六七八九十两]+))?\s*年[^。；;，,\n]{0,12}经验');
          IF (matched IS NOT NULL AND matched[1] !~ '^(0|1|一)$') OR clause ~ '多年[^。；;，,\n]{0,12}经验' THEN
            RETURN 'not_reachable_experience_required';
          END IF;
        END LOOP;
        IF corpus ~ '(本科|学士|大专|专科|硕士|研究生|博士|学历不限|不限学历|专业不限|不限专业|在校生|应届生)' THEN RETURN 'reachable'; END IF;
        RETURN 'unknown';
      END; $$;
      UPDATE catalog.job_graph_generation SET generation = generation + 1 WHERE id = true;
    `)
      .execute(db);
  },
  async down() {
    throw new Error("Forward-only repair; restore a verified backup to roll back database state.");
  },
};
