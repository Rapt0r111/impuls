const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.redemptions DROP CONSTRAINT redemptions_status_check, DROP CONSTRAINT redemption_decision_check;
    ALTER TABLE impuls.redemptions ADD CONSTRAINT redemptions_status_check CHECK(status IN ('pending','cancelled','approved','rejected','fulfilled'));
    ALTER TABLE impuls.redemptions ADD CONSTRAINT redemption_decision_check CHECK (
      (status IN ('approved','rejected','fulfilled') AND decision_actor_id IS NOT NULL AND decision_actor_id<>user_id AND decision_reason IS NOT NULL AND decided_at IS NOT NULL) OR
      (status IN ('pending','cancelled') AND decision_actor_id IS NULL AND decision_reason IS NULL AND decided_at IS NULL));
    ALTER TABLE impuls.redemptions ADD COLUMN fulfillment_actor_id uuid REFERENCES impuls.users(id),
      ADD COLUMN fulfillment_reason text CHECK(char_length(btrim(fulfillment_reason)) BETWEEN 1 AND 2000),
      ADD COLUMN fulfilled_at timestamptz(3);
    ALTER TABLE impuls.redemptions ADD CONSTRAINT redemption_fulfillment_check CHECK (
      (status='fulfilled' AND fulfillment_actor_id IS NOT NULL AND fulfillment_actor_id<>user_id AND fulfillment_reason IS NOT NULL AND fulfilled_at IS NOT NULL AND fulfilled_at>=decided_at) OR
      (status<>'fulfilled' AND fulfillment_actor_id IS NULL AND fulfillment_reason IS NULL AND fulfilled_at IS NULL));
    DROP INDEX impuls.redemptions_pending_unique;
    CREATE UNIQUE INDEX redemptions_pending_unique ON impuls.redemptions(user_id,reward_id,scope_id) WHERE status IN ('pending','approved','fulfilled');
    CREATE INDEX redemptions_fulfillment_idx ON impuls.redemptions(scope_id,created_at DESC,id DESC) WHERE status='approved';
    CREATE OR REPLACE FUNCTION impuls.guard_redemption() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF TG_OP='INSERT' THEN
        IF NEW.status<>'pending' OR NEW.version<>1 OR NOT EXISTS (
          SELECT 1 FROM impuls.reward_versions r JOIN impuls.quota_periods q ON q.id=NEW.quota_period_id
          WHERE r.id=NEW.reward_version_id AND r.enabled AND r.kind='cosmetic' AND r.mode=NEW.mode
          AND ROW(NEW.reward_id,NEW.scope_id,NEW.reward_version,NEW.title,NEW.conditions,NEW.price)
          IS NOT DISTINCT FROM ROW(r.reward_id,r.scope_id,r.version,r.title,r.conditions,r.price)
          AND ROW(q.reward_id,q.scope_id,q.starts_at,q.ends_at)
          IS NOT DISTINCT FROM ROW(NEW.reward_id,NEW.scope_id,NEW.period_start,NEW.period_end))
        THEN RAISE EXCEPTION 'Invalid redemption snapshot' USING ERRCODE='23514'; END IF;
      ELSE
        IF NOT ((OLD.status='pending' AND NEW.status IN ('cancelled','approved','rejected')) OR
          (OLD.status='approved' AND NEW.status='fulfilled' AND
            ROW(NEW.decision_actor_id,NEW.decision_reason,NEW.decided_at,NEW.cancellation_reason)
            IS NOT DISTINCT FROM ROW(OLD.decision_actor_id,OLD.decision_reason,OLD.decided_at,OLD.cancellation_reason))) OR
          NEW.version<>OLD.version+1 OR
          ROW(NEW.id,NEW.user_id,NEW.reward_version_id,NEW.reward_id,NEW.scope_id,NEW.quota_period_id,NEW.reward_version,NEW.title,NEW.conditions,NEW.price,NEW.period_start,NEW.period_end,NEW.mode,NEW.created_at)
          IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.reward_version_id,OLD.reward_id,OLD.scope_id,OLD.quota_period_id,OLD.reward_version,OLD.title,OLD.conditions,OLD.price,OLD.period_start,OLD.period_end,OLD.mode,OLD.created_at)
        THEN RAISE EXCEPTION 'Invalid redemption transition' USING ERRCODE='23514'; END IF;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TABLE impuls.entitlements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      redemption_id uuid NOT NULL UNIQUE REFERENCES impuls.redemptions(id),
      user_id uuid NOT NULL REFERENCES impuls.users(id),
      reward_id uuid NOT NULL,
      scope_id uuid NOT NULL REFERENCES impuls.access_scopes(id),
      actor_id uuid NOT NULL REFERENCES impuls.users(id),
      reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 1 AND 2000),
      mode text NOT NULL CHECK(mode='synthetic'),
      created_at timestamptz(3) NOT NULL,
      UNIQUE(user_id,reward_id,scope_id),
      CHECK(actor_id<>user_id)
    );
    CREATE FUNCTION impuls.guard_entitlement() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Entitlements are immutable' USING ERRCODE='23514'; END IF;
      IF NOT EXISTS(SELECT 1 FROM impuls.redemptions d WHERE d.id=NEW.redemption_id AND d.status='fulfilled'
        AND ROW(d.user_id,d.reward_id,d.scope_id,d.fulfillment_actor_id,d.fulfillment_reason,d.mode,d.fulfilled_at)
        IS NOT DISTINCT FROM ROW(NEW.user_id,NEW.reward_id,NEW.scope_id,NEW.actor_id,NEW.reason,NEW.mode,NEW.created_at))
      THEN RAISE EXCEPTION 'Invalid entitlement source' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER entitlement_valid BEFORE INSERT OR UPDATE ON impuls.entitlements FOR EACH ROW EXECUTE FUNCTION impuls.guard_entitlement();
    CREATE FUNCTION impuls.check_fulfillment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF EXISTS(SELECT 1 FROM impuls.redemptions d WHERE d.id=NEW.id AND d.status='fulfilled' AND NOT EXISTS(
        SELECT 1 FROM impuls.entitlements e WHERE e.redemption_id=d.id AND
        ROW(e.user_id,e.reward_id,e.scope_id,e.actor_id,e.reason,e.mode,e.created_at)
        IS NOT DISTINCT FROM ROW(d.user_id,d.reward_id,d.scope_id,d.fulfillment_actor_id,d.fulfillment_reason,d.mode,d.fulfilled_at)))
      THEN RAISE EXCEPTION 'Missing fulfillment entitlement' USING ERRCODE='23514'; END IF;
      RETURN NULL;
    END $$;
    CREATE CONSTRAINT TRIGGER fulfillment_complete AFTER INSERT OR UPDATE ON impuls.redemptions
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION impuls.check_fulfillment();
    REVOKE ALL ON FUNCTION impuls.guard_entitlement(),impuls.check_fulfillment() FROM PUBLIC;
    REVOKE ALL ON impuls.entitlements FROM PUBLIC;
    GRANT SELECT,INSERT ON impuls.entitlements TO impuls_app;
    GRANT UPDATE(fulfillment_actor_id,fulfillment_reason,fulfilled_at) ON impuls.redemptions TO impuls_app;
    ALTER TABLE impuls.entitlements ENABLE ROW LEVEL SECURITY;
    CREATE POLICY entitlements_server_access ON impuls.entitlements FOR ALL TO impuls_app USING(true) WITH CHECK(true);
    ALTER TABLE impuls.audit_events DROP CONSTRAINT audit_events_action_check, DROP CONSTRAINT audit_events_object_check;
    ALTER TABLE impuls.audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN ('task.accept','task.return','task.create','task.assign','task.edit','task.cancel','ledger.correct','reward.reserve','reward.cancel','reward.approve','reward.reject','reward.fulfill'));
    ALTER TABLE impuls.audit_events ADD CONSTRAINT audit_events_object_check CHECK (
      (action IN ('task.accept','task.return') AND review_id IS NOT NULL AND task_id IS NULL AND correction_id IS NULL AND redemption_id IS NULL) OR
      (action IN ('task.create','task.assign','task.edit','task.cancel') AND review_id IS NULL AND task_id IS NOT NULL AND correction_id IS NULL AND redemption_id IS NULL) OR
      (action='ledger.correct' AND review_id IS NULL AND task_id IS NULL AND correction_id IS NOT NULL AND redemption_id IS NULL) OR
      (action IN ('reward.reserve','reward.cancel','reward.approve','reward.reject','reward.fulfill') AND review_id IS NULL AND task_id IS NULL AND correction_id IS NULL AND redemption_id IS NOT NULL));
    CREATE UNIQUE INDEX audit_redemption_fulfillment_unique ON impuls.audit_events(redemption_id) WHERE action='reward.fulfill';
    ALTER TABLE impuls.notification_outbox DROP CONSTRAINT notification_outbox_kind_check, DROP CONSTRAINT notification_outbox_object_check;
    ALTER TABLE impuls.notification_outbox ADD CONSTRAINT notification_outbox_kind_check CHECK(kind IN ('task.accepted','task.returned','task.assigned','ledger.corrected','reward.reserved','reward.cancelled','reward.approved','reward.rejected','reward.fulfilled'));
    ALTER TABLE impuls.notification_outbox ADD CONSTRAINT notification_outbox_object_check CHECK (
      (kind IN ('task.accepted','task.returned') AND review_id IS NOT NULL AND task_id IS NULL AND correction_id IS NULL AND redemption_id IS NULL) OR
      (kind='task.assigned' AND review_id IS NULL AND task_id IS NOT NULL AND correction_id IS NULL AND redemption_id IS NULL) OR
      (kind='ledger.corrected' AND review_id IS NULL AND task_id IS NULL AND correction_id IS NOT NULL AND redemption_id IS NULL) OR
      (kind IN ('reward.reserved','reward.cancelled','reward.approved','reward.rejected','reward.fulfilled') AND review_id IS NULL AND task_id IS NULL AND correction_id IS NULL AND redemption_id IS NOT NULL));
    CREATE UNIQUE INDEX outbox_redemption_fulfillment_unique ON impuls.notification_outbox(redemption_id) WHERE kind='reward.fulfilled';
  `);
};
const down = (pgm) => {
  pgm.sql(
    `DO $$ BEGIN RAISE EXCEPTION 'Keep fulfillment history; roll back the application with SYNTHETIC_REWARDS_ENABLED=false'; END $$;`,
  );
};
module.exports = { up, down };
