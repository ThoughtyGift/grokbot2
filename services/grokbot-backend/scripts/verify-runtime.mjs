/**
 * P4 gate: the S5 brain process is up and answers as runtime, not as the BFF.
 *
 *   node scripts/verify-runtime.mjs
 */
const base = (process.env.GROKBOT2_RUNTIME_URL || "http://127.0.0.1:8789").replace(/\/$/, "");

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

console.log(`runtime ${base}`);

let body = null;
try {
  const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) });
  check("GET /health", r.ok, `HTTP ${r.status}`);
  body = r.ok ? await r.json() : null;
} catch (e) {
  check("GET /health", false, String(e?.message ?? e));
}

check("role is runtime", body?.role === "runtime", JSON.stringify(body ?? null));
check("pid is a number", typeof body?.pid === "number", String(body?.pid ?? "missing"));

try {
  const r = await fetch(`${base}/internal/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(2500),
  });
  const j = await r.json();
  check("POST /internal/turns without messages is 400", r.status === 400, `HTTP ${r.status} ${JSON.stringify(j)}`);
} catch (e) {
  check("POST /internal/turns without messages is 400", false, String(e?.message ?? e));
}

process.exit(failed ? 1 : 0);
