import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

/**
 * 把「评估未完成」与「评估不合格」在持久记录里分开。
 *
 * 迁移 001 的 CHECK 只允许 `pilot | watch | reject | ineligible`。而原始来源配置里
 * `hardGates.*.status` 本来是三态 `pass | pending | fail`，归一化时被压成布尔，`pending`
 * 与 `fail` 都得出 `ineligible`。结果 33 个仅仅在等连续运行证据的来源，在记录里与被否决
 * 的来源无法区分——而它们要产出那份证据，恰恰得先跑起来。
 *
 * 未完成的流程不是结论。新增 `assessing` 取值，`ineligible` 此后只表示评估过且不合格。
 *
 * 不回填历史行：既有 `ineligible` 记录是当时依据布尔判定写下的事实，改写它们会伪造
 * 评估历史。下一次 `source-registry` 写入时自然会得到新的正确取值。
 */
export const sourceAssessmentInProgressMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE source_control.source_assessments
        DROP CONSTRAINT source_assessments_decision_check;

      ALTER TABLE source_control.source_assessments
        ADD CONSTRAINT source_assessments_decision_check CHECK (
          decision IN ('pilot', 'watch', 'reject', 'ineligible', 'assessing')
        );
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    // 回滚前必须先把 `assessing` 归并回 `ineligible`，否则旧 CHECK 无法建立。
    await sql`
      UPDATE source_control.source_assessments
      SET decision = 'ineligible'
      WHERE decision = 'assessing';

      ALTER TABLE source_control.source_assessments
        DROP CONSTRAINT source_assessments_decision_check;

      ALTER TABLE source_control.source_assessments
        ADD CONSTRAINT source_assessments_decision_check CHECK (
          decision IN ('pilot', 'watch', 'reject', 'ineligible')
        );
    `.execute(db);
  },
};
