const up = (pgm) => {
  pgm.sql(`
    -- Real Bot API delivery reuses the leased queue and its immutable attempt journal.
    -- New states are additive: existing rows already satisfy every widened check.
    ALTER TABLE impuls.notification_simulations
      DROP CONSTRAINT notification_simulations_status_check,
      DROP CONSTRAINT notification_simulations_error_code_check,
      DROP CONSTRAINT notification_simulations_check1;
    ALTER TABLE impuls.notification_simulations
      ADD CONSTRAINT notification_simulations_status_check
        CHECK (status IN ('ready','processing','retry','simulated','delivered','failed','suppressed')),
      ADD CONSTRAINT notification_simulations_error_code_check
        CHECK (error_code IN ('transport_unavailable','recipient_inactive','unsupported_kind',
          'attempts_exhausted','timeout','rate_limited','recipient_unreachable')),
      ADD CONSTRAINT notification_simulations_check1
        CHECK ((status IN ('simulated','delivered','failed','suppressed'))=(completed_at IS NOT NULL));

    ALTER TABLE impuls.notification_simulation_events
      DROP CONSTRAINT notification_simulation_events_phase_check,
      DROP CONSTRAINT notification_simulation_events_error_code_check,
      DROP CONSTRAINT notification_simulation_events_check,
      DROP CONSTRAINT notification_simulation_events_check1;
    ALTER TABLE impuls.notification_simulation_events
      ADD CONSTRAINT notification_simulation_events_phase_check
        CHECK (phase IN ('started','retry','simulated','delivered','failed','suppressed','lease_expired')),
      ADD CONSTRAINT notification_simulation_events_error_code_check
        CHECK (error_code IN ('transport_unavailable','timeout','attempts_exhausted','recipient_inactive',
          'unsupported_kind','rate_limited','recipient_unreachable')),
      ADD CONSTRAINT notification_simulation_events_check
        CHECK ((phase IN ('started','simulated','delivered','lease_expired')) = (error_code IS NULL)),
      ADD CONSTRAINT notification_simulation_events_check1
        CHECK ((phase IN ('started','simulated','delivered','lease_expired') AND error_code IS NULL)
          OR (phase='retry' AND error_code IN ('transport_unavailable','timeout','rate_limited'))
          OR (phase='failed' AND error_code IN ('transport_unavailable','timeout','attempts_exhausted','rate_limited'))
          OR (phase='suppressed' AND error_code IN ('recipient_inactive','unsupported_kind','recipient_unreachable')));

    CREATE OR REPLACE FUNCTION impuls.guard_notification_simulation() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF OLD.status IN ('simulated','delivered','failed','suppressed') OR
        ROW(NEW.outbox_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.outbox_id,OLD.created_at) THEN
        RAISE EXCEPTION 'Keep terminal simulation history' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;

    CREATE OR REPLACE FUNCTION impuls.record_notification_simulation_transition() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    BEGIN
      IF OLD.status='processing' AND
        ((NEW.status='processing' AND NEW.attempts=OLD.attempts+1 AND NEW.lease_token IS DISTINCT FROM OLD.lease_token)
          OR (NEW.status='failed' AND NEW.error_code='attempts_exhausted')) THEN
        INSERT INTO impuls.notification_simulation_events(outbox_id,attempt,phase)
          VALUES(OLD.outbox_id,OLD.attempts,'lease_expired');
      END IF;
      IF NEW.status='processing' AND NEW.attempts=OLD.attempts+1 THEN
        INSERT INTO impuls.notification_simulation_events(outbox_id,attempt,phase)
          VALUES(NEW.outbox_id,NEW.attempts,'started');
      ELSIF OLD.status='processing' AND NEW.status IN ('retry','simulated','delivered','failed','suppressed') THEN
        INSERT INTO impuls.notification_simulation_events(outbox_id,attempt,phase,error_code)
          VALUES(NEW.outbox_id,NEW.attempts,NEW.status,NEW.error_code);
      END IF;
      RETURN NULL;
    END $$;

    -- The only path from the worker role to a Telegram ID: active recipients, one value,
    -- row share lock held until the caller's delivery transaction ends (serialises with revocation).
    CREATE FUNCTION impuls.lock_notification_recipient_chat(subject uuid) RETURNS bigint
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    DECLARE chat bigint; allowed boolean;
    BEGIN
      SELECT telegram_id, active INTO chat, allowed FROM impuls.users WHERE id=subject FOR SHARE;
      RETURN CASE WHEN allowed THEN chat END;
    END $$;
    REVOKE ALL ON FUNCTION impuls.lock_notification_recipient_chat(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION impuls.lock_notification_recipient_chat(uuid) TO impuls_worker;
  `);
};
const down = () => {
  throw new Error(
    "Keep notification delivery history; use a forward migration",
  );
};
module.exports = { up, down };
