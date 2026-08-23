/**
 * MCP — `get_mcp_tools` and `call_mcp_tool` from the original catalog.
 *
 * The original reaches connected services this way ("MCP tools give structured access to
 * connected services … when a task needs data or an action from an external service, escalate
 * in order, cheapest first"), and the screenshot of it attaching a Telegram MCP mid-conversation
 * is the same surface.
 *
 * Servers are declared in a repo-root `.mcp.json`, the same shape Claude Code and Cursor use:
 *
 *   { "mcpServers": { "github": { "command": "npx", "args": [...], "env": { ... } } } }
 *
 * That file holds live tokens, so it is gitignored and **never logged** — not the env, not the
 * args, not a server's error output. Only tool names and results reach the transcript.
 *
 * Transport is stdio + JSON-RPC 2.0, which is what every server in that config speaks. Servers
 * start lazily on first use and are reused, because `npx -y <server>` costs seconds.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSpecSecrets, missingArgSecrets, warnMissing } from "./secrets.js";
import { currentOwner } from "./request-context.js";
import { DEFAULT_USER } from "./auth.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONFIG = process.env.GROKBOT2_MCP_CONFIG ?? join(repoRoot, ".mcp.json");
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".data");

/**
 * MCP config is PER-USER (multi-tenant Phase 6): one tenant's server tokens (github, slack, …) must
 * never be spawned for another's agent. The default identity (the single-user desktop) keeps using
 * the global `.mcp.json` unchanged; every other account reads `.data/mcp/<safe-authId>.json`. Live
 * server processes are keyed by owner too, so the same server name for two tenants is two processes
 * with two credentials.
 */
function configPathFor(owner: string): string {
  if (owner === DEFAULT_USER.authId) return CONFIG;
  const safe = owner.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(DATA_DIR, "mcp", `${safe}.json`);
}
/** A server that will not answer must not hang the turn behind it. */
const START_TIMEOUT_MS = 60_000;
const CALL_TIMEOUT_MS = 60_000;

/**
 * `cwd` matters more than it looks.
 *
 * The spawn inherits this backend's working directory (`services/grokbot-backend`), so a server
 * that resolves anything relative — a Python module beside itself, a config next to its entry
 * point — cannot be launched without it. The hermes bridge is the case that forced it: its
 * `mcp_serve` module is importable only from the hermes root, and `python -c` puts the working
 * directory on `sys.path`. Claude Code and Cursor both accept `cwd` in the same config shape, so
 * this is matching the format rather than extending it.
 */
interface ServerSpec { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
interface McpTool { name: string; description?: string; inputSchema?: unknown }

/** One resource a server exposes. Field names are the MCP spec's. */
interface McpResource { uri: string; name?: string; description?: string; mimeType?: string }

interface Live {
  proc: ChildProcessWithoutNullStreams;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  buf: string;
  /**
   * What the server said it can do, from its `initialize` reply.
   *
   * Kept because `resources/list` is not universal: a server without the capability answers with an
   * error, and asking anyway would surface a protocol failure as if the resource were missing. The
   * reply was previously discarded — this is the first thing that needs it.
   */
  capabilities: Record<string, unknown>;
  /** Cached `resources/list`, filled on first read. */
  resources?: McpResource[];
  nextId: number;
  tools: McpTool[];
}

const live = new Map<string, Live>();

/** Declared servers for `owner` (default: the current request's owner), read fresh each call. */
export function mcpServers(owner: string = currentOwner()): Record<string, ServerSpec> {
  const path = configPathFor(owner);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const servers = parsed?.mcpServers;
    return servers && typeof servers === "object" ? servers : {};
  } catch (e) {
    console.warn(`[grokbot2] [mcp] ${path} is not readable JSON: ${(e as Error).message}`);
    return {};
  }
}

export const isMcpConfigured = (owner: string = currentOwner()): boolean => Object.keys(mcpServers(owner)).length > 0;

