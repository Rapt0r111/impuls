import { describe, expect, it } from "vitest";
import { referencedRoles } from "../scripts/verify-backup.mjs";

describe("backup check role discovery", () => {
  it("collects roles from grants, revokes, default privileges and policies", () => {
    const script = [
      "REVOKE ALL ON TABLE impuls.users FROM PUBLIC;",
      "GRANT SELECT,INSERT ON TABLE impuls.users TO impuls_app;",
      'GRANT ALL ON FUNCTION impuls.claim() TO impuls_worker, "Odd Role";',
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA impuls GRANT SELECT ON TABLES TO anon;",
      "CREATE POLICY p ON impuls.users FOR SELECT TO impuls_expiry_executor USING (true);",
      "ALTER FUNCTION impuls.f() OWNER TO supabase_admin;",
      "-- GRANT ALL TO commented_out",
      "GRANT USAGE ON SCHEMA impuls TO CURRENT_USER;",
    ].join("\n");
    expect(referencedRoles(script)).toEqual([
      "Odd Role",
      "anon",
      "impuls_app",
      "impuls_expiry_executor",
      "impuls_worker",
      "postgres",
    ]);
  });
});
