const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.reward_versions ADD COLUMN reservation_seconds integer CHECK(reservation_seconds>0);
    ALTER TABLE impuls.redemptions ADD COLUMN expires_at timestamptz(3) CHECK(expires_at>created_at);
    ALTER TABLE impuls.redemptions DROP CONSTRAINT redemptions_status_check, DROP CONSTRAINT redemption_decision_check;
    ALTER TABLE impuls.redemptions ADD CONSTRAINT redemptions_status_check CHECK(status IN ('pending','cancelled','approved','rejected','fulfilled','expired'));
    ALTER TABLE impuls.redemptions ADD CONSTRAINT redemption_decision_check CHECK (
      (status IN ('approved','rejected','fulfilled','expired') AND decision_actor_id IS NOT NULL AND decision_actor_id<>user_id AND decision_reason IS NOT NULL AND decided_at IS NOT NULL) OR
      (status IN ('pending','cancelled') AND decision_actor_id IS NULL AND decision_reason IS NULL AND decided_at IS NULL));
    CREATE OR REPLACE FUNCTION impuls.guard_redemption() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF TG_OP='INSERT' THEN
        IF NEW.status<>'pending' OR NEW.version<>1 OR NOT EXISTS (
          SELECT 1 FROM impuls.reward_versions r JOIN impuls.quota_periods q ON q.id=NEW.quota_period_id
          WHERE r.id=NEW.reward_version_id AND r.enabled AND r.kind='cosmetic' AND r.mode=NEW.mode
          AND ROW(NEW.reward_id,NEW.scope_id,NEW.reward_version,NEW.title,NEW.conditions,NEW.price,NEW.expires_at)
          IS NOT DISTINCT FROM ROW(r.reward_id,r.scope_id,r.version,r.title,r.conditions,r.price,CASE WHEN r.reservation_seconds IS NULL THEN NULL ELSE NEW.created_at+r.reservation_seconds*interval '1 second' END)
          AND ROW(q.reward_id,q.scope_id,q.starts_at,q.ends_at)
          IS NOT DISTINCT FROM ROW(NEW.reward_id,NEW.scope_id,NEW.period_start,NEW.period_end))
        THEN RAISE EXCEPTION 'Invalid redemption snapshot' USING ERRCODE='23514'; END IF;
      ELSE
        IF NOT ((OLD.status='pending' AND NEW.status IN ('cancelled','approved','rejected','expired')) OR
          (OLD.status='approved' AND NEW.status='fulfilled' AND
            ROW(NEW.decision_actor_id,NEW.decision_reason,NEW.decided_at,NEW.cancellation_reason)
            IS NOT DISTINCT FROM ROW(OLD.decision_actor_id,OLD.decision_reason,OLD.decided_at,OLD.cancellation_reason))) OR
          NEW.version<>OLD.version+1 OR
          ROW(NEW.id,NEW.user_id,NEW.reward_version_id,NEW.reward_id,NEW.scope_id,NEW.quota_period_id,NEW.reward_version,NEW.title,NEW.conditions,NEW.price,NEW.period_start,NEW.period_end,NEW.mode,NEW.created_at,NEW.expires_at)
          IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.reward_version_id,OLD.reward_id,OLD.scope_id,OLD.quota_period_id,OLD.reward_version,OLD.title,OLD.conditions,OLD.price,OLD.period_start,OLD.period_end,OLD.mode,OLD.created_at,OLD.expires_at)
        THEN RAISE EXCEPTION 'Invalid redemption transition' USING ERRCODE='23514'; END IF;
      END IF;
      IF NEW.status='expired' AND (NEW.expires_at IS NULL OR NEW.decided_at<NEW.expires_at OR clock_timestamp()<NEW.expires_at) THEN
        RAISE EXCEPTION 'Reservation is not due' USING ERRCODE='23514';
      END IF;
      IF NEW.status='approved' AND (NEW.expires_at IS NOT NULL AND (NEW.decided_at>=NEW.expires_at OR clock_timestamp()>=NEW.expires_at)) THEN
        RAISE EXCEPTION 'Reservation has expired' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
    ALTER TABLE impuls.ledger_entries DROP CONSTRAINT ledger_entries_kind_check, DROP CONSTRAINT ledger_entries_amount_check;
    ALTER TABLE impuls.ledger_entries ADD CONSTRAINT ledger_entries_kind_check CHECK(kind IN ('task_acceptance','acceptance_reversal','reward_reservation','reward_cancellation','reward_approval','reward_rejection','reward_expiration'));
    ALTER TABLE impuls.ledger_entries ADD CONSTRAINT ledger_entries_amount_check CHECK (
      (kind='task_acceptance' AND amount>=0 AND correction_id IS NULL AND original_entry_id IS NULL AND redemption_id IS NULL AND reserved_delta=0) OR
      (kind='acceptance_reversal' AND amount<=0 AND correction_id IS NOT NULL AND original_entry_id IS NOT NULL AND redemption_id IS NULL AND reserved_delta=0) OR
      (kind='reward_reservation' AND amount<0 AND reserved_delta=-amount AND currency='points' AND redemption_id IS NOT NULL AND correction_id IS NULL AND original_entry_id IS NULL) OR
      (kind IN ('reward_cancellation','reward_rejection','reward_expiration') AND amount>0 AND reserved_delta=-amount AND currency='points' AND redemption_id IS NOT NULL AND correction_id IS NULL AND original_entry_id IS NOT NULL) OR
      (kind='reward_approval' AND amount=0 AND reserved_delta<0 AND currency='points' AND redemption_id IS NOT NULL AND correction_id IS NULL AND original_entry_id IS NOT NULL));
    DROP INDEX impuls.ledger_redemption_resolution_unique;
    CREATE UNIQUE INDEX ledger_redemption_resolution_unique ON impuls.ledger_entries(redemption_id) WHERE kind IN ('reward_cancellation','reward_rejection','reward_expiration','reward_approval');
    CREATE OR REPLACE FUNCTION impuls.guard_reservation_entry() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF NEW.redemption_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM impuls.redemptions d WHERE d.id=NEW.redemption_id AND d.user_id=NEW.user_id AND d.mode=NEW.mode AND (
          (NEW.kind='reward_reservation' AND NEW.amount=-d.price AND d.status='pending') OR
          (NEW.kind IN ('reward_cancellation','reward_rejection','reward_expiration','reward_approval') AND NEW.reserved_delta=-d.price
            AND ((NEW.kind='reward_cancellation' AND d.status='cancelled' AND NEW.amount=d.price) OR
                 (NEW.kind='reward_rejection' AND d.status='rejected' AND NEW.amount=d.price) OR
                 (NEW.kind='reward_expiration' AND d.status='expired' AND NEW.amount=d.price) OR
                 (NEW.kind='reward_approval' AND d.status='approved' AND NEW.amount=0))
            AND EXISTS(SELECT 1 FROM impuls.ledger_entries l WHERE l.id=NEW.original_entry_id AND l.redemption_id=d.id
              AND l.kind='reward_reservation' AND l.user_id=NEW.user_id AND l.amount=-d.price AND l.season_key=NEW.season_key AND l.time_zone=NEW.time_zone))))
      THEN RAISE EXCEPTION 'Invalid reservation ledger entry' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    ALTER TABLE impuls.audit_events DROP CONSTRAINT audit_events_action_check, DROP CONSTRAINT audit_events_object_check;
    ALTER TABLE impuls.audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN ('task.accept','task.return','task.create','task.assign','task.edit','task.cancel','ledger.correct','reward.reserve','reward.cancel','reward.approve','reward.reject','reward.fulfill','reward.expire'));
    ALTER TABLE impuls.audit_events ADD CONSTRAINT audit_events_object_check CHECK (
      (action IN ('task.accept','task.return') AND review_id IS NOT NULL AND task_id IS NULL AND correction_id IS NULL AND redemption_id IS NULL) OR
      (action IN ('task.create','task.assign','task.edit','task.cancel') AND review_id IS NULL AND task_id IS NOT NULL AND correction_id IS NULL AND redemption_id IS NULL) OR
      (action='ledger.correct' AND review_id IS NULL AND task_id IS NULL AND correction_id IS NOT NULL AND redemption_id IS NULL) OR
      (action IN ('reward.reserve','reward.cancel','reward.approve','reward.reject','reward.fulfill','reward.expire') AND review_id IS NULL AND task_id IS NULL AND correction_id IS NULL AND redemption_id IS NOT NULL));
    CREATE UNIQUE INDEX audit_redemption_expiration_unique ON impuls.audit_events(redemption_id) WHERE action='reward.expire';
    ALTER TABLE impuls.notification_outbox DROP CONSTRAINT notification_outbox_kind_check, DROP CONSTRAINT notification_outbox_object_check;
    ALTER TABLE impuls.notification_outbox ADD CONSTRAINT notification_outbox_kind_check CHECK(kind IN ('task.accepted','task.returned','task.assigned','ledger.corrected','reward.reserved','reward.cancelled','reward.approved','reward.rejected','reward.fulfilled','reward.expired'));
    ALTER TABLE impuls.notification_outbox ADD CONSTRAINT notification_outbox_object_check CHECK (
      (kind IN ('task.accepted','task.returned') AND review_id IS NOT NULL AND task_id IS NULL AND correction_id IS NULL AND redemption_id IS NULL) OR
      (kind='task.assigned' AND review_id IS NULL AND task_id IS NOT NULL AND correction_id IS NULL AND redemption_id IS NULL) OR
      (kind='ledger.corrected' AND review_id IS NULL AND task_id IS NULL AND correction_id IS NOT NULL AND redemption_id IS NULL) OR
      (kind IN ('reward.reserved','reward.cancelled','reward.approved','reward.rejected','reward.fulfilled','reward.expired') AND review_id IS NULL AND task_id IS NULL AND correction_id IS NULL AND redemption_id IS NOT NULL));
    CREATE UNIQUE INDEX outbox_redemption_expiration_unique ON impuls.notification_outbox(redemption_id) WHERE kind='reward.expired';
  `);
};
const down = (pgm) => {
  pgm.sql(
    `DO $$ BEGIN RAISE EXCEPTION 'Keep expiry history; roll back the application with SYNTHETIC_REWARDS_ENABLED=false'; END $$;`,
  );
};
module.exports = { up, down };
