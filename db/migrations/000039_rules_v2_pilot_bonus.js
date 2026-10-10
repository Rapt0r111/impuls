const up = (pgm) => {
  pgm.sql(`
    -- Rules version for the pilot (P-04, owner decision 10.10.2026, ADR-0031): the reviewer
    -- may lower the base down to 50 % of the task fund and add one bonus of +10 % or +25 %
    -- of the fund. Past versions are never edited (§ 5): this publishes a new version that
    -- copies everything else from the latest synthetic version with acceptance enabled.
    -- Tasks keep the version they were created with; only tasks created under the new
    -- version get these options. Without such a source version (an empty database) nothing
    -- is published, because a version needs its economy settings and an author.
    INSERT INTO impuls.rule_sets (version_number, definition, effective_from, created_by)
    SELECT (SELECT max(version_number) FROM impuls.rule_sets) + 1,
      jsonb_set(source.definition, '{acceptance}',
        (source.definition->'acceptance') - 'adjustment' - 'bonuses' || jsonb_build_object(
          'adjustment', jsonb_build_object('minPercent', 50),
          'bonuses', jsonb_build_array(
            jsonb_build_object('code', 'plus_10', 'title', 'Бонус +10 %', 'percent', 10),
            jsonb_build_object('code', 'plus_25', 'title', 'Бонус +25 %', 'percent', 25)))),
      clock_timestamp(), source.created_by
    FROM (
      SELECT definition, created_by FROM impuls.rule_sets
      WHERE definition->>'mode' = 'synthetic' AND definition->'acceptance'->>'enabled' = 'true'
      ORDER BY version_number DESC LIMIT 1
    ) source;
  `);
};
const down = () => {
  throw new Error(
    "A published rules version may already be bound to tasks; publish a new version instead",
  );
};
module.exports = { up, down };
