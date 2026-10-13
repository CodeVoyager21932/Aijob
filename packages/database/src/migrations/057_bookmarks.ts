import { sql,type Migration } from "kysely";
export const bookmarksMigration:Migration={
  async up(db){await sql`
    CREATE TABLE application.job_bookmarks (
      owner_id uuid NOT NULL REFERENCES identity.owners(id),owner_epoch bigint NOT NULL,job_id uuid NOT NULL REFERENCES catalog.published_jobs(id),
      saved boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(owner_id,owner_epoch,job_id)
    );
    CREATE TABLE application.bookmark_receipts (
      owner_id uuid NOT NULL REFERENCES identity.owners(id),owner_epoch bigint NOT NULL,idempotency_key text NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,
      PRIMARY KEY(owner_id,owner_epoch,idempotency_key)
    );
    CREATE TRIGGER bookmark_epoch BEFORE INSERT OR UPDATE ON application.job_bookmarks FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
    CREATE TRIGGER bookmark_receipt_epoch BEFORE INSERT ON application.bookmark_receipts FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
    CREATE INDEX bookmark_owner_saved ON application.job_bookmarks(owner_id,owner_epoch,saved,updated_at DESC);
    GRANT SELECT,INSERT,UPDATE,DELETE ON application.job_bookmarks,application.bookmark_receipts TO aijob_web_api,aijob_match_worker,aijob_ops_cli;
    GRANT ALL ON application.job_bookmarks,application.bookmark_receipts TO aijob_migrator;
    INSERT INTO application.job_bookmarks(owner_id,owner_epoch,job_id,saved)
      SELECT c.owner_id,c.owner_epoch,c.published_job_id,true FROM application.application_cases c JOIN identity.owners o ON o.id=c.owner_id AND o.epoch=c.owner_epoch
      WHERE c.stage='interested' AND c.deleted_at IS NULL AND c.published_job_id IS NOT NULL AND o.status='active' AND (o.retention_mode='account_managed' OR o.retention_expires_at>now())
      ON CONFLICT DO NOTHING;
  `.execute(db);},
  async down(){throw new Error("Forward-only migration; retain existing application history.");}
};
