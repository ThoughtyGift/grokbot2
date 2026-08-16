/**
 * Quality gate for the extracted prompt.
 *
 * A character count proves nothing: the first extraction reported 32,829 chars while
 * carrying literal "\n", literal "—" and fragments of JS source. Fail loudly on
 * anything that means the decoder is still wrong.
 */
import { readFileSync } from "node:fs";

const p = JSON.parse(readFileSync("docs/extracted/subagent-prompts.json", "utf8"));
const target = process.argv[2] ?? "buildSandBaseSystemPrompt";
const rec = p.prompts.find((x) => x.name === target);
if (!rec) { console.error(`no prompt named ${target}`); process.exit(1); }
const t = rec.text;

const BACKSLASH = String.fromCharCode(92);
const count = (re) => (t.match(re) ?? []).length;

const checks = [
  ["undecoded unicode escapes", count(new RegExp(BACKSLASH + BACKSLASH + "u[0-9a-fA-F]{4}", "g")), 0],
  ["undecoded newline escapes", count(new RegExp(BACKSLASH + BACKSLASH + "n", "g")), 0],
  ["undecoded tab escapes", count(new RegExp(BACKSLASH + BACKSLASH + "t", "g")), 0],
  ["stray JS string enders", count(/",\s*$/gm), 0],
  ["invented --- separators", count(/^---$/gm), 0],
];

console.log(`${target}: ${t.length} chars, ${rec.segments?.length ?? "-"} segments`);
console.log(`  real newlines : ${count(/\n/g)}`);
console.log(`  real em-dashes: ${count(/—/g)}`);
console.log("");

let fail = 0;
for (const [name, got, want] of checks) {
  const ok = got === want;
  if (!ok) fail += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name.padEnd(28)} ${got}${ok ? "" : ` (want ${want})`}`);
}

console.log(`\n--- first 240 ---\n${t.slice(0, 240)}`);
console.log(`\n--- last 200 ---\n${t.slice(-200)}`);
process.exit(fail ? 1 : 0);
