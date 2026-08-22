/**
 * P5 gate: the S6 computer process is up and answers as computer, not as the BFF.
 *
 *   node scripts/verify-computer.mjs
 */
const base = (process.env.GROKBOT2_COMPUTER_URL || "http://127.0.0.1:8790").replace(/\/$/, "");

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

console.log(`computer ${base}`);

let body = null;
try {
  const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) });
  check("GET /health", r.ok, `HTTP ${r.status}`);
  body = r.ok ? await r.json() : null;
} catch (e) {
  check("GET /health", false, String(e?.message ?? e));
}

check("role is computer", body?.role === "computer", JSON.stringify(body ?? null));
check("pid is a number", typeof body?.pid === "number", String(body?.pid ?? "missing"));

try {
  const r = await fetch(`${base}/internal/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(2500),
  });
  const j = await r.json();
  check("POST /internal/status without id still has agentId", typeof j?.agentId === "string", JSON.stringify(j));
  check("empty id is off", j?.state === "off", j?.state ?? "missing");
} catch (e) {
  check("POST /internal/status without id still has agentId", false, String(e?.message ?? e));
}

try {
  const r = await fetch(`${base}/internal/exec`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(2500),
  });
  const j = await r.json();
  check("POST /internal/exec without op is 400", r.status === 400, `HTTP ${r.status} ${JSON.stringify(j)}`);
} catch (e) {
  check("POST /internal/exec without op is 400", false, String(e?.message ?? e));
}

process.exit(failed ? 1 : 0);
