const up = (pgm) => {
  pgm.sql(`
    -- Rules version for the pilot (P-04, owner decision 10.10.2026, ADR-0031): the reviewer
    -- may lower the base down to 50 % of the task fund and add one bonus of +10 % or +25 %
    -- of the fund. Past versions are never edited (§ 5): this publishes a new version.
    -- Tasks keep the version they were created with; only tasks created under the new
    -- version get these options.
    WITH pilot(acceptance) AS (
      SELECT jsonb_build_object(
        'adjustment', jsonb_build_object('minPercent', 50),
        'bonuses', jsonb_build_array(
          jsonb_build_object('code', 'plus_10', 'title', 'Бонус +10 %', 'percent', 10),
          jsonb_build_object('code', 'plus_25', 'title', 'Бонус +25 %', 'percent', 25)))
    ),
    -- Everything else is copied from the latest synthetic version with acceptance enabled.
    copied AS (
      SELECT jsonb_set(source.definition, '{acceptance}',
          (source.definition->'acceptance') - 'adjustment' - 'bonuses' || pilot.acceptance) AS definition,
        source.created_by
      FROM pilot, (
        SELECT definition, created_by FROM impuls.rule_sets
        WHERE definition->>'mode' = 'synthetic' AND definition->'acceptance'->>'enabled' = 'true'
        ORDER BY version_number DESC LIMIT 1
      ) source
    ),
    -- Without such a version (Production had none on 10.10.2026) publish only what the owner
    -- decided: Europe/Moscow and acceptance with these options. No level thresholds: they
    -- were never decided, so the profile shows levels as not configured. The author is the
    -- holder of admin.rules (the owner after bootstrap); with nobody to name, nothing is
    -- published (an empty database, CI).
    minimal AS (
      SELECT jsonb_build_object('mode', 'synthetic', 'timeZone', 'Europe/Moscow',
          'acceptance', jsonb_build_object('enabled', true) || pilot.acceptance) AS definition,
        owner.user_id AS created_by
      FROM pilot, (
        SELECT b.user_id FROM impuls.role_bindings b JOIN impuls.users u ON u.id = b.user_id AND u.active
        WHERE b.action = 'admin.rules' AND b.revoked_at IS NULL AND b.valid_from <= clock_timestamp()
          AND (b.valid_until IS NULL OR b.valid_until > clock_timestamp())
        ORDER BY b.valid_from, b.user_id LIMIT 1
      ) owner
      WHERE NOT EXISTS (SELECT 1 FROM copied)
    )
    INSERT INTO impuls.rule_sets (version_number, definition, effective_from, created_by)
    SELECT coalesce((SELECT max(version_number) FROM impuls.rule_sets), 0) + 1,
      definition, clock_timestamp(), created_by
    FROM (SELECT * FROM copied UNION ALL SELECT * FROM minimal) chosen;
  `);
};
const down = () => {
  throw new Error(
    "A published rules version may already be bound to tasks; publish a new version instead",
  );
};
module.exports = { up, down };
