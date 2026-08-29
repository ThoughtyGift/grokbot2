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
import { gwHeaders } from "./gw-auth.mjs";
import { WIRE_CHANNELS, PUSHED_CHANNELS, NO_DATA_CHANNELS, SHARED_ROOM_COMMANDS, buildCommands } from "@grokbot2/cursor-acl";
/** Enumerating the table only touches `ports` inside the handlers it returns. */
const ACL_PORT_STUB = new Proxy({}, { get: () => new Proxy(() => {}, { get: () => () => {}, apply: () => ({}) }) });

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const CONTRACT = join(REPO, "docs", "extracted", "box-host-contract.json");
/**
 * Where the Cursor dialect is written down.
 *
 * The command table and the SSE channel names moved into `@grokbot2/cursor-acl` in Phase 2, and
 * `gateway.ts` is now only the adapter that supplies its ports. Both are read: the source of
 * truth is "everything that speaks the dialect", so a name reappearing in the service would be
 * caught rather than silently un-checked.
 */
const DIALECT_SRC = [
  join(REPO, "packages", "cursor-acl", "src", "commands.ts"),
  join(REPO, "packages", "cursor-acl", "src", "sse.ts"),
  join(REPO, "packages", "cursor-acl", "src", "http.ts"),
  join(REPO, "services", "grokbot-backend", "src", "gateway.ts"),
];
const dialectSource = () => DIALECT_SRC.filter(existsSync).map((f) => readFileSync(f, "utf8")).join("\n");
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

// ── hợp đồng 0.29/0.30 ────────────────────────────────────────────────────────
//
// Tập tên hợp lệ lấy từ HỢP ĐỒNG MỚI NHẤT đọc được, không phải từ 0.20.
//
// `box-host-contract.json` bóc từ `dist/host` của 0.20 và liệt kê 16 kênh. 0.29/0.30 bỏ hẳn thư
// mục ấy, nhưng bảng kênh client CHẤP NHẬN vẫn đọc được ở `node-agent-coordinator` — và nó có 18:
// thêm `agent-activity` và `mcp-auth`, không bỏ cái nào. Chấm bằng danh sách 16 thì hai tên mới bị
// coi là sai trong khi client nhận chúng bình thường.
//
// Dựng lại bằng: node scripts/extract-host-0-30.mjs --dist <thư mục dist>
const C30_FILE = join(REPO, "docs", "extracted", "host-contract-0-30.json");
const c30 = existsSync(C30_FILE) ? JSON.parse(readFileSync(C30_FILE, "utf8")) : null;
const NHAN = [...new Set([...contract.eventChannels, ...(c30?.channels ?? [])])];
const BI_DANH = { ...(contract.channelAliases ?? {}), ...(c30?.channelAliases ?? {}) };


/*
 * Bảng lệnh đọc riêng, KHÔNG lấy từ ảnh chụp hợp đồng.
 *
 * Hai file cùng giữ một danh sách và chúng đã trôi xa nhau: `box-host-contract.json` là ảnh của
 * **0.20** (120 lệnh), bảng thật của 0.30 có **147**. Gate đọc file cũ nên báo PASS 10/10 trong khi
 * 12 lệnh client gửi được không ai trả lời.
 */
const CMDS = join(REPO, "docs", "extracted", "gateway-commands.json");
if (!existsSync(CMDS)) {
  console.error(`no command table at ${CMDS} — run: node scripts/extract-gateway.mjs <asar-dir>`);
  process.exit(2);
}
const bangLenh = JSON.parse(readFileSync(CMDS, "utf8")).commands.map((c) => c.name ?? String(c));

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
      // The ticket, once P0-5 enforces it. Spread first so a check that deliberately sends a
      // wrong or absent credential can still override it.
      headers: { "content-type": "application/json", ...gwHeaders(), ...(headers ?? {}) },
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
/**
 * When probing started.
 *
 * `unknownPaths` is a HISTORICAL record that survives restarts by design, so "is this key
 * present?" is the wrong question — a path recorded before the route was implemented stays in the
 * file for ever and the route reads as missing long after it works. The right question is whether
 * the recorder saw it DURING this probe, which is a timestamp comparison.
 */
