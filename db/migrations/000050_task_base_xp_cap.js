const up = (pgm) => {
  pgm.sql(`
    -- Base XP for one task stays within 0–100; the bonus on top is not capped (ADR-0042). The limit is
    -- NOT VALID so reviews written before this migration keep their values; it is validated below only
    -- when no review breaks it.
    ALTER TABLE impuls.reviews
      DROP CONSTRAINT reviews_xp_limit_check,
      ADD CONSTRAINT reviews_xp_limit_check CHECK (fund_xp <= 100 AND base_xp <= 100) NOT VALID;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM impuls.reviews
        WHERE NOT (fund_xp <= 100 AND base_xp <= 100)) THEN
        ALTER TABLE impuls.reviews VALIDATE CONSTRAINT reviews_xp_limit_check;
      END IF;
    END $$;
  `);
};
const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.reviews
      DROP CONSTRAINT reviews_xp_limit_check,
      ADD CONSTRAINT reviews_xp_limit_check CHECK (fund_xp <= 100 AND base_xp + bonus_xp <= 100) NOT VALID;
  `);
};
module.exports = { up, down };
