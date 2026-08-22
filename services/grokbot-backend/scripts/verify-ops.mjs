/**
 * P6 gate: the S10/S11 ops process is up and answers as ops, not as the BFF.
 *
 *   node scripts/verify-ops.mjs
 */
const base = (process.env.GROKBOT2_OPS_URL || "http://127.0.0.1:8791").replace(/\/$/, "");

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

console.log(`ops ${base}`);

let body = null;
try {
  const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) });
  check("GET /health", r.ok, `HTTP ${r.status}`);
  body = r.ok ? await r.json() : null;
} catch (e) {
  check("GET /health", false, String(e?.message ?? e));
}

check("role is ops", body?.role === "ops", JSON.stringify(body ?? null));
check("pid is a number", typeof body?.pid === "number", String(body?.pid ?? "missing"));

try {
  const r = await fetch(`${base}/slack/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "url_verification", challenge: "p6-ops-challenge" }),
    signal: AbortSignal.timeout(2500),
  });
  const j = await r.json();
  check("POST /slack/events url_verification is 200", r.ok, `HTTP ${r.status}`);
  check("challenge is echoed", j?.challenge === "p6-ops-challenge", JSON.stringify(j));
} catch (e) {
  check("POST /slack/events url_verification is 200", false, String(e?.message ?? e));
}

process.exit(failed ? 1 : 0);
