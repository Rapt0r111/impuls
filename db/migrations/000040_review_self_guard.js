const up = (pgm) => {
  pgm.sql(`
    -- Second line behind the domain's self_review check: nobody may review a submission
    -- they wrote or a task they are assigned to, whatever the application sends.
    -- Corrections and reward decisions already carry the same rule as table CHECKs.
    CREATE FUNCTION impuls.guard_review_reviewer() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM impuls.submissions s
        LEFT JOIN impuls.task_assignments a ON a.task_id=s.task_id AND a.user_id=NEW.reviewer_id
        WHERE s.id=NEW.submission_id AND (s.author_id=NEW.reviewer_id OR a.user_id IS NOT NULL)
      ) THEN RAISE EXCEPTION 'Reviewer cannot review own work' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_review_reviewer() FROM PUBLIC;
    CREATE TRIGGER reviews_reviewer_not_self BEFORE INSERT ON impuls.reviews
      FOR EACH ROW EXECUTE FUNCTION impuls.guard_review_reviewer();
  `);
};
const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER reviews_reviewer_not_self ON impuls.reviews;
    DROP FUNCTION impuls.guard_review_reviewer();
  `);
};
module.exports = { up, down };
