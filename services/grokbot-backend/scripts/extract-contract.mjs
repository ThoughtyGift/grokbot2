/**
 * Extract the box host's own HTTP contract from the shipped client bundle.
 *
 * The app ships an implementation of the very server this backend emulates: `app.asar` contains
 * the host's router, its path constants, its auth branches and its 404 text. So the protocol half
 * of "match the original" is a porting job against a reference, not guesswork — which is the whole
 * premise of docs/execution-roadmap.md.
 *
 * Three rules, each learned from a way this could quietly go wrong:
 *
 *  1. **Anchor on string literals, never on offsets or minified names.** Byte offsets move the
 *     moment the app updates. Minified identifiers are worse: they are reused across chunks, and
 *     searching for `y3s` during the spike landed in a completely unrelated function in another
 *     bundle. Literals like `"not found: "` and `"/local-exec/requests"` are load-bearing strings
 *     that survive minification.
 *  2. **Fail loudly.** An extractor that silently returns a short list is worse than no extractor,
 *     because everything downstream then measures against a contract with holes in it. Any missing
 *     anchor is a non-zero exit and a named error.
 *  3. **Be deterministic.** Two runs must produce byte-identical output, or the contract cannot be
 *     diffed across app versions. Everything is sorted; nothing carries a timestamp.
 *
 * Usage:
 *   node scripts/extract-contract.mjs                 # write docs/extracted/box-host-contract.json
 *   node scripts/extract-contract.mjs --check         # verify only, exit 1 on drift
 *   node scripts/extract-contract.mjs --asar <path>
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Paths resolved from THIS file, never from the working directory — tool-coverage.mjs used a
// cwd-relative path and only ran from one directory, which is how a "measurement" silently
// becomes a crash.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const OUT = join(REPO, "docs", "extracted", "box-host-contract.json");
const COMMANDS = join(REPO, "docs", "extracted", "gateway-commands.json");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const CHECK_ONLY = process.argv.includes("--check");

class ExtractionError extends Error {}
const fail = (msg) => { throw new ExtractionError(msg); };

/** Packed asar only — never unpacked dirs or host-main.cjs (those lack the channel anchors). */
const isAsarFile = (p) => {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Installers sometimes unpack; a gitignored copy may live beside the repo. First file hit wins. */
const resolveAsar = () => {
  const explicit = arg("--asar", "");
  if (explicit) return explicit;
  const local = process.env.LOCALAPPDATA ?? "";
  const desktop = dirname(REPO);
  const candidates = [
    process.env.GROKBOT2_ASAR,
    join(REPO, "Grok Bot", "resources", "app.asar"),
    join(desktop, "Grok Bot", "resources", "app.asar"),
    join(local, "Programs", "Grok Bot", "resources", "app.asar"),
    join(local, "Programs", "Grok Bot", "resources", "app.asar.disabled-by-grokbot2"),
  ].filter(Boolean);
  const hit = candidates.find(isAsarFile);
  if (!hit) {
    fail(`app.asar not found. Tried:\n  ${candidates.join("\n  ")}\nPass --asar <path> or GROKBOT2_ASAR.`);
  }
  return hit;
};

const ASAR = resolveAsar();
console.log(`asar       ${ASAR}`);

// ── load ──────────────────────────────────────────────────────────────────────
if (!existsSync(ASAR)) fail(`app.asar not found at ${ASAR} — pass --asar <path>`);
// latin1 keeps byte offset == character offset, so slices line up with indexOf results.
const text = readFileSync(ASAR).toString("latin1");

/** Every index of `needle`, so a duplicated chunk is visible instead of silently picking one. */
const allIndexes = (needle) => {
  const out = [];
  let at = -1;
  while ((at = text.indexOf(needle, at + 1)) !== -1) out.push(at);
  return out;
};

// ── anchor 1: the path constant table ─────────────────────────────────────────
//
// Looks like: f5n="/api",gAi="/events",AAi="/health",…,h5n="/avatars";var EAi="/local-exec/requests",…
// We read every `IDENT="/…"` and `IDENT="header-name"` in a window around the anchor, giving a
// minified-name -> literal map that the router can then be resolved against.
const PATH_ANCHOR = '"/local-exec/requests"';
const pathAnchors = allIndexes(PATH_ANCHOR);
if (pathAnchors.length === 0) fail(`path anchor ${PATH_ANCHOR} not found — the bundle layout changed`);

const constants = {};
for (const at of pathAnchors) {
  const window = text.slice(Math.max(0, at - 1200), at + 1200);
  for (const m of window.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*"(\/[a-z0-9/_-]*|[a-z-]+(?:-[a-z-]+)+|Bearer)"/g)) {
    // First definition wins, and identical redefinitions across chunks are consistent — but a
    // CONFLICTING one means we are mixing two bundles, so say so rather than pick.
    const [, name, value] = m;
    if (constants[name] != null && constants[name] !== value) {
      fail(`constant ${name} has two values ("${constants[name]}" and "${value}") — anchor window spans two chunks`);
    }
    constants[name] = value;
  }
}

