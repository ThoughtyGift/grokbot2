/**
 * When the model pool fails, the bot must stop spinning.
 *
 * Reported twice as "no reply, and the bot spins forever". The reply half was upstream — the
 * pool stopped answering completions while its own web pages still served in 90ms — but the
 * spinning half was ours: the `!r.ok` branch of runTurn wrote the error into the bubble and
 * returned without clearing presence, so `isRunning` stayed true with nothing behind it. Every
 * other exit from that function clears it; this was the one that did not, and it is the branch
 * an outage takes.
 *
 * Waiting for the real failure means two 185s timeouts back to back, so this points the backend
 * at a port nothing listens on: the connection is refused immediately and the same branch runs.
 *
 * Run standalone (it starts and stops its own backend on port 8799):
 *   node scripts/e2e-pool-failure.mjs
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { killPort, onExitKill } from "./kill-port.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.GROKBOT2_E2E_PORT || 8799);
onExitKill(PORT);
const GW = `http://localhost:${PORT}/gw/api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

/**
 * Refuse to run against a backend this script did not start.
 *
 * `child.kill()` with `shell: true` kills the cmd wrapper on Windows and leaves the tsx
 * grandchild listening. A later run then reuses that stale process — which is running the
 * OLD code — so this test passed against a build with the fix deliberately removed. A test
 * that cannot fail is worse than no test, so the port is checked before anything starts.
 */
try {
  await fetch(`http://localhost:${PORT}/health`, { signal: AbortSignal.timeout(1500) });
  console.log(`port ${PORT} da co tien trinh khac dang nghe — dong no truoc (stale backend tu lan chay truoc).`);
  process.exit(1);
} catch { /* nothing listening, which is what we want */ }

// Port 1 is reserved and nothing listens there, so the fetch fails at connect rather than
// hanging — the failure mode is the same, the wait is not.
const child = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(PORT),
    GROKBOT2_PORT: String(PORT),
    CLAUDE_POOL_URL: "http://127.0.0.1:1/v1/claude",
    GROKBOT2_AUTH: "off",
    GROKBOT2_RUNTIME_URL: "",
    GROKBOT2_COMPUTER_URL: "",
  },
});

/** Kill the whole tree; on Windows the direct child is only the shell wrapper. */
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

const post = async (m, b) => (await fetch(`${GW}/${m}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
})).json();

try {
  let up = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    try { if ((await fetch(`http://localhost:${PORT}/health`)).ok) { up = true; break; } } catch { /* not yet */ }
  }
  if (!up) { console.log(`backend khong len duoc tren ${PORT}:\n${log.slice(-600)}`); process.exit(1); }

  console.log("1. a turn against a dead pool");
  const { agent } = await post("createAgent", { name: "DeadPool" });
  await post("sendPrompt", { agentId: agent.id, content: "Chao ban", clientNonce: `dp${Date.now()}` });

  let settled = null;
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    const rows = await post("listAgents", {});
    const me = (Array.isArray(rows) ? rows : rows.agents).find((a) => a.id === agent.id);
    const t = await post("getAgentTranscript", { id: agent.id, limit: 5 });
    const last = (t.entries ?? []).at(-1);
    if (String(last?.message?.content ?? "").length > 0) { settled = { me, last }; break; }
  }
  check("the failure is reported in the bubble", settled != null,
    settled ? String(settled.last.message.content).slice(0, 60) : "bubble stayed empty for 45s");
  if (settled) {
    check("the bubble stops streaming", settled.last.streaming === false, `streaming=${settled.last.streaming}`);
    // The point of the test. Read it from the roster row, which is what the sidebar draws.
    check("the bot stops spinning", settled.me?.isRunning === false, `isRunning=${settled.me?.isRunning}`);
    check("no leftover activity", settled.me?.currentActivity == null, JSON.stringify(settled.me?.currentActivity ?? null));
  }
} finally {
  killTree();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
