/**
 * Memory, end to end against the real box.
 *
 * The claim being tested is the one the user actually cares about: does the bot get better
 * at working with you over time? That means a fact learned in one conversation has to
 * survive into a LATER one — so the test starts a second agent-session cold, with no shared
 * transcript, and asks for the fact back.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The gateway now runs with GROKBOT2_AUTH=enforce, so an unauthenticated call answers 401 and
// the script fails on `undefined.id` two lines later. The spawned backend reads the SAME token
// file rather than minting its own (auth-gate reuses a saved token), so sending it is correct
// and keeps these tests going through the real auth path instead of switching it off.
import { gwHeaders } from "./gw-auth.mjs";

const PORT = 18995;

/**
 * Load the repo-root `.env` into this process.
 *
 * The backend reads that file itself, so the SPAWNED one was always configured — but this script
 * also calls the box directly (`/memoryLoad` below) and guards on the same variables, and a plain
 * `node scripts/...` shell has none of them. The guard therefore fired on a machine where
 * everything needed was present, and the test read as "not applicable here" for weeks.
 */
{
  const { readFileSync } = await import("node:fs");
  const { dirname, join: j } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = j(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  try {
    for (const line of readFileSync(j(root, ".env"), "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      // Never override something the caller set on purpose.
      if (!(k in process.env)) process.env[k] = t.slice(eq + 1).trim();
    }
  } catch { /* no .env — the guard below will say what is missing */ }
}

if (!process.env.GROKBOT2_BOX_EXEC_URL) { console.error("needs GROKBOT2_BOX_EXEC_URL + GROKBOT2_EXEC_TOKEN"); process.exit(1); }

const root = await mkdtemp(join(tmpdir(), "grokbot-mem-"));
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

try { await fetch(`http://127.0.0.1:${PORT}/gw/health`, { signal: AbortSignal.timeout(1200) }); console.error("port busy"); process.exit(1); } catch { /* ok */ }

const backend = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: "services/grokbot-backend", shell: true,
  env: { ...process.env, PORT: String(PORT), GROKBOT2_STATE_FILE: join(root, "state.json"), TSX_DISABLE_CACHE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
procs.push(backend);
for (let i = 0; i < 60; i += 1) { try { await fetch(`http://127.0.0.1:${PORT}/gw/health`); break; } catch { await wait(500); } }

const gw = (m, b = {}) =>
  fetch(`http://127.0.0.1:${PORT}/gw/api/${m}`, { method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b) }).then((r) => r.json());
const textOf = (e) => (e.kind === "message" ? e.content : e.message?.content ?? "");
const entries = (id) => gw("getAgentTranscriptTail", { id, limit: 200 }).then((r) => r.entries ?? []);

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  ${String(detail).slice(0, 180)}`}`);
};

async function say(agentId, prompt, timeoutMs = 90_000) {
  const before = (await entries(agentId)).length;
  await gw("sendPrompt", { agentId, content: prompt });
  const deadline = Date.now() + timeoutMs;
  const seen = new Set();
  while (Date.now() < deadline) {
    await wait(1500);
    const turn = (await entries(agentId)).slice(before);
    for (const c of turn.filter((e) => e.kind === "send-message" && e.message?.type === "local-tool-permission" && e.message.ask.status === "pending")) {
      if (seen.has(c.message.ask.requestId)) continue;
      seen.add(c.message.ask.requestId);
      await gw("resolveLocalToolPermission", { requestId: c.message.ask.requestId, agentId, resolution: "allow-once" });
    }
    if (turn.some((e) => e.streaming)) continue;
    const reply = [...turn].reverse().find((e) => e.kind === "send-message" && e.message?.type === "text" &&
      textOf(e).trim() && !textOf(e).startsWith("🔧 "));
    if (reply) return { text: textOf(reply).replace(/\s+/g, " "), turn };
  }
  return { text: "(no reply)", turn: [] };
}

const FACT = "mình làm nghề dựng phim và chỉ thích trả lời thật ngắn";

// ── 1. the agent stores it ───────────────────────────────────────────────────
console.log("learning");
const a = (await gw("createAgent", { name: "MemProbe" })).agent;
const r1 = await say(a.id, `Nhớ giúp mình điều này cho những lần sau: ${FACT}.`);
console.log(`      reply: ${r1.text.slice(0, 120)}`);
const usedTool = r1.turn.some((e) => e.kind === "tool-call" && e.name === "knowledge_base");
check("the agent called knowledge_base", usedTool, r1.turn.filter((e) => e.kind === "tool-call").map((e) => e.name).join(",") || "no tool call");

// ── 2. it landed on the box, not just in this process ───────────────────────
const stored = await fetch(`${process.env.GROKBOT2_BOX_EXEC_URL.replace(/\/+$/, "")}/memoryLoad`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROKBOT2_EXEC_TOKEN}` },
  body: JSON.stringify({ key: a.id }),
}).then((r) => r.json()).catch(() => ({ entries: [] }));
check("it is persisted on the box", (stored.entries ?? []).length > 0, JSON.stringify(stored).slice(0, 160));
if (stored.entries?.length) console.log(`      stored: ${stored.entries.map((e) => `${e.title}: ${e.content}`).join(" | ").slice(0, 160)}`);

// ── 3. a COLD session recalls it ────────────────────────────────────────────
// Same bot, brand-new backend process: no transcript, no cache. If the fact comes back it
// came from the box, which is the whole claim.
console.log("\nrecall in a cold session");
await killTree(backend);
procs.length = 0;
const backend2 = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: "services/grokbot-backend", shell: true,
  env: { ...process.env, PORT: String(PORT), GROKBOT2_STATE_FILE: join(root, "state2.json"), TSX_DISABLE_CACHE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
procs.push(backend2);
for (let i = 0; i < 60; i += 1) { try { await fetch(`http://127.0.0.1:${PORT}/gw/health`); break; } catch { await wait(500); } }

// Recreate the bot so it takes the same id, hence the same memory key.
const b = (await gw("createAgent", { name: "MemProbe" })).agent;
check("cold session reuses the same agent id", b.id === a.id, `${a.id} -> ${b.id}`);
check("cold session starts with an empty transcript", (await entries(b.id)).length === 0);

const r2 = await say(b.id, "Mình làm nghề gì, và bạn nên trả lời mình dài hay ngắn?");
console.log(`      reply: ${r2.text.slice(0, 180)}`);
check("recalls the profession", /dựng phim/i.test(r2.text), r2.text.slice(0, 120));
check("recalls the style preference", /ngắn/i.test(r2.text), r2.text.slice(0, 120));
check("recalled without calling a tool", !r2.turn.some((e) => e.kind === "tool-call"), "it had to look it up instead of already knowing");

console.log(`\n${pass} passed, ${fail} failed`);
await stop();
process.exit(fail ? 1 : 0);
