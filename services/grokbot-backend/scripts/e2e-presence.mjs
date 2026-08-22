/**
 * The typing indicator, watched from the outside.
 *
 * The client computes it as
 *   isAgentRunning ? (isAgentComposing ? "typing" : "working") : "none"
 * from `isRunning` / `isComposingMessage` on the AGENT RECORD. So this polls listAgents
 * while a turn runs and asserts the sequence the app would actually render — the bug was
 * that those fields were never sent at all, and a screenshot cannot tell "no indicator"
 * apart from "indicator that never turned on".
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gwHeaders } from "./gw-auth.mjs";
import { killPort } from "./kill-port.mjs";

const PORT = 18777;

/**
 * Sweep the port on every exit path.
 *
 * `killTree` here kills the SHELL's pid, which leaks the node grandchild whenever the shell
 * has already gone — one sweep left ten backends listening on 8794-8807, and the next run
 * failed with "port already in use". An exit hook covers the paths killTree does not: a
 * thrown assertion, a timeout, Ctrl-C. Killing by port cannot reach :8788.
 */
process.on("exit", () => { try { killPort(PORT); } catch { /* nothing to clean */ } });
const root = await mkdtemp(join(tmpdir(), "grokbot-presence-"));
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

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  ${String(detail).slice(0, 160)}`}`);
};

/** Exactly the client's own formula. */
const indicator = (a) => (a?.isRunning ? (a.isComposingMessage ? "typing" : "working") : "none");
const agentOf = async (id) => (await gw("listAgents")).find((x) => x.id === id);

const a = (await gw("createAgent", { name: "PresenceProbe" })).agent;

console.log("idle before anything happens");
const idle = await agentOf(a.id);
check("record carries the presence fields", "isRunning" in idle, Object.keys(idle).join(","));
check("indicator is none", indicator(idle) === "none", JSON.stringify(idle));

console.log("\nduring a turn");
await gw("sendPrompt", { agentId: a.id, content: "Viết một đoạn 4 câu về biển." });
const seen = [];
const activities = new Set();
for (let i = 0; i < 90; i += 1) {
  await wait(300);
  const rec = await agentOf(a.id);
  const state = indicator(rec);
  if (seen[seen.length - 1] !== state) seen.push(state);
  if (rec?.currentActivity) activities.add(JSON.stringify(rec.currentActivity));
  if (seen.length >= 3 && state === "none") break;
}
console.log(`      sequence  : ${seen.join(" → ")}`);
console.log(`      activities: ${[...activities].join(" ") || "(none)"}`);

check("the indicator turns on at all", seen.includes("working") || seen.includes("typing"), seen.join(","));
check("it reaches 'typing' once text arrives", seen.includes("typing"), seen.join(","));
check("'working' comes before 'typing'", seen.indexOf("working") >= 0 && seen.indexOf("working") < seen.indexOf("typing"), seen.join(","));
check("it returns to none when done", seen[seen.length - 1] === "none", seen.join(","));
check("thinking activity is reported", [...activities].some((x) => /thinking/.test(x)), [...activities].join(" "));

console.log("\nafter a restart nothing is left running");
await killTree(backend);
procs.length = 0;
const backend2 = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: "services/grokbot-backend", shell: true,
  env: { ...process.env, PORT: String(PORT), GROKBOT2_STATE_FILE: join(root, "state.json"), TSX_DISABLE_CACHE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
procs.push(backend2);
for (let i = 0; i < 60; i += 1) { try { await fetch(`http://127.0.0.1:${PORT}/gw/health`); break; } catch { await wait(500); } }
const after = await agentOf(a.id);
check("restored record is idle", indicator(after) === "none", JSON.stringify({ isRunning: after?.isRunning, isComposingMessage: after?.isComposingMessage }));

console.log(`\n${pass} passed, ${fail} failed`);
await stop();
process.exit(fail ? 1 : 0);