/**
 * Resolve one identifier the router references but the anchor window did not cover.
 *
 * The constant table is not one block: `/prepare-upgrade`, `/webauthn/requests` and
 * `/webauthn/responses` are declared elsewhere in the chunk, so a fixed window around
 * `/local-exec/requests` misses them — which is exactly what the first run reported, loudly.
 *
 * Searching the whole file by NAME is safe here because the pattern is narrow (identifier
 * immediately assigned a string literal) and the value is then required to look like a path.
 * Two different path values for one name means two chunks are in play, and that fails rather
 * than guessing.
 */
function resolveConstant(ident) {
  if (constants[ident] != null) return constants[ident];
  const re = new RegExp(`\\b${ident.replace(/\$/g, "\\$")}\\s*=\\s*"(\\/[a-z0-9/_-]*)"`, "g");
  const values = [...new Set([...text.matchAll(re)].map((m) => m[1]))];
  if (values.length === 0) return null;
  if (values.length > 1) fail(`constant ${ident} resolves to ${values.length} different paths (${values.join(", ")})`);
  constants[ident] = values[0];
  return values[0];
}

// ── anchor 2: the router ──────────────────────────────────────────────────────
//
// The host's fallback text. This is the single most reliable landmark in the file: it is the last
// statement of the router, and it is a template literal that no other code produces.
const ROUTER_ANCHOR = "not found: ";
const routerHits = allIndexes(ROUTER_ANCHOR);
if (routerHits.length === 0) fail(`router anchor ${JSON.stringify(ROUTER_ANCHOR)} not found`);

