/**
 * Where the local build stands against the original, measured against extracted ground
 * truth rather than against what the app happened to ask for.
 *
 * The distinction matters: "0 unmapped" only ever meant the app had not called anything we
 * lack, and an app never calls what it cannot use.
 */
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const commands = read("docs/extracted/gateway-commands.json").commands.map((c) => c.name);
const tools = read("docs/extracted/tool-catalog.json").tools.map((t) => t.name);
const gw = readFileSync("services/grokbot-backend/src/gateway.ts", "utf8");
const impl = [...gw.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*\(/gm)].map((m) => m[1]);

const localTools = {
  box: ["run_terminal_command_v2", "read_file_v2", "list_dir_v2", "glob_file_search", "ripgrep_raw_search"],
  web: ["web_search", "web_fetch"],
  agent: ["ask_question", "knowledge_base"],
};
const localToolNames = Object.values(localTools).flat();

const pct = (a, b) => `${a}/${b} (${Math.round((a / b) * 100)}%)`;

console.log("=== GATEWAY ===");
const missing = commands.filter((c) => !impl.includes(c));
console.log(`  client can send : ${commands.length}`);
console.log(`  we implement    : ${pct(commands.length - missing.length, commands.length)}`);

const GROUPS = {
  "shared rooms (needs a relay)": /Room|SharedRoom/,
  "attachments": /[Aa]ttachment/,
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
const overlap = localToolNames.filter((n) => tools.includes(n));
console.log(`  original's catalog : ${tools.length}`);
console.log(`  ours by real name  : ${pct(overlap.length, tools.length)}  ${overlap.join(", ")}`);
console.log(`  browser MCP        : 16 (a separate surface, not part of the ${tools.length})`);

console.log("\n=== WHAT THE ORIGINAL DOES THAT WE STILL DO NOT ===");
for (const [label, state] of Object.entries({
  "shared rooms": "needs a real relay — faking it creates rooms nobody can join",
  "past-conversation search": "the original runs a PAST_CONVERSATION_EXPLORER subagent",
  "skills": "skillsCatalog answers []",
  "agent memory UI": "memory works via knowledge_base, but the app's own memory screen is unanswered",
  "live transcript updates": "BROKEN — the window never renders a new entry on its own",
})) console.log(`  ${label.padEnd(26)} ${state}`);
