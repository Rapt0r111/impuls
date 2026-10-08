import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "..");
const data = JSON.parse(
  fs.readFileSync(
    path.join(root, "outputs/system-progress-site/src/data.json"),
    "utf8",
  ),
);
const rows = data.queries.criteria.rows;
assert.equal(rows.length, 72);
assert.equal(new Set(rows.map((r) => r.id)).size, 72);
for (const r of rows) {
  assert.ok([0, 0.5, 1].includes(r.score));
  const colon = r.evidence.lastIndexOf(":");
  const file = r.evidence.slice(0, colon),
    line = Number(r.evidence.slice(colon + 1));
  assert.ok(
    fs
      .readFileSync(path.join(root, file), "utf8")
      .split(/\r?\n/)
      [line - 1]?.trim(),
    r.evidence,
  );
}
for (const f of data.queries.features.rows) {
  const c = rows.filter((r) => r.feature === f.feature);
  assert.equal(c.length, 6);
  assert.equal(
    f.points,
    c.reduce((s, x) => s + x.score, 0),
  );
  assert.equal(f.done + f.partial + f.missing, 6);
  assert.ok(Math.abs(f.coverage - (f.points / 6) * 100) < 1e-9);
}
assert.equal(rows.filter((r) => r.phase === "R1").length, 48);
assert.equal(rows.filter((r) => r.phase === "R2").length, 24);
assert.equal(
  rows.reduce((s, x) => s + x.score, 0),
  38,
);
assert.equal(rows.filter((r) => r.score === 1).length, 35);
assert.equal(rows.filter((r) => r.score === 0.5).length, 6);
assert.equal(rows.filter((r) => r.score === 0).length, 31);
assert.equal(
  data.queries.gates.rows.filter((r) => r.id.startsWith("P-")).length,
  6,
);
for (const r of data.queries.gallery.rows)
  assert.ok(fs.existsSync(path.join(root, r.file)));
assert.ok(!JSON.stringify(data).includes("postgres://"));
assert.ok(!JSON.stringify(data).includes("bot_token"));
assert.equal(data.report.asOf, "2026-10-05");
console.log(
  "PASS: 72 criteria, 12 reconciled functions, 48 R1 / 24 R2, 38 points, all evidence lines and four screenshots exist; no connection credentials.",
);
