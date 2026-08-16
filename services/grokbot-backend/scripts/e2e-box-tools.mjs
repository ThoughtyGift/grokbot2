/**
 * Does the brain actually pick the right tool, call it correctly, and answer from the result?
 *
 * Runs the whole loop against a throwaway sandbox: model -> TOOL_CALL -> approval card ->
 * exec daemon -> result -> follow-up answer.
 *
 * Only the READ-ONLY tools are exercised (list/read/glob/grep). Those are pure file
 * operations confined to the sandbox root, so this verifies the loop without executing a
 * single shell command on the developer's machine — the whole point of keeping shell in
 * the box.
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "e2e-token";
const DAEMON_PORT = 18447;
const BACKEND_PORT = 18448;

const root = await mkdtemp(join(tmpdir(), "grokbox-e2e-"));
await writeFile(join(root, "README.md"), "# Sandbox\nDu an thu nghiem cho Grok Bot 2.\n");
await writeFile(join(root, "notes.txt"), "alpha\nbravo\nMAGIC_TOKEN_9137\ndelta\n");
await mkdir(join(root, "src"), { recursive: true });
await writeFile(join(root, "src", "app.ts"), "export const version = '2.4.1';\n");
await writeFile(join(root, "src", "util.ts"), "export const noop = () => {};\n");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];

/**
 * Kill the whole tree, not just the process we spawned.
 *
 * `npx tsx` is a wrapper: killing it leaves the real node child holding the port, the next
 * run silently binds nothing, its health check is answered by the PREVIOUS build, and you
 * spend an hour concluding your source edit "didn't take". Same trap as the 8788 one in
 * HANDOFF, wearing a different hat.
 */
const killTree = (p) =>
  new Promise((r) => {
    if (!p.pid) return r();
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }).on("close", r);
    else { try { process.kill(-p.pid, "SIGKILL"); } catch { p.kill("SIGKILL"); } r(); }
  });

const stop = async () => {
  for (const p of procs) await killTree(p);
  await rm(root, { recursive: true, force: true });
};
// A crash must not leave a stale backend holding the port for the next run.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { void stop().then(() => process.exit(1)); });

// 1. exec daemon over the sandbox
// glob and grep go through the shell. Without a resolvable bash they return empty rather
// than erroring, which reads exactly like "the model searched and found nothing" — so
// point the daemon at a real bash on a dev machine. The box uses the /bin/bash default.
const { existsSync } = await import("node:fs");
const shell = ["/bin/bash", "C:/Program Files/Git/bin/bash.exe"].find((p) => existsSync(p));
console.log(`shell for box ops: ${shell ?? "(none — glob/grep will be empty)"}`);

const daemon = spawn(process.execPath, ["infra/vps/exec-daemon.mjs", String(DAEMON_PORT), root], {
  env: { ...process.env, GROKBOT2_EXEC_TOKEN: TOKEN, GROKBOT2_EXEC_LOG: "1", ...(shell ? { GROKBOT2_EXEC_SHELL: shell } : {}) },
  stdio: ["ignore", "pipe", "pipe"],
});
procs.push(daemon);
// Echo what the daemon actually received — the only way to tell a mangled argument
// apart from a search that legitimately found nothing.
daemon.stderr.on("data", (d) => process.stdout.write(String(d)));
await new Promise((r) => daemon.stdout.once("data", r));

