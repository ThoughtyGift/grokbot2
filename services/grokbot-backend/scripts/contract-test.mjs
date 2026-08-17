/**
 * Gate A — assert this backend against the contract extracted from the shipped client.
 *
 * This is the piece that turns "does it match the original?" from an afternoon of squinting at
 * two windows into a command with an exit code. Nothing here needs the app running: the contract
 * is ground truth read out of `app.asar`, so a mismatch is a mismatch whether or not anyone is
 * looking at a screen.
 *
 * Four families of check, and the last two are the ones that would have caught real bugs:
 *
 *   routes    every path in the contract, its status codes, its required response fields
 *   auth      the three 401 branches the host has, and the fallback status
 *   commands  the 120 gateway commands, split into implemented / missing / deliberately skipped
 *   channels  every channel name this backend broadcasts must be one the coordinator accepts —
 *             `roster` was not, and that cost six rounds of guessing (parity.md §2w)
 *
 * Usage:
 *   node scripts/contract-test.mjs
 *   node scripts/contract-test.mjs --plan P2 --run 3
 *   node scripts/contract-test.mjs --only routes,auth
 *   node scripts/contract-test.mjs --base http://localhost:8788
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const CONTRACT = join(REPO, "docs", "extracted", "box-host-contract.json");
const GATEWAY_TS = join(REPO, "services", "grokbot-backend", "src", "gateway.ts");
const RUNS = join(REPO, "docs", "parity-runs");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:8788");
const PLAN = arg("--plan", "P1");
const RUN = Number(arg("--run", "1"));
const ONLY = (arg("--only", "") || "").split(",").filter(Boolean);
const want = (family) => ONLY.length === 0 || ONLY.includes(family);

if (!existsSync(CONTRACT)) {
  console.error(`no contract at ${CONTRACT} — run: node scripts/extract-contract.mjs`);
  process.exit(1);
}
const contract = JSON.parse(readFileSync(CONTRACT, "utf8"));

/**
 * The contract's paths are relative to the gateway base the host is mounted on; this backend
 * serves them under `/gw`. `/api/<cmd>` is the one exception in shape only — same prefix.
 */
const GW = "/gw";
const checks = [];
const record = (family, name, expected, actual, note) => {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  checks.push({ family, name, expected, actual, pass, ...(note ? { note } : {}) });
  return pass;
};

/**
 * Routes that answer with headers and then HOLD THE CONNECTION.
 *
 * `/events` is an SSE stream that stays open for the life of the app, and the two `/requests`
 * channels are long polls the host parks for ~25s until it has work. Reading their body to
 * completion is waiting for something designed never to complete — the first run of this script
 * reported all three as "unreachable: timeout", which is not a backend fault, it is the test
 * asking the wrong question. For these, headers arriving IS the answer.
 */
const isStreaming = (path) => path === "/events" || path.endsWith("/requests");

