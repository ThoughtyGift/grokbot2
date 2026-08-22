/**
 * Where the local build stands against the original, measured against extracted ground truth
 * rather than against what the app happened to ask for.
 *
 * The distinction matters: "0 unmapped" only ever meant the app had not called anything we lack,
 * and an app never calls what it cannot use.
 *
 * ── Rewritten 2026-08-20 (roadmap F0). The previous version measured two things wrongly:
 *
 *   1. Gateway coverage came from grepping `src/gateway.ts` for `^  name: (`. Phase 2 moved the
 *      command table into `packages/cursor-acl`, so the grep matched nothing and the report read
 *      **0/120** while the ACL actually served 111. A gate ran on that number.
 *   2. Tool coverage came from a hardcoded list of nine names inside this file. The real registry
 *      in `src/tools.ts` held twelve.
 *
 * Both now read the running code: commands from `buildCommands()` on the built ACL, tools from the
 * registry via `tool-registry.mts`. Neither can drift without the number moving.
 *
 * Under the FE-gốc roadmap this is the primary product metric, so it also ASSERTS: below the
 * recorded baseline is a non-zero exit, not a line of output nobody reads.
 *
 *   node scripts/parity-report.mjs                   # measure + assert against baseline
 *   node scripts/parity-report.mjs --write-baseline  # record today's numbers as the floor
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, "..");
const REPO = resolve(BACKEND, "..", "..");
const BASELINE = join(REPO, "docs", "parity-runs", "fe-goc-baseline.json");
const WRITE = process.argv.includes("--write-baseline");

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const pct = (a, b) => `${a}/${b} (${Math.round((a / b) * 100)}%)`;

const commands = read(join(REPO, "docs", "extracted", "gateway-commands.json")).commands.map((c) => c.name);

/**
 * The ACL command table, from the built package rather than from its source text.
 *
 * `buildCommands(ports)` only reads `ports` inside the handlers it returns, so a Proxy that
 * answers anything is enough to enumerate the keys without standing up a backend.
 */
const aclCommandNames = async () => {
  const dist = join(REPO, "packages", "cursor-acl", "dist", "commands.js");
  if (!existsSync(dist)) {
    console.error("cursor-acl is not built — run: pnpm --filter @grokbot2/cursor-acl build");
    process.exit(2);
  }
  const { buildCommands } = await import(`file://${dist.replace(/\\/g, "/")}`);
  const ports = new Proxy({}, { get: () => new Proxy(() => {}, { get: () => () => {}, apply: () => ({}) }) });
  return Object.keys(buildCommands(ports));
};

/**
 * Tool coverage, from `tool-registry.mts` so this report and `tool-coverage.mjs` cannot drift
 * apart — the drift is what produced three different tool numbers in three different docs.
 * Runs through tsx because the backend has no dist.
 */
const toolCoverage = () => {
  const r = spawnSync("npx", ["tsx", join("scripts", "tool-registry.mts")], { cwd: BACKEND, encoding: "utf8", shell: true });
  const marker = "__TOOLS_JSON__";
  const at = (r.stdout ?? "").indexOf(marker);
  if (r.status !== 0 || at < 0) {
    console.error("could not read the tool registry via tsx:");
    console.error((r.stderr || r.stdout || "").trim().split("\n").slice(-6).join("\n"));
    process.exit(2);
  }
  return JSON.parse(r.stdout.slice(at + marker.length));
};

const impl = await aclCommandNames();

/**
 * Commands answered with an explicit refusal, not a capability.
 *
 * Read from the ACL so the two cannot drift. Without this split the gateway number jumps 111 → 120
 * the moment shared rooms start answering `{ok:false}` and reads as though sharing works.
 */
const refused = await (async () => {
  const dist = join(REPO, "packages", "cursor-acl", "dist", "commands.js");
  if (!existsSync(dist)) return [];
  const m = await import(`file://${dist.split("\\").join("/")}`);
  return [...(m.SHARED_ROOM_COMMANDS ?? [])];
})();
const tools = toolCoverage();

/**
 * SSE + bootstrap floors, from the built ACL/proto — same rule as gateway: do not grep source.
 */
