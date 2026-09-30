const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.reviews DROP CONSTRAINT reviews_decision_check;
    ALTER TABLE impuls.reviews ADD CONSTRAINT reviews_decision_check CHECK (decision IN ('return', 'accept'));
    ALTER TABLE impuls.reviews ADD COLUMN fund_xp integer CHECK (fund_xp >= 0);
    ALTER TABLE impuls.reviews ADD COLUMN fund_points integer CHECK (fund_points >= 0);
    ALTER TABLE impuls.reviews ADD CONSTRAINT reviews_fund_snapshot_check CHECK (
      (decision = 'return' AND fund_xp IS NULL AND fund_points IS NULL) OR
      (decision = 'accept' AND fund_xp IS NOT NULL AND fund_points IS NOT NULL)
    );
    CREATE TABLE impuls.ledger_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES impuls.users(id),
      review_id uuid NOT NULL REFERENCES impuls.reviews(id),
      task_id uuid NOT NULL REFERENCES impuls.tasks(id),
      task_title text NOT NULL CHECK (char_length(task_title) BETWEEN 1 AND 120),
      rule_set_id uuid NOT NULL REFERENCES impuls.rule_sets(id),
      rule_version integer NOT NULL CHECK (rule_version > 0),
      currency text NOT NULL CHECK (currency IN ('xp', 'points')),
      kind text NOT NULL CHECK (kind = 'task_acceptance'),
      amount integer NOT NULL CHECK (amount >= 0),
      mode text NOT NULL CHECK (mode = 'synthetic'),
      season_key text NOT NULL CHECK (season_key ~ '^[0-9]{4}-[0-9]{2}$'),
      time_zone text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 80),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz(3) NOT NULL,
      updated_at timestamptz(3) NOT NULL,
      UNIQUE (review_id, user_id, currency, kind)
    );
    CREATE INDEX ledger_entries_user_time_idx ON impuls.ledger_entries (user_id, created_at DESC, id DESC);
    CREATE TABLE impuls.account_balances (
      user_id uuid PRIMARY KEY REFERENCES impuls.users(id),
      lifetime_xp bigint NOT NULL DEFAULT 0 CHECK (lifetime_xp BETWEEN 0 AND 9007199254740991),
      available_points bigint NOT NULL DEFAULT 0 CHECK (available_points BETWEEN 0 AND 9007199254740991),
      reserved_points bigint NOT NULL DEFAULT 0 CHECK (reserved_points BETWEEN 0 AND 9007199254740991),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE impuls.audit_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_id uuid NOT NULL REFERENCES impuls.users(id),
      review_id uuid NOT NULL UNIQUE REFERENCES impuls.reviews(id),
      action text NOT NULL CHECK (action IN ('task.accept', 'task.return')),
      request_id uuid NOT NULL,
      reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
      diff jsonb NOT NULL CHECK (jsonb_typeof(diff) = 'object'),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    );
    CREATE TABLE impuls.notification_outbox (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recipient_id uuid NOT NULL REFERENCES impuls.users(id),
      review_id uuid NOT NULL UNIQUE REFERENCES impuls.reviews(id),
      kind text NOT NULL CHECK (kind IN ('task.accepted', 'task.returned')),
      mode text NOT NULL CHECK (mode = 'synthetic'),
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'suppressed')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    );
    REVOKE ALL ON impuls.ledger_entries, impuls.account_balances, impuls.audit_events, impuls.notification_outbox FROM PUBLIC;
    GRANT SELECT, INSERT ON impuls.ledger_entries, impuls.account_balances, impuls.audit_events, impuls.notification_outbox TO impuls_app;
    GRANT UPDATE (lifetime_xp, available_points, reserved_points, version, updated_at) ON impuls.account_balances TO impuls_app;
    ALTER TABLE impuls.ledger_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.account_balances ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.audit_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.notification_outbox ENABLE ROW LEVEL SECURITY;
    CREATE POLICY ledger_entries_server_access ON impuls.ledger_entries FOR ALL TO impuls_app USING (true) WITH CHECK (true);
    CREATE POLICY account_balances_server_access ON impuls.account_balances FOR ALL TO impuls_app USING (true) WITH CHECK (true);
    CREATE POLICY audit_events_server_access ON impuls.audit_events FOR ALL TO impuls_app USING (true) WITH CHECK (true);
    CREATE POLICY notification_outbox_server_access ON impuls.notification_outbox FOR ALL TO impuls_app USING (true) WITH CHECK (true);
  `);
};
const down = (pgm) => {
  pgm.sql(`
    DROP TABLE impuls.notification_outbox;
    DROP TABLE impuls.audit_events;
    DROP TABLE impuls.account_balances;
    DROP TABLE impuls.ledger_entries;
    ALTER TABLE impuls.reviews DROP CONSTRAINT reviews_fund_snapshot_check;
    ALTER TABLE impuls.reviews DROP COLUMN fund_xp, DROP COLUMN fund_points;
    ALTER TABLE impuls.reviews DROP CONSTRAINT reviews_decision_check;
    ALTER TABLE impuls.reviews ADD CONSTRAINT reviews_decision_check CHECK (decision = 'return');
  `);
};
module.exports = { up, down };
