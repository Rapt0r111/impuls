const up = (pgm) => {
  pgm.sql(`
    REVOKE ALL ON FUNCTION impuls.revoke_sessions_on_permission_change() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION impuls.revoke_sessions_on_permission_change() TO impuls_app;
  `);
};

const down = (pgm) => {
  pgm.sql(`
    REVOKE EXECUTE ON FUNCTION impuls.revoke_sessions_on_permission_change() FROM impuls_app;
    GRANT EXECUTE ON FUNCTION impuls.revoke_sessions_on_permission_change() TO PUBLIC;
  `);
};

module.exports = { up, down };
