const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.view','task.create','task.assign','task.edit','task.cancel','task.review',
      'reward.decide','reward.fulfill','admin.access','admin.rules','admin.catalog',
      'admin.catalog.publish','admin.catalog.quota.publish','admin.audit','admin.notifications','ledger.correct'
    ));
    GRANT INSERT(id,reward_id,scope_id,starts_at,ends_at,capacity) ON impuls.quota_periods TO impuls_app;
    CREATE TABLE impuls.quota_publications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      quota_period_id uuid NOT NULL UNIQUE REFERENCES impuls.quota_periods(id),
      reward_id uuid NOT NULL,
      scope_id uuid NOT NULL REFERENCES impuls.access_scopes(id),
      starts_at timestamptz(3) NOT NULL,
      ends_at timestamptz(3) NOT NULL CHECK (ends_at>starts_at),
      capacity integer NOT NULL CHECK (capacity BETWEEN 0 AND 1000000),
      actor_id uuid NOT NULL REFERENCES impuls.users(id),
      request_id uuid NOT NULL,
      reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX quota_publications_scope_time_id ON impuls.quota_publications(scope_id,created_at DESC,id DESC);
    REVOKE ALL ON impuls.quota_publications FROM PUBLIC;
    GRANT SELECT,INSERT ON impuls.quota_publications TO impuls_app;
    ALTER TABLE impuls.quota_publications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY quota_publications_server_read ON impuls.quota_publications FOR SELECT TO impuls_app USING(true);
    CREATE POLICY quota_publications_server_insert ON impuls.quota_publications FOR INSERT TO impuls_app WITH CHECK(true);
    CREATE FUNCTION impuls.guard_quota_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF TG_OP<>'INSERT' THEN
        RAISE EXCEPTION 'Quota publication history is immutable' USING ERRCODE='23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM impuls.quota_periods q WHERE q.id=NEW.quota_period_id
        AND ROW(q.reward_id,q.scope_id,q.starts_at,q.ends_at,q.capacity) IS NOT DISTINCT FROM
          ROW(NEW.reward_id,NEW.scope_id,NEW.starts_at,NEW.ends_at,NEW.capacity)
        AND EXISTS(SELECT 1 FROM impuls.reward_versions r WHERE r.reward_id=q.reward_id AND r.scope_id=q.scope_id AND r.mode='synthetic' AND r.kind='cosmetic'))
      THEN RAISE EXCEPTION 'Invalid quota publication snapshot' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_quota_publication() FROM PUBLIC;
    CREATE TRIGGER quota_publication_valid BEFORE INSERT OR UPDATE OR DELETE ON impuls.quota_publications
      FOR EACH ROW EXECUTE FUNCTION impuls.guard_quota_publication();
  `);
};
const down = () => {
  throw new Error(
    "Keep quota publication history; disable SYNTHETIC_QUOTA_PUBLICATION_ENABLED to roll back the application",
  );
};
module.exports = { up, down };
