// ADR-0029, этап 2 (продолжение 000051). Остались две политики вставки, которые
// требовали mode = 'synthetic' (ledger_expiry_service_insert, outbox_expiry_service), и функция
// автоматического истечения, которая писала литерал. Теперь политики проверяют только вид записи, а
// автоматическое истечение переносит mode из резерва (у новых записей он пустой, у старых
// сохраняется), как требует guard_reservation_entry.
// Напоминания (enqueue_task_due_reminders) пока пишут 'synthetic': старый воркер берёт только такие
// записи; функция сменится вместе с удалением столбцов, когда воркер уже без фильтра.
const up = (pgm) => {
  pgm.sql(`
    DROP POLICY ledger_expiry_service_insert ON impuls.ledger_entries;
    CREATE POLICY ledger_expiry_service_insert ON impuls.ledger_entries FOR INSERT TO impuls_expiry_executor
      WITH CHECK (kind = 'reward_expiration');
    DROP POLICY outbox_expiry_service ON impuls.notification_outbox;
    CREATE POLICY outbox_expiry_service ON impuls.notification_outbox FOR INSERT TO impuls_expiry_executor
      WITH CHECK (kind = 'reward.expired');

-- expire_one_synthetic_reservation belongs to impuls_expiry_executor (000027). Replacing it needs
-- that role; managed Postgres (Supabase) gives the migration role no superuser rights, so the
-- membership and the CREATE grant are temporary, as in 000027 and 000028.
GRANT impuls_expiry_executor TO CURRENT_USER WITH SET TRUE;
GRANT CREATE ON SCHEMA impuls TO impuls_expiry_executor;
SET LOCAL ROLE impuls_expiry_executor;

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
        VALUES(d.user_id,d.id,'points','reward_expiration',d.price,-d.price,original.id,d.mode,original.season_key,original.time_zone,at,at);
      INSERT INTO impuls.audit_events(actor_id,redemption_id,action,request_id,reason,diff,automatic_expiry,created_at,updated_at)
        VALUES(NULL,d.id,'reward.expire',request,reason,jsonb_build_object('from','pending','to','expired','price',d.price,
          'version',d.version+1,'availableDelta',d.price,'reservedDelta',-d.price,'quotaPeriodId',q.id),true,at,at);
      INSERT INTO impuls.notification_outbox(recipient_id,redemption_id,kind,mode,created_at,updated_at)
        VALUES(d.user_id,d.id,'reward.expired',d.mode,at,at);
      RETURN true;
    END $function$;

RESET ROLE;
REVOKE CREATE ON SCHEMA impuls FROM impuls_expiry_executor;
REVOKE impuls_expiry_executor FROM CURRENT_USER;
`);
};
const down = (pgm) => {
  pgm.sql(`
    DROP POLICY ledger_expiry_service_insert ON impuls.ledger_entries;
    CREATE POLICY ledger_expiry_service_insert ON impuls.ledger_entries FOR INSERT TO impuls_expiry_executor
      WITH CHECK (mode = 'synthetic' AND kind = 'reward_expiration');
    DROP POLICY outbox_expiry_service ON impuls.notification_outbox;
    CREATE POLICY outbox_expiry_service ON impuls.notification_outbox FOR INSERT TO impuls_expiry_executor
      WITH CHECK (mode = 'synthetic' AND kind = 'reward.expired');
  `);
};
module.exports = { up, down };