function rpc(s: Live, method: string, params?: unknown): Promise<any> {
  const id = ++s.nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, CALL_TIMEOUT_MS);
    s.pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    s.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`);
  });
}

/**
 * True when `command` names a real binary Windows can launch directly.
 *
 * Anything else — a bare `npx`, `npm`, a `.cmd` or `.bat` shim — needs a shell to resolve, and
 * pays the argument-reparsing cost that comes with one.
 */
const isDirectExecutable = (command: string): boolean => /\.(exe|com)$/i.test(command.trim());

/**
 * The environment an MCP server is allowed to see.
 *
 * The spawn used to pass `{...process.env, ...spec.env}`, so every server inherited THIS BACKEND'S
 * whole environment. Harmless while everything belongs to one person on one machine; a full
 * compromise the moment the backend runs on a shared host, because a server only has to read its own
 * `process.env` to walk off with `CLAUDE_POOL_KEY` (the pool), `GROKBOT2_JWT_SECRET` (mint a token
 * for any account), `GROKBOT2_BILLING_WEBHOOK_SECRET` (grant itself a plan) or the gateway ticket.
 * No exploit needed — just a `console.log`.
 *
 * So the child gets an ALLOWLIST: what a process needs to start and find its runtime, plus whatever
 * the server's own config declares in `env`. Notably absent is NODE_OPTIONS, which can inject code
 * into a Node child.
 *
 * `GROKBOT2_MCP_ENV_PASSTHROUGH=1` restores the old behaviour for a server that genuinely needs
 * something else — a deliberate, per-install decision rather than a silent default.
 */
const ENV_ALLOWLIST = [
  // Finding and running the executable
  "PATH", "Path", "PATHEXT", "COMSPEC", "ComSpec", "SystemRoot", "windir", "SystemDrive",
  // Where a process may write and read its own state
  "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "XDG_CACHE_HOME",
  // Program locations npx/node resolve against on Windows
  "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData", "CommonProgramFiles",
  // Harmless identity/locale a CLI may branch on
  "OS", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "USERNAME", "COMPUTERNAME", "LANG", "LC_ALL", "TZ",
] as const;

export function childEnv(specEnv?: Record<string, string>): NodeJS.ProcessEnv {
  if (process.env.GROKBOT2_MCP_ENV_PASSTHROUGH === "1") return { ...process.env, ...(specEnv ?? {}) };
  const out: NodeJS.ProcessEnv = {};
  for (const k of ENV_ALLOWLIST) {
    const v = process.env[k];
    if (v !== undefined) out[k] = v;
  }
  // The server's OWN declared env last: this is the one place a secret is meant to reach it.
  return { ...out, ...(specEnv ?? {}) };
}

/** Start a server for `owner` and complete the MCP handshake, or throw with a usable reason. */
async function start(name: string, owner: string): Promise<Live> {
  const key = `${owner}::${name}`;
  const existing = live.get(key);
  if (existing && existing.proc.exitCode == null) return existing;

  const spec = mcpServers(owner)[name];
  if (!spec?.command) throw new Error(`no MCP server "${name}" in ${configPathFor(owner)}`);

  // A catalog row declares `${CREDENTIAL}` instead of a token, so nothing on disk holds a secret.
  // Substituted here, per owner — see secrets.ts for why args and env fail differently.
  const resolved = resolveSpecSecrets(spec, owner);
  const blocking = missingArgSecrets(resolved);
  if (blocking.length) {
    throw new Error(
      `MCP server "${name}" needs ${blocking.join(", ")} — set ` +
      `${blocking.length > 1 ? "them" : "it"} in the backend environment or .data/secrets/<user>.json`,
    );
  }
  warnMissing(name, resolved.missing);

  const proc = spawn(spec.command, resolved.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: childEnv(resolved.env),
    ...(spec.cwd ? { cwd: spec.cwd } : {}),
    // `shell` ONLY for shims, never for a real executable — it re-parses the arguments.
    //
    // `npx`/`npm` are `.cmd` files on Windows and cannot be spawned without a shell, which is why
    // this was unconditional. But routing a direct `.exe` through `cmd.exe` hands the argument
    // list back to cmd's parser, and cmd treats `;` and `&` as separators. The hermes bridge is
    // launched as `python.exe -c "import mcp_serve; mcp_serve.run_mcp_server()"`, so the semicolon
    // split the command and the server died at startup — reported only as `MCP server "hermes"
    // exited`, which reads like the server's fault.
    //
    // Measured: with `shell` off, the same spawn completes the handshake on protocolVersion
    // 2024-11-05, 2025-06-18 AND 2026-07-28. The version negotiation was never the problem.
    shell: process.platform === "win32" && !isDirectExecutable(spec.command),
  }) as ChildProcessWithoutNullStreams;

  const s: Live = { proc, pending: new Map(), buf: "", nextId: 0, tools: [], capabilities: {} };

  // JSON-RPC frames are newline-delimited; a chunk can split or join them.
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    s.buf += chunk;
    let nl: number;
    while ((nl = s.buf.indexOf("\n")) !== -1) {
      const line = s.buf.slice(0, nl).trim();
      s.buf = s.buf.slice(nl + 1);
      if (!line) continue;
      let msg: any;
      try { msg = JSON.parse(line); } catch { continue; }   // servers also log plain text here
      const slot = s.pending.get(msg.id);
      if (!slot) continue;
      s.pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(msg.error.message ?? "MCP error"));
      else slot.resolve(msg.result);
    }
  });
  // stderr is where servers print startup noise AND, sometimes, their env. Never log it.
  proc.stderr.resume();
  proc.on("exit", () => {
    for (const [, slot] of s.pending) slot.reject(new Error(`MCP server "${name}" exited`));
    s.pending.clear();
    if (live.get(key) === s) live.delete(key);
  });

  live.set(key, s);

  const handshake = (async () => {
    const hello = await rpc(s, "initialize", {
      protocolVersion: "2024-11-05",
      // We now consume resources as well as tools. Declaring nothing was fine while only tools were
      // used; a server may gate features on what the client claims, so say what we actually read.
      capabilities: { tools: {}, resources: {} },
      clientInfo: { name: "grokbot2", version: "0.1.0" },
    });
    s.capabilities = (hello?.capabilities ?? {}) as Record<string, unknown>;
    s.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const listed = await rpc(s, "tools/list");
    s.tools = Array.isArray(listed?.tools) ? listed.tools : [];
  })();

  await Promise.race([
    handshake,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`MCP server "${name}" did not start within 60s`)), START_TIMEOUT_MS)),
  ]);
  return s;
}

