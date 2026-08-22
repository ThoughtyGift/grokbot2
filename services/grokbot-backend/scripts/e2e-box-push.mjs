/**
 * Computer-pane status must be pushed, not waited for.
 *
 * `forever-box` is one of the sixteen channels the coordinator forwards, and the only one it
 * treats specially: it runs `proxifyForeverBoxStatus(payload, vncProxy)` on the way past, so the
 * payload has to BE the status object — `vncUrl` at the top level. The renderer files it by
 * `payload.agentId`, so a frame without that field lands under `undefined` and the pane never
 * leaves "off".
 *
 * Spawns its own computer + BFF so the P5 gate does not depend on live VNC or CDP 9222.
 *
 *   node scripts/e2e-box-push.mjs
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { gwHeaders } from "./gw-auth.mjs";
import { killPort, onExitKill } from "./kill-port.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BFF = join(HERE, "..");
const COMPUTER = join(BFF, "..", "grokbot-computer");
const COMP_PORT = 8796;
const BFF_PORT = Number(process.env.GROKBOT2_E2E_PORT || 8797);
onExitKill(COMP_PORT, BFF_PORT);
const COMP_URL = `http://127.0.0.1:${COMP_PORT}`;
const BASE = `http://localhost:${BFF_PORT}`;
const VNC = "http://127.0.0.1/vnc.html?password=test";
const GRACE = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = mkdtempSync(join(tmpdir(), "grokbot2-box-push-"));

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
  GROKBOT2_VNC_URL: VNC,
});
computer.stdout.on("data", (d) => { log += d; });
computer.stderr.on("data", (d) => { log += d; });

const bff = spawnSvc(BFF, {
  PORT: String(BFF_PORT),
  GROKBOT2_PORT: String(BFF_PORT),
  GROKBOT2_AUTH: "off",
  GROKBOT2_RUNTIME_URL: "",
  GROKBOT2_COMPUTER_URL: COMP_URL,
  GROKBOT2_COMPUTER_RELEASE_MS: String(GRACE),
  GROKBOT2_SQLITE_FILE: join(dataDir, "grokbot.sqlite"),
  GROKBOT2_STATE_FILE: join(dataDir, "state.json"),
});
bff.stdout.on("data", (d) => { log += d; });
bff.stderr.on("data", (d) => { log += d; });

const waitUp = async (url) => {
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return true; } catch { /* not yet */ }
  }
  return false;
};

try {
  if (!await waitUp(`${COMP_URL}/health`)) {
    console.log(`computer khong len tren ${COMP_PORT}:\n${log.slice(-800)}`);
    process.exit(1);
  }
  if (!await waitUp(`${BASE}/health`)) {
    console.log(`bff khong len tren ${BFF_PORT}:\n${log.slice(-800)}`);
    process.exit(1);
  }

  const post = async (m, b) => (await fetch(`${BASE}/gw/api/${m}`, {
    method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b),
  })).json();

  const frames = [];
  const stream = await fetch(`${BASE}/gw/events`, { headers: { accept: "text/event-stream", ...gwHeaders() } });
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const pump = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const data = part.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
        if (!data) continue;
        try { const ev = JSON.parse(data); if (ev.channel === "forever-box") frames.push(ev.payload); } catch { /* keepalive */ }
      }
    }
  })();

  const { agent } = await post("createAgent", { name: "BoxPush" });
  const mine = () => frames.filter((f) => f.agentId === agent.id);

  console.log("1. taking the computer pushes a running status");
  await post("ensureForeverBox", { id: agent.id });
  await sleep(1500);
  const started = mine();
  check("a frame arrived", started.length > 0, `${started.length} frame(s)`);
  check("it carries agentId", started[0]?.agentId === agent.id, started[0]?.agentId ?? "missing");
  check("state is running", started.at(-1)?.state === "running", started.at(-1)?.state ?? "-");
  check("vncUrl is present", typeof started.at(-1)?.vncUrl === "string" && started.at(-1).vncUrl.length > 0,
    started.at(-1)?.vncUrl ? "set" : "MISSING — the pane would show a placeholder");

  console.log("\n2. repeat actions do not spam the wire");
  const before = mine().length;
  for (let i = 0; i < 5; i++) await post("ensureForeverBox", { id: agent.id });
  await sleep(1200);
  check("no frame per repeat call", mine().length === before, `${mine().length - before} extra frame(s) for 5 calls`);

  console.log("\n3. releasing the session pushes it back off");
  await post("interruptAgentRun", { agentId: agent.id });
  console.log(`   (grace ${GRACE}ms)`);
  const seenBefore = mine().length;
  let offFrame = null;
  for (let i = 0; i < Math.ceil(GRACE / 1000) + 15; i++) {
    await sleep(1000);
    offFrame = mine().slice(seenBefore).find((f) => f.state === "off");
    if (offFrame) break;
  }
  check("an off frame arrived", offFrame != null, offFrame ? "state=off" : "none within the grace period + 15s");

  console.log("\n4. a pane opened by the user releases itself");
  const { agent: idle } = await post("createAgent", { name: "BoxIdle" });
  await post("ensureForeverBox", { id: idle.id });
  await sleep(800);
  const opened = await post("getForeverBoxStatus", { id: idle.id });
  check("opening the pane reports running", opened?.state === "running", opened?.state ?? "-");
  let released = null;
  for (let i = 0; i < Math.ceil(GRACE / 1000) + 15; i++) {
    await sleep(1000);
    const st = await post("getForeverBoxStatus", { id: idle.id });
    if (st?.state === "off") { released = st; break; }
  }
  check("it goes off on its own, with no turn", released != null,
    released ? "state=off" : "still running — nothing armed the release");
  check("the release was pushed too", frames.some((f) => f.agentId === idle.id && f.state === "off"),
    frames.filter((f) => f.agentId === idle.id).map((f) => f.state).join(" → ") || "no frames");

  reader.cancel().catch(() => {});
  await Promise.race([pump, sleep(1000)]);
} finally {
  killTree();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
