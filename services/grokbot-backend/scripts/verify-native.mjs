/**
 * P7 gate: the native `/v1` surface is up on the BFF and does not require Cursor ACL.
 *
 *   node scripts/verify-native.mjs
 */
const base = (process.env.GROKBOT2_URL || "http://127.0.0.1:8788").replace(/\/$/, "");

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

console.log(`native ${base}/v1`);

let health = null;
try {
  const r = await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(2500) });
  check("GET /v1/health", r.ok, `HTTP ${r.status}`);
  health = r.ok ? await r.json() : null;
} catch (e) {
  check("GET /v1/health", false, String(e?.message ?? e));
}

check("health.ok", health?.ok === true, JSON.stringify(health ?? null));
check("health.pid", typeof health?.pid === "number", String(health?.pid ?? "missing"));
check("health.isBusy is boolean", typeof health?.isBusy === "boolean", String(health?.isBusy));

let session = null;
try {
  const r = await fetch(`${base}/v1/session`, { signal: AbortSignal.timeout(2500) });
  check("GET /v1/session", r.ok, `HTTP ${r.status}`);
  session = r.ok ? await r.json() : null;
} catch (e) {
  check("GET /v1/session", false, String(e?.message ?? e));
}

check("session has a bearer token", typeof session?.token === "string" && session.token.length >= 8, JSON.stringify({ tokenType: session?.tokenType, auth: session?.auth }));

const token = session?.token ?? "";
const auth = (extra = {}) => ({ authorization: `Bearer ${token}`, ...extra });

try {
  const r = await fetch(`${base}/v1/agents`, { headers: auth(), signal: AbortSignal.timeout(2500) });
  const j = r.ok ? await r.json() : null;
  check("GET /v1/agents with session token", r.ok && Array.isArray(j), `HTTP ${r.status}`);
} catch (e) {
  check("GET /v1/agents with session token", false, String(e?.message ?? e));
}

try {
  const r = await fetch(`${base}/gw/api/getAgentTranscriptTail`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth() },
    body: "{}",
    signal: AbortSignal.timeout(2500),
  });
  check("stock /gw still answers (ACL not removed)", r.status !== 404, `HTTP ${r.status}`);
} catch (e) {
  check("stock /gw still answers (ACL not removed)", false, String(e?.message ?? e));
}

process.exit(failed ? 1 : 0);
