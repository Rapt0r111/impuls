const up = (pgm) => {
  pgm.sql(`
    -- Rule versions published from the app (ADR-0035). Published versions are never edited:
    -- the runtime role may only add a new row, and every added row carries a publication
    -- record with the author, request id and reason.
    GRANT INSERT(version_number, definition, effective_from, created_by) ON impuls.rule_sets TO impuls_app;
    CREATE POLICY rule_sets_server_insert ON impuls.rule_sets FOR INSERT TO impuls_app WITH CHECK (true);

    CREATE TABLE impuls.rule_publications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_set_id uuid NOT NULL UNIQUE REFERENCES impuls.rule_sets(id),
      actor_id uuid NOT NULL REFERENCES impuls.users(id),
      request_id uuid NOT NULL,
      reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX rule_publications_time_idx ON impuls.rule_publications (created_at DESC, id DESC);
    REVOKE ALL ON impuls.rule_publications FROM PUBLIC;
    GRANT SELECT, INSERT ON impuls.rule_publications TO impuls_app;
    ALTER TABLE impuls.rule_publications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rule_publications_server_read ON impuls.rule_publications FOR SELECT TO impuls_app USING (true);
    CREATE POLICY rule_publications_server_insert ON impuls.rule_publications FOR INSERT TO impuls_app WITH CHECK (true);
    CREATE FUNCTION impuls.guard_rule_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Rule publication history is immutable' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_rule_publication() FROM PUBLIC;
    CREATE TRIGGER rule_publication_immutable BEFORE INSERT OR UPDATE OR DELETE ON impuls.rule_publications
      FOR EACH ROW EXECUTE FUNCTION impuls.guard_rule_publication();
  `);
};
const down = () => {
  throw new Error(
    "Keep rule publication history; disable RULES_MANAGEMENT_ENABLED to roll back the application",
  );
};
module.exports = { up, down };
