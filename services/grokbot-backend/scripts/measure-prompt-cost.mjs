/**
 * What does the ported system prompt actually cost, in seconds?
 *
 * `GROKBOT2_PROMPT=short` swaps ~7.3k tokens of ported Grok Bot prompt for three sentences. That
 * trade — the app's voice against its latency — should be made on a number, not a feeling.
 *
 * Measured as time to the FIRST character of content, because that is the wait the user sees;
 * total duration mostly tracks how long the answer is. The pool varies a lot run to run (a bare
 * one-line question measured anywhere from 5.2s to 7.5s), so each mode runs several times and the
 * median is what gets reported — a single pair of readings cannot separate a real difference from
 * pool noise.
 *
 *   node scripts/measure-prompt-cost.mjs [runs]
 *
 * Spawns child processes because `config.system` is resolved at import time, so the two modes
 * cannot coexist in one process.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = Number(process.argv[2] ?? 3);

/** The child: build the prompt for this mode, stream one question, print the TTFT. */
if (process.env.__PROMPT_COST_CHILD === "1") {
  const { config, loadPoolKey } = await import("../src/config.ts");
  const { buildSystemPrompt } = await import("../src/prompt.ts");
  const system = buildSystemPrompt("", { agentName: "Test", boxOn: false, browserOn: false });
  const url = config.poolUrl.replace(/\/v1\/claude$/, "/v1/chat/completions");
  const t0 = Date.now();
  let first = null, chars = 0;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${loadPoolKey()}` },
    body: JSON.stringify({
      model: config.model, stream: true,
      messages: [{ role: "system", content: system }, { role: "user", content: "Viet mot doan khoang 120 chu ve loi ich cua di bo buoi sang." }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value, { stream: true }).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const b = line.slice(6).trim();
      if (!b || b === "[DONE]") continue;
      try {
        const piece = JSON.parse(b).choices?.[0]?.delta?.content ?? "";
        if (piece) { chars += piece.length; if (first == null) first = Date.now() - t0; }
      } catch { /* partial frame */ }
    }
  }
  console.log(JSON.stringify({ promptChars: system.length, ttft: first, total: Date.now() - t0, chars }));
  process.exit(0);
}

const runOnce = (mode) => new Promise((resolve) => {
  const env = { ...process.env, __PROMPT_COST_CHILD: "1" };
  if (mode === "short") env.GROKBOT2_PROMPT = "short"; else delete env.GROKBOT2_PROMPT;
  const child = spawn("npx", ["tsx", join(HERE, "measure-prompt-cost.mjs")], { cwd: join(HERE, ".."), shell: true, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.on("close", () => {
    const line = out.split("\n").reverse().find((l) => l.trim().startsWith("{"));
    resolve(line ? JSON.parse(line) : null);
  });
});

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const results = { full: [], short: [] };

console.log(`do ${RUNS} lan moi che do, chay xen ke\n`);
for (let i = 0; i < RUNS; i++) {
  // Interleaved on purpose: running all of one mode then all of the other would let a slow
  // minute on the pool land entirely on one side and look like a prompt effect.
  for (const mode of ["full", "short"]) {
    const r = await runOnce(mode);
    if (r?.ttft == null) { console.log(`  ${mode.padEnd(6)} lan ${i + 1}: that bai`); continue; }
    results[mode].push(r.ttft);
    console.log(`  ${mode.padEnd(6)} lan ${i + 1}: prompt ${String(r.promptChars).padStart(6)} ky tu · token dau ${String(r.ttft).padStart(6)}ms · xong ${String(r.total).padStart(6)}ms`);
  }
}

console.log("");
for (const mode of ["full", "short"]) {
  const xs = results[mode];
  if (!xs.length) { console.log(`${mode}: khong co so lieu`); continue; }
  console.log(`${mode.padEnd(6)} token dau: median ${median(xs)}ms  (${xs.join(", ")})`);
}
if (results.full.length && results.short.length) {
  const d = median(results.full) - median(results.short);
  console.log(`\nchenh lech median: ${d}ms  (${d > 0 ? "short nhanh hon" : "khong nhanh hon"})`);

  // Report the verdict as unusable when it is unusable. The first version compared the effect
  // against half the COMBINED spread, which let a run through where one mode read 6.1s → 34.9s
  // climbing monotonically — queueing on the pool, not prompt size — and printed a confident
  // 18-second median difference off it. Two checks now, both about within-mode noise:
  const spreadOf = (xs) => Math.max(...xs) - Math.min(...xs);
  const worst = Math.max(spreadOf(results.full), spreadOf(results.short));
  const climbing = (xs) => xs.length >= 3 && xs.every((v, i) => i === 0 || v > xs[i - 1]);
  if (worst > Math.abs(d)) {
    console.log(`   KHONG KET LUAN DUOC: rieng trong mot che do da chenh ${worst}ms, lon hon ca khac biet giua hai che do.`);
  }
  if (climbing(results.full) || climbing(results.short)) {
    console.log("   KHONG KET LUAN DUOC: thoi gian tang deu qua cac lan chay — pool dang bi tai, khong phai anh huong cua prompt.");
  }
  if (worst <= Math.abs(d) && !climbing(results.full) && !climbing(results.short)) {
    console.log(`   Do on dinh du de tin: prompt day du dat them khoang ${d}ms truoc ky tu dau tien.`);
  }
}
