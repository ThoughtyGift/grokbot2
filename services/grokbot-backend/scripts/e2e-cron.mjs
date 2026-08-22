/**
 * P6 exit: a cron routine fires from the ops process clock, with history on the BFF.
 *
 * Spawns ops + BFF. Creates an enabled cron matching `now`, drives ops `/internal/tick`
 * with that instant (no 70s wall wait), and asserts a schedule run exists. Also proves
 * the BFF did not start the in-process 10s interval.
 *
 *   node scripts/e2e-cron.mjs
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { killPort, onExitKill } from "./kill-port.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BFF = join(HERE, "..");
const OPS = join(BFF, "..", "grokbot-ops");
const OPS_PORT = 8802;
const BFF_PORT = Number(process.env.GROKBOT2_E2E_PORT || 8803);
onExitKill(OPS_PORT, BFF_PORT);
const OPS_URL = `http://127.0.0.1:${OPS_PORT}`;
const BFF_URL = `http://127.0.0.1:${BFF_PORT}`;
const GW = `http://localhost:${BFF_PORT}/gw/api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = mkdtempSync(join(tmpdir(), "grokbot2-cron-"));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

for (const p of [OPS_PORT, BFF_PORT]) {
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
  killPort(OPS_PORT);
  killPort(BFF_PORT);
};

let bffLog = "";
let opsLog = "";
const ops = spawnSvc(OPS, {
  GROKBOT2_OPS_PORT: String(OPS_PORT),
  GROKBOT2_BFF_URL: BFF_URL,
});
ops.stdout.on("data", (d) => { opsLog += d; });
ops.stderr.on("data", (d) => { opsLog += d; });

const bff = spawnSvc(BFF, {
  PORT: String(BFF_PORT),
  GROKBOT2_PORT: String(BFF_PORT),
  GROKBOT2_AUTH: "off",
  GROKBOT2_RUNTIME_URL: "",
  GROKBOT2_COMPUTER_URL: "",
  GROKBOT2_OPS_URL: OPS_URL,
  GROKBOT2_SQLITE_FILE: join(dataDir, "grokbot.sqlite"),
  GROKBOT2_STATE_FILE: join(dataDir, "state.json"),
});
bff.stdout.on("data", (d) => { bffLog += d; });
bff.stderr.on("data", (d) => { bffLog += d; });

const post = async (m, b) => {
  const r = await fetch(`${GW}/${m}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const waitHealth = async (url) => {
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ }
  }
  return false;
};

try {
  if (!await waitHealth(`${OPS_URL}/health`)) {
    console.log(`ops khong len duoc tren ${OPS_PORT}:\n${opsLog.slice(-600)}`);
    process.exit(1);
  }
  if (!await waitHealth(`${BFF_URL}/health`)) {
    console.log(`bff khong len duoc tren ${BFF_PORT}:\n${bffLog.slice(-600)}`);
    process.exit(1);
  }

  const opsHealth = await (await fetch(`${OPS_URL}/health`)).json();
  check("ops role is ops", opsHealth.role === "ops", JSON.stringify(opsHealth));
  check("BFF did not start in-process scheduler", !/routine scheduler started/.test(bffLog),
    /owns scheduler/.test(bffLog) ? "ops-owns line present" : bffLog.slice(-200));
  check("ops started its interval", /scheduler started/.test(opsLog), opsLog.slice(-200));

  const created = await post("createAgent", { name: "CronBot" });
  const agent = created.body?.agent;
  check("createAgent is 200", Boolean(agent?.id), `HTTP ${created.status}`);

  const now = new Date();
  const trigger = `${now.getMinutes()} ${now.getHours()} * * *`;
  const list = await post("createAgentAutomation", {
    id: agent.id,
    spec: { name: "p6-cron", prompt: "cron ping", trigger, isEnabled: true },
  });
  const rec = (Array.isArray(list.body) ? list.body : []).find((a) => a.name === "p6-cron");
  check("routine created", Boolean(rec?.id), JSON.stringify(list.body)?.slice(0, 160));

  const t0 = Date.now();
  const tick = await fetch(`${OPS_URL}/internal/tick`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ now: now.toISOString() }),
  });
  const tickBody = await tick.json().catch(() => null);
  check("ops /internal/tick is 200", tick.ok, `HTTP ${tick.status} ${JSON.stringify(tickBody)}`);

  const after = await post("getAgentAutomations", { id: agent.id });
  const rows = Array.isArray(after.body) ? after.body : [];
  const mine = rows.find((a) => a.id === rec?.id) ?? rows.find((a) => a.name === "p6-cron");
  const run = (mine?.runs ?? [])[0];
  check("a schedule run exists in history", run?.trigger === "schedule", JSON.stringify(run ?? mine?.runs));
  const started = run?.startedAt;
  check("scheduledAt within 60s of target", typeof started === "number" && Math.abs(started - t0) <= 60_000,
    started != null ? `delta=${started - t0}ms` : "missing startedAt");
} finally {
  killTree();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