/** `get_mcp_tools` — what is reachable, without starting anything the model did not ask for. */
export async function getMcpTools(arg: string, owner: string = currentOwner()): Promise<string> {
  const names = Object.keys(mcpServers(owner));
  if (names.length === 0) return `(chưa cấu hình MCP — tạo ${configPathFor(owner)} với {"mcpServers":{…}})`;

  const wanted = arg.trim().replace(/^["']|["']$/g, "");
  const targets = wanted ? names.filter((n) => n === wanted) : names;
  if (targets.length === 0) return `(không có server "${wanted}"; có: ${names.join(", ")})`;

  const out: string[] = [];
  for (const name of targets) {
    try {
      const s = await start(name, owner);
      out.push(`${name}: ${s.tools.map((t) => t.name).join(", ") || "(không có tool)"}`);
    } catch (e) {
      out.push(`${name}: lỗi — ${(e as Error).message}`);
    }
  }
  return out.join("\n");
}

// ── resources ─────────────────────────────────────────────────────────────────
//
// The other half of MCP, and two of the six tools docs/history/execution-roadmap.md counts as genuinely
// missing: `list_mcp_resources` and `read_mcp_resource`. Tools are things a server DOES; resources
// are things it HAS — a file, a document, a record — addressed by URI. Same transport, same
// handshake, two more methods.

/** True when the server said it serves resources. Asking one that did not is a protocol error. */
const servesResources = (s: Live): boolean =>
  s.capabilities.resources != null && typeof s.capabilities.resources === "object";

/**
 * `list_mcp_resources` — what each server has, addressable by URI.
 *
 * Servers that do not declare the capability are named as such rather than skipped: "this server
 * has no resources" and "this server does not do resources" are different facts, and the model
 * needs the second one to stop asking.
 */
export async function listMcpResources(arg: string, owner: string = currentOwner()): Promise<string> {
  const names = Object.keys(mcpServers(owner));
  if (names.length === 0) return `(chưa cấu hình MCP — tạo ${configPathFor(owner)} với {"mcpServers":{…}})`;

  const wanted = arg.trim().replace(/^["']|["']$/g, "");
  const targets = wanted ? names.filter((n) => n === wanted) : names;
  if (targets.length === 0) return `(không có server "${wanted}"; có: ${names.join(", ")})`;

  const out: string[] = [];
  for (const name of targets) {
    try {
      const s = await start(name, owner);
      if (!servesResources(s)) { out.push(`${name}: (server này không hỗ trợ resources)`); continue; }
      const listed = await rpc(s, "resources/list");
      const items: McpResource[] = Array.isArray(listed?.resources) ? listed.resources : [];
      s.resources = items;
      if (items.length === 0) { out.push(`${name}: (không có resource nào)`); continue; }
      // The URI is the only part the model must reproduce exactly, so it comes first.
      out.push(
        `${name}:\n` +
          items.slice(0, 40).map((r) => {
            const label = [r.name, r.mimeType].filter(Boolean).join(" · ");
            return `  ${r.uri}${label ? `  (${label})` : ""}`;
          }).join("\n") +
          (items.length > 40 ? `\n  … còn ${items.length - 40} resource nữa` : ""),
      );
    } catch (e) {
      out.push(`${name}: lỗi — ${(e as Error).message}`);
    }
  }
  return out.join("\n");
}

/**
 * `read_mcp_resource({server, uri})` — fetch one resource's contents.
 *
 * A reply carries `contents[]`, each entry either `text` or a base64 `blob`. Binary is reported by
 * size and type rather than dumped: a base64 image in the transcript costs thousands of tokens and
 * the model cannot see it anyway. Attaching it properly is `attach_file`'s job.
 */
export async function readMcpResource(arg: string, owner: string = currentOwner()): Promise<string> {
  let spec: any;
  try { spec = JSON.parse(arg); } catch {
    // A bare URI is the obvious thing to type, so accept it when only one server serves resources.
    spec = { uri: arg.trim().replace(/^["']|["']$/g, "") };
  }
  const uri = String(spec?.uri ?? spec?.resource ?? spec?.url ?? "").trim();
  if (!uri) return 'read_mcp_resource cần {"server":"…","uri":"…"}';

  const names = Object.keys(mcpServers(owner));
  let server = String(spec?.server ?? spec?.server_name ?? "").trim();
  if (!server) {
    if (names.length === 1) server = names[0];
    else return `read_mcp_resource cần "server" khi có nhiều server (${names.join(", ")})`;
  }
  if (!names.includes(server)) return `(không có server "${server}"; có: ${names.join(", ")})`;

  try {
    const s = await start(server, owner);
    if (!servesResources(s)) return `(server "${server}" không hỗ trợ resources)`;
    const res = await rpc(s, "resources/read", { uri });
    const contents: any[] = Array.isArray(res?.contents) ? res.contents : [];
    if (contents.length === 0) return `(${uri}: không có nội dung)`;
    return contents.map((c) => {
      if (typeof c?.text === "string") return c.text;
      if (typeof c?.blob === "string") {
        // Report, do not inline: base64 in the transcript is pure token cost.
        const bytes = Math.floor((c.blob.length * 3) / 4);
        return `(${c.mimeType ?? "nhị phân"}, ${bytes} byte — dữ liệu nhị phân, không hiển thị được ở đây)`;
      }
      return JSON.stringify(c);
    }).join("\n\n");
  } catch (e) {
    return `Không đọc được ${uri}: ${(e as Error).message}`;
  }
}

/** `call_mcp_tool({server, tool_name, tool_args})`. */
export async function callMcpTool(arg: string, owner: string = currentOwner()): Promise<string> {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { return 'call_mcp_tool cần {"server":"…","tool_name":"…","tool_args":{…}}'; }
  const server = String(spec?.server ?? spec?.server_name ?? "");
  const tool = String(spec?.tool_name ?? spec?.tool ?? spec?.name ?? "");
  const args = spec?.tool_args ?? spec?.arguments ?? spec?.args ?? {};
  if (!server || !tool) return 'call_mcp_tool cần {"server":"…","tool_name":"…","tool_args":{…}}';

  try {
    const s = await start(server, owner);
    if (s.tools.length && !s.tools.some((t) => t.name === tool)) {
      return `(server "${server}" không có tool "${tool}"; có: ${s.tools.map((t) => t.name).join(", ")})`;
    }
    const r = await rpc(s, "tools/call", { name: tool, arguments: args });
    // MCP returns content blocks; the model only needs the text.
    const text = Array.isArray(r?.content)
      ? r.content.map((c: any) => (typeof c?.text === "string" ? c.text : `[${c?.type ?? "block"}]`)).join("\n")
      : JSON.stringify(r);
    const capped = text.length > 6000 ? `${text.slice(0, 6000)}\n… (cắt bớt)` : text;
    return r?.isError ? `MCP lỗi: ${capped}` : capped;
  } catch (e) {
    return `MCP lỗi: ${(e as Error).message}`;
  }
}

/** Startup line. Names only — never the env or args, which carry tokens. */
export function reportMcpConfig(log: (msg: string) => void): void {
  const names = Object.keys(mcpServers());
  log(names.length ? `[mcp] ${names.length} server: ${names.join(", ")}` : "[mcp] chưa cấu hình (.mcp.json)");
}

/** Stop every server (shutdown, and so a script can exit). */
export function closeMcp(): void {
  for (const [, s] of live) { try { s.proc.kill(); } catch { /* already gone */ } }
  live.clear();
}

/**
 * What to tell the app about one server, for the Plugins pane.
 *
 * Every row used to report a flat `disconnected` with the detail "Runs on Grok Bot's computer" —
 * true of the machine, and a lie about the server: a memory server that had been answering tool
 * calls all session still read as disconnected, and one whose credential was never supplied read
 * the same, so the pane could not tell "fine" from "broken".
 *
 * The vocabulary is the client's own (`Tis` in electron-main maps its connection kinds onto these):
 * `connected` · `initializing` · `needsAuth` · `error` · `disconnected`.
 *
 * `needsAuth` is deliberately NOT used. It renders an Authenticate button that hands off to an OAuth
 * URL, and nothing here can produce one for a stdio server — the button would only fail. A missing
 * credential is reported as `error` naming the variable, which is what it is and what fixes it.
 */
export function mcpServerStatus(name: string, owner: string = currentOwner()): {
  status: "connected" | "initializing" | "error" | "disconnected";
  detail: string;
  toolCount: number;
} {
  const spec = mcpServers(owner)[name];
  if (!spec?.command) return { status: "error", detail: "Not in this account's MCP config", toolCount: 0 };

  const resolved = resolveSpecSecrets(spec, owner);
  const blocking = missingArgSecrets(resolved);
  const where = "the plugin's setup, the backend environment, or .data/secrets/<user>.json";
  if (blocking.length) {
    return { status: "error", detail: `Needs ${blocking.join(", ")} — set it in ${where}`, toolCount: 0 };
  }

  const s = live.get(`${owner}::${name}`);
  if (s && s.proc.exitCode == null) {
    return { status: "connected", detail: `${s.tools.length} tool(s) available`, toolCount: s.tools.length };
  }
  if (s) return { status: "error", detail: `Exited with code ${s.proc.exitCode}`, toolCount: 0 };

  // An unresolved placeholder in `env` does not stop the spawn — the key is dropped and the server
  // runs degraded (n8n serves its docs with no API key at all). So it is not an error, but leaving it
  // unsaid is what made a credential-less Facebook look identical to a healthy server. Name it.
  if (resolved.missing.length) {
    return {
      status: "disconnected",
      detail: `Starts on first use, but ${resolved.missing.join(", ")} is not set — set it in ${where}`,
      toolCount: 0,
    };
  }

  return { status: "disconnected", detail: "Configured; starts on first use", toolCount: 0 };
}
