/**
 * P4 exit: S5 hop p50 vs the pool floor, same model and payload.
 *
 *   node scripts/measure-p4-latency.mjs [runs]
 *
 * Writes docs/parity-runs/P4-latency.json. Pass when runtime p50 ≤ 1.3× pool p50.
 * sendPrompt wait is recorded when it settles; it is not the pass line because chat includes
 * the ported system prompt and typewriter (ROADMAP §5.4 is the extract hop, cùng model).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gwHeaders } from "./gw-auth.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const REPO = join(ROOT, "..", "..");
const RUNS = Math.max(3, Number(process.argv[2] ?? 5));
const BASE = "http://localhost:8788";
const RUNTIME = (process.env.GROKBOT2_RUNTIME_URL || "http://127.0.0.1:8789").replace(/\/$/, "");
const POOL = process.env.CLAUDE_POOL_URL ?? "https://admin.halcion.vn/v1/claude";
const MODEL = process.env.GROKBOT2_MODEL ?? "gemini-3.7-flash";
const PROMPT = "Chao ban. Tra loi dung mot cau ngan.";
const BODY = { messages: [{ role: "user", content: PROMPT }], model: MODEL, maxTokens: 64 };

function poolKey() {
  const text = readFileSync(join(ROOT, "pool-key.txt"), "utf8");
  const usable = text.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.includes("PASTE_") && !l.startsWith("#") && !l.startsWith("//"));
  for (const l of usable) {
    const m = l.match(/hal_[A-Za-z0-9]{24,}/);
    if (m) return m[0];
  }
  return usable.find((l) => /^[A-Za-z0-9_\-.]{16,}$/.test(l)) || null;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

const gw = async (m, a) => {
  const r = await fetch(`${BASE}/gw/api/${m}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...gwHeaders() },
    body: JSON.stringify(a ?? {}),
  });
  return r.json();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function timePool(key) {
  const t0 = Date.now();
  const res = await fetch(POOL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(BODY),
    signal: AbortSignal.timeout(60_000),
  });
  const j = await res.json();
  const ms = Date.now() - t0;
  if (j.success !== true && !j.result && !j.text) throw new Error(`pool ${res.status}`);
  return ms;
}

async function timeRuntime(key) {
  const t0 = Date.now();
  const res = await fetch(`${RUNTIME}/internal/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...BODY, url: POOL, key, stream: false }),
    signal: AbortSignal.timeout(60_000),
  });
  const j = await res.json();
  const ms = Date.now() - t0;
  if (!j.ok) throw new Error(j.error ?? `runtime HTTP ${res.status}`);
  return ms;
}

async function timeChat(agentId) {
  const before = ((await gw("getAgentTranscript", { id: agentId, limit: 200 })).entries ?? []).length;
  const t0 = Date.now();
  await gw("sendPrompt", { agentId, clientNonce: `p4${Date.now()}${Math.random()}`, content: PROMPT });
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const rows = await gw("listAgents", {});
    const me = (Array.isArray(rows) ? rows : []).find((a) => a.id === agentId);
    const n = ((await gw("getAgentTranscript", { id: agentId, limit: 200 })).entries ?? []).length;
    if (n > before && me && me.isRunning === false) return Date.now() - t0;
  }
  return null;
}

const key = poolKey();
if (!key) {
  console.error("no pool key");
  process.exit(2);
}

console.log(`model ${MODEL}  runs ${RUNS}  pool vs /internal/turns (same payload)\n`);

const pool = [];
const runtime = [];
const chat = [];

let agentId = null;
try {
  const created = await gw("createAgent", { name: `P4 p50 ${Date.now() % 10000}` });
  agentId = created?.agent?.id ?? null;
} catch { /* BFF optional for hop measurement */ }

try {
  for (let i = 0; i < RUNS; i++) {
    const p = await timePool(key);
    pool.push(p);
    console.log(`  pool    ${i + 1}/${RUNS}  ${p} ms`);
    const r = await timeRuntime(key);
    runtime.push(r);
    console.log(`  runtime ${i + 1}/${RUNS}  ${r} ms`);
    if (agentId) {
      const c = await timeChat(agentId);
      if (c != null) {
        chat.push(c);
        console.log(`  chat    ${i + 1}/${RUNS}  ${c} ms`);
      } else {
        console.log(`  chat    ${i + 1}/${RUNS}  (did not settle in 60s — omitted)`);
      }
    }
  }
} finally {
  if (agentId) await gw("deleteAgents", { ids: [agentId] }).catch(() => {});
}

const report = {
  at: new Date().toISOString(),
  model: MODEL,
  runs: RUNS,
  prompt: PROMPT,
  poolMs: pool,
  runtimeMs: runtime,
  chatMs: chat,
  p50: {
    pool: median(pool),
    runtime: median(runtime),
    chat: chat.length ? median(chat) : null,
  },
};
report.ratio = {
  runtimeOverPool: +(report.p50.runtime / report.p50.pool).toFixed(3),
  chatOverPool: report.p50.chat ? +(report.p50.chat / report.p50.pool).toFixed(3) : null,
};
report.pass = report.ratio.runtimeOverPool <= 1.3;
report.note = "pass line is runtime/pool with identical payload (S5 hop). chat wait includes the ported prompt.";

writeFileSync(join(REPO, "docs", "parity-runs", "P4-latency.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\np50 pool=${report.p50.pool} ms  runtime=${report.p50.runtime} ms  chat=${report.p50.chat ?? "n/a"} ms`);
console.log(`runtime/pool = ${report.ratio.runtimeOverPool}  ${report.pass ? "PASS ≤1.3" : "FAIL >1.3"}`);
process.exit(report.pass ? 0 : 1);
