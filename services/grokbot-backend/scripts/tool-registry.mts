/**
 * The one place that answers "how many of the original's 54 tools do we offer?" — as JSON, for
 * `parity-report.mjs` and `tool-coverage.mjs` to share instead of each counting its own way.
 *
 * Before this file the repo held three different answers, all sincerely measured:
 *
 *   9/54   a hardcoded name list inside parity-report.mjs, last synced by hand
 *   12/54  `Object.keys(TOOLS)` from src/tools.ts — a smaller, separate registry
 *   28/54  the LIVE map (src/runtime/tools.ts, 53 tools) diffed with the alias table
 *
 * 28 is the product-truthful one: it reads the map chat actually dispatches on, so a tool that
 * fails to register counts as missing — which is how the browser tools once vanished silently.
 * The other two measured real things, just not the thing anyone was deciding with.
 *
 * Run through tsx: the backend has no dist/ and this reaches into src.
 *
 *   npx tsx scripts/tool-registry.mts
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toolNames } from "../src/runtime/tools.js";

/**
 * Names that differ only by generation — ours covers theirs. Kept here rather than in each
 * consumer so the two reports cannot disagree about what counts as covered.
 */
const ALIAS: Record<string, string> = {
  read_file: "read_file_v2",
  list_dir: "list_dir_v2",
  ripgrep_search: "ripgrep_raw_search",
  file_search: "glob_file_search",
  task: "task_v2",
  mcp: "call_mcp_tool",
};

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const catalog = JSON.parse(readFileSync(join(REPO, "docs", "extracted", "tool-catalog.json"), "utf8"));
const arr = Array.isArray(catalog) ? catalog : (catalog.tools ?? Object.values(catalog).find(Array.isArray) ?? []);
const original: string[] = arr.map((t: any) => t.name ?? t).filter(Boolean);

const ours = new Set(toolNames());
const have: string[] = [];
const missing: string[] = [];
for (const n of original) (ours.has(ALIAS[n] ?? n) ? have : missing).push(n);
const extra = [...ours].filter((n) => !original.includes(n) && !Object.values(ALIAS).includes(n));

/**
 * Importing the runtime map boots the store, which logs "restored N agent(s)" to stdout. A
 * sentinel keeps the JSON findable rather than hoping no log line ever contains a brace.
 */
process.stdout.write(`\n__TOOLS_JSON__${JSON.stringify({
  live: [...ours],
  liveCount: ours.size,
  originalCount: original.length,
  have,
  missing,
  extra,
})}`);
