const up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION impuls.read_synthetic_expiry_status()
      RETURNS TABLE(snapshot_at timestamptz,due bigint,scheduled bigint,untimed_pending bigint,
        automatic_expired bigint,oldest_due_at timestamptz,oldest_due_age_seconds bigint,last_automatic_expiry_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
      SELECT statement_timestamp(),
        count(*) FILTER (WHERE status='pending' AND expires_at<=statement_timestamp()),
        count(*) FILTER (WHERE status='pending' AND expires_at>statement_timestamp()),
        count(*) FILTER (WHERE status='pending' AND expires_at IS NULL),
        count(*) FILTER (WHERE status='expired' AND automatic_expiry),
        min(expires_at) FILTER (WHERE status='pending' AND expires_at<=statement_timestamp()),
        floor(extract(epoch FROM statement_timestamp()-
          min(expires_at) FILTER (WHERE status='pending' AND expires_at<=statement_timestamp())))::bigint,
        max(decided_at) FILTER (WHERE status='expired' AND automatic_expiry)
      FROM impuls.redemptions WHERE mode='synthetic'
    $$;
    -- ALTER OWNER needs SET on the new owner; managed Postgres (Supabase) gives the
    -- migration role no superuser rights. The grant is temporary and revoked below.
    GRANT impuls_expiry_executor TO CURRENT_USER WITH SET TRUE;
    GRANT CREATE ON SCHEMA impuls TO impuls_expiry_executor;
    ALTER FUNCTION impuls.read_synthetic_expiry_status() OWNER TO impuls_expiry_executor;
    REVOKE CREATE ON SCHEMA impuls FROM impuls_expiry_executor;
    REVOKE impuls_expiry_executor FROM CURRENT_USER;
    REVOKE ALL ON FUNCTION impuls.read_synthetic_expiry_status() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION impuls.read_synthetic_expiry_status() TO impuls_expiry_worker;
  `);
};
const down = (pgm) => {
  pgm.sql("DROP FUNCTION impuls.read_synthetic_expiry_status()");
};
module.exports = { up, down };
