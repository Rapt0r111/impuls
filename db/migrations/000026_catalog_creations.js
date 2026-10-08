const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.view','task.create','task.assign','task.edit','task.cancel','task.review',
      'reward.decide','reward.fulfill','admin.access','admin.rules','admin.catalog',
      'admin.catalog.publish','admin.catalog.quota.publish','admin.catalog.create',
      'admin.audit','admin.notifications','ledger.correct'
    ));
    CREATE TABLE impuls.catalog_creations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      initial_version_id uuid NOT NULL UNIQUE REFERENCES impuls.reward_versions(id),
      actor_id uuid NOT NULL REFERENCES impuls.users(id),
      request_id uuid NOT NULL,
      reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX catalog_creations_time_id ON impuls.catalog_creations(created_at DESC,id DESC);
    REVOKE ALL ON impuls.catalog_creations FROM PUBLIC;
    GRANT SELECT,INSERT ON impuls.catalog_creations TO impuls_app;
    ALTER TABLE impuls.catalog_creations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY catalog_creations_server_read ON impuls.catalog_creations FOR SELECT TO impuls_app USING(true);
    CREATE POLICY catalog_creations_server_insert ON impuls.catalog_creations FOR INSERT TO impuls_app WITH CHECK(true);
    CREATE FUNCTION impuls.guard_catalog_creation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF TG_OP<>'INSERT' THEN
        RAISE EXCEPTION 'Catalog creation history is immutable' USING ERRCODE='23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM impuls.reward_versions r WHERE r.id=NEW.initial_version_id
        AND r.version=1 AND NOT r.enabled AND r.mode='synthetic' AND r.kind='cosmetic'
        AND NOT EXISTS(SELECT 1 FROM impuls.reward_versions other
          WHERE other.reward_id=r.reward_id AND other.scope_id=r.scope_id AND other.id<>r.id))
      THEN RAISE EXCEPTION 'Invalid catalog creation snapshot' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_catalog_creation() FROM PUBLIC;
    CREATE TRIGGER catalog_creation_valid BEFORE INSERT OR UPDATE OR DELETE ON impuls.catalog_creations
      FOR EACH ROW EXECUTE FUNCTION impuls.guard_catalog_creation();
  `);
};
const down = () => {
  throw new Error(
    "Keep catalog creation history; disable SYNTHETIC_CATALOG_CREATION_ENABLED to roll back the application",
  );
};
module.exports = { up, down };
