const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.view','task.create','task.assign','task.edit','task.cancel','task.review',
      'reward.decide','reward.fulfill','admin.access','admin.access.manage','admin.rules','admin.catalog',
      'admin.catalog.create','admin.catalog.publish','admin.catalog.schedule','admin.catalog.schedule.cancel','admin.catalog.quota.publish',
      'admin.audit','admin.notifications','ledger.correct'
    ));
    CREATE TABLE impuls.access_changes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL CHECK (kind IN ('grant','revoke')),
      binding_id uuid NOT NULL REFERENCES impuls.role_bindings(id),
      actor_id uuid NOT NULL REFERENCES impuls.users(id),
      subject_id uuid NOT NULL REFERENCES impuls.users(id),
      scope_id uuid NOT NULL REFERENCES impuls.access_scopes(id),
      action text NOT NULL,
      valid_until timestamptz,
      request_id uuid NOT NULL,
      reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (binding_id, kind)
    );
    CREATE INDEX access_changes_scope_time_id ON impuls.access_changes(scope_id,created_at DESC,id DESC);
    REVOKE ALL ON impuls.access_changes FROM PUBLIC;
    GRANT SELECT,INSERT ON impuls.access_changes TO impuls_app;
    ALTER TABLE impuls.access_changes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY access_changes_server_read ON impuls.access_changes FOR SELECT TO impuls_app USING (true);
    CREATE POLICY access_changes_server_insert ON impuls.access_changes FOR INSERT TO impuls_app WITH CHECK (true);
    -- Defence in depth for the domain rules: no self-service, no delegation of
    -- the access-management rights themselves, and the evidence matches the binding.
    CREATE FUNCTION impuls.guard_access_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    DECLARE b impuls.role_bindings%ROWTYPE;
    BEGIN
      IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Access change history is immutable' USING ERRCODE='23514'; END IF;
      SELECT * INTO b FROM impuls.role_bindings WHERE id=NEW.binding_id;
      IF NOT FOUND OR b.user_id<>NEW.subject_id OR b.scope_id<>NEW.scope_id OR b.action<>NEW.action
         OR NEW.actor_id=NEW.subject_id OR NEW.action IN ('admin.access','admin.access.manage')
         OR (NEW.kind='grant' AND b.granted_by<>NEW.actor_id)
         OR (NEW.kind='revoke' AND b.revoked_at IS NULL) THEN
        RAISE EXCEPTION 'Invalid access change' USING ERRCODE='23514';
      END IF;
      NEW.created_at=clock_timestamp();
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_access_change() FROM PUBLIC;
    CREATE TRIGGER access_change_valid BEFORE INSERT OR UPDATE OR DELETE ON impuls.access_changes
      FOR EACH ROW EXECUTE FUNCTION impuls.guard_access_change();
  `);
};
const down = () => {
  throw new Error(
    "Keep access change evidence; disable SYNTHETIC_ACCESS_MANAGEMENT_ENABLED to stop new changes",
  );
};
module.exports = { up, down };
