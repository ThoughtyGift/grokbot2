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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONFIG = process.env.GROKBOT2_MCP_CONFIG ?? join(repoRoot, ".mcp.json");
/** A server that will not answer must not hang the turn behind it. */
const START_TIMEOUT_MS = 60_000;
const CALL_TIMEOUT_MS = 60_000;

interface ServerSpec { command: string; args?: string[]; env?: Record<string, string> }
interface McpTool { name: string; description?: string; inputSchema?: unknown }

interface Live {
  proc: ChildProcessWithoutNullStreams;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  buf: string;
  nextId: number;
  tools: McpTool[];
}

const live = new Map<string, Live>();

/** Declared servers, read fresh so editing .mcp.json does not need a restart. */
export function mcpServers(): Record<string, ServerSpec> {
  if (!existsSync(CONFIG)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CONFIG, "utf8"));
    const servers = parsed?.mcpServers;
    return servers && typeof servers === "object" ? servers : {};
  } catch (e) {
    console.warn(`[grokbot2] [mcp] ${CONFIG} is not readable JSON: ${(e as Error).message}`);
    return {};
  }
}

export const isMcpConfigured = (): boolean => Object.keys(mcpServers()).length > 0;

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

/** Start a server and complete the MCP handshake, or throw with a usable reason. */
async function start(name: string): Promise<Live> {
  const existing = live.get(name);
  if (existing && existing.proc.exitCode == null) return existing;

  const spec = mcpServers()[name];
  if (!spec?.command) throw new Error(`no MCP server "${name}" in ${CONFIG}`);

  const proc = spawn(spec.command, spec.args ?? [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...(spec.env ?? {}) },
    shell: process.platform === "win32",   // npx/npm are .cmd shims on Windows
  }) as ChildProcessWithoutNullStreams;

  const s: Live = { proc, pending: new Map(), buf: "", nextId: 0, tools: [] };

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
    if (live.get(name) === s) live.delete(name);
  });

  live.set(name, s);

  const handshake = (async () => {
    await rpc(s, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "grokbot2", version: "0.1.0" },
    });
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
export async function getMcpTools(arg: string): Promise<string> {
  const names = Object.keys(mcpServers());
  if (names.length === 0) return `(chưa cấu hình MCP — tạo ${CONFIG} với {"mcpServers":{…}})`;

  const wanted = arg.trim().replace(/^["']|["']$/g, "");
  const targets = wanted ? names.filter((n) => n === wanted) : names;
  if (targets.length === 0) return `(không có server "${wanted}"; có: ${names.join(", ")})`;

  const out: string[] = [];
  for (const name of targets) {
    try {
      const s = await start(name);
      out.push(`${name}: ${s.tools.map((t) => t.name).join(", ") || "(không có tool)"}`);
    } catch (e) {
      out.push(`${name}: lỗi — ${(e as Error).message}`);
    }
  }
  return out.join("\n");
}

/** `call_mcp_tool({server, tool_name, tool_args})`. */
export async function callMcpTool(arg: string): Promise<string> {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { return 'call_mcp_tool cần {"server":"…","tool_name":"…","tool_args":{…}}'; }
  const server = String(spec?.server ?? spec?.server_name ?? "");
  const tool = String(spec?.tool_name ?? spec?.tool ?? spec?.name ?? "");
  const args = spec?.tool_args ?? spec?.arguments ?? spec?.args ?? {};
  if (!server || !tool) return 'call_mcp_tool cần {"server":"…","tool_name":"…","tool_args":{…}}';

  try {
    const s = await start(server);
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
