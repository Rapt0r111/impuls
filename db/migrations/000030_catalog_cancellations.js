const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.view','task.create','task.assign','task.edit','task.cancel','task.review',
      'reward.decide','reward.fulfill','admin.access','admin.rules','admin.catalog',
      'admin.catalog.create','admin.catalog.publish','admin.catalog.schedule','admin.catalog.schedule.cancel','admin.catalog.quota.publish',
      'admin.audit','admin.notifications','ledger.correct'
    ));
    CREATE TABLE impuls.catalog_cancellations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      version_id uuid NOT NULL UNIQUE REFERENCES impuls.catalog_publications(published_version_id),
      actor_id uuid NOT NULL REFERENCES impuls.users(id),
      request_id uuid NOT NULL,
      reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX catalog_cancellations_time_id ON impuls.catalog_cancellations(created_at DESC,id DESC);
    REVOKE ALL ON impuls.catalog_cancellations FROM PUBLIC;
    GRANT SELECT,INSERT ON impuls.catalog_cancellations TO impuls_app;
    ALTER TABLE impuls.catalog_cancellations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY catalog_cancellations_server_read ON impuls.catalog_cancellations FOR SELECT TO impuls_app USING (true);
    CREATE POLICY catalog_cancellations_server_insert ON impuls.catalog_cancellations FOR INSERT TO impuls_app WITH CHECK (true);
    CREATE FUNCTION impuls.guard_catalog_cancellation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    DECLARE target impuls.reward_versions%ROWTYPE;
    BEGIN
      IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Catalog cancellation history is immutable' USING ERRCODE='23514'; END IF;
      SELECT * INTO target FROM impuls.reward_versions WHERE id=NEW.version_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Invalid cancellation target' USING ERRCODE='23514'; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended(target.reward_id::text||target.scope_id::text,0));
      PERFORM id FROM impuls.quota_periods WHERE reward_id=target.reward_id AND scope_id=target.scope_id ORDER BY id FOR UPDATE;
      IF target.mode<>'synthetic' OR target.kind<>'cosmetic' OR target.effective_from<=clock_timestamp() THEN
        RAISE EXCEPTION 'Only future synthetic terms can be cancelled' USING ERRCODE='23514';
      END IF;
      NEW.created_at=clock_timestamp();
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_catalog_cancellation() FROM PUBLIC;
    CREATE TRIGGER catalog_cancellation_valid BEFORE INSERT OR UPDATE OR DELETE ON impuls.catalog_cancellations
      FOR EACH ROW EXECUTE FUNCTION impuls.guard_catalog_cancellation();
    CREATE OR REPLACE FUNCTION impuls.guard_catalog_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Catalog publication history is immutable' USING ERRCODE='23514'; END IF;
      IF NOT EXISTS (SELECT 1 FROM impuls.reward_versions prior JOIN impuls.reward_versions next
        ON next.reward_id=prior.reward_id AND next.scope_id=prior.scope_id
        WHERE prior.id=NEW.previous_version_id AND next.id=NEW.published_version_id
          AND prior.mode='synthetic' AND next.mode='synthetic' AND prior.kind='cosmetic' AND next.kind='cosmetic'
          AND next.version>prior.version AND next.effective_from>prior.effective_from
          AND next.version=(SELECT max(v.version)+1 FROM impuls.reward_versions v
            WHERE v.reward_id=next.reward_id AND v.scope_id=next.scope_id AND v.id<>next.id)
          AND NOT EXISTS(SELECT 1 FROM impuls.reward_versions gap WHERE gap.reward_id=next.reward_id AND gap.scope_id=next.scope_id
            AND gap.version>prior.version AND gap.version<next.version
            AND NOT EXISTS(SELECT 1 FROM impuls.catalog_cancellations c WHERE c.version_id=gap.id)))
      THEN RAISE EXCEPTION 'Invalid publication snapshot' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
  `);
};
const down = () => {
  throw new Error(
    "Keep cancellation evidence; disable SYNTHETIC_CATALOG_CANCELLATION_ENABLED to stop new cancellations",
  );
};
module.exports = { up, down };
