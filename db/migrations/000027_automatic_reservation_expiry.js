const up = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='impuls_expiry_worker') THEN
        CREATE ROLE impuls_expiry_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='impuls_expiry_executor') THEN
        CREATE ROLE impuls_expiry_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      END IF;
    END $$;
    GRANT USAGE ON SCHEMA impuls TO impuls_expiry_worker,impuls_expiry_executor;
    ALTER TABLE impuls.redemptions ADD COLUMN automatic_expiry boolean NOT NULL DEFAULT false;
    ALTER TABLE impuls.redemptions DROP CONSTRAINT redemption_decision_check;
    ALTER TABLE impuls.redemptions ADD CONSTRAINT redemption_decision_check CHECK (
      (NOT automatic_expiry AND (
        (status IN ('approved','rejected','fulfilled','expired') AND decision_actor_id IS NOT NULL AND decision_actor_id<>user_id AND decision_reason IS NOT NULL AND decided_at IS NOT NULL) OR
        (status IN ('pending','cancelled') AND decision_actor_id IS NULL AND decision_reason IS NULL AND decided_at IS NULL))) OR
      (automatic_expiry AND status='expired' AND decision_actor_id IS NULL AND decided_at IS NOT NULL
        AND decision_reason IS NOT NULL AND decision_reason='Автоматическое истечение синтетического резерва'));
    ALTER TABLE impuls.audit_events ALTER COLUMN actor_id DROP NOT NULL;
    ALTER TABLE impuls.audit_events ADD COLUMN automatic_expiry boolean NOT NULL DEFAULT false;
    ALTER TABLE impuls.audit_events ADD CONSTRAINT audit_actor_source_check CHECK (
      (NOT automatic_expiry AND actor_id IS NOT NULL) OR
      (automatic_expiry AND actor_id IS NULL AND action='reward.expire'
        AND reason='Автоматическое истечение синтетического резерва'));
    CREATE INDEX redemptions_due_idx ON impuls.redemptions(quota_period_id,expires_at,id)
      WHERE status='pending' AND mode='synthetic' AND expires_at IS NOT NULL;

    -- App INSERT privileges do not confer the right to impersonate this service.
    CREATE FUNCTION impuls.guard_automatic_expiry_source() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog AS $$
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
          AND d.automatic_expiry AND d.status='expired' AND d.mode='synthetic'
          AND d.decided_at=NEW.created_at AND d.decision_reason=NEW.reason) THEN
          RAISE EXCEPTION 'Invalid automatic expiry evidence' USING ERRCODE='23514';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_automatic_expiry_source() FROM PUBLIC;
    CREATE TRIGGER automatic_redemption_source BEFORE INSERT OR UPDATE ON impuls.redemptions
      FOR EACH ROW EXECUTE FUNCTION impuls.guard_automatic_expiry_source();
    CREATE TRIGGER automatic_audit_source BEFORE INSERT ON impuls.audit_events
      FOR EACH ROW EXECUTE FUNCTION impuls.guard_automatic_expiry_source();

    -- Private NOLOGIN executor; neither application nor either worker is a member.
    -- Separate branches avoid planning unrelated table reads for expiry, including
    -- after PostgreSQL switches from custom to generic cached trigger plans.
    CREATE OR REPLACE FUNCTION impuls.guard_ledger_reversal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF NEW.kind<>'acceptance_reversal' THEN RETURN NEW; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM impuls.ledger_entries original JOIN impuls.ledger_corrections c ON c.id=NEW.correction_id
        WHERE original.id=NEW.original_entry_id AND original.kind='task_acceptance'
          AND ROW(NEW.user_id,NEW.review_id,NEW.task_id,NEW.task_title,NEW.rule_set_id,NEW.rule_version,NEW.currency,NEW.mode,NEW.season_key,NEW.time_zone)
            IS NOT DISTINCT FROM ROW(original.user_id,original.review_id,original.task_id,original.task_title,original.rule_set_id,original.rule_version,original.currency,original.mode,original.season_key,original.time_zone)
          AND NEW.amount=-original.amount AND c.review_id=original.review_id AND c.user_id=original.user_id
          AND NEW.amount=CASE NEW.currency WHEN 'xp' THEN c.xp_delta ELSE c.points_delta END
      ) THEN RAISE EXCEPTION 'Invalid acceptance reversal' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE FUNCTION impuls.check_fulfillment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF NOT EXISTS(SELECT 1 FROM impuls.redemptions d WHERE d.id=NEW.id AND d.status='fulfilled') THEN RETURN NULL; END IF;
      IF EXISTS(SELECT 1 FROM impuls.redemptions d WHERE d.id=NEW.id AND d.status='fulfilled' AND NOT EXISTS(
        SELECT 1 FROM impuls.entitlements e WHERE e.redemption_id=d.id AND
        ROW(e.user_id,e.reward_id,e.scope_id,e.actor_id,e.reason,e.mode,e.created_at)
        IS NOT DISTINCT FROM ROW(d.user_id,d.reward_id,d.scope_id,d.fulfillment_actor_id,d.fulfillment_reason,d.mode,d.fulfilled_at)))
      THEN RAISE EXCEPTION 'Missing fulfillment entitlement' USING ERRCODE='23514'; END IF;
      RETURN NULL;
    END $$;
    GRANT SELECT ON impuls.redemptions,impuls.quota_periods,impuls.account_balances,impuls.ledger_entries TO impuls_expiry_executor;
    GRANT UPDATE(status,decision_actor_id,decision_reason,decided_at,automatic_expiry,version,updated_at)
      ON impuls.redemptions TO impuls_expiry_executor;
    GRANT UPDATE(reserved,version,updated_at) ON impuls.quota_periods TO impuls_expiry_executor;
    GRANT UPDATE(available_points,reserved_points,version,updated_at) ON impuls.account_balances TO impuls_expiry_executor;
    GRANT INSERT ON impuls.ledger_entries,impuls.audit_events,impuls.notification_outbox TO impuls_expiry_executor;
    CREATE POLICY redemptions_expiry_service ON impuls.redemptions TO impuls_expiry_executor
      USING(mode='synthetic') WITH CHECK(mode='synthetic' AND automatic_expiry AND status='expired');
    CREATE POLICY quotas_expiry_service ON impuls.quota_periods TO impuls_expiry_executor USING(true) WITH CHECK(true);
    CREATE POLICY balances_expiry_service ON impuls.account_balances TO impuls_expiry_executor USING(true) WITH CHECK(true);
    CREATE POLICY ledger_expiry_service_read ON impuls.ledger_entries FOR SELECT TO impuls_expiry_executor USING(mode='synthetic');
    CREATE POLICY ledger_expiry_service_insert ON impuls.ledger_entries FOR INSERT TO impuls_expiry_executor
      WITH CHECK(mode='synthetic' AND kind='reward_expiration');
    CREATE POLICY audit_expiry_service ON impuls.audit_events FOR INSERT TO impuls_expiry_executor
      WITH CHECK(automatic_expiry AND action='reward.expire');
    CREATE POLICY outbox_expiry_service ON impuls.notification_outbox FOR INSERT TO impuls_expiry_executor
      WITH CHECK(mode='synthetic' AND kind='reward.expired');

    CREATE FUNCTION impuls.expire_one_synthetic_reservation() RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    DECLARE q impuls.quota_periods%ROWTYPE; d impuls.redemptions%ROWTYPE;
      b impuls.account_balances%ROWTYPE; original impuls.ledger_entries%ROWTYPE;
      at timestamptz; request uuid; reason constant text := 'Автоматическое истечение синтетического резерва';
    BEGIN
      -- Start with quota, exactly as reserve/cancel/decide. Never lock a redemption first.
      SELECT * INTO q FROM impuls.quota_periods p WHERE EXISTS (
        SELECT 1 FROM impuls.redemptions r WHERE r.quota_period_id=p.id AND r.mode='synthetic'
          AND r.status='pending' AND r.expires_at<=clock_timestamp())
        ORDER BY p.id FOR UPDATE OF p SKIP LOCKED LIMIT 1;
      IF NOT FOUND THEN RETURN false; END IF;
      SELECT * INTO d FROM impuls.redemptions WHERE quota_period_id=q.id AND mode='synthetic'
        AND status='pending' AND expires_at<=clock_timestamp() ORDER BY expires_at,id LIMIT 1;
      IF NOT FOUND THEN RETURN false; END IF;
      SELECT * INTO b FROM impuls.account_balances WHERE user_id=d.user_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Missing reservation balance' USING ERRCODE='23514'; END IF;
      SELECT * INTO d FROM impuls.redemptions WHERE id=d.id FOR UPDATE;
      at := date_trunc('milliseconds',clock_timestamp());
      IF d.mode<>'synthetic' OR d.status<>'pending' OR d.expires_at IS NULL OR d.expires_at>at THEN RETURN false; END IF;
      IF b.reserved_points<d.price OR q.reserved<1 THEN
        RAISE EXCEPTION 'Reservation projection inconsistent' USING ERRCODE='23514';
      END IF;
      SELECT * INTO original FROM impuls.ledger_entries WHERE redemption_id=d.id AND kind='reward_reservation' AND mode='synthetic';
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
    END $$;
    -- ALTER OWNER needs SET on the new owner; managed Postgres (Supabase) gives the
    -- migration role no superuser rights. The grant is temporary and revoked below.
    GRANT impuls_expiry_executor TO CURRENT_USER WITH SET TRUE;
    -- ALTER OWNER requires temporary CREATE; no persistent schema creation authority.
    GRANT CREATE ON SCHEMA impuls TO impuls_expiry_executor;
    ALTER FUNCTION impuls.expire_one_synthetic_reservation() OWNER TO impuls_expiry_executor;
    REVOKE CREATE ON SCHEMA impuls FROM impuls_expiry_executor;
    REVOKE impuls_expiry_executor FROM CURRENT_USER;
    REVOKE ALL ON FUNCTION impuls.expire_one_synthetic_reservation() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION impuls.expire_one_synthetic_reservation() TO impuls_expiry_worker;
  `);
};
const down = () => {
  throw new Error(
    "Keep automatic expiry history; disable SYNTHETIC_RESERVATION_EXPIRY_ENABLED and use a forward migration",
  );
};
module.exports = { up, down };
