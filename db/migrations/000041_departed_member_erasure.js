const up = (pgm) => {
  pgm.sql(`
    -- P-02 (owner decision 10.10.2026, ADR-0033): the only personal data kept about a member
    -- is the Telegram ID and the self-chosen name, and both are removed 90 days after the
    -- member leaves. The account row stays, because the ledger, reviews and journals keep
    -- referring to it; it loses everything that identifies a person.
    ALTER TABLE impuls.users ALTER COLUMN telegram_id DROP NOT NULL;
    ALTER TABLE impuls.users ADD COLUMN erased_at timestamptz;
    ALTER TABLE impuls.users ADD CONSTRAINT users_erasure_check CHECK (
      (erased_at IS NULL AND telegram_id IS NOT NULL) OR
      (erased_at IS NOT NULL AND telegram_id IS NULL AND NOT active
        AND display_name = 'Удалённый участник'));

    -- Evidence that an erasure happened, with no personal data in it.
    CREATE TABLE impuls.member_erasures (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL UNIQUE REFERENCES impuls.users(id),
      departed_at timestamptz NOT NULL,
      erased_at timestamptz NOT NULL,
      sessions_deleted integer NOT NULL CHECK (sessions_deleted >= 0),
      name_changes_deleted integer NOT NULL CHECK (name_changes_deleted >= 0),
      idempotency_records_deleted integer NOT NULL CHECK (idempotency_records_deleted >= 0),
      CHECK (erased_at >= departed_at + interval '90 days')
    );
    REVOKE ALL ON impuls.member_erasures FROM PUBLIC;
    ALTER TABLE impuls.member_erasures ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION impuls.keep_member_erasure() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      RAISE EXCEPTION 'Member erasure history is immutable' USING ERRCODE='23514';
    END $$;
    REVOKE ALL ON FUNCTION impuls.keep_member_erasure() FROM PUBLIC;
    CREATE TRIGGER keep_member_erasure BEFORE UPDATE OR DELETE ON impuls.member_erasures
      FOR EACH ROW EXECUTE FUNCTION impuls.keep_member_erasure();

    -- Name history stays immutable, except that it goes away with an erased account.
    CREATE OR REPLACE FUNCTION impuls.keep_profile_name_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND EXISTS (
        SELECT 1 FROM impuls.users WHERE id = OLD.user_id AND erased_at IS NOT NULL) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'Profile name history is immutable' USING ERRCODE='23514';
    END $$;

    -- A member has left when the account is switched off and every membership has ended,
    -- by removal or by its term. The departure is the moment the last membership ended.
    -- An account that never had a membership (the owner) or still holds an open-ended one
    -- is not a departure.
    CREATE FUNCTION impuls.member_departures() RETURNS TABLE(user_id uuid, departed_at timestamptz)
      LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
      SELECT u.id, max(LEAST(m.revoked_at, m.valid_until))
      FROM impuls.users u JOIN impuls.task_scope_members m ON m.user_id = u.id
      WHERE NOT u.active AND u.erased_at IS NULL
      GROUP BY u.id
      HAVING bool_and(m.revoked_at IS NOT NULL OR m.valid_until IS NOT NULL)
    $$;
    REVOKE ALL ON FUNCTION impuls.member_departures() FROM PUBLIC;

    -- Run by the database owner (scripts/erase-departed-members.mjs); the application has
    -- no access. Each account is locked and re-checked before it is erased, so a member
    -- admitted again at the same moment is either kept (admission won) or comes back as a
    -- new account (the erased row no longer matches the Telegram ID).
    CREATE FUNCTION impuls.erase_departed_members(p_limit integer DEFAULT 100)
      RETURNS TABLE(user_id uuid, departed_at timestamptz, erased_at timestamptz)
      LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    DECLARE
      candidate uuid;
      departed timestamptz;
      at timestamptz;
      sessions_n integer;
      names_n integer;
      replies_n integer;
    BEGIN
      IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
        RAISE EXCEPTION 'p_limit must be between 1 and 1000' USING ERRCODE='22023';
      END IF;
      FOR candidate IN
        SELECT d.user_id FROM impuls.member_departures() d
        WHERE d.departed_at <= clock_timestamp() - interval '90 days'
        ORDER BY d.departed_at, d.user_id LIMIT p_limit
      LOOP
        PERFORM 1 FROM impuls.users u WHERE u.id = candidate AND NOT u.active AND u.erased_at IS NULL
          FOR UPDATE SKIP LOCKED;
        CONTINUE WHEN NOT FOUND;
        SELECT d.departed_at INTO departed FROM impuls.member_departures() d WHERE d.user_id = candidate;
        CONTINUE WHEN departed IS NULL OR departed > clock_timestamp() - interval '90 days';
        at := clock_timestamp();
        UPDATE impuls.users SET telegram_id = NULL, display_name = 'Удалённый участник',
          erased_at = at, version = version + 1, updated_at = at
        WHERE id = candidate;
        DELETE FROM impuls.sessions s WHERE s.user_id = candidate;
        GET DIAGNOSTICS sessions_n = ROW_COUNT;
        DELETE FROM impuls.profile_name_changes p WHERE p.user_id = candidate;
        GET DIAGNOSTICS names_n = ROW_COUNT;
        -- Stored replies repeat the member's name (member and access administration).
        -- A replay this old has no use, so the reply goes rather than being rewritten.
        DELETE FROM impuls.idempotency_records r
        WHERE r.actor_id = candidate OR strpos(r.response_body::text, candidate::text) > 0;
        GET DIAGNOSTICS replies_n = ROW_COUNT;
        INSERT INTO impuls.member_erasures(user_id, departed_at, erased_at, sessions_deleted,
          name_changes_deleted, idempotency_records_deleted)
        VALUES (candidate, departed, at, sessions_n, names_n, replies_n);
        user_id := candidate;
        departed_at := departed;
        erased_at := at;
        RETURN NEXT;
      END LOOP;
    END $$;
    REVOKE ALL ON FUNCTION impuls.erase_departed_members(integer) FROM PUBLIC;
  `);
};
const down = () => {
  throw new Error("Erased data cannot be restored; use a forward migration");
};
module.exports = { up, down };