const dialectCoverage = async () => {
  const sseDist = join(REPO, "packages", "cursor-acl", "dist", "sse.js");
  const protoDist = join(REPO, "packages", "grokbot-proto", "dist", "bootstrap.js");
  if (!existsSync(sseDist) || !existsSync(protoDist)) {
    console.error("cursor-acl / grokbot-proto not built — run: pnpm --filter @grokbot2/cursor-acl --filter @grokbot2/proto build");
    process.exit(2);
  }
  const sse = await import(`file://${sseDist.replace(/\\/g, "/")}`);
  const proto = await import(`file://${protoDist.replace(/\\/g, "/")}`);
  const wire = [...sse.WIRE_CHANNELS];
  const pushed = [...sse.PUSHED_CHANNELS];
  const noData = [...(sse.NO_DATA_CHANNELS ?? [])];
  const gates = [...proto.BOOTSTRAP_GATE_METHODS];
  const built = Object.keys(proto.bootstrapResponses);
  return {
    sse: {
      have: pushed.length,
      of: wire.length,
      pushed,
      noData,
      /** Not pushed AND not declared data-less — the only entries that are a real gap. */
      missing: wire.filter((c) => !pushed.includes(c) && !noData.includes(c)),
    },
    bootstrap: {
      have: gates.filter((m) => built.includes(m)).length,
      of: gates.length,
      missing: gates.filter((m) => !built.includes(m)),
    },
  };
};

const dialect = await dialectCoverage();

console.log("=== GATEWAY ===");
const missing = commands.filter((c) => !impl.includes(c));
const gwHave = commands.length - missing.length;
console.log(`  client can send : ${commands.length}`);
console.log(`  we answer       : ${pct(gwHave, commands.length)}   (source: cursor-acl buildCommands)`);
// A refusal is an answer, not a feature. Report the two separately or the count lies.
const refusedHere = refused.filter((c) => impl.includes(c));
if (refusedHere.length) {
  console.log(`    of which real  : ${gwHave - refusedHere.length}`);
  console.log(`    explicit refusal: ${refusedHere.length}  (shared rooms — no relay; ROADMAP F5)`);
}

const GROUPS = {
  "shared rooms (needs a relay)": /Room|SharedRoom/,
  attachments: /[Aa]ttachment/,
  "agent memory UI": /Memor/i,
  "box lifecycle": /Box|Host/,
  "transcript windows": /Transcript|openAgent|getTranscript/,
  "MCP / WebAuthn": /Mcp|WebAuthn/,
};
for (const [label, re] of Object.entries(GROUPS)) {
  const hit = missing.filter((m) => re.test(m));
  if (hit.length) console.log(`    ${String(hit.length).padStart(2)}  ${label.padEnd(30)} ${hit.slice(0, 4).join(", ")}${hit.length > 4 ? " …" : ""}`);
}
const other = missing.filter((m) => !Object.values(GROUPS).some((re) => re.test(m)));
if (other.length) console.log(`    ${String(other.length).padStart(2)}  ${"other".padEnd(30)} ${other.join(", ")}`);

console.log("\n=== TOOLS ===");
console.log(`  original's catalog : ${tools.originalCount}`);
console.log(`  our live map       : ${tools.liveCount}   (source: src/runtime/tools.ts via tool-registry.mts)`);
console.log(`  we cover           : ${pct(tools.have.length, tools.originalCount)}`);
console.log(`  ours beyond it     : ${tools.extra.length} (browser_*, drafts, routines — a separate surface)`);

console.log("\n=== SSE ===");
console.log(`  wire names         : ${dialect.sse.of}   (source: cursor-acl WIRE_CHANNELS)`);
console.log(`  we push            : ${pct(dialect.sse.have, dialect.sse.of)}   (source: PUSHED_CHANNELS)`);
// 16 is not the target. Seven wire names have no producer anywhere in the repo, so an empty frame
// on those would buy a bigger number and nothing else — they are reported as "nothing to send",
// not as work remaining. Only `missing` is a real gap.
if (dialect.sse.noData.length) {
  const reach = dialect.sse.of - dialect.sse.noData.length;
  console.log(`  with a producer    : ${pct(dialect.sse.have, reach)}   (${dialect.sse.of} wire names − ${dialect.sse.noData.length} with none)`);
  console.log(`    nothing to send    ${dialect.sse.noData.join(", ")}`);
}
console.log(dialect.sse.missing.length
  ? `    REAL GAP           ${dialect.sse.missing.join(", ")}`
  : "    real gaps          none — every channel with a producer is pushed");

