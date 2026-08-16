/**
 * Context grep for the 23 MB host bundle.
 *
 * `grep -o` with a wide context window misses matches here: the bundle is effectively one
 * enormous line, so line-oriented tools behave unpredictably. Read it once and slice.
 *
 *   node grep-host.mjs <needle> [before] [after] [max]
 */
import { readFileSync } from "node:fs";

const HOST = process.env.HOST_BUNDLE ?? "C:/Users/admin/Desktop/grokbot-fe-current/dist/host/host-main.cjs";
const needle = process.argv[2];
const before = Number(process.argv[3] ?? 100);
const after = Number(process.argv[4] ?? 160);
const max = Number(process.argv[5] ?? 6);

const src = readFileSync(HOST, "utf8");
let from = 0, n = 0;
while (n < max) {
  const i = src.indexOf(needle, from);
  if (i < 0) break;
  console.log(`\n--- match ${++n} @ ${i} ---`);
  console.log(src.slice(Math.max(0, i - before), i + needle.length + after).replace(/\n/g, "\\n"));
  from = i + needle.length;
}
if (!n) console.log(`no match for ${JSON.stringify(needle)}`);
else console.log(`\n(total occurrences: ${src.split(needle).length - 1})`);
