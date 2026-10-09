const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.view','task.create','task.assign','task.edit','task.cancel','task.review',
      'reward.decide','reward.fulfill','admin.access','admin.access.manage','admin.members.manage','admin.rules','admin.catalog',
      'admin.catalog.create','admin.catalog.publish','admin.catalog.schedule','admin.catalog.schedule.cancel','admin.catalog.quota.publish',
      'admin.audit','admin.notifications','ledger.correct'
    ));

    -- admin.members.manage is, like admin.access*, never delegated through the application.
    CREATE OR REPLACE FUNCTION impuls.guard_access_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    DECLARE b impuls.role_bindings%ROWTYPE;
    BEGIN
      IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Access change history is immutable' USING ERRCODE='23514'; END IF;
      SELECT * INTO b FROM impuls.role_bindings WHERE id=NEW.binding_id;
      IF NOT FOUND OR b.user_id<>NEW.subject_id OR b.scope_id<>NEW.scope_id OR b.action<>NEW.action
         OR NEW.actor_id=NEW.subject_id OR NEW.action IN ('admin.access','admin.access.manage','admin.members.manage')
         OR (NEW.kind='grant' AND b.granted_by<>NEW.actor_id)
         OR (NEW.kind='revoke' AND b.revoked_at IS NULL) THEN
        RAISE EXCEPTION 'Invalid access change' USING ERRCODE='23514';
      END IF;
      NEW.created_at=clock_timestamp();
      RETURN NEW;
    END $$;

    CREATE TABLE impuls.member_changes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL CHECK (kind IN ('admit','remove')),
      membership_id uuid NOT NULL REFERENCES impuls.task_scope_members(id),
      actor_id uuid NOT NULL REFERENCES impuls.users(id),
      subject_id uuid NOT NULL REFERENCES impuls.users(id),
      scope_id uuid NOT NULL REFERENCES impuls.access_scopes(id),
      user_created boolean NOT NULL,
      user_reactivated boolean NOT NULL,
      user_deactivated boolean NOT NULL,
      revoked_bindings integer NOT NULL CHECK (revoked_bindings >= 0),
      valid_until timestamptz,
      request_id uuid NOT NULL,
      reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (actor_id <> subject_id),
      CHECK (kind = 'admit' OR (NOT user_created AND NOT user_reactivated)),
      CHECK (kind = 'remove' OR (NOT user_deactivated AND revoked_bindings = 0))
    );
    CREATE INDEX member_changes_scope_time_id ON impuls.member_changes(scope_id, created_at DESC, id DESC);
    REVOKE ALL ON impuls.member_changes FROM PUBLIC;
    GRANT SELECT ON impuls.member_changes TO impuls_app;
    ALTER TABLE impuls.member_changes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY member_changes_server_read ON impuls.member_changes FOR SELECT TO impuls_app USING (true);
    CREATE FUNCTION impuls.keep_member_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      RAISE EXCEPTION 'Member change history is immutable' USING ERRCODE='23514';
    END $$;
    REVOKE ALL ON FUNCTION impuls.keep_member_change() FROM PUBLIC;
    CREATE TRIGGER keep_member_change BEFORE UPDATE OR DELETE ON impuls.member_changes
      FOR EACH ROW EXECUTE FUNCTION impuls.keep_member_change();

    -- Application errors of the two writers below. 'IM001' hides the object from callers
    -- without both rights; the rest are domain outcomes the caller maps to HTTP.
    --   IM001 no authority / unknown scope   IM002 forbidden target   IM003 conflict
    --   IM004 term in the past               IM005 membership not found
    CREATE FUNCTION impuls.assert_member_authority(p_actor uuid, p_scope uuid) RETURNS void
      LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    DECLARE ok boolean;
    BEGIN
      PERFORM 1 FROM impuls.users WHERE id=p_actor AND active FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'No member authority' USING ERRCODE='IM001'; END IF;
      SELECT count(DISTINCT action)=2 INTO ok FROM (
        SELECT action FROM impuls.role_bindings
        WHERE user_id=p_actor AND scope_id=p_scope AND action IN ('admin.access','admin.members.manage')
          AND revoked_at IS NULL AND valid_from<=clock_timestamp()
          AND (valid_until IS NULL OR valid_until>clock_timestamp()) FOR SHARE) held;
      IF NOT ok THEN RAISE EXCEPTION 'No member authority' USING ERRCODE='IM001'; END IF;
    END $$;
    REVOKE ALL ON FUNCTION impuls.assert_member_authority(uuid,uuid) FROM PUBLIC;

    CREATE FUNCTION impuls.admit_member(
      p_actor uuid, p_scope uuid, p_telegram bigint, p_name text,
      p_valid_until timestamptz, p_request uuid, p_reason text
    ) RETURNS TABLE(change_id uuid, membership_id uuid, user_id uuid, display_name text,
      membership_version integer, valid_until timestamptz, user_created boolean,
      user_reactivated boolean, changed_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    #variable_conflict use_column
    DECLARE u impuls.users%ROWTYPE; m impuls.task_scope_members%ROWTYPE;
      made boolean := false; woke boolean := false; cid uuid; at timestamptz;
    BEGIN
      PERFORM impuls.assert_member_authority(p_actor, p_scope);
      PERFORM pg_advisory_xact_lock(hashtextextended('members:'||p_scope::text,0));
      IF p_valid_until IS NOT NULL AND p_valid_until<=clock_timestamp() THEN
        RAISE EXCEPTION 'Term must be in the future' USING ERRCODE='IM004';
      END IF;
      SELECT * INTO u FROM impuls.users WHERE telegram_id=p_telegram FOR UPDATE;
      IF NOT FOUND THEN
        INSERT INTO impuls.users(telegram_id,display_name,active) VALUES(p_telegram,btrim(p_name),true)
          RETURNING * INTO u;
        made := true;
      ELSE
        IF u.id=p_actor THEN RAISE EXCEPTION 'Forbidden target' USING ERRCODE='IM002'; END IF;
        IF NOT u.active THEN
          UPDATE impuls.users SET active=true,version=version+1,updated_at=clock_timestamp()
            WHERE id=u.id RETURNING * INTO u;
          woke := true;
        END IF;
      END IF;
      SELECT * INTO m FROM impuls.task_scope_members WHERE scope_id=p_scope AND task_scope_members.user_id=u.id FOR UPDATE;
      IF NOT FOUND THEN
        INSERT INTO impuls.task_scope_members(scope_id,user_id,valid_from,valid_until)
          VALUES(p_scope,u.id,clock_timestamp(),p_valid_until) RETURNING * INTO m;
      ELSIF m.revoked_at IS NULL AND m.valid_from<=clock_timestamp()
        AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) AND NOT woke THEN
        RAISE EXCEPTION 'Already a member' USING ERRCODE='IM003';
      ELSE
        UPDATE impuls.task_scope_members SET revoked_at=NULL,valid_from=clock_timestamp(),valid_until=p_valid_until,
          version=version+1,updated_at=clock_timestamp() WHERE id=m.id RETURNING * INTO m;
      END IF;
      INSERT INTO impuls.member_changes(kind,membership_id,actor_id,subject_id,scope_id,user_created,user_reactivated,
        user_deactivated,revoked_bindings,valid_until,request_id,reason)
        VALUES('admit',m.id,p_actor,u.id,p_scope,made,woke,false,0,m.valid_until,p_request,p_reason)
        RETURNING id,created_at INTO cid,at;
      RETURN QUERY SELECT cid,m.id,u.id,u.display_name,m.version,m.valid_until,made,woke,at;
    END $$;
    REVOKE ALL ON FUNCTION impuls.admit_member(uuid,uuid,bigint,text,timestamptz,uuid,text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION impuls.admit_member(uuid,uuid,bigint,text,timestamptz,uuid,text) TO impuls_app;

    CREATE FUNCTION impuls.remove_member(
      p_actor uuid, p_scope uuid, p_membership uuid, p_expected integer, p_request uuid, p_reason text
    ) RETURNS TABLE(change_id uuid, membership_id uuid, user_id uuid, display_name text,
      membership_version integer, revoked_bindings integer, user_deactivated boolean, changed_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    #variable_conflict use_column
    DECLARE m impuls.task_scope_members%ROWTYPE; u impuls.users%ROWTYPE;
      ids uuid[]; n integer := 0; gone boolean := false; cid uuid; at timestamptz;
    BEGIN
      PERFORM impuls.assert_member_authority(p_actor, p_scope);
      PERFORM pg_advisory_xact_lock(hashtextextended('members:'||p_scope::text,0));
      SELECT * INTO m FROM impuls.task_scope_members WHERE id=p_membership AND scope_id=p_scope FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Unknown membership' USING ERRCODE='IM005'; END IF;
      IF m.revoked_at IS NOT NULL OR m.version<>p_expected OR m.valid_from>clock_timestamp()
        OR (m.valid_until IS NOT NULL AND m.valid_until<=clock_timestamp()) THEN
        RAISE EXCEPTION 'Membership changed' USING ERRCODE='IM003';
      END IF;
      IF m.user_id=p_actor THEN RAISE EXCEPTION 'Forbidden target' USING ERRCODE='IM002'; END IF;
      SELECT * INTO u FROM impuls.users WHERE id=m.user_id FOR UPDATE;
      -- Whoever administers access or members of this scope must be taken off by a path outside the app.
      PERFORM 1 FROM impuls.role_bindings WHERE user_id=m.user_id AND scope_id=p_scope
        AND action IN ('admin.access','admin.access.manage','admin.members.manage')
        AND revoked_at IS NULL AND (valid_until IS NULL OR valid_until>clock_timestamp());
      IF FOUND THEN RAISE EXCEPTION 'Forbidden target' USING ERRCODE='IM002'; END IF;
      SELECT coalesce(array_agg(id),'{}') INTO ids FROM impuls.role_bindings
        WHERE user_id=m.user_id AND scope_id=p_scope AND revoked_at IS NULL
          AND (valid_until IS NULL OR valid_until>clock_timestamp());
      n := coalesce(array_length(ids,1),0);
      IF n>0 THEN
        UPDATE impuls.role_bindings SET revoked_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1
          WHERE id=ANY(ids);
        INSERT INTO impuls.access_changes(kind,binding_id,actor_id,subject_id,scope_id,action,valid_until,request_id,reason)
          SELECT 'revoke',b.id,p_actor,b.user_id,p_scope,b.action,b.valid_until,p_request,p_reason
          FROM impuls.role_bindings b WHERE b.id=ANY(ids);
      END IF;
      UPDATE impuls.task_scope_members SET revoked_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
        WHERE id=m.id RETURNING * INTO m;
      PERFORM 1 FROM impuls.task_scope_members x WHERE x.user_id=m.user_id AND x.id<>m.id
        AND x.revoked_at IS NULL AND x.valid_from<=clock_timestamp()
        AND (x.valid_until IS NULL OR x.valid_until>clock_timestamp());
      IF NOT FOUND AND u.active THEN
        -- No other area keeps this person: end the allowlist entry; the existing trigger closes sessions.
        UPDATE impuls.users SET active=false,version=version+1,updated_at=clock_timestamp() WHERE id=u.id;
        gone := true;
      END IF;
      INSERT INTO impuls.member_changes(kind,membership_id,actor_id,subject_id,scope_id,user_created,user_reactivated,
        user_deactivated,revoked_bindings,valid_until,request_id,reason)
        VALUES('remove',m.id,p_actor,u.id,p_scope,false,false,gone,n,m.valid_until,p_request,p_reason)
        RETURNING id,created_at INTO cid,at;
      RETURN QUERY SELECT cid,m.id,u.id,u.display_name,m.version,n,gone,at;
    END $$;
    REVOKE ALL ON FUNCTION impuls.remove_member(uuid,uuid,uuid,integer,uuid,text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION impuls.remove_member(uuid,uuid,uuid,integer,uuid,text) TO impuls_app;
  `);
};
const down = () => {
  throw new Error(
    "Keep member change evidence; disable SYNTHETIC_MEMBER_MANAGEMENT_ENABLED to stop new changes",
  );
};
module.exports = { up, down };