console.log("\n=== BOOTSTRAP RPC ===");
console.log(`  gate methods       : ${dialect.bootstrap.of}   (source: grokbot-proto BOOTSTRAP_GATE_METHODS)`);
console.log(`  we have a body     : ${pct(dialect.bootstrap.have, dialect.bootstrap.of)}   (source: bootstrapResponses)`);
// Same denominator trap as SSE: `WatchSandBoxMigration` is a SERVER-STREAMING RPC for box
// migration, absent from the renderer and never once called (`recordRpc` persists; the count is 0).
// An empty stream IS the right answer for an install that never migrates a box, so this line is
// informational — not a gap to close.
if (dialect.bootstrap.missing.length) {
  console.log(`    empty proto 200    ${dialect.bootstrap.missing.join(", ")}`);
}

console.log("\n=== WHAT THE ORIGINAL DOES THAT WE STILL DO NOT ===");
for (const [label, state] of Object.entries({
  "shared rooms": "needs a real relay — faking it creates rooms nobody can join (roadmap F5)",
  "past-conversation search": "DONE 2026-08-21: `search_conversations` tool + `pastConversationExplorer` subagent type. Never was a contract gap — the host offers it as a subagent_type, with no gateway command and no channel. (The old entry named PAST_CONVERSATION_EXPLORER, a string that exists nowhere in the app.)",
  skills: "skillsCatalog answers [] — CONTRACT-CORRECT: the decl is {args:none, reply:array} and the client itself maps [] to null. Not a gap; having a skills feature at all is a product choice",
  "agent memory UI": "NOT A GAP (measured 2026-08-21): getAgentMemories/deleteAgentMemory/clearAgentMemories appear 0 times in the whole renderer — the screen does not exist in this build. They live only in the HOST's 120-command table",
  "live transcript updates": "late, not lost — the client replicates an ordered log and needs events (docs/transcript-replica.md)",
})) console.log(`  ${label.padEnd(26)} ${state}`);

const now = {
  gateway: { have: gwHave, of: commands.length },
  tools: { have: tools.have.length, of: tools.originalCount },
  sse: { have: dialect.sse.have, of: dialect.sse.of },
  bootstrap: { have: dialect.bootstrap.have, of: dialect.bootstrap.of },
};

if (WRITE) {
  writeFileSync(BASELINE, `${JSON.stringify({ ...now, at: new Date().toISOString(), note: "FE-gốc roadmap floor. parity-report exits non-zero below these." }, null, 2)}\n`);
  console.log(`\nbaseline written: ${BASELINE}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.log("\nno baseline yet — run with --write-baseline to record this as the floor");
  process.exit(0);
}

const base = read(BASELINE);
const drops = [];
if (now.gateway.have < base.gateway.have) drops.push(`gateway ${now.gateway.have} < baseline ${base.gateway.have}`);
if (now.tools.have < base.tools.have) drops.push(`tools ${now.tools.have} < baseline ${base.tools.have}`);
if (base.sse && now.sse.have < base.sse.have) drops.push(`sse ${now.sse.have} < baseline ${base.sse.have}`);
if (base.bootstrap && now.bootstrap.have < base.bootstrap.have) drops.push(`bootstrap ${now.bootstrap.have} < baseline ${base.bootstrap.have}`);

const sseLine = base.sse ? `, sse ${base.sse.have}/${base.sse.of}` : "";
const bootLine = base.bootstrap ? `, bootstrap ${base.bootstrap.have}/${base.bootstrap.of}` : "";
console.log(`\nbaseline: gateway ${base.gateway.have}/${base.gateway.of}, tools ${base.tools.have}/${base.tools.of}${sseLine}${bootLine}`);
if (drops.length) {
  console.error(`PARITY REGRESSED:\n  ${drops.join("\n  ")}`);
  process.exit(1);
}
console.log("parity at or above baseline.");
