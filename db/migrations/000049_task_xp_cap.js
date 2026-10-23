const up = (pgm) => {
  pgm.sql(`
    -- XP for one task stays within 0–100, bonuses included, as points do (ADR-0042). The limits are
    -- NOT VALID so rows written before this migration keep their values; they are validated below only
    -- when no row breaks them.
    ALTER TABLE impuls.tasks
      DROP CONSTRAINT tasks_requested_xp_check,
      ADD CONSTRAINT tasks_requested_xp_check CHECK (requested_xp BETWEEN 0 AND 100) NOT VALID,
      DROP CONSTRAINT tasks_verified_xp_check,
      ADD CONSTRAINT tasks_verified_xp_check CHECK (verified_xp BETWEEN 0 AND 100) NOT VALID,
      ADD CONSTRAINT tasks_fund_xp_limit_check CHECK (fund_xp BETWEEN 0 AND 100) NOT VALID;
    ALTER TABLE impuls.reviews ADD CONSTRAINT reviews_xp_limit_check CHECK (
      fund_xp <= 100 AND base_xp + bonus_xp <= 100) NOT VALID;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM impuls.tasks
        WHERE requested_xp > 100 OR verified_xp > 100 OR fund_xp > 100) THEN
        ALTER TABLE impuls.tasks VALIDATE CONSTRAINT tasks_requested_xp_check,
          VALIDATE CONSTRAINT tasks_verified_xp_check,
          VALIDATE CONSTRAINT tasks_fund_xp_limit_check;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM impuls.reviews
        WHERE NOT (fund_xp <= 100 AND base_xp + bonus_xp <= 100)) THEN
        ALTER TABLE impuls.reviews VALIDATE CONSTRAINT reviews_xp_limit_check;
      END IF;
    END $$;
  `);
};
const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.reviews DROP CONSTRAINT reviews_xp_limit_check;
    ALTER TABLE impuls.tasks
      DROP CONSTRAINT tasks_fund_xp_limit_check,
      DROP CONSTRAINT tasks_requested_xp_check,
      ADD CONSTRAINT tasks_requested_xp_check CHECK (requested_xp BETWEEN 0 AND 100000),
      DROP CONSTRAINT tasks_verified_xp_check,
      ADD CONSTRAINT tasks_verified_xp_check CHECK (verified_xp BETWEEN 0 AND 100000);
  `);
};
module.exports = { up, down };
