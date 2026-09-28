const up = (pgm) => {
  pgm.sql(`
    ALTER FUNCTION impuls.revoke_sessions_on_access_change()
      SET search_path = pg_catalog;
  `);
};

const down = (pgm) => {
  pgm.sql(`
    ALTER FUNCTION impuls.revoke_sessions_on_access_change()
      RESET search_path;
  `);
};

module.exports = { up, down };
