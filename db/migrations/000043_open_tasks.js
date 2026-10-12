const up = (pgm) => {
  pgm.sql(`
    -- A free task is a draft the commander marks as open for claiming: any active member of
    -- its scope may take it (self-assignment through the existing task_assignments row).
    -- The flag is set once at creation (INSERT only); impuls_app has no UPDATE on the column,
    -- so it can never be switched afterwards.
    ALTER TABLE impuls.tasks ADD COLUMN open_for_claim boolean NOT NULL DEFAULT false;
    CREATE INDEX tasks_open_for_claim_idx
      ON impuls.tasks (scope_id, due_at, id) WHERE status = 'draft' AND open_for_claim;
  `);
};
const down = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM impuls.tasks WHERE open_for_claim) THEN
        RAISE EXCEPTION 'Open tasks exist; keep the column and roll back the application';
      END IF;
    END $$;
    DROP INDEX impuls.tasks_open_for_claim_idx;
    ALTER TABLE impuls.tasks DROP COLUMN open_for_claim;
  `);
};
module.exports = { up, down };
