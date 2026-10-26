// ADR-0029, этап 2. Снимаем метку «synthetic» из схемы. Старые строки сохраняют значение
// (журналы неизменяемы), новые пишутся без mode. Сравнения mode теперь IS NOT DISTINCT FROM,
// поэтому связи между старой и новой строкой не теряются.
const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.ledger_entries DROP CONSTRAINT ledger_entries_mode_check, ALTER COLUMN mode DROP NOT NULL;
    ALTER TABLE impuls.notification_outbox DROP CONSTRAINT notification_outbox_mode_check, ALTER COLUMN mode DROP NOT NULL;
    ALTER TABLE impuls.ledger_corrections DROP CONSTRAINT ledger_corrections_mode_check, ALTER COLUMN mode DROP NOT NULL;
    ALTER TABLE impuls.reward_versions DROP CONSTRAINT reward_versions_mode_check, ALTER COLUMN mode DROP NOT NULL;
    ALTER TABLE impuls.redemptions DROP CONSTRAINT redemptions_mode_check, ALTER COLUMN mode DROP NOT NULL;
    ALTER TABLE impuls.entitlements DROP CONSTRAINT entitlements_mode_check, ALTER COLUMN mode DROP NOT NULL;
    ALTER TABLE impuls.task_scope_members DROP CONSTRAINT task_scope_members_synthetic_check;

    DROP POLICY notification_outbox_worker_read ON impuls.notification_outbox;
    CREATE POLICY notification_outbox_worker_read ON impuls.notification_outbox FOR SELECT TO impuls_worker USING (true);
    DROP POLICY redemptions_expiry_service ON impuls.redemptions;
    CREATE POLICY redemptions_expiry_service ON impuls.redemptions FOR ALL TO impuls_expiry_executor
      USING (true) WITH CHECK (automatic_expiry AND status = 'expired');
    DROP POLICY ledger_expiry_service_read ON impuls.ledger_entries;
    CREATE POLICY ledger_expiry_service_read ON impuls.ledger_entries FOR SELECT TO impuls_expiry_executor USING (true);

    DROP INDEX impuls.redemptions_due_idx;
    CREATE INDEX redemptions_due_idx ON impuls.redemptions USING btree (quota_period_id, expires_at, id)
      WHERE status = 'pending' AND expires_at IS NOT NULL;
  `);
  // CREATE OR REPLACE keeps each function's owner, grants, language and search_path.
  pgm.sql(`
CREATE OR REPLACE FUNCTION impuls.guard_correction_award()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM impuls.reviews r JOIN impuls.ledger_entries xp ON xp.review_id=r.id
        JOIN impuls.ledger_entries p ON p.review_id=r.id AND p.user_id=xp.user_id
        WHERE r.id=NEW.review_id AND r.decision='accept' AND xp.user_id=NEW.user_id
          AND xp.currency='xp' AND p.currency='points' AND xp.kind='task_acceptance' AND p.kind='task_acceptance'
          AND xp.mode IS NOT DISTINCT FROM NEW.mode AND p.mode IS NOT DISTINCT FROM NEW.mode AND NEW.xp_delta=-xp.amount AND NEW.points_delta=-p.amount
      ) THEN RAISE EXCEPTION 'Invalid correction award' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $function$;

CREATE OR REPLACE FUNCTION impuls.guard_first_result_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM impuls.ledger_entries l JOIN impuls.reviews r ON r.id=l.review_id
        WHERE l.id=NEW.source_entry_id AND l.user_id=NEW.user_id AND l.currency='xp'
          AND l.kind='task_acceptance' AND r.decision='accept'
          AND l.created_at=NEW.granted_at
      ) THEN RAISE EXCEPTION 'Invalid first result source' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $function$;

