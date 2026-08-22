/**
 * When the S6 computer process is unreachable, chat must still answer.
 *
 * Contrast `e2e-runtime-down`: a dead runtime fails the model call. A dead computer must not
 * 500 `sendPrompt` — the pane reports `off` with `agentId` set (ROADMAP §5.5).
 *
 *   node scripts/e2e-computer-down.mjs
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { killPort, onExitKill } from "./kill-port.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.GROKBOT2_E2E_PORT || 8793);
onExitKill(PORT);
const GW = `http://localhost:${PORT}/gw/api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = mkdtempSync(join(tmpdir(), "grokbot2-computer-down-"));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

try {
  await fetch(`http://localhost:${PORT}/health`, { signal: AbortSignal.timeout(1500) });
  console.log(`port ${PORT} da co tien trinh khac dang nghe — dong no truoc.`);
  process.exit(1);
} catch { /* nothing listening */ }

const child = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(PORT),
    GROKBOT2_PORT: String(PORT),
    GROKBOT2_AUTH: "off",
    GROKBOT2_RUNTIME_URL: "",
    GROKBOT2_COMPUTER_URL: "http://127.0.0.1:1",
    GROKBOT2_SQLITE_FILE: join(dataDir, "grokbot.sqlite"),
    GROKBOT2_STATE_FILE: join(dataDir, "state.json"),
  },
});

const killTree = () => {
  // Never taskkill a pid whose child has already exited: with `shell: true` the pid is the
  // SHELL's, a shell that dies early (a backend losing the port to EADDRINUSE, say) frees it,
  // and Windows hands the number to whatever starts next. A killTree at the end of the script
  // then kills a stranger — twice in one session that stranger was the BFF on :8788.
  if (child.pid == null || child.exitCode !== null || child.killed) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();

  // Belt and braces: the tree kill above uses the SHELL's pid, which is wrong once the shell
  // has exited (stranger killed) or once it has exited while its node child lives (orphan
  // leaked). The port is the handle that is always right, and cannot reach :8788.
  killPort(PORT);
};
let log = "";
child.stdout.on("data", (d) => { log += d; });
child.stderr.on("data", (d) => { log += d; });

const post = async (m, b) => {
  const r = await fetch(`${GW}/${m}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

try {
  let up = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    try { if ((await fetch(`http://localhost:${PORT}/health`)).ok) { up = true; break; } } catch { /* not yet */ }
  }
  if (!up) { console.log(`backend khong len duoc tren ${PORT}:\n${log.slice(-600)}`); process.exit(1); }

  console.log("1. pane reports off with agentId when computer is down");
  const created = await post("createAgent", { name: "DeadComputer" });
  const agent = created.body?.agent;
  check("createAgent is 200", created.status === 200 && Boolean(agent?.id), `HTTP ${created.status}`);

  const st = await post("getForeverBoxStatus", { id: agent.id });
  check("getForeverBoxStatus is 200", st.status === 200, `HTTP ${st.status}`);
  check("status carries agentId", st.body?.agentId === agent.id, st.body?.agentId ?? "missing");
  check("state is off", st.body?.state === "off", st.body?.state ?? "-");

  const ensured = await post("ensureForeverBox", { id: agent.id });
  check("ensureForeverBox is 200", ensured.status === 200, `HTTP ${ensured.status}`);
  check("ensure still has agentId", ensured.body?.agentId === agent.id, ensured.body?.agentId ?? "missing");
  check("ensure is off, not running-without-url", ensured.body?.state === "off", ensured.body?.state ?? "-");

  console.log("\n2. sendPrompt does not 500");
  const sent = await post("sendPrompt", { agentId: agent.id, content: "Chao ban", clientNonce: `cd${Date.now()}` });
  check("sendPrompt is 200", sent.status === 200, `HTTP ${sent.status}`);

  let settled = null;
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    const rows = await post("listAgents", {});
    const list = Array.isArray(rows.body) ? rows.body : rows.body?.agents;
    const me = list?.find((a) => a.id === agent.id);
    const t = await post("getAgentTranscript", { id: agent.id, limit: 8 });
    const last = (t.body?.entries ?? []).at(-1);
    const text = String(last?.message?.content ?? last?.content ?? "");
    if (me?.isRunning === false && text.length > 0 && last?.kind !== "user-message" && last?.kind !== "message") {
      settled = { me, last, text };
      break;
    }
    if (me?.isRunning === false && (t.body?.entries ?? []).some((e) => e.kind === "send-message" && String(e.message?.content ?? "").length > 0)) {
      const hit = (t.body.entries).filter((e) => e.kind === "send-message").at(-1);
      settled = { me, last: hit, text: String(hit?.message?.content ?? "") };
      break;
    }
  }
  check("the bot still replies (or reports a model error, not a computer crash)", settled != null,
    settled ? settled.text.slice(0, 80) : "no assistant bubble for 45s");
  if (settled) {
    check("the bubble is not a 500 about computer", !/internal server error|HTTP 500/i.test(settled.text),
      settled.text.slice(0, 80));
    check("the bot stops spinning", settled.me?.isRunning === false, `isRunning=${settled.me?.isRunning}`);
  }
} finally {
  killTree();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
