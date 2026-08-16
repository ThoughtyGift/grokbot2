/**
 * Does the tiered prompt actually change how the agent behaves?
 *
 * Unit tests prove the string is assembled correctly; only a live turn shows whether the
 * model reads the context and volatile tiers. Three probes, each targeting one tier.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 18771;
const root = await mkdtemp(join(tmpdir(), "grokbot-prompt-"));
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
  await fetch(`http://127.0.0.1:${PORT}/gw/health`, { signal: AbortSignal.timeout(1200) });
  console.error(`port ${PORT} already in use`); process.exit(1);
} catch { /* expected */ }

const backend = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: "services/grokbot-backend", shell: true,
  env: { ...process.env, PORT: String(PORT), GROKBOT2_STATE_FILE: join(root, "state.json"), TSX_DISABLE_CACHE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
procs.push(backend);
for (let i = 0; i < 60; i += 1) {
  try { await fetch(`http://127.0.0.1:${PORT}/gw/health`); break; } catch { await wait(500); }
}

const gw = (m, b = {}) =>
  fetch(`http://127.0.0.1:${PORT}/gw/api/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());

await gw("setHostSettings", { userTimeZone: "Asia/Ho_Chi_Minh" });
const agent = (await gw("createAgent", { name: "TierProbe" })).agent;
const textOf = (e) => (e.kind === "message" ? e.content : e.message?.content ?? "");

async function say(prompt, timeoutMs = 90_000) {
  const before = ((await gw("getAgentTranscriptTail", { id: agent.id, limit: 200 })).entries ?? []).length;
  await gw("sendPrompt", { agentId: agent.id, content: prompt });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await wait(1500);
    const all = (await gw("getAgentTranscriptTail", { id: agent.id, limit: 200 })).entries ?? [];
    const r = all.slice(before).reverse()
      .find((e) => e.kind === "send-message" && e.message?.type === "text" && textOf(e).trim() && !e.streaming);
    if (r) return textOf(r).replace(/\s+/g, " ").trim();
  }
  return "(no reply)";
}

const CASES = [
  {
    tier: "context (agent identity)",
    ask: "Bạn tên là gì? Trả lời ngắn.",
    ok: (r) => /TierProbe/i.test(r),
  },
  {
    tier: "context (no box → must not promise a shell)",
    ask: "Chạy lệnh `ls -la` giúp mình.",
    // Correct behaviour is to say it cannot, not to claim it ran something.
    ok: (r) => /chưa|không thể|không có|no box|chưa nối/i.test(r) && !/^(đã chạy|kết quả)/i.test(r),
  },
  {
    tier: "volatile (date)",
    ask: "Hôm nay là ngày mấy? Chỉ trả lời ngày tháng năm.",
    ok: (r) => new RegExp(String(new Date().getFullYear())).test(r),
  },
];

console.log(`agent ${agent.id} "TierProbe", timezone Asia/Ho_Chi_Minh\n`);
let pass = 0, fail = 0;
for (const c of CASES) {
  const r = await say(c.ask);
  const ok = c.ok(r);
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${c.tier}`);
  console.log(`      ask   : ${c.ask}`);
  console.log(`      reply : ${r.slice(0, 170)}\n`);
}

console.log(`${pass} passed, ${fail} failed`);
await stop();
process.exit(fail ? 1 : 0);
