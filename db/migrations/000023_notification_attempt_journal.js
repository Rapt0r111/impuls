const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE impuls.notification_simulation_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      outbox_id uuid NOT NULL REFERENCES impuls.notification_simulations(outbox_id),
      attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 5),
      phase text NOT NULL CHECK (phase IN ('started','retry','simulated','failed','suppressed','lease_expired')),
      error_code text CHECK (error_code IN ('transport_unavailable','timeout','attempts_exhausted','recipient_inactive','unsupported_kind')),
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(outbox_id,attempt,phase),
      CHECK ((phase IN ('started','simulated','lease_expired')) = (error_code IS NULL)),
      CHECK ((phase IN ('started','simulated','lease_expired') AND error_code IS NULL)
        OR (phase='retry' AND error_code IN ('transport_unavailable','timeout'))
        OR (phase='failed' AND error_code IN ('transport_unavailable','timeout','attempts_exhausted'))
        OR (phase='suppressed' AND error_code IN ('recipient_inactive','unsupported_kind')))
    );
    CREATE INDEX notification_simulation_events_page ON impuls.notification_simulation_events(recorded_at DESC,id DESC);
    REVOKE ALL ON impuls.notification_simulation_events FROM PUBLIC,impuls_worker,impuls_app;
    ALTER TABLE impuls.notification_simulation_events ENABLE ROW LEVEL SECURITY;
    GRANT SELECT(id,outbox_id,attempt,phase,error_code,recorded_at)
      ON impuls.notification_simulation_events TO impuls_app;
    CREATE POLICY notification_simulation_events_app_read ON impuls.notification_simulation_events
      FOR SELECT TO impuls_app USING (true);

    CREATE FUNCTION impuls.keep_notification_simulation_event() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      RAISE EXCEPTION 'Keep notification attempt history' USING ERRCODE='23514';
    END $$;
    REVOKE ALL ON FUNCTION impuls.keep_notification_simulation_event() FROM PUBLIC;
    CREATE TRIGGER keep_notification_simulation_event BEFORE UPDATE OR DELETE ON impuls.notification_simulation_events
      FOR EACH ROW EXECUTE FUNCTION impuls.keep_notification_simulation_event();

    CREATE FUNCTION impuls.record_notification_simulation_transition() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    BEGIN
      -- No backfill and no inference from ready rows. Only observed transitions.
      IF OLD.status='processing' AND
        ((NEW.status='processing' AND NEW.attempts=OLD.attempts+1 AND NEW.lease_token IS DISTINCT FROM OLD.lease_token)
          OR (NEW.status='failed' AND NEW.error_code='attempts_exhausted')) THEN
        INSERT INTO impuls.notification_simulation_events(outbox_id,attempt,phase)
          VALUES(OLD.outbox_id,OLD.attempts,'lease_expired');
      END IF;
      IF NEW.status='processing' AND NEW.attempts=OLD.attempts+1 THEN
        INSERT INTO impuls.notification_simulation_events(outbox_id,attempt,phase)
          VALUES(NEW.outbox_id,NEW.attempts,'started');
      ELSIF OLD.status='processing' AND NEW.status IN ('retry','simulated','failed','suppressed') THEN
        INSERT INTO impuls.notification_simulation_events(outbox_id,attempt,phase,error_code)
          VALUES(NEW.outbox_id,NEW.attempts,NEW.status,NEW.error_code);
      END IF;
      RETURN NULL;
    END $$;
    REVOKE ALL ON FUNCTION impuls.record_notification_simulation_transition() FROM PUBLIC;
    CREATE TRIGGER record_notification_simulation_transition AFTER UPDATE ON impuls.notification_simulations
      FOR EACH ROW EXECUTE FUNCTION impuls.record_notification_simulation_transition();
  `);
};
const down = () => {
  throw new Error("Keep notification attempt history; use a forward migration");
};
module.exports = { up, down };