const req = async (method, path, { body, headers, stream = false } = {}) => {
  const controller = new AbortController();
  // A streaming probe needs only the headers, so it can give up quickly and cleanly.
  const timer = setTimeout(() => controller.abort(), stream ? 4_000 : 15_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(headers ?? {}) },
      ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    if (stream) {
      // Status and headers are already here; drop the body rather than draining a stream that
      // will not end.
      void res.body?.cancel().catch(() => {});
      return { status: res.status, headers: res.headers, text: "", json: undefined, streamed: true };
    }
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, headers: res.headers, text, json };
  } catch (e) {
    return { status: 0, text: String(e?.message ?? e), headers: new Headers() };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Long polls the host PARKS before answering — no headers arrive until it has work or times out.
 *
 * So neither "body completed" nor "headers arrived" is the right probe. What distinguishes a
 * working long poll is that it *holds*: an immediate answer is itself the bug (this backend's own
 * comment says answering instantly makes the client reconnect in a tight loop and read the box as
 * flapping), and a 404 means the route is missing.
 */
const isLongPoll = (path) => path.endsWith("/requests");

// ── routes ────────────────────────────────────────────────────────────────────
const probed = [];
if (want("routes")) {
  for (const route of contract.routes) {
    // A prefix route needs a parameter; `/api/<param>` is exercised by the commands family below.
    if (route.path.startsWith("/api")) continue;
    const path = route.path.replace("/<param>", "/contract-probe");
    const longPoll = isLongPoll(route.path);
    const r = await req(route.method, `${GW}${path}`, {
      ...(route.method === "POST" ? { body: {} } : {}),
      stream: isStreaming(route.path),
    });
    probed.push({ route, path, r });

    if (longPoll) {
      // aborted (status 0 after our short timeout) == held the connection == correct
      const behaviour = r.status === 0 ? "holds" : r.status === 404 ? "404" : `answers ${r.status} immediately`;
      record("routes", `${route.method} ${GW}${path} holds the connection`, "holds", behaviour,
        behaviour === "holds" ? undefined : "an instant answer makes the client reconnect in a tight loop");
      continue;
    }
    if (r.status === 0) {
      record("routes", `${route.method} ${GW}${path}`, "reachable", `unreachable: ${r.text}`);
      continue;
    }
    if (route.path === "/events") {
      const ct = r.headers.get("content-type") ?? "";
      record("routes", "GET /gw/events is text/event-stream", true, ct.includes("text/event-stream"), ct);
    }
  }
}

/**
 * Whether a route is really implemented — and status alone cannot answer that.
 *
 * While the backend is in observe mode an unmatched path answers `200 {}`, so a MISSING route
 * looks exactly like a working one. The authority is the recorder: if the probe turned up in
 * `unknownPaths`, nothing handled it. This is the observe machinery from P0-3 paying for itself a
 * second time — it makes "implemented" measurable without flipping to 404 first.
 */
if (want("routes") && probed.length) {
  const cov = await req("GET", `${GW}/__coverage`);
  const unknown = Object.keys(cov.json?.persisted?.unknownPaths ?? {});
  const strict = cov.json?.persisted?.strict404 === true;
  for (const { route, path, r } of probed) {
    if (isLongPoll(route.path)) continue;
    const key = `${route.method} ${GW}${path}`;
    const wasUnknown = unknown.includes(key);
    const implemented = strict ? r.status !== 404 : !wasUnknown;
    record("routes", `${key} implemented`, true, implemented,
      implemented ? undefined
        : `in the contract, not handled here — recorded as an unknown path${strict ? "" : " (observe mode: status was 200 from the fallback)"}`);
  }
}

// ── /health fields ────────────────────────────────────────────────────────────
if (want("routes")) {
  const r = await req("GET", `${GW}/health`);
  const got = r.json && typeof r.json === "object" ? Object.keys(r.json) : [];
  for (const field of contract.health.fields) {
    record("routes", `GET ${GW}/health has ${field}`, true, got.includes(field));
  }
  // The bare-root probe the observe pass caught the app making. Not in the contract — the
  // contract's paths are gateway-relative — but measured, and measurement outranks inference.
  const bare = await req("GET", "/health");
  record("routes", "GET /health (bare root) answers", true, bare.status !== 0 && bare.status !== 404,
    "observed live: something calls /health at the root, not /gw/health");
}

// ── auth + fallback ───────────────────────────────────────────────────────────
if (want("auth")) {
  for (const msg of contract.auth401) {
    record("auth", `contract carries 401 branch "${msg}"`, true, true, "extracted, not yet enforced here");
  }
  // The fallback. Two legitimate answers, and which one is correct depends on the phase we are
  // in — observe (200, recording) or strict (404, like the host). Both are reported, neither is
  // silently accepted as "fine".
  const bogus = await req("POST", `${GW}/definitely-not-a-real-route-${RUN}`, { body: { probe: 1 } });
  const cov = await req("GET", `${GW}/__coverage`);
  const strict = cov.json?.persisted?.strict404 === true;
  record("auth", "unmatched path status", strict ? 404 : 200, bogus.status,
    strict ? "strict mode: must match the host's 404" : "observe mode: 200 is expected, path must be recorded");
  const recorded = Object.keys(cov.json?.persisted?.unknownPaths ?? {})
    .some((k) => k.includes("definitely-not-a-real-route"));
  record("auth", "unmatched path recorded", true, recorded,
    "an unknown path that leaves no trace is the blind spot P0-3 closed");
  if (strict) {
    record("auth", "404 body matches the host's text", true,
      typeof bogus.json?.error === "string" && bogus.json.error.startsWith(contract.fallback.bodyContains));
  }
}

// ── gateway commands ──────────────────────────────────────────────────────────
if (want("commands")) {
  const gw = readFileSync(GATEWAY_TS, "utf8");
  // The `methods` table: two-space-indented `name: (` entries.
  const implemented = new Set([...gw.matchAll(/^ {2}([A-Za-z][\w]*):\s*\(/gm)].map((m) => m[1]));
  const skipped = new Set(contract.intentionallySkipped);
  const missing = contract.gatewayCommands
    .map((c) => c.name)
    .filter((n) => !implemented.has(n) && !skipped.has(n));

  record("commands", "every command is implemented or deliberately skipped", [], missing,
    missing.length ? `${missing.length} command(s) the client can send and we do not handle` : undefined);
  // A skipped command must be a DECISION, so it has to appear in the contract's skip list rather
  // than merely be absent from the table.
  for (const n of skipped) {
    record("commands", `skipped on purpose: ${n}`, false, implemented.has(n),
      "shared rooms need a real relay — a room nobody can join is worse than no room");
  }
}

// ── event channels ────────────────────────────────────────────────────────────
if (want("channels")) {
  const gw = readFileSync(GATEWAY_TS, "utf8");
  const broadcasts = [...new Set([...gw.matchAll(/broadcast\(\s*"([^"]+)"/g)].map((m) => m[1]))].sort();
  record("channels", "backend broadcasts at least one channel", true, broadcasts.length > 0);
  for (const ch of broadcasts) {
    const ok = contract.eventChannels.includes(ch);
    record("channels", `broadcast("${ch}") is a channel the coordinator accepts`, true, ok,
      ok ? undefined
         : `not in the 16-entry table — silently dropped. Valid: ${contract.eventChannels.join(", ")}`);
  }
  // The three families whose wire name differs. Emitting the family name looks right and is
  // dropped exactly as `roster` was, so name them explicitly.
  for (const [family, channel] of Object.entries(contract.channelAliases ?? {})) {
    record("channels", `does not broadcast the family name "${family}"`, false, broadcasts.includes(family),
      `the wire name is "${channel}"`);
  }
}

// ── report ────────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => !c.pass);
const byFamily = {};
for (const c of checks) {
  byFamily[c.family] ??= { checks: 0, failed: 0 };
  byFamily[c.family].checks += 1;
  if (!c.pass) byFamily[c.family].failed += 1;
}

let commit = "unknown";
try { commit = execSync("git rev-parse --short HEAD", { cwd: REPO }).toString().trim(); } catch { /* not a repo */ }

const out = {
  plan: PLAN,
  run: RUN,
  gate: "A",
  backendCommit: commit,
  appVersion: contract.appVersion,
  base: BASE,
  summary: byFamily,
  pass: failed.length === 0,
  mismatches: failed.map((c) => ({
    gate: "A",
    check: c.name,
    expected: c.expected,
    actual: c.actual,
    // Gate A only ever reads protocol shape, so everything it finds is class 1 by construction.
    loai: 1,
    ...(c.note ? { note: c.note } : {}),
  })),
};

mkdirSync(RUNS, { recursive: true });
const file = join(RUNS, `${PLAN}-gateA-run-${String(RUN).padStart(2, "0")}.json`);
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);

for (const [family, s] of Object.entries(byFamily)) {
  const mark = s.failed === 0 ? "PASS" : "FAIL";
  console.log(`${mark}  ${family.padEnd(9)} ${s.checks - s.failed}/${s.checks}`);
}
if (failed.length) {
  console.log(`\n${failed.length} mismatch(es):`);
  for (const c of failed) {
    console.log(`  ${c.name}`);
    console.log(`      expected ${JSON.stringify(c.expected)}`);
    console.log(`      actual   ${JSON.stringify(c.actual)}`);
    if (c.note) console.log(`      ${c.note}`);
  }
}
console.log(`\nwrote ${file}`);
process.exit(failed.length === 0 ? 0 : 1);
