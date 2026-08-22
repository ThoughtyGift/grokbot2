/**
 * Public Slack/GitHub HTTP terminates on ops, not on BFF `/gw/.../events`.
 *
 *   node scripts/e2e-webhook-ops.mjs
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
const OPS_PORT = 8804;
const BFF_PORT = Number(process.env.GROKBOT2_E2E_PORT || 8805);
onExitKill(OPS_PORT, BFF_PORT);
const OPS_URL = `http://127.0.0.1:${OPS_PORT}`;
const BFF_URL = `http://127.0.0.1:${BFF_PORT}`;
const GW = `http://localhost:${BFF_PORT}/gw`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = mkdtempSync(join(tmpdir(), "grokbot2-webhook-ops-"));

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

spawnSvc(OPS, { GROKBOT2_OPS_PORT: String(OPS_PORT), GROKBOT2_BFF_URL: BFF_URL });
spawnSvc(BFF, {
  PORT: String(BFF_PORT),
  GROKBOT2_PORT: String(BFF_PORT),
  GROKBOT2_AUTH: "off",
  GROKBOT2_RUNTIME_URL: "",
  GROKBOT2_COMPUTER_URL: "",
  GROKBOT2_OPS_URL: OPS_URL,
  GROKBOT2_SQLITE_FILE: join(dataDir, "grokbot.sqlite"),
  GROKBOT2_STATE_FILE: join(dataDir, "state.json"),
});

const waitHealth = async (url) => {
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ }
  }
  return false;
};

try {
  if (!await waitHealth(`${OPS_URL}/health`) || !await waitHealth(`${BFF_URL}/health`)) {
    console.log("ops/bff khong len duoc");
    process.exit(1);
  }

  const challenge = await fetch(`${OPS_URL}/slack/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "url_verification", challenge: "wh-ops" }),
  });
  const ch = await challenge.json();
  check("ops url_verification echoes challenge", ch?.challenge === "wh-ops", JSON.stringify(ch));

  const ping = await fetch(`${OPS_URL}/github/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-github-event": "ping" },
    body: "{}",
  });
  const pingBody = await ping.json();
  check("ops github ping is pong", pingBody?.pong === true, JSON.stringify(pingBody));

  const gwSlack = await fetch(`${GW}/slack/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "url_verification", challenge: "should-404" }),
  });
  check("BFF /gw/slack/events is 404 when ops URL is set", gwSlack.status === 404, `HTTP ${gwSlack.status}`);

  const gwGh = await fetch(`${GW}/github/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-github-event": "ping" },
    body: "{}",
  });
  check("BFF /gw/github/events is 404 when ops URL is set", gwGh.status === 404, `HTTP ${gwGh.status}`);

  const created = await fetch(`${GW}/api/createAgent`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "SlackBot" }),
  });
  const agent = (await created.json())?.agent;
  check("createAgent", Boolean(agent?.id), created.status);

  await fetch(`${GW}/api/createAgentAutomation`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: agent.id,
      spec: { name: "slack-listener", prompt: "reply", trigger: "slack_mention", isEnabled: true },
    }),
  });

  const ev = await fetch(`${OPS_URL}/slack/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "event_callback",
      event: { type: "app_mention", text: "hello", channel: "C1", user: "U1" },
    }),
  });
  const evBody = await ev.json();
  check("ops event_callback fires a listener", ev.ok && evBody?.fired >= 1, JSON.stringify(evBody));

  const autos = await (await fetch(`${GW}/api/getAgentAutomations`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: agent.id }),
  })).json();
  const listener = (Array.isArray(autos) ? autos : []).find((a) => a.name === "slack-listener");
  check("BFF history has an event run", listener?.runs?.[0]?.trigger === "event",
    JSON.stringify(listener?.runs?.[0] ?? null));
} finally {
  killTree();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
