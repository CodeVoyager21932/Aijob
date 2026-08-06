import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";

import type { Database } from "../types.js";

export const identityAccountEmailExpandMigration: Migration = {
  async up(db: Kysely<Database>): Promise<void> {
    await sql`
    ALTER TABLE identity.owners
      ADD COLUMN retention_mode text NOT NULL DEFAULT 'anonymous_ttl' CHECK (
        retention_mode IN ('anonymous_ttl', 'account_managed')
      ),
      ALTER COLUMN retention_expires_at DROP NOT NULL,
      ADD CONSTRAINT owners_id_epoch_unique UNIQUE (id, epoch),
      ADD CONSTRAINT owners_retention_mode_consistent CHECK (
        (retention_mode = 'anonymous_ttl' AND retention_expires_at IS NOT NULL)
        OR (retention_mode = 'account_managed' AND retention_expires_at IS NULL)
      );

    CREATE TABLE identity.accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL UNIQUE REFERENCES identity.owners(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'active' CHECK (
        status IN ('active', 'deletion_pending', 'deleted')
      ),
      revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      CONSTRAINT accounts_owner_id_unique UNIQUE (owner_id, id),
      CONSTRAINT accounts_deleted_state_consistent CHECK (
        (status = 'deleted' AND deleted_at IS NOT NULL)
        OR (status <> 'deleted' AND deleted_at IS NULL)
      ),
      CONSTRAINT accounts_update_after_creation CHECK (updated_at >= created_at)
    );

    CREATE TABLE identity.email_identities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
      email_lookup_hash text NOT NULL UNIQUE CHECK (email_lookup_hash ~ '^[a-f0-9]{64}$'),
      email_ciphertext bytea NOT NULL CHECK (octet_length(email_ciphertext) BETWEEN 1 AND 1024),
      email_nonce bytea NOT NULL CHECK (octet_length(email_nonce) BETWEEN 12 AND 32),
      email_auth_tag bytea NOT NULL CHECK (octet_length(email_auth_tag) BETWEEN 12 AND 32),
      encryption_key_version text NOT NULL CHECK (
        char_length(encryption_key_version) BETWEEN 1 AND 64
      ),
      verified_at timestamptz NOT NULL,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT email_identities_owner_id_unique UNIQUE (account_id, id),
      CONSTRAINT email_identities_revocation_consistent CHECK (
        (status = 'active' AND revoked_at IS NULL)
        OR (status = 'revoked' AND revoked_at IS NOT NULL)
      ),
      CONSTRAINT email_identities_verified_after_creation CHECK (verified_at >= created_at),
      CONSTRAINT email_identities_update_after_creation CHECK (updated_at >= created_at)
    );

    CREATE UNIQUE INDEX email_identities_one_active_per_account_idx
      ON identity.email_identities(account_id)
      WHERE status = 'active';

    CREATE TABLE identity.email_verification_challenges (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      purpose text NOT NULL CHECK (purpose IN ('claim_owner', 'sign_in', 'change_email')),
      status text NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'consumed', 'expired', 'locked')
      ),
      owner_id uuid,
      owner_epoch bigint,
      account_id uuid REFERENCES identity.accounts(id) ON DELETE CASCADE,
      email_lookup_hash text NOT NULL CHECK (email_lookup_hash ~ '^[a-f0-9]{64}$'),
      verification_token_hash text NOT NULL CHECK (
        verification_token_hash ~ '^[a-f0-9]{64}$'
      ),
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
      expires_at timestamptz NOT NULL,
      retry_after_at timestamptz NOT NULL,
      consumed_at timestamptz,
      locked_at timestamptz,
      idempotency_key_hash text NOT NULL CHECK (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
      request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT email_verification_challenges_owner_fk
        FOREIGN KEY (owner_id, owner_epoch) REFERENCES identity.owners(id, epoch),
      CONSTRAINT email_verification_challenges_idempotency_unique
        UNIQUE (purpose, idempotency_key_hash),
      CONSTRAINT email_verification_challenges_context_consistent CHECK (
        (
          purpose = 'claim_owner'
          AND owner_id IS NOT NULL
          AND owner_epoch IS NOT NULL
          AND account_id IS NULL
        )
        OR (
          purpose = 'sign_in'
          AND owner_id IS NULL
          AND owner_epoch IS NULL
          AND account_id IS NULL
        )
        OR (
          purpose = 'change_email'
          AND owner_id IS NULL
          AND owner_epoch IS NULL
          AND account_id IS NOT NULL
        )
      ),
      CONSTRAINT email_verification_challenges_attempt_limit CHECK (
        attempt_count <= max_attempts
      ),
      CONSTRAINT email_verification_challenges_state_consistent CHECK (
        (status IN ('pending', 'expired') AND consumed_at IS NULL AND locked_at IS NULL)
        OR (status = 'consumed' AND consumed_at IS NOT NULL AND locked_at IS NULL)
        OR (
          status = 'locked'
          AND consumed_at IS NULL
          AND locked_at IS NOT NULL
          AND attempt_count = max_attempts
        )
      ),
      CONSTRAINT email_verification_challenges_time_consistent CHECK (
        expires_at > created_at
        AND retry_after_at >= created_at
        AND updated_at >= created_at
      )
    );

    CREATE INDEX accounts_owner_updated_idx
      ON identity.accounts(owner_id, updated_at DESC, id DESC);
    CREATE INDEX email_verification_challenges_email_pending_idx
      ON identity.email_verification_challenges(email_lookup_hash, created_at DESC)
      WHERE status = 'pending';
    CREATE INDEX email_verification_challenges_expiry_idx
      ON identity.email_verification_challenges(expires_at, id)
      WHERE status = 'pending';

    CREATE FUNCTION identity.validate_account_managed_owner()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.retention_mode = 'account_managed' AND NOT EXISTS (
        SELECT 1
        FROM identity.accounts
        WHERE owner_id = NEW.id AND status = 'active'
      ) THEN
        RAISE EXCEPTION 'ACCOUNT_MANAGED_OWNER_REQUIRES_ACTIVE_ACCOUNT';
      END IF;
      IF NEW.status = 'active'
        AND NEW.retention_mode = 'anonymous_ttl'
        AND EXISTS (
          SELECT 1
          FROM identity.accounts
          WHERE owner_id = NEW.id AND status = 'active'
        ) THEN
        RAISE EXCEPTION 'ACTIVE_ACCOUNT_REQUIRES_ACCOUNT_MANAGED_OWNER';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER owners_account_managed_guard
      BEFORE INSERT OR UPDATE OF status, retention_mode, retention_expires_at
      ON identity.owners
      FOR EACH ROW EXECUTE FUNCTION identity.validate_account_managed_owner();

    CREATE FUNCTION identity.validate_active_account_owner()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.status = 'active' AND EXISTS (
        SELECT 1
        FROM identity.owners
        WHERE id = NEW.owner_id
          AND status = 'active'
          AND retention_mode <> 'account_managed'
      ) THEN
        RAISE EXCEPTION 'ACTIVE_ACCOUNT_REQUIRES_ACCOUNT_MANAGED_OWNER';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE CONSTRAINT TRIGGER accounts_active_owner_guard
      AFTER INSERT OR UPDATE ON identity.accounts
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION identity.validate_active_account_owner();

    CREATE FUNCTION identity.protect_account_owner_link()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      linked_owner_status text;
    BEGIN
      SELECT status INTO linked_owner_status
      FROM identity.owners
      WHERE id = OLD.owner_id;

      IF TG_OP = 'DELETE' THEN
        IF linked_owner_status NOT IN ('deletion_pending', 'deleted') THEN
          RAISE EXCEPTION 'ACTIVE_OWNER_ACCOUNT_CANNOT_BE_DELETED';
        END IF;
        RETURN OLD;
      END IF;

      IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
        RAISE EXCEPTION 'IMMUTABLE_ACCOUNT_OWNER';
      END IF;
      IF NEW.status <> 'active' AND linked_owner_status = 'active' THEN
        RAISE EXCEPTION 'ACTIVE_OWNER_REQUIRES_ACTIVE_ACCOUNT';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER accounts_owner_link_guard
      BEFORE UPDATE OR DELETE ON identity.accounts
      FOR EACH ROW EXECUTE FUNCTION identity.protect_account_owner_link();

    CREATE FUNCTION identity.protect_email_identity_material()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.account_id IS DISTINCT FROM OLD.account_id
        OR NEW.email_lookup_hash IS DISTINCT FROM OLD.email_lookup_hash
        OR NEW.email_ciphertext IS DISTINCT FROM OLD.email_ciphertext
        OR NEW.email_nonce IS DISTINCT FROM OLD.email_nonce
        OR NEW.email_auth_tag IS DISTINCT FROM OLD.email_auth_tag
        OR NEW.encryption_key_version IS DISTINCT FROM OLD.encryption_key_version
        OR NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
        RAISE EXCEPTION 'IMMUTABLE_EMAIL_IDENTITY_MATERIAL';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER email_identities_material_guard
      BEFORE UPDATE ON identity.email_identities
      FOR EACH ROW EXECUTE FUNCTION identity.protect_email_identity_material();

    CREATE FUNCTION identity.purge_account_identity_for_owner(
      target_owner_id uuid,
      requested_owner_epoch bigint
    )
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, identity
    AS $$
    DECLARE
      deleted_accounts integer;
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM identity.owners
        WHERE id = target_owner_id
          AND status = 'deletion_pending'
          AND epoch = requested_owner_epoch + 1
        FOR UPDATE
      ) THEN
        RAISE EXCEPTION 'OWNER_DELETION_EPOCH_MISMATCH';
      END IF;

      DELETE FROM identity.email_verification_challenges
      WHERE owner_id = target_owner_id;
      DELETE FROM identity.accounts WHERE owner_id = target_owner_id;
      GET DIAGNOSTICS deleted_accounts = ROW_COUNT;
      RETURN deleted_accounts;
    END;
    $$;

    REVOKE ALL ON FUNCTION identity.purge_account_identity_for_owner(uuid, bigint)
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION identity.purge_account_identity_for_owner(uuid, bigint)
      TO aijob_match_worker, aijob_ops_cli, aijob_migrator;
    GRANT UPDATE (retention_mode) ON TABLE identity.owners TO aijob_match_worker;

    REVOKE ALL ON TABLE
      identity.accounts,
      identity.email_identities,
      identity.email_verification_challenges
      FROM PUBLIC, aijob_collector_worker, aijob_match_worker;

    GRANT SELECT, INSERT, DELETE ON TABLE
      identity.accounts,
      identity.email_identities,
      identity.email_verification_challenges
      TO aijob_web_api;

    GRANT UPDATE (status, revision, updated_at, deleted_at)
      ON TABLE identity.accounts TO aijob_web_api;
    GRANT UPDATE (status, revoked_at, updated_at)
      ON TABLE identity.email_identities TO aijob_web_api;
    GRANT UPDATE (status, attempt_count, consumed_at, locked_at, updated_at)
      ON TABLE identity.email_verification_challenges TO aijob_web_api;

    GRANT ALL PRIVILEGES ON TABLE
      identity.accounts,
      identity.email_identities,
      identity.email_verification_challenges
      TO aijob_ops_cli, aijob_migrator;
    `.execute(db);
  },

  async down(_db: Kysely<Database>): Promise<void> {
    // Forward-only expand migration: identity and credential history must not be destroyed.
  },
};
