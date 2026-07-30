import { type Kysely, type Migration, sql } from "kysely";
import type { Database } from "../types.js";

export const enforceOwnerIsolationMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
      ALTER TABLE profile.resume_analyses
        ADD CONSTRAINT resume_analyses_owner_id_id_unique UNIQUE (owner_id, id);

      ALTER TABLE profile.profile_fact_revisions
        ADD CONSTRAINT profile_fact_revisions_owner_id_id_unique UNIQUE (owner_id, id);

      ALTER TABLE profile.job_preference_revisions
        ADD CONSTRAINT job_preference_revisions_owner_id_id_unique UNIQUE (owner_id, id);

      ALTER TABLE profile.resume_evidence_revisions
        DROP CONSTRAINT resume_evidence_revisions_resume_analysis_id_fkey,
        ADD CONSTRAINT resume_evidence_revisions_owner_analysis_fk
          FOREIGN KEY (owner_id, resume_analysis_id)
          REFERENCES profile.resume_analyses(owner_id, id)
          ON DELETE SET NULL (resume_analysis_id),
        ADD CONSTRAINT resume_evidence_revisions_owner_id_id_unique UNIQUE (owner_id, id);

      ALTER TABLE matching.match_runs
        ADD CONSTRAINT match_runs_owner_fact_fk
          FOREIGN KEY (owner_id, profile_fact_revision_id)
          REFERENCES profile.profile_fact_revisions(owner_id, id),
        ADD CONSTRAINT match_runs_owner_preference_fk
          FOREIGN KEY (owner_id, preference_revision_id)
          REFERENCES profile.job_preference_revisions(owner_id, id),
        ADD CONSTRAINT match_runs_owner_evidence_fk
          FOREIGN KEY (owner_id, evidence_revision_id)
          REFERENCES profile.resume_evidence_revisions(owner_id, id),
        ADD CONSTRAINT match_runs_owner_id_id_unique UNIQUE (owner_id, id);

      ALTER TABLE matching.recommendation_runs
        ADD CONSTRAINT recommendation_runs_owner_fact_fk
          FOREIGN KEY (owner_id, profile_fact_revision_id)
          REFERENCES profile.profile_fact_revisions(owner_id, id),
        ADD CONSTRAINT recommendation_runs_owner_preference_fk
          FOREIGN KEY (owner_id, preference_revision_id)
          REFERENCES profile.job_preference_revisions(owner_id, id),
        ADD CONSTRAINT recommendation_runs_owner_evidence_fk
          FOREIGN KEY (owner_id, evidence_revision_id)
          REFERENCES profile.resume_evidence_revisions(owner_id, id),
        ADD CONSTRAINT recommendation_runs_owner_id_id_unique UNIQUE (owner_id, id);

      ALTER TABLE matching.resume_tailoring_runs
        ADD CONSTRAINT tailoring_runs_owner_analysis_fk
          FOREIGN KEY (owner_id, resume_analysis_id)
          REFERENCES profile.resume_analyses(owner_id, id),
        ADD CONSTRAINT tailoring_runs_owner_evidence_fk
          FOREIGN KEY (owner_id, evidence_revision_id)
          REFERENCES profile.resume_evidence_revisions(owner_id, id),
        ADD CONSTRAINT tailoring_runs_owner_id_id_unique UNIQUE (owner_id, id);

      ALTER TABLE matching.recommendation_items
        ADD COLUMN owner_id uuid;

      UPDATE matching.recommendation_items AS item
      SET owner_id = run.owner_id
      FROM matching.recommendation_runs AS run
      WHERE run.id = item.recommendation_run_id;

      ALTER TABLE matching.recommendation_items
        ALTER COLUMN owner_id SET NOT NULL,
        ADD CONSTRAINT recommendation_items_owner_run_fk
          FOREIGN KEY (owner_id, recommendation_run_id)
          REFERENCES matching.recommendation_runs(owner_id, id)
          ON DELETE CASCADE,
        ADD CONSTRAINT recommendation_items_owner_match_fk
          FOREIGN KEY (owner_id, match_run_id)
          REFERENCES matching.match_runs(owner_id, id);

      ALTER TABLE matching.resume_exports
        ADD CONSTRAINT resume_exports_owner_tailoring_fk
          FOREIGN KEY (owner_id, tailoring_run_id)
          REFERENCES matching.resume_tailoring_runs(owner_id, id);

      CREATE FUNCTION profile.prevent_revision_update()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'IMMUTABLE_PROFILE_REVISION';
      END;
      $$;

      CREATE TRIGGER profile_fact_revisions_no_update
        BEFORE UPDATE ON profile.profile_fact_revisions
        FOR EACH ROW EXECUTE FUNCTION profile.prevent_revision_update();

      CREATE TRIGGER job_preference_revisions_no_update
        BEFORE UPDATE ON profile.job_preference_revisions
        FOR EACH ROW EXECUTE FUNCTION profile.prevent_revision_update();

      CREATE TRIGGER resume_evidence_revisions_no_update
        BEFORE UPDATE ON profile.resume_evidence_revisions
        FOR EACH ROW EXECUTE FUNCTION profile.prevent_revision_update();

      CREATE FUNCTION task_queue.protect_task_context()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF (
          NEW.task_type,
          NEW.source_id,
          NEW.policy_version,
          NEW.adapter_version,
          NEW.run_mode,
          NEW.owner_id,
          NEW.owner_epoch,
          NEW.payload,
          NEW.idempotency_key
        ) IS DISTINCT FROM (
          OLD.task_type,
          OLD.source_id,
          OLD.policy_version,
          OLD.adapter_version,
          OLD.run_mode,
          OLD.owner_id,
          OLD.owner_epoch,
          OLD.payload,
          OLD.idempotency_key
        ) THEN
          RAISE EXCEPTION 'IMMUTABLE_TASK_CONTEXT';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER tasks_immutable_context
        BEFORE UPDATE ON task_queue.tasks
        FOR EACH ROW EXECUTE FUNCTION task_queue.protect_task_context();
    `.execute(db);
  },

  async down(db: Kysely<Database>): Promise<void> {
    await sql`
      DROP TRIGGER tasks_immutable_context ON task_queue.tasks;
      DROP FUNCTION task_queue.protect_task_context();

      DROP TRIGGER resume_evidence_revisions_no_update
        ON profile.resume_evidence_revisions;
      DROP TRIGGER job_preference_revisions_no_update
        ON profile.job_preference_revisions;
      DROP TRIGGER profile_fact_revisions_no_update
        ON profile.profile_fact_revisions;
      DROP FUNCTION profile.prevent_revision_update();

      ALTER TABLE matching.resume_exports
        DROP CONSTRAINT resume_exports_owner_tailoring_fk;

      ALTER TABLE matching.recommendation_items
        DROP CONSTRAINT recommendation_items_owner_match_fk,
        DROP CONSTRAINT recommendation_items_owner_run_fk,
        DROP COLUMN owner_id;

      ALTER TABLE matching.resume_tailoring_runs
        DROP CONSTRAINT tailoring_runs_owner_id_id_unique,
        DROP CONSTRAINT tailoring_runs_owner_evidence_fk,
        DROP CONSTRAINT tailoring_runs_owner_analysis_fk;

      ALTER TABLE matching.recommendation_runs
        DROP CONSTRAINT recommendation_runs_owner_id_id_unique,
        DROP CONSTRAINT recommendation_runs_owner_evidence_fk,
        DROP CONSTRAINT recommendation_runs_owner_preference_fk,
        DROP CONSTRAINT recommendation_runs_owner_fact_fk;

      ALTER TABLE matching.match_runs
        DROP CONSTRAINT match_runs_owner_id_id_unique,
        DROP CONSTRAINT match_runs_owner_evidence_fk,
        DROP CONSTRAINT match_runs_owner_preference_fk,
        DROP CONSTRAINT match_runs_owner_fact_fk;

      ALTER TABLE profile.resume_evidence_revisions
        DROP CONSTRAINT resume_evidence_revisions_owner_id_id_unique,
        DROP CONSTRAINT resume_evidence_revisions_owner_analysis_fk,
        ADD CONSTRAINT resume_evidence_revisions_resume_analysis_id_fkey
          FOREIGN KEY (resume_analysis_id)
          REFERENCES profile.resume_analyses(id)
          ON DELETE SET NULL;

      ALTER TABLE profile.job_preference_revisions
        DROP CONSTRAINT job_preference_revisions_owner_id_id_unique;

      ALTER TABLE profile.profile_fact_revisions
        DROP CONSTRAINT profile_fact_revisions_owner_id_id_unique;

      ALTER TABLE profile.resume_analyses
        DROP CONSTRAINT resume_analyses_owner_id_id_unique;
    `.execute(db);
  },
};