const probeStartMs = Date.now();
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
  const unknown = cov.json?.persisted?.unknownPaths ?? {};
  const strict = cov.json?.persisted?.strict404 === true;
  for (const { route, path, r } of probed) {
    if (isLongPoll(route.path)) continue;
    const key = `${route.method} ${GW}${path}`;
    // Recorded during THIS probe, not merely present in the file. `- 1000` absorbs clock skew
    // between this process and the backend's debounced write.
    const hit = unknown[key];
    const wasUnknown = hit != null && hit.lastMs >= probeStartMs - 1000;
    // In strict mode a 404 is ambiguous, and reading only the status gets it wrong: `/avatars/<id>`
    // answers 404 "agent has no avatar" for an id that does not exist, which is the route WORKING.
    // The fallback is the one that says "not found: <METHOD> <path>", so the body is what separates
    // "no such route" from "no such thing behind the route".
    const fellThrough = r.status === 404
      && typeof r.json?.error === "string"
      && r.json.error.startsWith(contract.fallback.bodyContains);
    const implemented = strict ? !fellThrough : !wasUnknown;
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
  // Read the BUILT table, not a regex over its source.
  //
  // The regex was `/^\s+([A-Za-z][\w]*):\s*\(/gm` — `name: (args) =>`. It never matched
  // `ensureForeverBox: async (a) => {`, because `async` sits between the colon and the paren, so
  // the check reported a command "we do not handle" that has been handled all along. Third time
  // this exact bug class showed up (parity-report read 0/120 off gateway.ts; the channels check
  // missed four pushes behind helpers), hence: ask the code, never its text.
  const implemented = new Set(Object.keys(buildCommands(ACL_PORT_STUB)));
  const refusals = new Set(SHARED_ROOM_COMMANDS);
  // Cùng lý do: suy từ bảng MỚI, không lấy danh sách bỏ-qua đóng băng trong ảnh chụp 0.20.
  const skipped = new Set(bangLenh.filter((n) => /Room|SharedRoom/.test(n)));
  /*
   * Danh sách lệnh lấy từ `gateway-commands.json`, KHÔNG từ ảnh chụp hợp đồng.
   *
   * Hai file cùng giữ một danh sách, và chúng đã trôi xa nhau: `box-host-contract.json` là ảnh của
   * **0.20** (120 lệnh), trong khi bảng thật của 0.30 có **147**. Phép kiểm này đọc file cũ nên
   * báo PASS 10/10 trong lúc 12 lệnh client gửi được không ai trả lời — một cái gate xanh vì nó
   * chấm ta so với một mục tiêu đã dịch chuyển từ mười phiên bản trước.
   *
   * `gateway-commands.json` là file có đúng một nhiệm vụ: giữ bảng lệnh, và `extract-gateway.mjs`
   * làm mới nó theo từng phiên bản app. Đọc thẳng từ đó thì hết một nguồn sự thật thứ hai để trôi.
   */
  const missing = bangLenh.filter((n) => !implemented.has(n) && !skipped.has(n));

  record("commands", "every command is implemented or deliberately skipped", [], missing,
    missing.length ? `${missing.length} command(s) the client can send and we do not handle` : undefined);

  // A declined command must DECLINE, out loud. Being absent from the table is not a decision the
  // client can see: the router falls through to `{}` with HTTP 200, which is indistinguishable
  // from "worked, nothing to report". ROADMAP F5 moved shared rooms from absent to `{ok:false,
  // reason}`, so what this asserts now is that the refusal is explicit — not that the command is
  // missing.
  for (const n of skipped) {
    record("commands", `declines out loud, not by silence: ${n}`, true, implemented.has(n) && refusals.has(n),
      "shared rooms need a real relay — a room nobody can join is worse than no room, but the client must be TOLD");
  }
}

/**
 * Route 0.29/0.30 mà 0.20 không có — và những khoảng trống ĐÃ KHAI BÁO.
 *
 * `/prepare-upgrade` và `/avatars/<id>` biến mất khỏi cả hai bundle mới (đo: 0 lần xuất hiện), nên
 * chúng không còn là hợp đồng. Ngược lại `/cookie-origin-approval/*` xuất hiện — đó là nửa HTTP của
 * `injectChromeCookies`, lệnh gateway ta cũng chưa có.
 *
 * Khoảng trống đã khai báo được chấm bằng "route này phải 404", KHÔNG phải bằng một dấu tích cho
 * không. Nếu ai đó cài một nửa rồi để nó trả 200 rỗng, bài này đỏ — mà đó đúng là lúc cần đỏ.
 */