CREATE OR REPLACE FUNCTION impuls.guard_redemption()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
    BEGIN
      IF TG_OP='INSERT' THEN
        IF NEW.status<>'pending' OR NEW.version<>1 OR NOT EXISTS (
          SELECT 1 FROM impuls.reward_versions r JOIN impuls.quota_periods q ON q.id=NEW.quota_period_id
          WHERE r.id=NEW.reward_version_id AND r.enabled AND r.kind='cosmetic' AND r.mode IS NOT DISTINCT FROM NEW.mode
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
    END $function$;

CREATE OR REPLACE FUNCTION impuls.guard_reservation_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
    BEGIN
      IF NEW.redemption_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM impuls.redemptions d WHERE d.id=NEW.redemption_id AND d.user_id=NEW.user_id AND d.mode IS NOT DISTINCT FROM NEW.mode AND (
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
    END $function$;

CREATE OR REPLACE FUNCTION impuls.guard_quota_publication()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
    BEGIN
      IF TG_OP<>'INSERT' THEN
        RAISE EXCEPTION 'Quota publication history is immutable' USING ERRCODE='23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM impuls.quota_periods q WHERE q.id=NEW.quota_period_id
        AND ROW(q.reward_id,q.scope_id,q.starts_at,q.ends_at,q.capacity) IS NOT DISTINCT FROM
          ROW(NEW.reward_id,NEW.scope_id,NEW.starts_at,NEW.ends_at,NEW.capacity)
        AND EXISTS(SELECT 1 FROM impuls.reward_versions r WHERE r.reward_id=q.reward_id AND r.scope_id=q.scope_id AND r.kind='cosmetic'))
      THEN RAISE EXCEPTION 'Invalid quota publication snapshot' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $function$;

CREATE OR REPLACE FUNCTION impuls.guard_catalog_creation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
    BEGIN
      IF TG_OP<>'INSERT' THEN
        RAISE EXCEPTION 'Catalog creation history is immutable' USING ERRCODE='23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM impuls.reward_versions r WHERE r.id=NEW.initial_version_id
        AND r.version=1 AND NOT r.enabled AND r.kind='cosmetic'
        AND NOT EXISTS(SELECT 1 FROM impuls.reward_versions other
          WHERE other.reward_id=r.reward_id AND other.scope_id=r.scope_id AND other.id<>r.id))
      THEN RAISE EXCEPTION 'Invalid catalog creation snapshot' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $function$;

CREATE OR REPLACE FUNCTION impuls.guard_automatic_expiry_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
    BEGIN
      IF NEW.automatic_expiry THEN
        IF current_user<>'impuls_expiry_executor' THEN
          RAISE EXCEPTION 'Automatic expiry requires service authority' USING ERRCODE='42501';
        END IF;
        IF TG_TABLE_NAME='redemptions' THEN
          IF TG_OP<>'UPDATE' OR OLD.status<>'pending' OR NEW.status<>'expired' THEN
            RAISE EXCEPTION 'Invalid automatic expiry source' USING ERRCODE='23514';
          END IF;
        ELSIF NOT EXISTS (SELECT 1 FROM impuls.redemptions d WHERE d.id=NEW.redemption_id
          AND d.automatic_expiry AND d.status='expired'
          AND d.decided_at=NEW.created_at AND d.decision_reason=NEW.reason) THEN
          RAISE EXCEPTION 'Invalid automatic expiry evidence' USING ERRCODE='23514';
        END IF;
      END IF;
      RETURN NEW;
    END $function$;

