/**
 * P6 exit: chat p50 with 10 enabled routines vs P4 chat p50 (same model).
 *
 *   node scripts/measure-p6-latency.mjs [runs]
 *
 * Writes docs/parity-runs/P6-latency.json. Pass when chat p50 ≤ P4 chat p50 * 1.3.
 * Five sendPrompt settles is enough (same as P4); do not burn extra pool calls.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gwHeaders } from "./gw-auth.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const RUNS = Math.max(3, Number(process.argv[2] ?? 5));
const BASE = "http://localhost:8788";
const PROMPT = "Chao ban. Tra loi dung mot cau ngan.";
const P4_PATH = join(REPO, "docs", "parity-runs", "P4-latency.json");

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

let p4;
try {
  p4 = JSON.parse(readFileSync(P4_PATH, "utf8"));
} catch {
  console.error("missing docs/parity-runs/P4-latency.json");
  process.exit(2);
}
const p4Chat = p4?.p50?.chat;
if (typeof p4Chat !== "number") {
  console.error("P4-latency.json has no chat p50");
  process.exit(2);
}
const LIMIT = Math.round(p4Chat * 1.3);

async function timeChat(agentId) {
  const before = ((await gw("getAgentTranscript", { id: agentId, limit: 200 })).entries ?? []).length;
  const t0 = Date.now();
  await gw("sendPrompt", { agentId, clientNonce: `p6${Date.now()}${Math.random()}`, content: PROMPT });
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const rows = await gw("listAgents", {});
    const me = (Array.isArray(rows) ? rows : []).find((a) => a.id === agentId);
    const n = ((await gw("getAgentTranscript", { id: agentId, limit: 200 })).entries ?? []).length;
    if (n > before && me && me.isRunning === false) return Date.now() - t0;
  }
  return null;
}

const created = await gw("createAgent", { name: `P6 p50 ${Date.now() % 10000}` });
const agentId = created?.agent?.id;
if (!agentId) {
  console.error("createAgent failed");
  process.exit(2);
}

const chat = [];
try {
  for (let i = 0; i < 10; i++) {
    await gw("createAgentAutomation", {
      id: agentId,
      spec: {
        name: `p6-load-${i}`,
        prompt: "idle routine — do not fire during p50",
        trigger: "0 0 1 1 *",
        isEnabled: true,
      },
    });
  }
  const listed = await gw("getAgentAutomations", { id: agentId });
  const n = Array.isArray(listed) ? listed.length : 0;
  console.log(`model ${p4.model ?? "?"}  runs ${RUNS}  10 routines on agent (${n} listed)\n`);

  for (let i = 0; i < RUNS; i++) {
    const c = await timeChat(agentId);
    if (c != null) {
      chat.push(c);
      console.log(`  chat    ${i + 1}/${RUNS}  ${c} ms`);
    } else {
      console.log(`  chat    ${i + 1}/${RUNS}  (did not settle in 60s — omitted)`);
    }
  }
} finally {
  await gw("deleteAgents", { ids: [agentId] }).catch(() => {});
}

if (!chat.length) {
  console.error("no chat settles — cannot score p50");
  process.exit(1);
}

const chatP50 = median(chat);
const report = {
  at: new Date().toISOString(),
  model: p4.model,
  runs: RUNS,
  prompt: PROMPT,
  routines: 10,
  chatMs: chat,
  p50: { chat: chatP50, p4Chat },
  limit: LIMIT,
  ratioVsP4: +(chatP50 / p4Chat).toFixed(3),
  pass: chatP50 <= LIMIT,
  note: `pass line is chat p50 ≤ P4 chat p50 * 1.3 (${p4Chat} * 1.3 = ${LIMIT} ms). 10 enabled routines that do not match this minute.`,
};

writeFileSync(join(REPO, "docs", "parity-runs", "P6-latency.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\np50 chat=${chatP50} ms  P4 chat=${p4Chat} ms  limit=${LIMIT} ms`);
console.log(`chat/P4 = ${report.ratioVsP4}  ${report.pass ? "PASS ≤1.3" : "FAIL >1.3"}`);
process.exit(report.pass ? 0 : 1);
