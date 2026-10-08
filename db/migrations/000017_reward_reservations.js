const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE impuls.reward_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reward_id uuid NOT NULL,
      scope_id uuid NOT NULL REFERENCES impuls.access_scopes(id),
      version integer NOT NULL CHECK (version > 0),
      title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
      conditions text NOT NULL CHECK (char_length(btrim(conditions)) BETWEEN 1 AND 2000),
      price integer NOT NULL CHECK (price BETWEEN 1 AND 1000000),
      kind text NOT NULL CHECK (kind='cosmetic'),
      mode text NOT NULL CHECK (mode='synthetic'),
      enabled boolean NOT NULL DEFAULT false,
      effective_from timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(reward_id,scope_id,version)
    );
    CREATE INDEX reward_versions_scope_idx ON impuls.reward_versions(scope_id,reward_id,effective_from DESC,version DESC);
    CREATE TABLE impuls.quota_periods (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reward_id uuid NOT NULL,
      scope_id uuid NOT NULL REFERENCES impuls.access_scopes(id),
      starts_at timestamptz(3) NOT NULL,
      ends_at timestamptz(3) NOT NULL CHECK (ends_at > starts_at),
      capacity integer NOT NULL CHECK (capacity BETWEEN 0 AND 1000000),
      reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
      used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (reserved+used <= capacity),
      UNIQUE(reward_id,scope_id,starts_at)
    );
    CREATE FUNCTION impuls.guard_quota_period() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF TG_OP='UPDATE' THEN
        IF ROW(NEW.id,NEW.reward_id,NEW.scope_id,NEW.starts_at,NEW.ends_at,NEW.capacity,NEW.created_at)
          IS DISTINCT FROM ROW(OLD.id,OLD.reward_id,OLD.scope_id,OLD.starts_at,OLD.ends_at,OLD.capacity,OLD.created_at)
        THEN RAISE EXCEPTION 'Quota terms are immutable' USING ERRCODE='23514'; END IF;
      ELSE
        PERFORM pg_advisory_xact_lock(hashtextextended(NEW.reward_id::text||NEW.scope_id::text,0));
        IF EXISTS(SELECT 1 FROM impuls.quota_periods q WHERE q.reward_id=NEW.reward_id AND q.scope_id=NEW.scope_id
          AND q.starts_at<NEW.ends_at AND q.ends_at>NEW.starts_at)
        THEN RAISE EXCEPTION 'Overlapping quota periods' USING ERRCODE='23514'; END IF;
      END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_quota_period() FROM PUBLIC;
    CREATE TRIGGER quota_period_valid BEFORE INSERT OR UPDATE ON impuls.quota_periods FOR EACH ROW EXECUTE FUNCTION impuls.guard_quota_period();
    CREATE TABLE impuls.redemptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES impuls.users(id),
      reward_version_id uuid NOT NULL REFERENCES impuls.reward_versions(id),
      reward_id uuid NOT NULL,
      scope_id uuid NOT NULL REFERENCES impuls.access_scopes(id),
      quota_period_id uuid NOT NULL REFERENCES impuls.quota_periods(id),
      reward_version integer NOT NULL CHECK (reward_version > 0),
      title text NOT NULL,
      conditions text NOT NULL,
      price integer NOT NULL CHECK (price > 0),
      period_start timestamptz(3) NOT NULL,
      period_end timestamptz(3) NOT NULL,
      mode text NOT NULL CHECK (mode='synthetic'),
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cancelled')),
      cancellation_reason text CHECK (char_length(btrim(cancellation_reason)) BETWEEN 1 AND 2000),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz(3) NOT NULL,
      updated_at timestamptz(3) NOT NULL,
      CHECK ((status='cancelled') = (cancellation_reason IS NOT NULL))
    );
    CREATE UNIQUE INDEX redemptions_pending_unique ON impuls.redemptions(user_id,reward_id,scope_id) WHERE status='pending';
    CREATE INDEX redemptions_user_time_idx ON impuls.redemptions(user_id,created_at DESC,id DESC);
    CREATE FUNCTION impuls.guard_redemption() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF TG_OP='INSERT' THEN
        IF NEW.status<>'pending' OR NEW.version<>1 OR NOT EXISTS (
          SELECT 1 FROM impuls.reward_versions r JOIN impuls.quota_periods q ON q.id=NEW.quota_period_id
          WHERE r.id=NEW.reward_version_id AND r.enabled AND r.kind='cosmetic' AND r.mode=NEW.mode
          AND ROW(NEW.reward_id,NEW.scope_id,NEW.reward_version,NEW.title,NEW.conditions,NEW.price)
          IS NOT DISTINCT FROM ROW(r.reward_id,r.scope_id,r.version,r.title,r.conditions,r.price)
          AND ROW(q.reward_id,q.scope_id,q.starts_at,q.ends_at)
          IS NOT DISTINCT FROM ROW(NEW.reward_id,NEW.scope_id,NEW.period_start,NEW.period_end)
        ) THEN RAISE EXCEPTION 'Invalid redemption snapshot' USING ERRCODE='23514'; END IF;
      ELSE
        IF OLD.status<>'pending' OR NEW.status<>'cancelled' OR NEW.version<>OLD.version+1 OR
          ROW(NEW.id,NEW.user_id,NEW.reward_version_id,NEW.reward_id,NEW.scope_id,NEW.quota_period_id,NEW.reward_version,NEW.title,NEW.conditions,NEW.price,NEW.period_start,NEW.period_end,NEW.mode,NEW.created_at)
          IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.reward_version_id,OLD.reward_id,OLD.scope_id,OLD.quota_period_id,OLD.reward_version,OLD.title,OLD.conditions,OLD.price,OLD.period_start,OLD.period_end,OLD.mode,OLD.created_at)
        THEN RAISE EXCEPTION 'Invalid redemption transition' USING ERRCODE='23514'; END IF;
      END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_redemption() FROM PUBLIC;
    CREATE TRIGGER redemption_valid BEFORE INSERT OR UPDATE ON impuls.redemptions FOR EACH ROW EXECUTE FUNCTION impuls.guard_redemption();
    CREATE FUNCTION impuls.guard_reward_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN RAISE EXCEPTION 'Reward versions are immutable' USING ERRCODE='23514'; END $$;
    REVOKE ALL ON FUNCTION impuls.guard_reward_version() FROM PUBLIC;
    CREATE TRIGGER reward_version_immutable BEFORE UPDATE ON impuls.reward_versions FOR EACH ROW EXECUTE FUNCTION impuls.guard_reward_version();
    REVOKE ALL ON impuls.reward_versions,impuls.quota_periods,impuls.redemptions FROM PUBLIC;
    GRANT SELECT ON impuls.reward_versions,impuls.quota_periods,impuls.redemptions TO impuls_app;
    GRANT INSERT ON impuls.redemptions TO impuls_app;
    GRANT UPDATE(reserved,used,version,updated_at) ON impuls.quota_periods TO impuls_app;
    GRANT UPDATE(status,cancellation_reason,version,updated_at) ON impuls.redemptions TO impuls_app;
    ALTER TABLE impuls.reward_versions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.quota_periods ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.redemptions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY reward_versions_server_access ON impuls.reward_versions FOR SELECT TO impuls_app USING(true);
    CREATE POLICY quota_periods_server_access ON impuls.quota_periods FOR ALL TO impuls_app USING(true) WITH CHECK(true);
    CREATE POLICY redemptions_server_access ON impuls.redemptions FOR ALL TO impuls_app USING(true) WITH CHECK(true);

    ALTER TABLE impuls.ledger_entries ALTER COLUMN review_id DROP NOT NULL, ALTER COLUMN task_id DROP NOT NULL,
      ALTER COLUMN task_title DROP NOT NULL, ALTER COLUMN rule_set_id DROP NOT NULL, ALTER COLUMN rule_version DROP NOT NULL;
    ALTER TABLE impuls.ledger_entries ADD COLUMN redemption_id uuid REFERENCES impuls.redemptions(id);
    ALTER TABLE impuls.ledger_entries ADD COLUMN reserved_delta integer NOT NULL DEFAULT 0;
    ALTER TABLE impuls.ledger_entries DROP CONSTRAINT ledger_entries_kind_check, DROP CONSTRAINT ledger_entries_amount_check;
    ALTER TABLE impuls.ledger_entries ADD CONSTRAINT ledger_entries_kind_check CHECK (kind IN ('task_acceptance','acceptance_reversal','reward_reservation','reward_cancellation'));
    ALTER TABLE impuls.ledger_entries ADD CONSTRAINT ledger_entries_amount_check CHECK (
      (kind='task_acceptance' AND amount>=0 AND correction_id IS NULL AND original_entry_id IS NULL AND redemption_id IS NULL AND reserved_delta=0) OR
      (kind='acceptance_reversal' AND amount<=0 AND correction_id IS NOT NULL AND original_entry_id IS NOT NULL AND redemption_id IS NULL AND reserved_delta=0) OR
      (kind='reward_reservation' AND amount<0 AND reserved_delta=-amount AND currency='points' AND redemption_id IS NOT NULL AND correction_id IS NULL AND original_entry_id IS NULL) OR
      (kind='reward_cancellation' AND amount>0 AND reserved_delta=-amount AND currency='points' AND redemption_id IS NOT NULL AND correction_id IS NULL AND original_entry_id IS NOT NULL));
    ALTER TABLE impuls.ledger_entries ADD CONSTRAINT ledger_entries_source_check CHECK (
      (redemption_id IS NULL AND review_id IS NOT NULL AND task_id IS NOT NULL AND task_title IS NOT NULL AND rule_set_id IS NOT NULL AND rule_version IS NOT NULL) OR
      (redemption_id IS NOT NULL AND review_id IS NULL AND task_id IS NULL AND task_title IS NULL AND rule_set_id IS NULL AND rule_version IS NULL));
    CREATE UNIQUE INDEX ledger_redemption_event_unique ON impuls.ledger_entries(redemption_id,kind) WHERE redemption_id IS NOT NULL;
    CREATE FUNCTION impuls.guard_reservation_entry() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF NEW.redemption_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM impuls.redemptions d WHERE d.id=NEW.redemption_id AND d.user_id=NEW.user_id AND d.mode=NEW.mode AND (
          (NEW.kind='reward_reservation' AND NEW.amount=-d.price AND d.status='pending') OR
          (NEW.kind='reward_cancellation' AND NEW.amount=d.price AND d.status='cancelled' AND EXISTS(
            SELECT 1 FROM impuls.ledger_entries l WHERE l.id=NEW.original_entry_id AND l.redemption_id=d.id AND l.kind='reward_reservation'
            AND l.user_id=NEW.user_id AND l.amount=-NEW.amount AND l.season_key=NEW.season_key AND l.time_zone=NEW.time_zone))))
      THEN RAISE EXCEPTION 'Invalid reservation ledger entry' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_reservation_entry() FROM PUBLIC;
    CREATE TRIGGER reservation_entry_valid BEFORE INSERT ON impuls.ledger_entries FOR EACH ROW EXECUTE FUNCTION impuls.guard_reservation_entry();
    ALTER TABLE impuls.audit_events ADD COLUMN redemption_id uuid REFERENCES impuls.redemptions(id);
    ALTER TABLE impuls.audit_events DROP CONSTRAINT audit_events_action_check, DROP CONSTRAINT audit_events_object_check;
    ALTER TABLE impuls.audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN ('task.accept','task.return','task.create','task.assign','task.edit','task.cancel','ledger.correct','reward.reserve','reward.cancel'));
    ALTER TABLE impuls.audit_events ADD CONSTRAINT audit_events_object_check CHECK (
      (action IN ('task.accept','task.return') AND review_id IS NOT NULL AND task_id IS NULL AND correction_id IS NULL AND redemption_id IS NULL) OR
      (action IN ('task.create','task.assign','task.edit','task.cancel') AND review_id IS NULL AND task_id IS NOT NULL AND correction_id IS NULL AND redemption_id IS NULL) OR
      (action='ledger.correct' AND review_id IS NULL AND task_id IS NULL AND correction_id IS NOT NULL AND redemption_id IS NULL) OR
      (action IN ('reward.reserve','reward.cancel') AND review_id IS NULL AND task_id IS NULL AND correction_id IS NULL AND redemption_id IS NOT NULL));
    CREATE UNIQUE INDEX audit_redemption_event_unique ON impuls.audit_events(redemption_id,action) WHERE redemption_id IS NOT NULL;
    ALTER TABLE impuls.notification_outbox ADD COLUMN redemption_id uuid REFERENCES impuls.redemptions(id);
    ALTER TABLE impuls.notification_outbox DROP CONSTRAINT notification_outbox_kind_check, DROP CONSTRAINT notification_outbox_object_check;
    ALTER TABLE impuls.notification_outbox ADD CONSTRAINT notification_outbox_kind_check CHECK (kind IN ('task.accepted','task.returned','task.assigned','ledger.corrected','reward.reserved','reward.cancelled'));
    ALTER TABLE impuls.notification_outbox ADD CONSTRAINT notification_outbox_object_check CHECK (
      (kind IN ('task.accepted','task.returned') AND review_id IS NOT NULL AND task_id IS NULL AND correction_id IS NULL AND redemption_id IS NULL) OR
      (kind='task.assigned' AND review_id IS NULL AND task_id IS NOT NULL AND correction_id IS NULL AND redemption_id IS NULL) OR
      (kind='ledger.corrected' AND review_id IS NULL AND task_id IS NULL AND correction_id IS NOT NULL AND redemption_id IS NULL) OR
      (kind IN ('reward.reserved','reward.cancelled') AND review_id IS NULL AND task_id IS NULL AND correction_id IS NULL AND redemption_id IS NOT NULL));
    CREATE UNIQUE INDEX outbox_redemption_event_unique ON impuls.notification_outbox(redemption_id,kind) WHERE redemption_id IS NOT NULL;
  `);
};
const down = (pgm) => {
  // Financial history must survive application rollback; no destructive down.
  pgm.sql(
    `DO $$ BEGIN RAISE EXCEPTION 'Keep reservation schema; roll back the application with SYNTHETIC_REWARDS_ENABLED=false'; END $$;`,
  );
};
module.exports = { up, down };
