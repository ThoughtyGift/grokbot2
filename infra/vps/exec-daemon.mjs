#!/usr/bin/env node
/**
 * Box exec daemon — the thing the real Grok Bot box runs on port 1337.
 *
 * Everything the agent's shell and file tools do happens HERE, inside the box, never on
 * the user's own machine. That separation is the whole point: the desktop app is a
 * viewer, the box is the computer.
 *
 *   GROKBOT2_EXEC_TOKEN=<secret> node exec-daemon.mjs [port] [root]
 *
 * Binds 127.0.0.1 only — publish it through the host's existing nginx (with the token)
 * rather than opening a port to the world.
 */
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join, relative, isAbsolute } from "node:path";

const PORT = Number(process.argv[2] ?? process.env.GROKBOT2_EXEC_PORT ?? 1337);
const ROOT = resolve(process.argv[3] ?? process.env.GROKBOT2_EXEC_ROOT ?? "/root/workspace");
const TOKEN = process.env.GROKBOT2_EXEC_TOKEN ?? "";
const MAX_OUTPUT = 200_000;
const DEFAULT_TIMEOUT = 60_000;

if (!TOKEN) {
  console.error("refusing to start without GROKBOT2_EXEC_TOKEN");
  process.exit(1);
}

/**
 * Keep every path inside ROOT. A traversal check on the *resolved* path is the only
 * one that holds — checking the raw string lets `a/../../etc` through.
 */
