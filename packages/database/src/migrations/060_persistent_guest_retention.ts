import { type Migration, sql } from "kysely";

export const persistentGuestRetentionMigration: Migration = {
  async up(db) {
    await sql`
      ALTER TABLE identity.owners DROP CONSTRAINT owners_retention_mode_check,
        ADD CONSTRAINT owners_retention_mode_check CHECK(retention_mode IN ('anonymous_ttl','persistent_guest','account_managed')),
        DROP CONSTRAINT owners_retention_mode_consistent,
        ADD CONSTRAINT owners_retention_mode_consistent CHECK(
          (retention_mode='anonymous_ttl' AND retention_expires_at IS NOT NULL)
          OR (retention_mode IN ('persistent_guest','account_managed') AND retention_expires_at IS NULL));
      CREATE OR REPLACE FUNCTION identity.validate_account_managed_owner() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.retention_mode='account_managed' AND NOT EXISTS (
          SELECT 1 FROM identity.accounts WHERE owner_id=NEW.id AND status='active'
        ) THEN RAISE EXCEPTION 'ACCOUNT_MANAGED_OWNER_REQUIRES_ACTIVE_ACCOUNT'; END IF;
        IF NEW.status='active' AND NEW.retention_mode<>'account_managed' AND EXISTS (
          SELECT 1 FROM identity.accounts WHERE owner_id=NEW.id AND status='active'
        ) THEN RAISE EXCEPTION 'ACTIVE_ACCOUNT_REQUIRES_ACCOUNT_MANAGED_OWNER'; END IF;
        RETURN NEW;
      END $$;
      -- Existing owners are not bulk-converted. A new user-created material save opts its active owner into retention.
      -- Legacy SQL callers retain their prior TTL default; browser creation explicitly sets persistent_guest.
    `.execute(db);
  },
  async down() {
    throw new Error(
      "Forward-only: do not impose an expiry on user-retained documents and originals.",
    );
  },
};
