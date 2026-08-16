/**
 * Context grep for the renderer bundle.
 *
 * Same reason as grep-host: the file is effectively one line, so line-oriented tools behave
 * unpredictably on it. Reads once and slices around each hit.
 *
 *   node grep-fe.mjs <needle> [before] [after] [max]
 */
import { readFileSync } from "node:fs";

const FE = process.env.FE_BUNDLE ?? "C:/Users/admin/Desktop/grokbot-fe-current/dist/renderer/assets/index-lA9cgT4O.js";
const needle = process.argv[2];
const before = Number(process.argv[3] ?? 150);
const after = Number(process.argv[4] ?? 220);
const max = Number(process.argv[5] ?? 6);

const src = readFileSync(FE, "utf8");
let from = 0, n = 0;
while (n < max) {
  const i = src.indexOf(needle, from);
  if (i < 0) break;
  console.log(`\n--- ${++n} @ ${i} ---`);
  console.log(src.slice(Math.max(0, i - before), i + needle.length + after).replace(/\n/g, "\\n"));
  from = i + needle.length;
}
console.log(n ? `\n(total ${src.split(needle).length - 1})` : `no match for ${JSON.stringify(needle)}`);