// 2. a SECOND backend on its own port and its own state file, so the live one is untouched
const backend = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: "services/grokbot-backend",
  shell: true,
  env: {
    ...process.env,
    PORT: String(BACKEND_PORT),
    GROKBOT2_BOX_EXEC_URL: `http://127.0.0.1:${DAEMON_PORT}`,
    GROKBOT2_EXEC_TOKEN: TOKEN,
    GROKBOT2_STATE_FILE: join(root, "state.json"),
    // tsx caches compiled output, so a fresh spawn can still run the previous edit —
    // the same "testing stale code" trap that has bitten this project before, just
    // wearing a different hat.
    TSX_DISABLE_CACHE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
procs.push(backend);
backend.stdout.on("data", (d) => { const s = String(d); if (/box|brain|backend on/.test(s)) process.stdout.write(`[be] ${s}`); });

// Refuse to test against something we did not just start: a leftover backend on this port
// answers health checks happily and reports the previous build's behaviour as if it were ours.
try {
  await fetch(`http://127.0.0.1:${BACKEND_PORT}/gw/health`, { signal: AbortSignal.timeout(1500) });
  console.error(`port ${BACKEND_PORT} is already served by another process — kill it and re-run`);
  await stop();
  process.exit(1);
} catch { /* nothing there, as required */ }

for (let i = 0; i < 40; i += 1) {
  try { await fetch(`http://127.0.0.1:${BACKEND_PORT}/gw/health`); break; } catch { await wait(500); }
}

const gw = (m, body = {}) =>
  fetch(`http://127.0.0.1:${BACKEND_PORT}/gw/api/${m}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());

const agent = (await gw("createAgent", { name: "BoxToolTest" })).agent;
console.log(`\nagent: ${agent.id}\nsandbox: ${root}\n`);

const textOf = (e) => (e.kind === "message" ? e.content : e.message?.content ?? "");

/** The backend echoes each tool result as its own bubble; that line is not the model's answer. */
const isEchoLine = (e) => /^🔧\s/.test(textOf(e));

/**
 * Send a prompt, auto-approve any tool card, and return only THIS turn's entries.
 * Scoping by the pre-send transcript length matters: without it every case re-reads the
 * first case's tool call and the whole suite reports the same stale result.
 */
async function ask(prompt, { timeoutMs = 90_000 } = {}) {
  const before = ((await gw("getAgentTranscriptTail", { id: agent.id, limit: 200 })).entries ?? []).length;
  await gw("sendPrompt", { agentId: agent.id, content: prompt });
  const deadline = Date.now() + timeoutMs;
  const seen = new Set();
  while (Date.now() < deadline) {
    await wait(1200);
    const all = (await gw("getAgentTranscriptTail", { id: agent.id, limit: 200 })).entries ?? [];
    const turn = all.slice(before);
    for (const card of turn.filter((e) => e.kind === "send-message" && e.message?.type === "local-tool-permission" && e.message.ask.status === "pending")) {
      const id = card.message.ask.requestId;
      if (seen.has(id)) continue;
      seen.add(id);
      await gw("resolveLocalToolPermission", { requestId: id, agentId: agent.id, resolution: "allow-once" });
    }
    const call = [...turn].reverse().find((e) => e.kind === "tool-call");
    if (!call || (call.status !== "done" && call.status !== "failed")) continue;
    // Wait for the turn to settle. Reading it while a bubble is still streaming catches the
    // model's pre-tool line ("Cần dùng công cụ …") instead of its answer, and reports it as
    // if no tool had run.
    if (turn.some((e) => e.streaming)) continue;
    const after = turn.slice(turn.indexOf(call) + 1);
    if (after.some((e) => e.kind === "send-message" && e.message?.type === "text" && textOf(e).trim() && !isEchoLine(e))) return turn;
  }
  return ((await gw("getAgentTranscriptTail", { id: agent.id, limit: 200 })).entries ?? []).slice(before);
}

const CASES = [
  // No box needed for these two, so they are the ones that work on a fresh clone.
  { ask: "Tìm trên web: trang chủ chính thức của Nous Research hermes agent. Dùng công cụ.", tool: "web_search", expect: /http|nous|hermes/i },
  { ask: "Đọc trang https://example.com và cho biết tiêu đề của nó.", tool: "web_fetch", expect: /example/i },
  { ask: "Thư mục làm việc có những file gì? Dùng công cụ rồi trả lời.", tool: "list_dir_v2", expect: /README|notes|src/i },
  { ask: "File notes.txt có một token đặc biệt. Đọc file đó và cho tôi biết token.", tool: "read_file_v2", expect: /MAGIC_TOKEN_9137/ },
  { ask: "Tìm tất cả file .ts trong dự án.", tool: "glob_file_search", expect: /app\.ts|util\.ts/ },
  { ask: "Chuỗi MAGIC_TOKEN_9137 nằm ở file nào? Tìm trong nội dung file.", tool: "ripgrep_raw_search", expect: /notes\.txt/ },
];

let pass = 0, fail = 0;
for (const c of CASES) {
  const t = await ask(c.ask);
  const call = [...t].reverse().find((e) => e.kind === "tool-call");
  const answer = [...t].reverse().find((e) => e.kind === "send-message" && e.message?.type === "text" && textOf(e).trim() && !isEchoLine(e));
  const usedRight = call?.name === c.tool;
  const gotResult = call?.status === "done" && Boolean(call.result);
  const answered = c.expect.test(String(answer ? textOf(answer) : ""));
  const ok = usedRight && gotResult && answered;
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${c.tool}`);
  console.log(`      chose      : ${call?.name ?? "(no tool call)"}${usedRight ? "" : `  ← expected ${c.tool}`}`);
  console.log(`      args       : ${call?.rawArgs ?? "-"}`);
  console.log(`      status     : ${call?.status ?? "-"}`);
  console.log(`      result     : ${String(call?.result ?? "").replace(/\s+/g, " ").slice(0, 110)}`);
  console.log(`      answer     : ${String(answer ? textOf(answer) : "-").replace(/\s+/g, " ").slice(0, 140)}`);
  console.log(`      answer uses result: ${answered}\n`);
}

console.log(`${pass} passed, ${fail} failed`);
await stop();
process.exit(fail ? 1 : 0);
