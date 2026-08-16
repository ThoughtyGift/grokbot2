/**
 * Protocol test for the box exec daemon.
 *
 * Runs against a throwaway root in the scratch dir, on a random port, and is NOT wired
 * into the live backend — validating the daemon must not hand the running agent a shell
 * on the developer's own machine.
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "test-token-not-a-secret";
const PORT = 18337;
const root = await mkdtemp(join(tmpdir(), "grokbox-"));

await writeFile(join(root, "hello.txt"), "line one\nline two\nline three\n");
await mkdir(join(root, "sub"), { recursive: true });
await writeFile(join(root, "sub", "needle.ts"), "export const secret = 'findme';\n");

// The daemon targets Linux (/bin/bash). On a dev machine point it at whatever bash exists
// so the shell path is still covered; the box itself uses the default.
const bashCandidates = ["/bin/bash", "C:/Program Files/Git/bin/bash.exe", "C:/Program Files (x86)/Git/bin/bash.exe"];
const { existsSync } = await import("node:fs");
const shell = bashCandidates.find((p) => existsSync(p));
if (!shell) { console.log("no bash found — cannot test the shell path"); process.exit(1); }
console.log(`shell: ${shell}\n`);

const daemon = spawn(process.execPath, ["infra/vps/exec-daemon.mjs", String(PORT), root], {
  env: { ...process.env, GROKBOT2_EXEC_TOKEN: TOKEN, GROKBOT2_EXEC_SHELL: shell },
  stdio: ["ignore", "pipe", "pipe"],
});
daemon.stderr.on("data", (d) => process.stderr.write(`[daemon] ${d}`));
await new Promise((r) => daemon.stdout.once("data", r));

const call = (op, args = {}, token = TOKEN) =>
  fetch(`http://127.0.0.1:${PORT}/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  ${detail}`}`);
};

console.log("auth");
check("rejects a wrong token", (await call("health", {}, "nope")).status === 401);
check("accepts the right token", (await call("health")).status === 200);
check("unknown op is reported", (await call("nosuchop")).body.error?.includes("unknown op"));

console.log("\nexec");
const echo = (await call("exec", { command: "echo hi-from-box" })).body;
check("runs a command", echo.stdout.trim() === "hi-from-box", JSON.stringify(echo));
check("reports exit code", (await call("exec", { command: "exit 3" })).body.exitCode === 3);
check("captures stderr", (await call("exec", { command: "echo oops >&2" })).body.stderr.trim() === "oops");
check("honours a timeout", (await call("exec", { command: "sleep 5", timeoutMs: 800 })).body.timedOut === true);
check("supports pipes", (await call("exec", { command: "printf 'a\\nb\\nc\\n' | wc -l" })).body.stdout.trim() === "3");

console.log("\nread");
const r1 = (await call("read", { target_file: "hello.txt" })).body;
check("reads a file", r1.content.includes("line one") && r1.totalLines === 4, JSON.stringify(r1).slice(0, 120));
const r2 = (await call("read", { target_file: "hello.txt", offset: 1, limit: 1, enable_line_numbers: true })).body;
check("honours offset/limit", r2.content.includes("line two") && !r2.content.includes("line one"), r2.content);
check("adds line numbers", /^\s*2\t/.test(r2.content), r2.content);

console.log("\nlist / glob / grep");
const ls = (await call("list", { target_directory: "." })).body;
check("lists entries", ls.entries.some((e) => e.name === "hello.txt") && ls.entries.some((e) => e.isDir && e.name === "sub"));
check("ignore_globs filters", !(await call("list", { target_directory: ".", ignore_globs: ["*.txt"] })).body.entries.some((e) => e.name === "hello.txt"));
const g = (await call("glob", { glob_pattern: "*.ts" })).body;
check("globs recursively", g.matches.some((m) => m.includes("needle.ts")), JSON.stringify(g));
const gr = (await call("grep", { pattern: "findme" })).body;
check("greps content", gr.matches.some((m) => m.includes("needle.ts")), JSON.stringify(gr));
check("empty grep is not an error", Array.isArray((await call("grep", { pattern: "zzz-not-here" })).body.matches));

console.log("\nsandbox");
check("blocks ../ traversal", (await call("read", { target_file: "../../../etc/passwd" })).body.error?.includes("escapes root"));
check("blocks absolute escape", (await call("list", { target_directory: "/etc" })).body.error?.includes("escapes root"));

daemon.kill();
await rm(root, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
