const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.view','task.create','task.assign','task.edit','task.cancel','task.review',
      'reward.decide','reward.fulfill','admin.access','admin.rules','admin.catalog',
      'admin.catalog.publish','admin.audit','admin.notifications','ledger.correct'
    ));
    GRANT INSERT ON impuls.reward_versions TO impuls_app;
    CREATE POLICY reward_versions_server_insert ON impuls.reward_versions FOR INSERT TO impuls_app WITH CHECK (true);
    CREATE TABLE impuls.catalog_publications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      previous_version_id uuid NOT NULL REFERENCES impuls.reward_versions(id),
      published_version_id uuid NOT NULL UNIQUE REFERENCES impuls.reward_versions(id),
      actor_id uuid NOT NULL REFERENCES impuls.users(id),
      request_id uuid NOT NULL,
      reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (previous_version_id<>published_version_id)
    );
    CREATE INDEX catalog_publications_time_id ON impuls.catalog_publications(created_at DESC,id DESC);
    REVOKE ALL ON impuls.catalog_publications FROM PUBLIC;
    GRANT SELECT,INSERT ON impuls.catalog_publications TO impuls_app;
    ALTER TABLE impuls.catalog_publications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY catalog_publications_server_read ON impuls.catalog_publications FOR SELECT TO impuls_app USING (true);
    CREATE POLICY catalog_publications_server_insert ON impuls.catalog_publications FOR INSERT TO impuls_app WITH CHECK (true);
    CREATE FUNCTION impuls.guard_catalog_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF TG_OP<>'INSERT' THEN
        RAISE EXCEPTION 'Catalog publication history is immutable' USING ERRCODE='23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM impuls.reward_versions prior JOIN impuls.reward_versions next
        ON next.reward_id=prior.reward_id AND next.scope_id=prior.scope_id
        WHERE prior.id=NEW.previous_version_id AND next.id=NEW.published_version_id
          AND prior.mode='synthetic' AND next.mode='synthetic' AND prior.kind='cosmetic' AND next.kind='cosmetic'
          AND next.version=prior.version+1 AND next.effective_from>prior.effective_from)
      THEN RAISE EXCEPTION 'Invalid publication snapshot' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_catalog_publication() FROM PUBLIC;
    CREATE TRIGGER catalog_publication_valid BEFORE INSERT OR UPDATE OR DELETE ON impuls.catalog_publications
      FOR EACH ROW EXECUTE FUNCTION impuls.guard_catalog_publication();
  `);
};
const down = () => {
  throw new Error(
    "Keep published catalog history; disable SYNTHETIC_CATALOG_PUBLICATION_ENABLED to roll back the application",
  );
};
module.exports = { up, down };
