const up = (pgm) => {
  pgm.sql(`
    -- The decision keeps the task fund (fund_*), the commander's corrected base and one
    -- optional bonus. The ledger still holds one xp and one points entry per acceptance
    -- (base + bonus), so balances, ranking, profile and corrections are unchanged; the
    -- review explains how each total was formed.
    ALTER TABLE impuls.reviews
      ADD COLUMN base_xp integer CHECK (base_xp >= 0),
      ADD COLUMN base_points integer CHECK (base_points >= 0),
      ADD COLUMN bonus_code text CHECK (bonus_code ~ '^[a-z][a-z0-9_]{1,39}$'),
      ADD COLUMN bonus_title text CHECK (char_length(bonus_title) BETWEEN 1 AND 80),
      ADD COLUMN bonus_xp integer CHECK (bonus_xp >= 0),
      ADD COLUMN bonus_points integer CHECK (bonus_points >= 0);
    UPDATE impuls.reviews SET base_xp=fund_xp, base_points=fund_points, bonus_xp=0, bonus_points=0
      WHERE decision='accept';
    ALTER TABLE impuls.reviews ADD CONSTRAINT reviews_award_breakdown_check CHECK (
      (decision='return' AND base_xp IS NULL AND base_points IS NULL AND bonus_code IS NULL
        AND bonus_title IS NULL AND bonus_xp IS NULL AND bonus_points IS NULL) OR
      (decision='accept' AND base_xp IS NOT NULL AND base_points IS NOT NULL
        AND bonus_xp IS NOT NULL AND bonus_points IS NOT NULL AND
        ((bonus_code IS NULL AND bonus_title IS NULL AND bonus_xp=0 AND bonus_points=0) OR
         (bonus_code IS NOT NULL AND bonus_title IS NOT NULL))));

    -- Rolling release: an application version that predates this migration inserts accepted
    -- reviews without the breakdown. Fill it with the unchanged fund and no bonus, which is
    -- exactly what that version pays, instead of failing every acceptance until the deploy.
    CREATE FUNCTION impuls.default_review_award() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF NEW.decision='accept' AND NEW.base_xp IS NULL AND NEW.base_points IS NULL
        AND NEW.bonus_xp IS NULL AND NEW.bonus_points IS NULL AND NEW.bonus_code IS NULL THEN
        NEW.base_xp:=NEW.fund_xp; NEW.base_points:=NEW.fund_points;
        NEW.bonus_xp:=0; NEW.bonus_points:=0;
      END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.default_review_award() FROM PUBLIC;
    CREATE TRIGGER reviews_default_award BEFORE INSERT ON impuls.reviews
      FOR EACH ROW EXECUTE FUNCTION impuls.default_review_award();

    -- A credit can never differ from what the saved decision says was awarded.
    -- Separate branch: a combined AND would still plan (and privilege-check) the reviews
    -- read for expiry credits written by a role that has no access to reviews.
    CREATE FUNCTION impuls.guard_acceptance_amount() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF NEW.kind<>'task_acceptance' THEN RETURN NEW; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM impuls.reviews r WHERE r.id=NEW.review_id AND r.decision='accept'
          AND NEW.amount=CASE NEW.currency WHEN 'xp' THEN r.base_xp+r.bonus_xp ELSE r.base_points+r.bonus_points END
      ) THEN RAISE EXCEPTION 'Acceptance amount differs from the saved decision' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_acceptance_amount() FROM PUBLIC;
    CREATE TRIGGER ledger_acceptance_amount BEFORE INSERT ON impuls.ledger_entries
      FOR EACH ROW EXECUTE FUNCTION impuls.guard_acceptance_amount();
  `);
};
const down = () => {
  throw new Error("Keep the saved award breakdown; use a forward migration");
};
module.exports = { up, down };
