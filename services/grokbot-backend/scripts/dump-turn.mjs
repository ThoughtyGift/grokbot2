/**
 * Dump the raw transcript entries for one turn.
 *
 * The E2E reported "no tool call" while the reply plainly contained a tool result, so the
 * question is what entries the backend actually produced — not what the rendered text says.
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "dump-token";
const DAEMON = 18991;
const BACKEND = 18992;
const root = await mkdtemp(join(tmpdir(), "grokbot-dump-"));
await writeFile(join(root, "notes.txt"), "alpha\nbravo\nMAGIC_TOKEN_9137\ndelta\n");

const procs = [];
const killTree = (p) =>
  new Promise((r) => {
        // Never taskkill a pid whose child has already exited: with `shell: true` the pid is the
    // SHELL's, a shell that dies early (a backend losing the port to EADDRINUSE, say) frees it,
    // and Windows hands the number to whatever starts next. A killTree at the end of the script
    // then kills a stranger — twice in one session that stranger was the BFF on :8788.
    if (!p.pid || p.exitCode !== null || p.killed) return r();
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }).on("close", r);
    else { try { process.kill(-p.pid, "SIGKILL"); } catch { p.kill("SIGKILL"); } r(); }
  });
const stop = async () => { for (const p of procs) await killTree(p); await rm(root, { recursive: true, force: true }); };
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => void stop().then(() => process.exit(1)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const shell = ["/bin/bash", "C:/Program Files/Git/bin/bash.exe"].find((p) => existsSync(p));
const daemon = spawn(process.execPath, ["infra/vps/exec-daemon.mjs", String(DAEMON), root], {
  env: { ...process.env, GROKBOT2_EXEC_TOKEN: TOKEN, ...(shell ? { GROKBOT2_EXEC_SHELL: shell } : {}) },
  stdio: ["ignore", "pipe", "pipe"],
});
procs.push(daemon);
await new Promise((r) => daemon.stdout.once("data", r));

const backend = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: "services/grokbot-backend", shell: true,
  env: {
    ...process.env, PORT: String(BACKEND), GROKBOT2_BOX_EXEC_URL: `http://127.0.0.1:${DAEMON}`,
    GROKBOT2_EXEC_TOKEN: TOKEN, GROKBOT2_STATE_FILE: join(root, "state.json"), TSX_DISABLE_CACHE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
procs.push(backend);
for (let i = 0; i < 60; i += 1) {
  try { await fetch(`http://127.0.0.1:${BACKEND}/gw/health`); break; } catch { await wait(500); }
}

const gw = (m, b = {}) =>
  fetch(`http://127.0.0.1:${BACKEND}/gw/api/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());

const agent = (await gw("createAgent", { name: "Dump" })).agent;
await gw("sendPrompt", { agentId: agent.id, content: "File notes.txt có một token đặc biệt. Đọc file đó và cho tôi biết token." });

// Approve anything that asks, and keep watching for a while so late entries are captured.
for (let i = 0; i < 40; i += 1) {
  await wait(1500);
  const es = (await gw("getAgentTranscriptTail", { id: agent.id, limit: 100 })).entries ?? [];
  for (const c of es.filter((e) => e.kind === "send-message" && e.message?.type === "local-tool-permission" && e.message.ask.status === "pending")) {
    await gw("resolveLocalToolPermission", { requestId: c.message.ask.requestId, agentId: agent.id, resolution: "allow-once" });
  }
  if (es.some((e) => e.kind === "tool-call" && (e.status === "done" || e.status === "failed"))) { await wait(6000); break; }
}

const entries = (await gw("getAgentTranscriptTail", { id: agent.id, limit: 100 })).entries ?? [];
console.log(`\n=== ${entries.length} entries ===`);
for (const e of entries) {
  const body =
    e.kind === "message" ? `${e.role}: ${e.content}` :
    e.kind === "tool-call" ? `${e.name}(${e.rawArgs}) status=${e.status} result=${String(e.result ?? "").slice(0, 60)}` :
    e.kind === "send-message" ? `${e.message?.type}: ${String(e.message?.content ?? e.message?.ask?.target ?? "").slice(0, 150)}${e.streaming ? "  [streaming]" : ""}` :
    JSON.stringify(e).slice(0, 120);
  console.log(`  [${e.kind}] ${body.replace(/\s+/g, " ")}`);
}

await stop();