const ROUTE_CHUA_LAM = {
  "/cookie-origin-approval/requests": "nửa HTTP của injectChromeCookies — lệnh gateway cũng chưa có",
  "/cookie-origin-approval/responses": "cùng cặp với trên",
};
if (want("routes") && c30) {
  const cuaBox = c30.boxRoutes.filter((r) => r.box && !r.path.startsWith("/api"));
  const daBiet = new Set(contract.routes.map((r) => r.path.replace("/<param>", "")));
  for (const r of cuaBox) {
    if (daBiet.has(r.path)) continue;                       // vòng probe ở trên lo rồi
    const rr = await req("POST", `${GW}${r.path}`, { body: {} });
    const ly = ROUTE_CHUA_LAM[r.path];
    if (ly) {
      record("routes", `${r.path} (${c30.appVersion}) chưa cài — phải 404, không giả vờ phục vụ`,
        404, rr.status, ly);
      continue;
    }
    record("routes", `${r.path} (${c30.appVersion}) có người trả lời`, true, rr.status !== 404 && rr.status !== 0,
      `route mới của client mà backend không có — thêm vào ROUTE_CHUA_LAM kèm lý do, hoặc cài nó`);
  }
}

if (want("channels")) {
  // Read the hub's OWN declared list, not a regex over its source.
  //
  // The regex used to be `/broadcast\(\s*"([^"]+)"/`, which found only literal `broadcast("x")`
  // calls. The moment F4 added channels pushed through `broadcastIfChanged(...)` and a `push(...)`
  // helper in the command table, those four became invisible here and the check quietly passed on
  // a shorter list. Same failure as parity-report reading 0/120 off `gateway.ts`: the instrument
  // measured the source text instead of the code.
  const broadcasts = [...PUSHED_CHANNELS].sort();
  record("channels", "backend broadcasts at least one channel", true, broadcasts.length > 0);
  for (const ch of broadcasts) {
    const ok = NHAN.includes(ch);
    record("channels", `broadcast("${ch}") is a channel the coordinator accepts`, true, ok,
      ok ? undefined
         : `not in the ${NHAN.length}-entry table — silently dropped. Valid: ${NHAN.join(", ")}`);
  }
  // Chiều ngược lại, và đây là chiều đã hụt: hãng THÊM một tên thì ta phải biết.
  //
  // `WIRE_CHANNELS` tồn tại để một push mới phải chọn trong tập thay vì tự đặt tên. Danh sách ấy
  // đứng ở 16 tên của 0.20 suốt hai phiên bản, nên `agent-activity` và `mcp-auth` không ai thấy —
  // và không bài chấm nào kêu, vì mọi bài đều chấm theo chiều "ta phát có hợp lệ không".
  if (c30) {
    const thieu = c30.channels.filter((ch) => !WIRE_CHANNELS.includes(ch));
    record("channels", `WIRE_CHANNELS phủ hết ${c30.channels.length} kênh của ${c30.appVersion}`,
      true, thieu.length === 0,
      thieu.length ? `thiếu: ${thieu.join(", ")} — thêm vào WIRE_CHANNELS kèm lý do` : undefined);
  }
  // The three families whose wire name differs. Emitting the family name looks right and is
  // dropped exactly as `roster` was, so name them explicitly.
  for (const [family, channel] of Object.entries(BI_DANH)) {
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
const payload = `${JSON.stringify(out, null, 2)}\n`;
const preferred = join(RUNS, `${PLAN}-gateA-run-${String(RUN).padStart(2, "0")}.json`);
let file = preferred;
try {
  writeFileSync(file, payload);
} catch {
  file = join(RUNS, `${PLAN}-gateA-run-${Date.now()}.json`);
  try {
    writeFileSync(file, payload);
  } catch (err) {
    console.error(`warn: could not write gate artifact (${err.message})`);
    file = null;
  }
}

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
if (file) console.log(`\nwrote ${file}`);
process.exit(failed.length === 0 ? 0 : 1);