function safePath(p) {
  const abs = isAbsolute(p ?? "") ? resolve(p) : resolve(ROOT, p ?? ".");
  const rel = relative(ROOT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes root: ${p}`);
  return abs;
}

const clip = (s) =>
  s.length <= MAX_OUTPUT ? { text: s, truncated: false } : { text: s.slice(0, MAX_OUTPUT), truncated: true };

// The box is Linux, so /bin/bash is the right default; the override exists purely so the
// protocol test can exercise the shell path on a dev machine.
const SHELL = process.env.GROKBOT2_EXEC_SHELL ?? "/bin/bash";

/** Run through bash so pipes and globs behave as the model expects. */
const sh = (command, cwd, timeout) =>
  new Promise((res) => {
    execFile(SHELL, ["-lc", command], { cwd, timeout, maxBuffer: MAX_OUTPUT * 2, killSignal: "SIGKILL" },
      (err, stdout, stderr) => {
        const out = clip(String(stdout ?? ""));
        const errOut = clip(String(stderr ?? ""));
        res({
          stdout: out.text, stderr: errOut.text,
          truncated: out.truncated || errOut.truncated,
          exitCode: err ? (typeof err.code === "number" ? err.code : 1) : 0,
          timedOut: Boolean(err && err.killed),
        });
      });
  });

const handlers = {
  async health() {
    const { stdout } = await sh("uname -a; echo; df -h / | tail -1", ROOT, 10_000);
    return { ok: true, root: ROOT, display: process.env.DISPLAY ?? null, info: stdout.trim() };
  },

  // run_terminal_command_v2
  async exec({ command, cwd, timeoutMs }) {
    if (typeof command !== "string" || !command.trim()) throw new Error("command required");
    return sh(command, safePath(cwd ?? "."), Math.min(Number(timeoutMs) || DEFAULT_TIMEOUT, 300_000));
  },

  // read_file_v2 — offset/limit are LINE based, matching the tool's params
  async read({ target_file, path, offset, limit, chars_limit, enable_line_numbers }) {
    const abs = safePath(target_file ?? path);
    const raw = await readFile(abs, "utf8");
    const lines = raw.split("\n");
    const from = Math.max(0, Number(offset) || 0);
    const to = limit ? from + Number(limit) : lines.length;
    let body = lines.slice(from, to);
    if (enable_line_numbers) body = body.map((l, i) => `${String(from + i + 1).padStart(6)}\t${l}`);
    const text = body.join("\n");
    const capped = chars_limit ? text.slice(0, Number(chars_limit)) : text;
    return { path: abs, totalLines: lines.length, from, to: Math.min(to, lines.length), content: clip(capped).text };
  },

  // list_dir_v2
  async list({ target_directory, path, ignore_globs }) {
    const abs = safePath(target_directory ?? path ?? ".");
    const names = await readdir(abs);
    const ignores = (ignore_globs ?? []).map((g) => new RegExp(`^${String(g).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`));
    const out = [];
    for (const name of names) {
      if (ignores.some((re) => re.test(name))) continue;
      try {
        const s = await stat(join(abs, name));
        out.push({ name, isDir: s.isDirectory(), size: s.size, modifiedMs: s.mtimeMs });
      } catch { out.push({ name, isDir: false, size: null, modifiedMs: null }); }
    }
    return { path: abs, entries: out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)) };
  },

  // glob_file_search — delegate to the shell so the box's own globbing applies
  async glob({ target_directory, glob_pattern }) {
    const dir = safePath(target_directory ?? ".");
    // Models write `**/*.ts`. `find -name` matches the basename only and never sees a
    // slash, so that pattern silently returns nothing; strip the recursive prefix and
    // switch to -path when a real slash remains.
    const raw = String(glob_pattern ?? "*").replace(/'/g, "");
    const stripped = raw.replace(/^(\*\*\/)+/, "");
    const test = stripped.includes("/") ? `-path '*/${stripped}'` : `-name '${stripped}'`;
    const { stdout } = await sh(`find . -name .git -prune -o -type f ${test} -print | head -500`, dir, 30_000);
    return { path: dir, pattern: stripped, matches: stdout.split("\n").filter(Boolean) };
  },

  // ripgrep_raw_search — rg when present, grep -r otherwise
  async grep({ pattern, path, glob, output_mode, context_before, context_after, case_insensitive }) {
    const dir = safePath(path ?? ".");
    const q = String(pattern ?? "").replace(/'/g, "'\\''");
    const flags = [
      case_insensitive ? "-i" : "",
      output_mode === "files_with_matches" ? "-l" : "-n",
      context_before ? `-B ${Number(context_before)}` : "",
      context_after ? `-A ${Number(context_after)}` : "",
      glob ? `--glob '${String(glob).replace(/'/g, "")}'` : "",
    ].filter(Boolean).join(" ");
    const rg = `rg ${flags} -- '${q}' . | head -300`;
    const fallback = `grep -rn ${case_insensitive ? "-i" : ""} -- '${q}' . | head -300`;
    const { stdout, stderr, exitCode } = await sh(`command -v rg >/dev/null && ${rg} || ${fallback}`, dir, 60_000);
    return { path: dir, matches: stdout.split("\n").filter(Boolean), stderr, exitCode };
  },
};

const server = createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "unauthorized" });

  const name = (req.url ?? "").replace(/^\/+|\?.*$/g, "");
  const fn = handlers[name];
  if (!fn) return send(404, { error: `unknown op: ${name}`, ops: Object.keys(handlers) });

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    let args = {};
    try { if (chunks.length) args = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* keep {} */ }
    // GROKBOT2_EXEC_LOG shows exactly what arrived. Worth having: an argument mangled
    // on the way in looks identical to a tool that simply found nothing.
    if (process.env.GROKBOT2_EXEC_LOG) console.error(`[exec-daemon] ${name} ${JSON.stringify(args).slice(0, 300)}`);
    try {
      send(200, await fn(args));
    } catch (e) {
      if (process.env.GROKBOT2_EXEC_LOG) console.error(`[exec-daemon] ${name} ERROR ${String(e?.message ?? e).slice(0, 200)}`);
      send(200, { error: String(e?.message ?? e) });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[exec-daemon] listening on 127.0.0.1:${PORT}, root=${ROOT}`);
  console.log(`[exec-daemon] ops: ${Object.keys(handlers).join(", ")}`);
});
