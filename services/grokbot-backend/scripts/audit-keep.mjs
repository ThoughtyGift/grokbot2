/**
 * Audit the KEEP list in build-prompt.mjs against the extracted segments.
 *
 * KEEP is a list of INDICES, so it is silently wrong the moment the app updates and the
 * segments shift. Re-extract first and diff, then read this: it prints every chapter with its
 * heading and whether we keep it, so the selection can be judged rather than trusted.
 *
 *   node scripts/audit-keep.mjs            # from the repo root
 */
import { readFileSync } from "node:fs";

const JSON_PATH = "docs/extracted/subagent-prompts.json";
const GEN_PATH = "services/grokbot-backend/scripts/build-prompt.mjs";

const data = JSON.parse(readFileSync(JSON_PATH, "utf8"));
const segments = data.prompts.find((p) => p.name === "buildSandBaseSystemPrompt")?.segments;
if (!segments) { console.error("buildSandBaseSystemPrompt not found"); process.exit(1); }

// Read the KEEP array out of the generator rather than duplicating it here — a second copy
// would drift, and this audit exists precisely to catch drift.
const gen = readFileSync(GEN_PATH, "utf8");
const block = gen.slice(gen.indexOf("const KEEP = ["), gen.indexOf("];", gen.indexOf("const KEEP = [")));
const KEEP = new Set([...block.matchAll(/(?<![\w.])(\d+)(?=\s*,)/g)].map((m) => Number(m[1])));

/** First markdown heading in a segment, else its opening words. */
const label = (s) => {
  const h = s.match(/^#{1,4}\s+(.+)$/m);
  if (h) return `## ${h[1].trim()}`;
  return s.replace(/\s+/g, " ").trim().slice(0, 72);
};

let keptChars = 0, dropChars = 0;
const kept = [], dropped = [];
segments.forEach((s, i) => {
  const row = `${String(i).padStart(3)}  ${label(s)}`;
  if (KEEP.has(i)) { kept.push(row); keptChars += s.length; }
  else { dropped.push(row); dropChars += s.length; }
});

console.log(`segments: ${segments.length}   KEEP: ${KEEP.size}   dropped: ${segments.length - KEEP.size}`);
console.log(`chars   : kept ${keptChars} (~${Math.round(keptChars / 4)} tok) · dropped ${dropChars}`);

const bad = [...KEEP].filter((i) => i >= segments.length);
console.log(bad.length ? `\n!! KEEP references ${bad.length} index(es) past the end: ${bad.join(", ")}` : "\nall KEEP indices are in range");

console.log(`\n===== KEPT (${kept.length}) =====`);
for (const r of kept) console.log(r);
console.log(`\n===== DROPPED (${dropped.length}) =====`);
for (const r of dropped) console.log(r);
