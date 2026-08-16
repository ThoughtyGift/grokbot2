/**
 * Does compaction preserve what the conversation actually depends on?
 *
 * Plants a specific fact early, buries it under enough traffic to force compaction, then
 * asks for it back. A unit test can prove the slice arithmetic; only a real summary pass
 * can show whether the fact survived the summariser.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BACKEND_PORT = 18661;
const root = await mkdtemp(join(tmpdir(), "grokbot-compact-"));
const procs = [];
const killTree = (p) =>
  new Promise((r) => {
    if (!p.pid) return r();
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }).on("close", r);
    else { try { process.kill(-p.pid, "SIGKILL"); } catch { p.kill("SIGKILL"); } r(); }
  });
const stop = async () => { for (const p of procs) await killTree(p); await rm(root, { recursive: true, force: true }); };
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => void stop().then(() => process.exit(1)));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await fetch(`http://127.0.0.1:${BACKEND_PORT}/gw/health`, { signal: AbortSignal.timeout(1200) });
  console.error(`port ${BACKEND_PORT} already in use — kill it first`);
  process.exit(1);
} catch { /* expected */ }

// A small budget forces compaction after a handful of turns instead of a hundred.
const backend = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: "services/grokbot-backend",
  shell: true,
  env: {
    ...process.env,
    PORT: String(BACKEND_PORT),
    GROKBOT2_STATE_FILE: join(root, "state.json"),
    GROKBOT2_CONTEXT_BUDGET: "900",
    GROKBOT2_KEEP_RECENT: "4",
    TSX_DISABLE_CACHE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
procs.push(backend);
backend.stdout.on("data", (d) => { const s = String(d); if (/compact|backend on/i.test(s)) process.stdout.write(`[be] ${s}`); });

for (let i = 0; i < 60; i += 1) {
  try { await fetch(`http://127.0.0.1:${BACKEND_PORT}/gw/health`); break; } catch { await wait(500); }
}

const gw = (m, body = {}) =>
  fetch(`http://127.0.0.1:${BACKEND_PORT}/gw/api/${m}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());

const agent = (await gw("createAgent", { name: "CompactTest" })).agent;
const textOf = (e) => (e.kind === "message" ? e.content : e.message?.content ?? "");

async function say(prompt, timeoutMs = 90_000) {
  const before = ((await gw("getAgentTranscriptTail", { id: agent.id, limit: 300 })).entries ?? []).length;
  await gw("sendPrompt", { agentId: agent.id, content: prompt });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await wait(1500);
    const all = (await gw("getAgentTranscriptTail", { id: agent.id, limit: 300 })).entries ?? [];
    const reply = all.slice(before).reverse()
      .find((e) => e.kind === "send-message" && e.message?.type === "text" && textOf(e).trim() && !e.streaming);
    if (reply) return textOf(reply);
  }
  return "(no reply)";
}

console.log(`agent ${agent.id}, budget=900 tok, keep=4\n`);

// 1. Plant a fact that no summariser can guess.
const FACT = "MÃ DỰ ÁN CỦA MÌNH LÀ ZK-4417-OMEGA";
console.log("1. planting the fact");
console.log(`   -> ${(await say(`Nhớ giúp mình: ${FACT}. Chỉ cần trả lời "đã nhớ".`)).slice(0, 90)}`);

// 2. Bury it under unrelated traffic until the budget is exceeded.
const filler = [
  "Kể mình nghe một sự thật thú vị về đại dương, khoảng 3 câu.",
  "Còn về sa mạc thì sao, cũng 3 câu.",
  "Núi cao nhất từng châu lục tên gì, liệt kê ngắn.",
  "Nói về mưa axit trong 3 câu.",
  "Giải thích ngắn gọn vì sao bầu trời màu xanh.",
  "Kể một sự thật về loài mèo, 2 câu.",
];
console.log("\n2. burying it");
for (const [i, f] of filler.entries()) {
  const r = await say(f);
  console.log(`   turn ${i + 2}: ${r.replace(/\s+/g, " ").slice(0, 60)}…`);
}

// 3. Ask for the buried fact back.
console.log("\n3. asking for it back");
const answer = await say(`Mã dự án mình đã nói lúc đầu là gì? Trả lời chính xác mã đó.`);
console.log(`   -> ${answer.replace(/\s+/g, " ").slice(0, 200)}`);

const state = JSON.parse(await (await fetch(`http://127.0.0.1:${BACKEND_PORT}/gw/api/getHostSettings`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } })).text());
void state;

const remembered = /ZK-4417-OMEGA/i.test(answer);
console.log(`\ncompaction happened : see [be] lines above`);
console.log(`fact survived       : ${remembered}`);

await stop();
process.exit(remembered ? 0 : 1);
