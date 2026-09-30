const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE impuls.reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      submission_id uuid NOT NULL UNIQUE REFERENCES impuls.submissions(id),
      reviewer_id uuid NOT NULL REFERENCES impuls.users(id),
      decision text NOT NULL CHECK (decision = 'return'),
      reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    REVOKE ALL ON impuls.reviews FROM PUBLIC;
    GRANT SELECT, INSERT ON impuls.reviews TO impuls_app;
    ALTER TABLE impuls.reviews ENABLE ROW LEVEL SECURITY;
    CREATE POLICY reviews_server_access ON impuls.reviews
      FOR ALL TO impuls_app USING (true) WITH CHECK (true);
  `);
};
const down = (pgm) => {
  pgm.sql("DROP TABLE impuls.reviews");
};
module.exports = { up, down };
