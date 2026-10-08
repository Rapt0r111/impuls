const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE impuls.ledger_corrections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      review_id uuid NOT NULL UNIQUE REFERENCES impuls.reviews(id),
      user_id uuid NOT NULL REFERENCES impuls.users(id),
      actor_id uuid NOT NULL REFERENCES impuls.users(id),
      reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
      xp_delta integer NOT NULL CHECK (xp_delta <= 0),
      points_delta integer NOT NULL CHECK (points_delta <= 0),
      mode text NOT NULL CHECK (mode = 'synthetic'),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz(3) NOT NULL,
      updated_at timestamptz(3) NOT NULL,
      CHECK (user_id <> actor_id)
    );
    REVOKE ALL ON impuls.ledger_corrections FROM PUBLIC;
    GRANT SELECT, INSERT ON impuls.ledger_corrections TO impuls_app;
    ALTER TABLE impuls.ledger_corrections ENABLE ROW LEVEL SECURITY;
    CREATE POLICY ledger_corrections_server_access ON impuls.ledger_corrections FOR ALL TO impuls_app USING (true) WITH CHECK (true);
    CREATE FUNCTION impuls.guard_correction_award() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM impuls.reviews r JOIN impuls.ledger_entries xp ON xp.review_id=r.id
        JOIN impuls.ledger_entries p ON p.review_id=r.id AND p.user_id=xp.user_id
        WHERE r.id=NEW.review_id AND r.decision='accept' AND xp.user_id=NEW.user_id
          AND xp.currency='xp' AND p.currency='points' AND xp.kind='task_acceptance' AND p.kind='task_acceptance'
          AND xp.mode=NEW.mode AND p.mode=NEW.mode AND NEW.xp_delta=-xp.amount AND NEW.points_delta=-p.amount
      ) THEN RAISE EXCEPTION 'Invalid correction award' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_correction_award() FROM PUBLIC;
    CREATE TRIGGER correction_award_valid BEFORE INSERT ON impuls.ledger_corrections FOR EACH ROW EXECUTE FUNCTION impuls.guard_correction_award();
    ALTER TABLE impuls.ledger_entries DROP CONSTRAINT ledger_entries_kind_check;
    ALTER TABLE impuls.ledger_entries DROP CONSTRAINT ledger_entries_amount_check;
    ALTER TABLE impuls.ledger_entries ADD COLUMN correction_id uuid REFERENCES impuls.ledger_corrections(id);
    ALTER TABLE impuls.ledger_entries ADD COLUMN original_entry_id uuid UNIQUE REFERENCES impuls.ledger_entries(id);
    ALTER TABLE impuls.ledger_entries ADD CONSTRAINT ledger_entries_kind_check CHECK (kind IN ('task_acceptance','acceptance_reversal'));
    ALTER TABLE impuls.ledger_entries ADD CONSTRAINT ledger_entries_amount_check CHECK (
      (kind='task_acceptance' AND amount >= 0 AND correction_id IS NULL AND original_entry_id IS NULL) OR
      (kind='acceptance_reversal' AND amount <= 0 AND correction_id IS NOT NULL AND original_entry_id IS NOT NULL));
    CREATE FUNCTION impuls.guard_ledger_reversal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF NEW.kind='acceptance_reversal' AND NOT EXISTS (
        SELECT 1 FROM impuls.ledger_entries original JOIN impuls.ledger_corrections c ON c.id=NEW.correction_id
        WHERE original.id=NEW.original_entry_id AND original.kind='task_acceptance'
          AND ROW(NEW.user_id,NEW.review_id,NEW.task_id,NEW.task_title,NEW.rule_set_id,NEW.rule_version,NEW.currency,NEW.mode,NEW.season_key,NEW.time_zone)
            IS NOT DISTINCT FROM ROW(original.user_id,original.review_id,original.task_id,original.task_title,original.rule_set_id,original.rule_version,original.currency,original.mode,original.season_key,original.time_zone)
          AND NEW.amount=-original.amount AND c.review_id=original.review_id AND c.user_id=original.user_id
          AND NEW.amount=CASE NEW.currency WHEN 'xp' THEN c.xp_delta ELSE c.points_delta END
      ) THEN RAISE EXCEPTION 'Invalid acceptance reversal' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_ledger_reversal() FROM PUBLIC;
    CREATE TRIGGER ledger_reversal_valid BEFORE INSERT ON impuls.ledger_entries FOR EACH ROW EXECUTE FUNCTION impuls.guard_ledger_reversal();
    ALTER TABLE impuls.audit_events ADD COLUMN correction_id uuid UNIQUE REFERENCES impuls.ledger_corrections(id);
    ALTER TABLE impuls.audit_events DROP CONSTRAINT audit_events_action_check;
    ALTER TABLE impuls.audit_events DROP CONSTRAINT audit_events_object_check;
    ALTER TABLE impuls.audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN ('task.accept','task.return','task.create','task.assign','task.edit','task.cancel','ledger.correct'));
    ALTER TABLE impuls.audit_events ADD CONSTRAINT audit_events_object_check CHECK (
      (action IN ('task.accept','task.return') AND review_id IS NOT NULL AND task_id IS NULL AND correction_id IS NULL) OR
      (action IN ('task.create','task.assign','task.edit','task.cancel') AND review_id IS NULL AND task_id IS NOT NULL AND correction_id IS NULL) OR
      (action='ledger.correct' AND review_id IS NULL AND task_id IS NULL AND correction_id IS NOT NULL));
    ALTER TABLE impuls.notification_outbox ADD COLUMN correction_id uuid UNIQUE REFERENCES impuls.ledger_corrections(id);
    ALTER TABLE impuls.notification_outbox DROP CONSTRAINT notification_outbox_kind_check;
    ALTER TABLE impuls.notification_outbox DROP CONSTRAINT notification_outbox_object_check;
    ALTER TABLE impuls.notification_outbox ADD CONSTRAINT notification_outbox_kind_check CHECK (kind IN ('task.accepted','task.returned','task.assigned','ledger.corrected'));
    ALTER TABLE impuls.notification_outbox ADD CONSTRAINT notification_outbox_object_check CHECK (
      (kind IN ('task.accepted','task.returned') AND review_id IS NOT NULL AND task_id IS NULL AND correction_id IS NULL) OR
      (kind='task.assigned' AND review_id IS NULL AND task_id IS NOT NULL AND correction_id IS NULL) OR
      (kind='ledger.corrected' AND review_id IS NULL AND task_id IS NULL AND correction_id IS NOT NULL));
  `);
};
const down = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM impuls.ledger_corrections) THEN
        RAISE EXCEPTION 'Correction history exists; keep schema and roll back the application';
      END IF;
    END $$;
    ALTER TABLE impuls.notification_outbox DROP CONSTRAINT notification_outbox_object_check;
    ALTER TABLE impuls.notification_outbox DROP CONSTRAINT notification_outbox_kind_check;
    ALTER TABLE impuls.notification_outbox DROP COLUMN correction_id;
    ALTER TABLE impuls.notification_outbox ADD CONSTRAINT notification_outbox_kind_check CHECK (kind IN ('task.accepted','task.returned','task.assigned'));
    ALTER TABLE impuls.notification_outbox ADD CONSTRAINT notification_outbox_object_check CHECK (
      (kind IN ('task.accepted','task.returned') AND review_id IS NOT NULL AND task_id IS NULL) OR (kind='task.assigned' AND review_id IS NULL AND task_id IS NOT NULL));
    ALTER TABLE impuls.audit_events DROP CONSTRAINT audit_events_object_check;
    ALTER TABLE impuls.audit_events DROP CONSTRAINT audit_events_action_check;
    ALTER TABLE impuls.audit_events DROP COLUMN correction_id;
    ALTER TABLE impuls.audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN ('task.accept','task.return','task.create','task.assign','task.edit','task.cancel'));
    ALTER TABLE impuls.audit_events ADD CONSTRAINT audit_events_object_check CHECK (
      (action IN ('task.accept','task.return') AND review_id IS NOT NULL AND task_id IS NULL) OR (action IN ('task.create','task.assign','task.edit','task.cancel') AND review_id IS NULL AND task_id IS NOT NULL));
    DROP TRIGGER ledger_reversal_valid ON impuls.ledger_entries;
    DROP FUNCTION impuls.guard_ledger_reversal();
    ALTER TABLE impuls.ledger_entries DROP CONSTRAINT ledger_entries_amount_check;
    ALTER TABLE impuls.ledger_entries DROP CONSTRAINT ledger_entries_kind_check;
    ALTER TABLE impuls.ledger_entries DROP COLUMN correction_id, DROP COLUMN original_entry_id;
    ALTER TABLE impuls.ledger_entries ADD CONSTRAINT ledger_entries_kind_check CHECK (kind='task_acceptance');
    ALTER TABLE impuls.ledger_entries ADD CONSTRAINT ledger_entries_amount_check CHECK (amount >= 0);
    DROP TRIGGER correction_award_valid ON impuls.ledger_corrections;
    DROP FUNCTION impuls.guard_correction_award();
    DROP TABLE impuls.ledger_corrections;
  `);
};
module.exports = { up, down };
