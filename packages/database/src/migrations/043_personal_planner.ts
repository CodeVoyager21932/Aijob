import { sql, type Migration } from "kysely";
export const personalPlannerMigration: Migration = {
  async up(db) {
    await sql`
      CREATE TABLE application.planner_items (
        id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
        case_id uuid, kind text NOT NULL CHECK(kind IN ('preparation','exam','interview','deadline','follow_up')),
        title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 200), note text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
        due_at timestamptz, timezone text NOT NULL DEFAULT 'Asia/Shanghai', artifact text NOT NULL DEFAULT '',
        evidence_revision_id uuid, evidence_ids jsonb NOT NULL DEFAULT '[]', source jsonb,
        revision integer NOT NULL DEFAULT 1 CHECK(revision > 0), completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY(owner_id, case_id) REFERENCES application.application_cases(owner_id, id) ON DELETE CASCADE,
        FOREIGN KEY(owner_id, evidence_revision_id) REFERENCES profile.resume_evidence_revisions(owner_id, id),
        CHECK(jsonb_typeof(evidence_ids) = 'array'), CHECK((status = 'done') = (completed_at IS NOT NULL))
      );
      CREATE INDEX planner_owner_due ON application.planner_items(owner_id, owner_epoch, due_at, id) WHERE status <> 'done';
      CREATE INDEX planner_owner_case ON application.planner_items(owner_id, case_id);
      CREATE TABLE application.saved_searches (
        id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
        label text NOT NULL, scope jsonb NOT NULL, scope_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(owner_id, owner_epoch, scope_hash)
      );
      CREATE TABLE application.planner_mutation_receipts (
        owner_id uuid NOT NULL REFERENCES identity.owners(id), owner_epoch bigint NOT NULL,
        request_key text NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id, owner_epoch, request_key)
      );
      CREATE FUNCTION application.assert_planner_owner_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE valid_owner boolean;
      BEGIN
        SELECT status = 'active' AND epoch = NEW.owner_epoch AND (retention_expires_at IS NULL OR retention_expires_at > now())
          INTO valid_owner FROM identity.owners WHERE id = NEW.owner_id FOR UPDATE;
        IF NOT COALESCE(valid_owner, false) THEN RAISE EXCEPTION 'OWNER_EPOCH_STALE'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER planner_epoch BEFORE INSERT OR UPDATE ON application.planner_items FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      CREATE TRIGGER saved_search_epoch BEFORE INSERT OR UPDATE ON application.saved_searches FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      CREATE TRIGGER planner_receipt_epoch BEFORE INSERT OR UPDATE ON application.planner_mutation_receipts FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      GRANT SELECT, INSERT, UPDATE, DELETE ON application.planner_items, application.saved_searches, application.planner_mutation_receipts TO aijob_web_api;
      GRANT SELECT, DELETE ON application.planner_items, application.saved_searches, application.planner_mutation_receipts TO aijob_match_worker;
      GRANT ALL ON application.planner_items, application.saved_searches, application.planner_mutation_receipts TO aijob_migrator, aijob_ops_cli;
    `.execute(db);
  },
  async down() {
    throw new Error(
      "PERSONAL_PLANNER_HAS_USER_DATA: roll back the application while retaining this additive schema; destructive downgrades require an explicit backup/restore procedure.",
    );
  },
};
