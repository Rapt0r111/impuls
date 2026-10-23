const up = (pgm) => {
  pgm.sql(`
    -- The verifier proposes XP beside points; the commander sees it and approves or changes it (ADR-0041).
    ALTER TABLE impuls.tasks
      ADD COLUMN verified_xp integer CHECK (verified_xp BETWEEN 0 AND 100000);
    GRANT UPDATE (verified_xp) ON impuls.tasks TO impuls_app;
  `);
};
const down = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM impuls.tasks WHERE verified_xp IS NOT NULL) THEN
        RAISE EXCEPTION 'Verified XP exist; keep the schema and roll back the application';
      END IF;
    END $$;
    ALTER TABLE impuls.tasks DROP COLUMN verified_xp;
  `);
};
module.exports = { up, down };
