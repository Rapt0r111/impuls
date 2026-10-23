const up = (pgm) => {
  pgm.sql(`
    -- Points for one task stay within 0–100, bonuses included (ADR-0041). The limits are NOT VALID
    -- so rows written before this migration keep their values; they are validated below only when
    -- no row breaks them. The verifier's score is kept beside the fund, which stays frozen until the
    -- commander forwards the report.
    ALTER TABLE impuls.tasks
      ADD COLUMN verified_points integer CHECK (verified_points BETWEEN 0 AND 100),
      DROP CONSTRAINT tasks_requested_points_check,
      ADD CONSTRAINT tasks_requested_points_check CHECK (requested_points BETWEEN 0 AND 100) NOT VALID,
      ADD CONSTRAINT tasks_fund_points_limit_check CHECK (fund_points BETWEEN 0 AND 100) NOT VALID;
    GRANT UPDATE (verified_points) ON impuls.tasks TO impuls_app;
    ALTER TABLE impuls.reviews ADD CONSTRAINT reviews_points_limit_check CHECK (
      fund_points <= 100 AND base_points + bonus_points <= 100) NOT VALID;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM impuls.tasks
        WHERE requested_points > 100 OR fund_points > 100) THEN
        ALTER TABLE impuls.tasks VALIDATE CONSTRAINT tasks_requested_points_check,
          VALIDATE CONSTRAINT tasks_fund_points_limit_check;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM impuls.reviews
        WHERE NOT (fund_points <= 100 AND base_points + bonus_points <= 100)) THEN
        ALTER TABLE impuls.reviews VALIDATE CONSTRAINT reviews_points_limit_check;
      END IF;
    END $$;
  `);
};
const down = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM impuls.tasks WHERE verified_points IS NOT NULL) THEN
        RAISE EXCEPTION 'Verified points exist; keep the schema and roll back the application';
      END IF;
    END $$;
    ALTER TABLE impuls.reviews DROP CONSTRAINT reviews_points_limit_check;
    ALTER TABLE impuls.tasks
      DROP CONSTRAINT tasks_fund_points_limit_check,
      DROP CONSTRAINT tasks_requested_points_check,
      ADD CONSTRAINT tasks_requested_points_check CHECK (requested_points BETWEEN 0 AND 100000),
      DROP COLUMN verified_points;
  `);
};
module.exports = { up, down };
