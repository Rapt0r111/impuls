const up = (pgm) => {
  pgm.sql(`
    -- 000035 compared names with COLLATE pg_unicode_fast, which exists only in PostgreSQL 18+.
    -- Supabase runs 17.x, where the collation does not exist, so every rename failed at run
    -- time. pg_c_utf8 is the builtin C.UTF-8 collation of PostgreSQL 17 and 18: lower() folds
    -- Unicode (Cyrillic included) even when the database default locale is C.
    CREATE OR REPLACE FUNCTION impuls.rename_self(p_user uuid, p_name text, p_request uuid) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    DECLARE previous text;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('profile-name',0));
      SELECT display_name INTO previous FROM impuls.users WHERE id=p_user AND active FOR UPDATE;
      IF NOT FOUND THEN RETURN 'inactive'; END IF;
      IF previous = p_name THEN RETURN 'unchanged'; END IF;
      IF EXISTS (SELECT 1 FROM impuls.users WHERE active AND id<>p_user AND lower(display_name COLLATE pg_c_utf8)=lower(p_name COLLATE pg_c_utf8)) THEN
        RETURN 'taken';
      END IF;
      UPDATE impuls.users SET display_name=p_name, version=version+1, updated_at=clock_timestamp() WHERE id=p_user;
      INSERT INTO impuls.profile_name_changes(user_id,previous_name,new_name,request_id)
        VALUES(p_user,previous,p_name,p_request);
      RETURN 'ok';
    END $$;
  `);
};
const down = () => {
  throw new Error(
    "Keep the PostgreSQL 17 compatible collation; pg_unicode_fast does not exist before 18",
  );
};
module.exports = { up, down };
