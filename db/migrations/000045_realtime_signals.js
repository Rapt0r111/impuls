const tables = [
  // [table, events, kind]: «tasks» касается всех (свободные, очередь проверки), «ledger» — только владельца записи.
  ["tasks", "INSERT OR UPDATE", "tasks"],
  ["ledger_entries", "INSERT", "ledger"],
  ["account_balances", "INSERT OR UPDATE", "ledger"],
  ["redemptions", "INSERT OR UPDATE", "redemptions"],
  ["reward_versions", "INSERT OR UPDATE", "rewards"],
];

const up = (pgm) => {
  pgm.sql(`
    -- ADR-0038: мгновенные сигналы «данные изменились» через Supabase Realtime.
    -- Сигнал не несёт данных: клиент получает его и сам перечитывает API, где
    -- действуют обычные права. Тема канала — отпечаток секрета и id участника,
    -- поэтому подписаться на чужую тему нельзя, не зная секрета (он лежит только в БД).
    CREATE TABLE impuls.realtime_secret (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      secret bytea NOT NULL CHECK (octet_length(secret) = 32)
    );
    INSERT INTO impuls.realtime_secret (secret)
      VALUES (sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'utf8')));
    REVOKE ALL ON impuls.realtime_secret FROM PUBLIC;
    ALTER TABLE impuls.realtime_secret ENABLE ROW LEVEL SECURITY;

    CREATE FUNCTION impuls.realtime_topic(p_user uuid) RETURNS text
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
      SELECT 'impuls-' || encode(sha256(s.secret || convert_to(p_user::text, 'utf8')), 'hex')
      FROM impuls.realtime_secret s
    $$;
    REVOKE ALL ON FUNCTION impuls.realtime_topic(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION impuls.realtime_topic(uuid) TO impuls_app;

    -- Без расширения Realtime (обычный PostgreSQL, тесты) сигнал ничего не делает;
    -- сбой доставки никогда не отменяет бизнес-транзакцию.
    CREATE FUNCTION impuls.realtime_signal(p_users uuid[], p_kind text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
    DECLARE
      u uuid;
    BEGIN
      IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
        RETURN;
      END IF;
      FOREACH u IN ARRAY p_users LOOP
        BEGIN
          PERFORM realtime.send(
            jsonb_build_object('kind', p_kind),
            'change',
            impuls.realtime_topic(u),
            false
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END LOOP;
    END;
    $$;
    REVOKE ALL ON FUNCTION impuls.realtime_signal(uuid[], text) FROM PUBLIC;

    CREATE FUNCTION impuls.realtime_on_change() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
    BEGIN
      IF TG_ARGV[0] = 'ledger' THEN
        PERFORM impuls.realtime_signal(ARRAY[NEW.user_id], TG_ARGV[0]);
      ELSE
        PERFORM impuls.realtime_signal(
          ARRAY(SELECT id FROM impuls.users WHERE active), TG_ARGV[0]);
      END IF;
      RETURN NULL;
    END;
    $$;
    REVOKE ALL ON FUNCTION impuls.realtime_on_change() FROM PUBLIC;

    -- Роли API Supabase не должны видеть ни секрет, ни функции (у схемы impuls для них нет USAGE,
    -- здесь права отзываются явно на случай изменения умолчаний).
    DO $$
    DECLARE role_name text;
    BEGIN
      FOR role_name IN
        SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')
      LOOP
        EXECUTE format('REVOKE ALL ON impuls.realtime_secret FROM %I', role_name);
        EXECUTE format(
          'REVOKE ALL ON FUNCTION impuls.realtime_topic(uuid), impuls.realtime_signal(uuid[], text), impuls.realtime_on_change() FROM %I',
          role_name);
      END LOOP;
    END $$;

    ${tables
      .map(
        ([table, events, kind]) => `CREATE TRIGGER ${table}_realtime
      AFTER ${events} ON impuls.${table}
      FOR EACH ROW EXECUTE FUNCTION impuls.realtime_on_change('${kind}');`,
      )
      .join("\n    ")}
  `);
};

const down = () => {
  throw new Error("Use a forward migration");
};

module.exports = { up, down };
