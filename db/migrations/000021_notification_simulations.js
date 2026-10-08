const up = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='impuls_worker') THEN
        CREATE ROLE impuls_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      END IF;
    END $$;
    GRANT USAGE ON SCHEMA impuls TO impuls_worker;
    GRANT SELECT (id,recipient_id,kind,mode,status,created_at) ON impuls.notification_outbox TO impuls_worker;
    CREATE POLICY notification_outbox_worker_read ON impuls.notification_outbox
      FOR SELECT TO impuls_worker USING (mode='synthetic');
    CREATE TABLE impuls.notification_simulations (
      outbox_id uuid PRIMARY KEY REFERENCES impuls.notification_outbox(id),
      status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','processing','retry','simulated','failed','suppressed')),
      attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
      next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      lease_token uuid,
      lease_until timestamptz,
      error_code text CHECK(error_code IN ('transport_unavailable','recipient_inactive','unsupported_kind','attempts_exhausted','timeout')),
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK ((status='processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL AND attempts>0)
        OR (status<>'processing' AND lease_token IS NULL AND lease_until IS NULL)),
      CHECK ((status IN ('simulated','failed','suppressed'))=(completed_at IS NOT NULL))
    );
    CREATE INDEX notification_simulations_due ON impuls.notification_simulations(next_attempt_at,outbox_id)
      WHERE status IN ('ready','retry');
    CREATE INDEX notification_simulations_leased ON impuls.notification_simulations(lease_until)
      WHERE status='processing';
    REVOKE ALL ON impuls.notification_simulations FROM PUBLIC;
    GRANT SELECT,INSERT ON impuls.notification_simulations TO impuls_worker;
    GRANT UPDATE(status,attempts,next_attempt_at,lease_token,lease_until,error_code,completed_at,updated_at)
      ON impuls.notification_simulations TO impuls_worker;
    ALTER TABLE impuls.notification_simulations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY notification_simulations_worker ON impuls.notification_simulations
      FOR ALL TO impuls_worker USING (true) WITH CHECK (true);
    CREATE FUNCTION impuls.guard_notification_simulation() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF OLD.status IN ('simulated','failed','suppressed') OR
        ROW(NEW.outbox_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.outbox_id,OLD.created_at) THEN
        RAISE EXCEPTION 'Keep terminal simulation history' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_notification_simulation() FROM PUBLIC;
    CREATE TRIGGER guard_notification_simulation BEFORE UPDATE ON impuls.notification_simulations
      FOR EACH ROW EXECUTE FUNCTION impuls.guard_notification_simulation();

    -- Narrow definer boundary: lock/read access without granting worker UPDATE on users.
    -- The row lock is held until the caller's simulation transaction ends.
    CREATE FUNCTION impuls.lock_notification_recipient(subject uuid) RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    DECLARE allowed boolean;
    BEGIN
      SELECT active INTO allowed FROM impuls.users WHERE id=subject FOR SHARE;
      RETURN coalesce(allowed,false);
    END $$;
    REVOKE ALL ON FUNCTION impuls.lock_notification_recipient(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION impuls.lock_notification_recipient(uuid) TO impuls_worker;
  `);
};
const down = () => {
  throw new Error(
    "Keep notification simulation history; use a forward migration",
  );
};
module.exports = { up, down };