CREATE OR REPLACE FUNCTION impuls.read_synthetic_expiry_status()
 RETURNS TABLE(snapshot_at timestamp with time zone, due bigint, scheduled bigint, untimed_pending bigint, automatic_expired bigint, oldest_due_at timestamp with time zone, oldest_due_age_seconds bigint, last_automatic_expiry_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
      SELECT statement_timestamp(),
        count(*) FILTER (WHERE status='pending' AND expires_at<=statement_timestamp()),
        count(*) FILTER (WHERE status='pending' AND expires_at>statement_timestamp()),
        count(*) FILTER (WHERE status='pending' AND expires_at IS NULL),
        count(*) FILTER (WHERE status='expired' AND automatic_expiry),
        min(expires_at) FILTER (WHERE status='pending' AND expires_at<=statement_timestamp()),
        floor(extract(epoch FROM statement_timestamp()-
          min(expires_at) FILTER (WHERE status='pending' AND expires_at<=statement_timestamp())))::bigint,
        max(decided_at) FILTER (WHERE status='expired' AND automatic_expiry)
      FROM impuls.redemptions
    $function$;

CREATE OR REPLACE FUNCTION impuls.expire_one_synthetic_reservation()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
    DECLARE q impuls.quota_periods%ROWTYPE; d impuls.redemptions%ROWTYPE;
      b impuls.account_balances%ROWTYPE; original impuls.ledger_entries%ROWTYPE;
      at timestamptz; request uuid; reason constant text := 'Автоматическое истечение синтетического резерва';
    BEGIN
      -- Start with quota, exactly as reserve/cancel/decide. Never lock a redemption first.
      SELECT * INTO q FROM impuls.quota_periods p WHERE EXISTS (
        SELECT 1 FROM impuls.redemptions r WHERE r.quota_period_id=p.id
          AND r.status='pending' AND r.expires_at<=clock_timestamp())
        ORDER BY p.id FOR UPDATE OF p SKIP LOCKED LIMIT 1;
      IF NOT FOUND THEN RETURN false; END IF;
      SELECT * INTO d FROM impuls.redemptions WHERE quota_period_id=q.id
        AND status='pending' AND expires_at<=clock_timestamp() ORDER BY expires_at,id LIMIT 1;
      IF NOT FOUND THEN RETURN false; END IF;
      SELECT * INTO b FROM impuls.account_balances WHERE user_id=d.user_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Missing reservation balance' USING ERRCODE='23514'; END IF;
      SELECT * INTO d FROM impuls.redemptions WHERE id=d.id FOR UPDATE;
      at := date_trunc('milliseconds',clock_timestamp());
      IF d.status<>'pending' OR d.expires_at IS NULL OR d.expires_at>at THEN RETURN false; END IF;
      IF b.reserved_points<d.price OR q.reserved<1 THEN
        RAISE EXCEPTION 'Reservation projection inconsistent' USING ERRCODE='23514';
      END IF;
      SELECT * INTO original FROM impuls.ledger_entries WHERE redemption_id=d.id AND kind='reward_reservation';
      IF NOT FOUND THEN RAISE EXCEPTION 'Missing reservation source' USING ERRCODE='23514'; END IF;
      request := gen_random_uuid();
      UPDATE impuls.redemptions SET status='expired',automatic_expiry=true,decision_actor_id=NULL,
        decision_reason=reason,decided_at=at,version=version+1,updated_at=at WHERE id=d.id;
      UPDATE impuls.account_balances SET available_points=available_points+d.price,reserved_points=reserved_points-d.price,
        version=version+1,updated_at=at WHERE user_id=d.user_id;
      UPDATE impuls.quota_periods SET reserved=reserved-1,version=version+1,updated_at=at WHERE id=q.id;
      INSERT INTO impuls.ledger_entries(user_id,redemption_id,currency,kind,amount,reserved_delta,original_entry_id,mode,season_key,time_zone,created_at,updated_at)
        VALUES(d.user_id,d.id,'points','reward_expiration',d.price,-d.price,original.id,'synthetic',original.season_key,original.time_zone,at,at);
      INSERT INTO impuls.audit_events(actor_id,redemption_id,action,request_id,reason,diff,automatic_expiry,created_at,updated_at)
        VALUES(NULL,d.id,'reward.expire',request,reason,jsonb_build_object('from','pending','to','expired','price',d.price,
          'version',d.version+1,'availableDelta',d.price,'reservedDelta',-d.price,'quotaPeriodId',q.id),true,at,at);
      INSERT INTO impuls.notification_outbox(recipient_id,redemption_id,kind,mode,created_at,updated_at)
        VALUES(d.user_id,d.id,'reward.expired','synthetic',at,at);
      RETURN true;
    END $function$;

CREATE OR REPLACE FUNCTION impuls.guard_catalog_cancellation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
    DECLARE target impuls.reward_versions%ROWTYPE;
    BEGIN
      IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Catalog cancellation history is immutable' USING ERRCODE='23514'; END IF;
      SELECT * INTO target FROM impuls.reward_versions WHERE id=NEW.version_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Invalid cancellation target' USING ERRCODE='23514'; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended(target.reward_id::text||target.scope_id::text,0));
      PERFORM id FROM impuls.quota_periods WHERE reward_id=target.reward_id AND scope_id=target.scope_id ORDER BY id FOR UPDATE;
      IF target.kind<>'cosmetic' OR target.effective_from<=clock_timestamp() THEN
        RAISE EXCEPTION 'Only future terms can be cancelled' USING ERRCODE='23514';
      END IF;
      NEW.created_at=clock_timestamp();
      RETURN NEW;
    END $function$;

CREATE OR REPLACE FUNCTION impuls.guard_catalog_publication()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
    BEGIN
      IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Catalog publication history is immutable' USING ERRCODE='23514'; END IF;
      IF NOT EXISTS (SELECT 1 FROM impuls.reward_versions prior JOIN impuls.reward_versions next
        ON next.reward_id=prior.reward_id AND next.scope_id=prior.scope_id
        WHERE prior.id=NEW.previous_version_id AND next.id=NEW.published_version_id
          AND prior.kind='cosmetic' AND next.kind='cosmetic'
          AND next.version>prior.version AND next.effective_from>prior.effective_from
          AND next.version=(SELECT max(v.version)+1 FROM impuls.reward_versions v
            WHERE v.reward_id=next.reward_id AND v.scope_id=next.scope_id AND v.id<>next.id)
          AND NOT EXISTS(SELECT 1 FROM impuls.reward_versions gap WHERE gap.reward_id=next.reward_id AND gap.scope_id=next.scope_id
            AND gap.version>prior.version AND gap.version<next.version
            AND NOT EXISTS(SELECT 1 FROM impuls.catalog_cancellations c WHERE c.version_id=gap.id)))
      THEN RAISE EXCEPTION 'Invalid publication snapshot' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $function$;

CREATE OR REPLACE FUNCTION impuls.enqueue_task_due_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
    DECLARE enqueued integer;
    BEGIN
      WITH due AS (
        SELECT t.id AS task_id, a.user_id
        FROM impuls.tasks t
        JOIN impuls.task_assignments a ON a.task_id=t.id
        JOIN impuls.users u ON u.id=a.user_id AND u.active
        WHERE t.status IN ('assigned','in_progress','needs_work')
          AND t.due_at > clock_timestamp() AND t.due_at <= clock_timestamp() + interval '24 hours'
          AND NOT EXISTS (SELECT 1 FROM impuls.notification_outbox o
            WHERE o.task_id=t.id AND o.kind='task.due_soon')
        ORDER BY t.due_at, t.id
        LIMIT 50
      ), inserted AS (
        INSERT INTO impuls.notification_outbox(recipient_id,task_id,kind,mode,created_at,updated_at)
        SELECT user_id,task_id,'task.due_soon','synthetic',clock_timestamp(),clock_timestamp() FROM due
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT count(*) INTO enqueued FROM inserted;
      RETURN enqueued;
    END $function$;
`);
};
const down = (pgm) => {
  pgm.sql(`
    UPDATE impuls.ledger_entries SET mode='synthetic' WHERE mode IS NULL;
    UPDATE impuls.notification_outbox SET mode='synthetic' WHERE mode IS NULL;
    UPDATE impuls.ledger_corrections SET mode='synthetic' WHERE mode IS NULL;
    UPDATE impuls.reward_versions SET mode='synthetic' WHERE mode IS NULL;
    UPDATE impuls.redemptions SET mode='synthetic' WHERE mode IS NULL;
    UPDATE impuls.entitlements SET mode='synthetic' WHERE mode IS NULL;
    ALTER TABLE impuls.ledger_entries ALTER COLUMN mode SET NOT NULL, ADD CONSTRAINT ledger_entries_mode_check CHECK (mode = 'synthetic');
    ALTER TABLE impuls.notification_outbox ALTER COLUMN mode SET NOT NULL, ADD CONSTRAINT notification_outbox_mode_check CHECK (mode = 'synthetic');
    ALTER TABLE impuls.ledger_corrections ALTER COLUMN mode SET NOT NULL, ADD CONSTRAINT ledger_corrections_mode_check CHECK (mode = 'synthetic');
    ALTER TABLE impuls.reward_versions ALTER COLUMN mode SET NOT NULL, ADD CONSTRAINT reward_versions_mode_check CHECK (mode = 'synthetic');
    ALTER TABLE impuls.redemptions ALTER COLUMN mode SET NOT NULL, ADD CONSTRAINT redemptions_mode_check CHECK (mode = 'synthetic');
    ALTER TABLE impuls.entitlements ALTER COLUMN mode SET NOT NULL, ADD CONSTRAINT entitlements_mode_check CHECK (mode = 'synthetic');
  `);
};
module.exports = { up, down };
