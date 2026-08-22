/**
 * When the S10 ops process is unreachable, chat must still answer and cron must NOT
 * silently fall back to the in-process 10s scheduler (that would hide a dead ops).
 *
 *   node scripts/e2e-ops-down.mjs
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { killPort, onExitKill } from "./kill-port.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.GROKBOT2_E2E_PORT || 8801);
onExitKill(PORT);
const GW = `http://localhost:${PORT}/gw/api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = mkdtempSync(join(tmpdir(), "grokbot2-ops-down-"));

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
    GROKBOT2_COMPUTER_URL: "",
    GROKBOT2_OPS_URL: "http://127.0.0.1:1",
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

  check("BFF did not start the in-process scheduler", !/routine scheduler started/.test(log),
    log.includes("owns scheduler") ? "ops-owns line present" : log.slice(-200));

  console.log("1. sendPrompt does not 500 when ops is down");
  const created = await post("createAgent", { name: "DeadOps" });
  const agent = created.body?.agent;
  check("createAgent is 200", created.status === 200 && Boolean(agent?.id), `HTTP ${created.status}`);

  const sent = await post("sendPrompt", { agentId: agent.id, content: "Chao ban", clientNonce: `od${Date.now()}` });
  check("sendPrompt is 200", sent.status === 200, `HTTP ${sent.status}`);

  console.log("\n2. cron does not fire in-process");
  const now = new Date();
  const trigger = `${now.getMinutes()} ${now.getHours()} * * *`;
  const list = await post("createAgentAutomation", {
    id: agent.id,
    spec: { name: "should-not-fire", prompt: "ping", trigger, isEnabled: true },
  });
  const rec = (Array.isArray(list.body) ? list.body : []).find((a) => a.name === "should-not-fire");
  check("routine created", Boolean(rec?.id), JSON.stringify(list.body)?.slice(0, 120));

  await sleep(12_000);
  const after = await post("getAgentAutomations", { id: agent.id });
  const rows = Array.isArray(after.body) ? after.body : [];
  const mine = rows.find((a) => a.id === rec?.id) ?? rows.find((a) => a.name === "should-not-fire");
  const runs = mine?.runs ?? [];
  check("runs stay empty (no in-process fallback)", runs.length === 0, `runs=${runs.length}`);
} finally {
  killTree();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
