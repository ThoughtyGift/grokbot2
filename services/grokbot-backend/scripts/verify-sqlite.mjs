/**
 * P3 gate: sqlite is the hot path, state.json is frozen, seq is contiguous per agent.
 *
 * Speaks to the file, not to the process — WAL lets a reader inspect while the backend holds
 * the connection. A missing file here is "the migrate never ran", not "the backend is down".
 *
 *   node scripts/verify-sqlite.mjs
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, "..", ".data");
const SQLITE = process.env.GROKBOT2_SQLITE_FILE ?? join(DATA, "grokbot.sqlite");
const JSON_FILE = process.env.GROKBOT2_STATE_FILE ?? join(DATA, "state.json");

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

console.log(`sqlite  ${SQLITE}`);
console.log(`json    ${JSON_FILE}`);

check("grokbot.sqlite exists", existsSync(SQLITE), existsSync(SQLITE) ? `${statSync(SQLITE).size} bytes` : "missing");
if (!existsSync(SQLITE)) {
  process.exit(1);
}

const db = new DatabaseSync(SQLITE, { readOnly: true });
try {
  const imported = db.prepare("SELECT value FROM meta WHERE key = ?").get("imported");
  check("meta.imported is 1", imported?.value === "1", String(imported?.value ?? "unset"));

  const agents = db.prepare("SELECT COUNT(*) AS n FROM agents").get();
  check("agents table is readable", typeof agents?.n === "number", `n=${agents?.n}`);

  const parked = db.prepare("SELECT COUNT(*) AS n FROM parked").get();
  check("parked table is readable", typeof parked?.n === "number", `n=${parked?.n}`);

  const autos = db.prepare("SELECT COUNT(*) AS n FROM automations").get();
  check("automations table is readable", typeof autos?.n === "number", `n=${autos?.n}`);

  const dups = db.prepare(`
    SELECT agent_id, seq, COUNT(*) AS n FROM entries GROUP BY agent_id, seq HAVING n > 1
  `).all();
  check("no duplicate seq per agent", dups.length === 0, dups.length ? `${dups.length} collision(s)` : "unique");

  const backwards = db.prepare(`
    SELECT a.agent_id FROM (
      SELECT agent_id, seq, LAG(seq) OVER (PARTITION BY agent_id ORDER BY seq, id) AS prev
      FROM entries
    ) a WHERE a.prev IS NOT NULL AND a.seq <= a.prev
  `).all();
  // Historical seq is derived from entry ids (`e3555`), so values skip; the replica parks on a
  // decrease, not on a skip. New writes in store.test.ts are 1..n contiguous.
  check("per-agent seq never goes backwards", backwards.length === 0,
    backwards.length ? `${backwards.length} decrease(s)` : "monotonic");

  if (existsSync(JSON_FILE)) {
    const jsonM = statSync(JSON_FILE).mtimeMs;
    const sqlM = statSync(SQLITE).mtimeMs;
    check("state.json is not newer than sqlite (frozen, not hot)", jsonM <= sqlM + 2000,
      `json ${new Date(jsonM).toISOString()}  sqlite ${new Date(sqlM).toISOString()}`);
  } else {
    check("state.json missing — rollback source gone", false, "keep the frozen file");
  }
} finally {
  db.close();
}

console.log(failed ? `\n${failed} failed` : "\nverify-sqlite ok");
process.exit(failed ? 1 : 0);
