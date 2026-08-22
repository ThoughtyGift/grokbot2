/**
 * Handoff skip/continue after S6 left the BFF (ROADMAP §5.5).
 *
 * Starts a computer process + BFF, puts a handoff card on the computer, then
 * `handBackForeverBox` with trigger=button and trigger=skip. Status must keep `agentId`.
 *
 *   node scripts/e2e-handoff.mjs
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { killPort, onExitKill } from "./kill-port.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BFF = join(HERE, "..");
const COMPUTER = join(BFF, "..", "grokbot-computer");
const COMP_PORT = 8794;
const BFF_PORT = Number(process.env.GROKBOT2_E2E_PORT || 8795);
onExitKill(COMP_PORT, BFF_PORT);
const COMP_URL = `http://127.0.0.1:${COMP_PORT}`;
const GW = `http://localhost:${BFF_PORT}/gw/api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = mkdtempSync(join(tmpdir(), "grokbot2-handoff-"));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

for (const p of [COMP_PORT, BFF_PORT]) {
  try {
    await fetch(`http://127.0.0.1:${p}/health`, { signal: AbortSignal.timeout(1500) });
    console.log(`port ${p} da co tien trinh khac dang nghe — dong no truoc.`);
    process.exit(1);
  } catch { /* free */ }
}

const kids = [];
const spawnSvc = (cwd, env) => {
  const child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd, shell: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env },
  });
  kids.push(child);
  return child;
};

const killTree = () => {
  for (const child of kids) {
        // Never taskkill a pid whose child has already exited: with `shell: true` the pid is the
    // SHELL's, a shell that dies early (a backend losing the port to EADDRINUSE, say) frees it,
    // and Windows hands the number to whatever starts next. A killTree at the end of the script
    // then kills a stranger — twice in one session that stranger was the BFF on :8788.
    if (child.pid == null || child.exitCode !== null || child.killed) continue;
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill();
  }

  // Belt and braces: the tree kill above uses the SHELL's pid, which is wrong once the shell
  // has exited (stranger killed) or once it has exited while its node child lives (orphan
  // leaked). The port is the handle that is always right, and cannot reach :8788.
  killPort(COMP_PORT);
  killPort(BFF_PORT);
};

let log = "";
const computer = spawnSvc(COMPUTER, {
  GROKBOT2_COMPUTER_PORT: String(COMP_PORT),
  GROKBOT2_VNC_URL: "http://127.0.0.1/vnc.html?password=test",
});
computer.stdout.on("data", (d) => { log += d; });
computer.stderr.on("data", (d) => { log += d; });

const bff = spawnSvc(BFF, {
  PORT: String(BFF_PORT),
  GROKBOT2_PORT: String(BFF_PORT),
  GROKBOT2_AUTH: "off",
  GROKBOT2_RUNTIME_URL: "",
  GROKBOT2_COMPUTER_URL: COMP_URL,
  GROKBOT2_COMPUTER_RELEASE_MS: "4000",
  GROKBOT2_VNC_URL: "http://127.0.0.1/vnc.html?password=test",
  GROKBOT2_SQLITE_FILE: join(dataDir, "grokbot.sqlite"),
  GROKBOT2_STATE_FILE: join(dataDir, "state.json"),
});
bff.stdout.on("data", (d) => { log += d; });
bff.stderr.on("data", (d) => { log += d; });

const post = async (m, b) => (await fetch(`${GW}/${m}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
})).json();

const waitUp = async (url) => {
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return true; } catch { /* not yet */ }
  }
  return false;
};

try {
  if (!await waitUp(`${COMP_URL}/health`)) {
    console.log(`computer khong len tren ${COMP_PORT}:\n${log.slice(-600)}`);
    process.exit(1);
  }
  if (!await waitUp(`http://localhost:${BFF_PORT}/health`)) {
    console.log(`bff khong len tren ${BFF_PORT}:\n${log.slice(-600)}`);
    process.exit(1);
  }

  const { agent } = await post("createAgent", { name: "Handoff" });

  console.log("1. start handoff → status has the card and stays running");
  const started = await fetch(`${COMP_URL}/internal/handoff/start`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: agent.id, instruction: "sign in", requestId: "boxhelp-1" }),
  });
  check("computer accepted start", started.ok, `HTTP ${started.status}`);
  const st1 = await post("getForeverBoxStatus", { id: agent.id });
  check("status carries agentId", st1?.agentId === agent.id, st1?.agentId ?? "missing");
  check("handoff is present", st1?.handoff?.requestId === "boxhelp-1", JSON.stringify(st1?.handoff ?? null));
  check("state is running (card counts as using the screen)", st1?.state === "running", st1?.state ?? "-");

  console.log("\n2. handBack trigger=button clears the card");
  const back = await post("handBackForeverBox", { id: agent.id, trigger: "button" });
  check("handBack returns {}", back && typeof back === "object", JSON.stringify(back));
  const st2 = await post("getForeverBoxStatus", { id: agent.id });
  check("handoff is gone", st2?.handoff == null, JSON.stringify(st2?.handoff ?? null));
  check("agentId still set", st2?.agentId === agent.id, st2?.agentId ?? "missing");

  console.log("\n3. handBack trigger=skip also clears");
  await fetch(`${COMP_URL}/internal/handoff/start`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: agent.id, instruction: "skip me", requestId: "boxhelp-2" }),
  });
  const st3 = await post("getForeverBoxStatus", { id: agent.id });
  check("second card is live", st3?.handoff?.requestId === "boxhelp-2", JSON.stringify(st3?.handoff ?? null));
  await post("handBackForeverBox", { id: agent.id, trigger: "skip" });
  const st4 = await post("getForeverBoxStatus", { id: agent.id });
  check("skip cleared the card", st4?.handoff == null, JSON.stringify(st4?.handoff ?? null));
  check("skip kept agentId", st4?.agentId === agent.id, st4?.agentId ?? "missing");
} finally {
  killTree();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
