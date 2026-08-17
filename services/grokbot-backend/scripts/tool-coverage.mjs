/**
 * Which of the original's 54 client-side tools this backend actually offers.
 *
 * Reads the LIVE tool map (so a tool that fails to register counts as missing, which is how
 * the browser tools silently vanished once) and diffs it against the extracted catalog.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toolNames } from "../src/chat.ts";

// Resolved from THIS file, not from the working directory. The path used to be
// `"../../docs/extracted/tool-catalog.json"`, which only worked when invoked from exactly
// `services/grokbot-backend` — run it from `scripts/` and it looked for `services/docs/…` and
// died. A measurement that crashes depending on where you stand is a measurement nobody takes.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const catalog = JSON.parse(readFileSync(join(REPO, "docs", "extracted", "tool-catalog.json"), "utf8"));
const arr = Array.isArray(catalog) ? catalog : catalog.tools ?? Object.values(catalog).find(Array.isArray) ?? [];
const original = arr.map((t) => t.name ?? t).filter(Boolean);

const ours = new Set(toolNames());

/** Names that differ only by generation — ours covers theirs. */
const ALIAS = {
  read_file: "read_file_v2", list_dir: "list_dir_v2", ripgrep_search: "ripgrep_raw_search",
  file_search: "glob_file_search", task: "task_v2", mcp: "call_mcp_tool",
};

const have = [], missing = [];
for (const n of original) {
  const mapped = ALIAS[n] ?? n;
  (ours.has(mapped) ? have : missing).push(ours.has(mapped) && mapped !== n ? `${n} → ${mapped}` : n);
}
const extra = [...ours].filter((n) => !original.includes(n) && !Object.values(ALIAS).includes(n));

console.log(`ORIGINAL: ${original.length} tools`);
console.log(`\nHAVE (${have.length}):\n  ${have.join("\n  ")}`);
console.log(`\nMISSING (${missing.length}):\n  ${missing.join("\n  ")}`);
console.log(`\nOURS NOT IN CATALOG (${extra.length}):\n  ${extra.join(", ")}`);
