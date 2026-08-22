/**
 * When the S5 runtime process is unreachable, the bot must stop spinning.
 *
 * Same presence-clear assertion as `e2e-pool-failure.mjs`, but the failure is "runtime
 * down" (ROADMAP §5.4) rather than a dead pool URL. The spawned BFF is pointed at a port
 * nothing listens on; in-process fallback must not hide that.
 *
 *   node scripts/e2e-runtime-down.mjs
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { killPort, onExitKill } from "./kill-port.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.GROKBOT2_E2E_PORT || 8798);
onExitKill(PORT);
const GW = `http://localhost:${PORT}/gw/api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    GROKBOT2_RUNTIME_URL: "http://127.0.0.1:1",
    GROKBOT2_COMPUTER_URL: "",
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

  console.log("1. a turn against a dead runtime");
  const { agent } = await post("createAgent", { name: "DeadRuntime" });
  await post("sendPrompt", { agentId: agent.id, content: "Chao ban", clientNonce: `dr${Date.now()}` });

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
    settled ? String(settled.last.message.content).slice(0, 80) : "bubble stayed empty for 45s");
  if (settled) {
    check("the bubble names runtime down", /runtime down/i.test(String(settled.last.message.content)),
      String(settled.last.message.content).slice(0, 80));
    check("the bubble stops streaming", settled.last.streaming === false, `streaming=${settled.last.streaming}`);
    check("the bot stops spinning", settled.me?.isRunning === false, `isRunning=${settled.me?.isRunning}`);
    check("no leftover activity", settled.me?.currentActivity == null, JSON.stringify(settled.me?.currentActivity ?? null));
  }
} finally {
  killTree();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
