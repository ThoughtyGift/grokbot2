/**
 * E2E coverage harness — replays every coordinator/gateway method the Grok Bot frontend
 * declares against the running backend, then reports what is really implemented vs stubbed.
 *
 *   node scripts/e2e-coverage.mjs [--bundle <renderer index-*.js>] [--base http://localhost:8788]
 *
 * Method names come straight out of the client bundle's coordinator maps
 * ({name:{args:"…",reply:"…"}}), so the list stays true to the shipped frontend.
 */
import { readFileSync, existsSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:8788");
const BUNDLE = arg("--bundle",
  "C:/Users/admin/AppData/Local/Temp/claude/c--Users-admin-Desktop-Grok-Bot/0cd063f0-c93a-40fd-873b-69cb94dc1839/scratchpad/asar-extracted/dist/renderer/assets/index-DNC736IO.js");

// ── 1. the frontend's declared method surface ──
const declared = [];
if (existsSync(BUNDLE)) {
  const js = readFileSync(BUNDLE, "utf8");
  const re = /([A-Za-z][A-Za-z0-9]*):\{args:"(none|object)",reply:"([a-z-]+)"\}/g;
  const seen = new Map();
  for (const m of js.matchAll(re)) if (!seen.has(m[1])) seen.set(m[1], { args: m[2], reply: m[3] });
  for (const [name, v] of seen) declared.push({ name, ...v });
} else {
  console.error("bundle not found, nothing to replay:", BUNDLE);
  process.exit(1);
}

const post = async (m, body) => {
  const r = await fetch(`${BASE}/gw/api/${m}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}),
  });
  return r.json().catch(() => null);
};

// Seed one agent so id-bearing calls have something real to act on.
const seeded = await post("createAgent", { name: "E2E Probe" });
const agentId = seeded?.agent?.id ?? seeded?.id ?? "agent-1";
const probeArgs = { id: agentId, agentId, ids: [], entryId: "e1", requestId: "none" };

const isEmpty = (v) =>
  v === null || v === undefined ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

const rows = [];
for (const d of declared) {
  if (/^(deleteAgents|clearTrays|interruptAgentRun)$/.test(d.name)) { rows.push({ ...d, status: "SKIP" }); continue; }
  let val, err = null;
  try { val = await post(d.name, d.args === "none" ? {} : probeArgs); } catch (e) { err = String(e); }
  rows.push({ ...d, empty: isEmpty(val), error: err, sample: err ?? JSON.stringify(val).slice(0, 68) });
}

// The backend's own map is the source of truth for "handled"; a void-reply method that
// answers {} is correct, not a stub. Unhandled methods silently fall through to {}.
const cov = await fetch(`${BASE}/gw/__coverage`).then((r) => r.json()).catch(() => null);
const handled = new Set(cov?.implemented ?? []);
for (const r of rows) {
  if (r.status === "SKIP") { r.status = handled.has(r.name) ? "HANDLED (not probed)" : "MISSING"; continue; }
  if (r.error) r.status = "ERROR";
  else if (!handled.has(r.name)) r.status = "MISSING";
  else if (r.empty && r.reply !== "void") r.status = "HANDLED (empty)";
  else r.status = "HANDLED";
}
const by = (s) => rows.filter((r) => r.status.startsWith(s));
const missing = by("MISSING"), handledRows = by("HANDLED");

console.log(`\n=== Grok Bot FE ↔ grokbot2 backend coverage ===`);
console.log(`frontend declares : ${declared.length} coordinator methods`);
console.log(`handled by backend: ${handledRows.length}`);
console.log(`NOT mapped        : ${missing.length}`);

console.log(`\n--- HANDLED (${handledRows.length}) ---`);
for (const r of handledRows) console.log(`  ✅ ${r.name.padEnd(32)} ${r.status === "HANDLED (empty)" ? "(returns empty)" : r.sample ?? ""}`);

console.log(`\n--- NOT MAPPED (${missing.length}) — the FE calls these, backend answers {} ---`);
for (const r of missing) console.log(`  ⬜ ${r.name.padEnd(32)} reply:${r.reply}`);
