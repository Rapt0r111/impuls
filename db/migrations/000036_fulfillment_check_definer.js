const up = (pgm) => {
  pgm.sql(`
    -- Deferred constraint triggers fire at commit. Before PostgreSQL 18 they run as the
    -- role current at commit time (the session role), not the role that queued the event.
    -- Automatic expiry updates redemptions inside a SECURITY DEFINER function, so the
    -- commit-time check ran as impuls_expiry_worker, which deliberately has no table
    -- privileges, and failed with "permission denied for table redemptions" on 17.x.
    -- The check reads only redemptions and entitlements and raises or returns NULL, so it
    -- runs with its owner's privileges and a fixed search_path instead of widening the
    -- worker role. Body is unchanged from 000027.
    CREATE OR REPLACE FUNCTION impuls.check_fulfillment() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    BEGIN
      IF NOT EXISTS(SELECT 1 FROM impuls.redemptions d WHERE d.id=NEW.id AND d.status='fulfilled') THEN RETURN NULL; END IF;
      IF EXISTS(SELECT 1 FROM impuls.redemptions d WHERE d.id=NEW.id AND d.status='fulfilled' AND NOT EXISTS(
        SELECT 1 FROM impuls.entitlements e WHERE e.redemption_id=d.id AND
        ROW(e.user_id,e.reward_id,e.scope_id,e.actor_id,e.reason,e.mode,e.created_at)
        IS NOT DISTINCT FROM ROW(d.user_id,d.reward_id,d.scope_id,d.fulfillment_actor_id,d.fulfillment_reason,d.mode,d.fulfilled_at)))
      THEN RAISE EXCEPTION 'Missing fulfillment entitlement' USING ERRCODE='23514'; END IF;
      RETURN NULL;
    END $$;
    REVOKE ALL ON FUNCTION impuls.check_fulfillment() FROM PUBLIC;
  `);
};
const down = () => {
  throw new Error(
    "Keep the definer trigger function; restoring invoker rights would break automatic expiry before PostgreSQL 18",
  );
};
module.exports = { up, down };
