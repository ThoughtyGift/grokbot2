/**
 * Where the reply latency actually goes.
 *
 * The app felt unresponsive after sending: ~24s before the first token for "Chao ban". This
 * splits that number three ways — the pool's own floor, the cost of our ported system prompt,
 * and anything our backend adds on top — so the fix targets the part that is actually large.
 *
 *   node scripts/measure-latency.cjs
 */
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..");
const URL = process.env.GROKBOT2_POOL_URL || "https://admin.halcion.vn/v1/claude";
const MODEL = process.env.GROKBOT2_MODEL || "gemini-3.7-flash";

/** Same resolution rule as src/config.ts, so we test the key the backend really uses. */
function poolKey() {
  const text = readFileSync(join(ROOT, "pool-key.txt"), "utf8");
  const usable = text.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.includes("PASTE_") && !l.startsWith("#") && !l.startsWith("//"));
  for (const l of usable) { const m = l.match(/hal_[A-Za-z0-9]{24,}/); if (m) return m[0]; }
  return usable.find((l) => /^[A-Za-z0-9_\-.]{16,}$/.test(l)) || null;
}

/** The generated base prompt, read as data rather than imported (importing boots the backend). */
function basePrompt() {
  const src = readFileSync(join(ROOT, "src", "prompt-base.ts"), "utf8");
  const start = src.indexOf('BASE_SYSTEM_PROMPT = ');
  if (start < 0) throw new Error("BASE_SYSTEM_PROMPT not found");
  const open = src.indexOf('"', start);
  // Walk the JSON string literal to its unescaped closing quote.
  let i = open + 1;
  for (; i < src.length; i++) {
    if (src[i] === "\\") { i++; continue; }
    if (src[i] === '"') break;
  }
  return JSON.parse(src.slice(open, i + 1));
}

async function time(label, system) {
  const key = poolKey();
  const body = JSON.stringify({
    messages: [{ role: "user", content: "Chao ban" }],
    system, model: MODEL, maxTokens: 64,
  });
  const runs = [];
  for (let n = 0; n < 3; n++) {
    const t0 = Date.now();
    let ok = "?";
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body,
      });
      const j = await res.json();
      ok = j.success === true ? "ok" : `ERR ${JSON.stringify(j).slice(0, 60)}`;
    } catch (e) { ok = `THREW ${e.message}`; }
    runs.push(Date.now() - t0);
    process.stdout.write(`  ${label} run${n + 1}: ${runs[n]} ms  ${ok}\n`);
  }
  const avg = Math.round(runs.reduce((a, b) => a + b, 0) / runs.length);
  console.log(`  ${label}: system=${system.length} chars (~${Math.round(system.length / 4)} tok) → avg ${avg} ms\n`);
  return avg;
}

(async () => {
  const base = basePrompt();
  console.log(`pool ${URL} · model ${MODEL}\n`);
  const tiny = await time("tiny  ", "Ban la tro ly. Tra loi ngan.");
  const full = await time("ported", base);
  console.log(`floor (pool itself, 28-char system) : ${tiny} ms`);
  console.log(`with our ported prompt              : ${full} ms`);
  console.log(`cost of the prompt                  : ${full - tiny} ms`);
  writeFileSync(join(ROOT, ".data", "latency.json"), JSON.stringify({ tiny, full, delta: full - tiny }, null, 1));
})();
