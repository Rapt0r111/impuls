const up = (pgm) => {
  pgm.sql(`
    -- A participant renames only themselves. The name is shown to other members (ranking, review
    -- queue, journals), so every change is kept and two active users never share a name.
    CREATE TABLE impuls.profile_name_changes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES impuls.users(id),
      previous_name text NOT NULL,
      new_name text NOT NULL CHECK (char_length(new_name) BETWEEN 2 AND 40),
      request_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (previous_name <> new_name)
    );
    CREATE INDEX profile_name_changes_user_time ON impuls.profile_name_changes(user_id, created_at DESC, id DESC);
    REVOKE ALL ON impuls.profile_name_changes FROM PUBLIC;
    ALTER TABLE impuls.profile_name_changes ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION impuls.keep_profile_name_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      RAISE EXCEPTION 'Profile name history is immutable' USING ERRCODE='23514';
    END $$;
    REVOKE ALL ON FUNCTION impuls.keep_profile_name_change() FROM PUBLIC;
    CREATE TRIGGER keep_profile_name_change BEFORE UPDATE OR DELETE ON impuls.profile_name_changes
      FOR EACH ROW EXECUTE FUNCTION impuls.keep_profile_name_change();

    -- Case-insensitive comparison uses the builtin Unicode collation (PostgreSQL 17+): lower() under the
    -- database default would fold ASCII only when the cluster is created with the C locale.
    -- Returns 'ok', 'unchanged', 'taken' (case-insensitive clash with another active user) or
    -- 'inactive'. One global lock serialises renames, so two users cannot take a name together.
    CREATE FUNCTION impuls.rename_self(p_user uuid, p_name text, p_request uuid) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    DECLARE previous text;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('profile-name',0));
      SELECT display_name INTO previous FROM impuls.users WHERE id=p_user AND active FOR UPDATE;
      IF NOT FOUND THEN RETURN 'inactive'; END IF;
      IF previous = p_name THEN RETURN 'unchanged'; END IF;
      IF EXISTS (SELECT 1 FROM impuls.users WHERE active AND id<>p_user AND lower(display_name COLLATE pg_unicode_fast)=lower(p_name COLLATE pg_unicode_fast)) THEN
        RETURN 'taken';
      END IF;
      UPDATE impuls.users SET display_name=p_name, version=version+1, updated_at=clock_timestamp() WHERE id=p_user;
      INSERT INTO impuls.profile_name_changes(user_id,previous_name,new_name,request_id)
        VALUES(p_user,previous,p_name,p_request);
      RETURN 'ok';
    END $$;
    REVOKE ALL ON FUNCTION impuls.rename_self(uuid,text,uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION impuls.rename_self(uuid,text,uuid) TO impuls_app;
  `);
};
const down = () => {
  throw new Error("Keep profile name history; use a forward migration");
};
module.exports = { up, down };