/** Walk back from the fallback to the enclosing `async function NAME(` and return the body. */
function routerAround(at) {
  const from = text.lastIndexOf("async function ", at);
  if (from < 0 || at - from > 8000) return null;
  const name = /^async function ([A-Za-z_$][\w$]*)\(/.exec(text.slice(from, from + 80))?.[1];
  const body = text.slice(from, at + 200);
  // The real router tests pathnames and methods; anything else that happens to sit near a
  // "not found: " string is not it.
  if (!/pathname===/.test(body) || !/e\.method===/.test(body)) return null;
  return { name, body, at: from };
}

const routers = routerHits.map(routerAround).filter(Boolean);
if (routers.length === 0) fail(`found ${routerHits.length} "not found: " hit(s) but none inside a path-routing function`);
// Prefer the richest one: the host router tests more paths than any lookalike.
const router = routers.sort((a, b) => (b.body.match(/pathname===/g) ?? []).length - (a.body.match(/pathname===/g) ?? []).length)[0];

// ── routes ────────────────────────────────────────────────────────────────────
const METHOD_OF = {};   // constantName -> Set(methods)
const PREFIX = new Set();

for (const m of router.body.matchAll(/e\.method===\s*"([A-Z]+)"\s*&&\s*r\.pathname===\s*([A-Za-z_$][\w$]*)/g)) {
  const [, method, ident] = m;
  (METHOD_OF[ident] ??= new Set()).add(method);
}
for (const m of router.body.matchAll(/e\.method===\s*"([A-Z]+)"\s*&&\s*r\.pathname\.startsWith\(`\$\{([A-Za-z_$][\w$]*)\}/g)) {
  const [, method, ident] = m;
  (METHOD_OF[ident] ??= new Set()).add(method);
  PREFIX.add(ident);
}
// `/health` is tested first, in its own `if`, so it does not match the `&&` chains above.
for (const m of router.body.matchAll(/e\.method===\s*"([A-Z]+)"\s*&&\s*r\.pathname===\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
  const [, method, ident] = m;
  (METHOD_OF[ident] ??= new Set()).add(method);
}

if (Object.keys(METHOD_OF).length === 0) fail("router matched no `method && pathname` pairs — the routing idiom changed");

/** Auth is per-route in the host: local-exec and webauthn REQUIRE a token; the rest check if set. */
const AUTH_REQUIRED = new Set(["/local-exec/requests", "/local-exec/responses", "/webauthn/requests", "/webauthn/responses"]);

const routes = [];
for (const [ident, methods] of Object.entries(METHOD_OF)) {
  const path = resolveConstant(ident);
  if (path == null) fail(`router references ${ident} and no string assignment in the bundle defines it as a path`);
  for (const method of methods) {
    routes.push({
      method,
      path: PREFIX.has(ident) ? `${path}/<param>` : path,
      matchesPrefix: PREFIX.has(ident) || undefined,
      auth: AUTH_REQUIRED.has(path) ? "required" : "ifTokenSet",
      constant: ident,
    });
  }
}
routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

// ── /health response fields ───────────────────────────────────────────────────
//
// `let p=t.getHealth(),h={ok:!0,pid:process.pid,isBusy:p.isBusy,…}`.
//
// Read with a brace COUNTER, not a regex. The object contains a nested conditional spread
// (`...p.busyOnlyAwaitingApproval!==void 0?{busyOnlyAwaitingApproval:…}:{}`), and a
// `[^}]*(?:\{[^}]*\}[^}]*)*` pattern stops at the first inner `}` — which is how the first run
// reported 4 fields where there are 7. A balanced scan is the only honest way to read a literal.
function balancedObject(haystack, from) {
  const open = haystack.indexOf("{", from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < haystack.length && i < open + 4000; i++) {
    if (haystack[i] === "{") depth += 1;
    else if (haystack[i] === "}") {
      depth -= 1;
      if (depth === 0) return haystack.slice(open + 1, i);
    }
  }
  return null;
}

const healthAt = router.body.indexOf("getHealth()");
if (healthAt < 0) fail("router does not call getHealth() — the /health branch changed");
const healthObj = balancedObject(router.body, healthAt);
if (!healthObj) fail("could not read the /health response object literal");

// Only keys at depth 0 of this literal are response fields; a key inside the conditional spread
// is the SAME field and must not be double counted.
const topLevelKeys = (body) => {
  const keys = [];
  let depth = 0;
  let token = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    else if (depth === 0 && ch === ":") {
      const name = /([A-Za-z_$][\w$]*)\s*$/.exec(token)?.[1];
      if (name) keys.push(name);
      token = "";
      continue;
    } else if (depth === 0 && ch === ",") { token = ""; continue; }
    token += ch;
  }
  return keys;
};
const healthFields = [...new Set(topLevelKeys(healthObj))].sort();
// A conditional spread means the field is only present sometimes.
const healthOptional = [...new Set([...healthObj.matchAll(/\.\.\.[^?]*!==void 0\?\s*\{\s*([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]))].sort();
if (healthFields.length < 5) fail(`only ${healthFields.length} /health field(s) read (${healthFields.join(", ")}) — the balanced scan is wrong`);

// ── auth 401 branches ─────────────────────────────────────────────────────────
const AUTH_MESSAGES = [
  "local-exec requires gateway authentication",
  "webauthn requires gateway authentication",
  "unauthorized",
];
const auth401 = AUTH_MESSAGES.filter((m) => text.includes(`"${m}"`));
if (auth401.length !== AUTH_MESSAGES.length) {
  fail(`expected ${AUTH_MESSAGES.length} auth messages in the bundle, found ${auth401.length}: ${auth401.join(", ")}`);
}

// ── /avatars status branches ──────────────────────────────────────────────────
const AVATAR_MESSAGES = {
  crossSite: "cross-site avatar loads are not allowed",
  missingId: "missing agent id",
  noAvatar: "agent has no avatar",
  noVersion: "no such avatar version",
};
const avatarStatuses = Object.fromEntries(
  Object.entries(AVATAR_MESSAGES).filter(([, m]) => text.includes(`"${m}"`)).map(([k, m]) => [k, m]),
);

// ── event channels ────────────────────────────────────────────────────────────
//
// The list the coordinator will accept. Sending a name absent from it is silently dropped, which
// cost six rounds of guessing before `roster` was found to be no channel at all (parity.md §2w).
// Extracted so the contract test can assert every channel we emit is in this set.
// The table is a FAMILY -> CHANNEL map, and for three entries the two names DIFFER:
//
//   var sr = { transcript:"transcript", agents:"agents", "agent-upserted":"agent-upserted",
//              tray:"tray", "agents-workflow":"workflows", subagents:"subagents",
//              "async-tasks":"async-tasks", "agents-automation":"automations",
//              "mcp-servers-updated":"mcp-servers", "forever-box":"forever-box",
//              "teach-recording":"teach-recording", "box-disk-pressure":"box-disk-pressure",
//              "computer-action":"computer-action", outline:"outline", sharing:"sharing",
//              "host-settings":"host-settings" },
//       dr = new Map(Object.entries(sr).map(([t,e]) => [e,t]));
//
// `dr` is the REVERSE map and the lookup is `dr.get(channel) ?? null` — so what goes on the WIRE
// is the VALUE side. Emitting a family name instead (`agents-workflow` rather than `workflows`)
// is dropped exactly as silently as `roster` was. Scraping nearby string literals is not good
// enough — the first run picked up 29 "channels" including `void`, `object` and `coordinator`
// from surrounding code. Parse the literal.
const CHANNEL_ANCHOR = 'transcript:"transcript"';
const channelHits = allIndexes(CHANNEL_ANCHOR);
if (channelHits.length === 0) fail(`channel anchor ${JSON.stringify(CHANNEL_ANCHOR)} not found`);

let channelFamilies = {};
for (const at of channelHits) {
  const body = balancedObject(text, text.lastIndexOf("{", at));
  if (!body) continue;
  const pairs = [...body.matchAll(/"?([a-z][a-z0-9-]{2,30})"?\s*:\s*"([a-z][a-z0-9-]{2,30})"/g)];
  // The real table maps every family to a channel and nothing else; a bigger parse is the
  // right one, but it must still look like a pure string->string map.
  if (pairs.length > Object.keys(channelFamilies).length) {
    channelFamilies = Object.fromEntries(pairs.map((m) => [m[1], m[2]]));
  }
}
if (Object.keys(channelFamilies).length === 0) fail("channel table located but no family->channel pairs parsed");

/** What may legally appear as `channel` on the SSE stream: the VALUE side of the table. */
const eventChannels = [...new Set(Object.values(channelFamilies))].sort();
/** The three entries where the coordinator's internal name is NOT the wire name. */
const channelAliases = Object.fromEntries(
  Object.entries(channelFamilies).filter(([family, channel]) => family !== channel).sort(),
);

// ── gateway commands ──────────────────────────────────────────────────────────
if (!existsSync(COMMANDS)) fail(`${COMMANDS} missing — run scripts/extract-gateway.mjs first`);
const raw = JSON.parse(readFileSync(COMMANDS, "utf8"));
const cmdList = Array.isArray(raw) ? raw : raw.commands;
if (!Array.isArray(cmdList) || cmdList.length === 0) fail("gateway-commands.json holds no commands");
const gatewayCommands = cmdList
  .map((c) => ({ name: c.name ?? String(c), takesBody: c.takesBody === true }))
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * Shared rooms are deliberately NOT implemented: they need a real relay, and a room nobody can
 * join is worse than no room. Listed so the contract test reports them as a decision rather than
 * as nine failures.
 */
const intentionallySkipped = gatewayCommands
  .map((c) => c.name)
  .filter((n) => /Room|SharedRoom/.test(n))
  .sort();

// ── emit ──────────────────────────────────────────────────────────────────────
const appVersion = /"version":\s*"(\d+\.\d+\.\d+)"/.exec(text)?.[1] ?? "unknown";

const contract = {
  extractedFrom: "app.asar",
  appVersion,
  routerFunction: router.name,
  anchors: { router: ROUTER_ANCHOR, paths: PATH_ANCHOR, channels: CHANNEL_ANCHOR },
  constants: Object.fromEntries(Object.entries(constants).sort()),
  routes,
  health: { fields: healthFields, optional: healthOptional },
  fallback: { status: 404, bodyContains: "not found: " },
  auth401,
  avatarStatuses,
  eventChannels,
  channelFamilies: Object.fromEntries(Object.entries(channelFamilies).sort()),
  channelAliases,
  gatewayCommands,
  intentionallySkipped,
};

const json = `${JSON.stringify(contract, null, 2)}\n`;

if (CHECK_ONLY) {
  const before = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (before !== json) {
    console.error("contract DRIFTED — re-run without --check to update, and review the diff");
    process.exit(1);
  }
  console.log("contract unchanged");
} else {
  writeFileSync(OUT, json);
}

console.log(`router      ${router.name}()  @ byte ${router.at}`);
console.log(`routes      ${routes.length}`);
for (const r of routes) console.log(`  ${r.method.padEnd(5)} ${r.path.padEnd(26)} auth=${r.auth}`);
console.log(`health      ${healthFields.length} field(s): ${healthFields.join(", ")}`);
console.log(`  optional  ${healthOptional.join(", ") || "(none)"}`);
console.log(`auth 401    ${auth401.length} branch(es)`);
console.log(`avatars     ${Object.keys(avatarStatuses).length} status branch(es)`);
console.log(`channels    ${eventChannels.length} valid on the wire: ${eventChannels.join(" ")}`);
for (const [family, channel] of Object.entries(channelAliases)) {
  console.log(`  ALIAS     family "${family}" goes out as channel "${channel}" — sending the family name is dropped`);
}
console.log(`commands    ${gatewayCommands.length} (${intentionallySkipped.length} intentionally skipped)`);
console.log(`app version ${appVersion}`);
console.log(CHECK_ONLY ? "" : `\nwrote ${OUT}`);
