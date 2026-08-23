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
import { oauthAccessToken, recordRefusal, refusalFor } from "./mcp-oauth.js";
import { warmAuthUrl } from "./oauth-client.js";
import { currentOwner } from "./request-context.js";
import { DEFAULT_USER } from "./auth.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONFIG = process.env.GROKBOT2_MCP_CONFIG ?? join(repoRoot, ".mcp.json");
/**
 * Where this module keeps its files.
 *
 * Derived from the module path, so it followed the code and ignored every test-isolation env var —
 * which is how a test that calls clearOAuth(DEFAULT_USER) deleted a REAL sign-in twice in one day.
 * `GROKBOT2_DATA_DIR` lets the test runner point all of it somewhere disposable; unset, nothing
 * changes.
 */
const DATA_DIR = process.env.GROKBOT2_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".data");

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
/**
 * The protocol version we ask for.
 *
 * Streamable HTTP only exists from 2025-03-26 on, so the old 2024-11-05 this sent would have made a
 * remote server fall back to the legacy two-endpoint SSE transport. Measured earlier on stdio: the
 * handshake completes on 2024-11-05, 2025-06-18 and 2026-07-28 alike, so raising it costs nothing
 * there and is required here.
 */
const MCP_PROTOCOL_VERSION = "2025-06-18";

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
interface ServerSpec {
  /** stdio: the executable. Absent for a remote server, which carries `url` instead. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** http: the Streamable HTTP endpoint, e.g. https://mcp.example.com/mcp */
  url?: string;
  /** http: sent on every request — where a `Bearer ${TOKEN}` credential goes. */
  headers?: Record<string, string>;
  /** Optional hint ("stdio" | "http" | "sse"); the presence of `url` already decides. */
  type?: string;
}
interface McpTool { name: string; description?: string; inputSchema?: unknown }

/** One resource a server exposes. Field names are the MCP spec's. */
interface McpResource { uri: string; name?: string; description?: string; mimeType?: string }

/**
 * How a server is reached. Two answers now, and the rest of this module knows neither.
 *
 * `stdio` spawns a process and talks over its pipes. `http` speaks MCP's Streamable HTTP to a URL —
 * which is what remote servers use (Zernio, and the vendor client's own plugins, which are remote
 * http/sse only). Until this existed a remote server needed the `mcp-remote` bridge as a stdio shim.
 *
 * `send` is fire-and-forget: a reply arrives later through `deliver`, exactly as it did when the only
 * transport was a pipe. That is what lets `rpc()` stay unchanged across both.
 */
interface Transport {
  kind: "stdio" | "http";
  send(msg: unknown): void;
  close(): void;
  /** null while usable; a human-readable reason once it is not. */
  dead(): string | null;
}

interface Live {
  transport: Transport;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
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

/**
 * Servers that answered 401, keyed the same way as `live`.
 *
 * The Plugins pane needs to be able to say needsAuth, and the only honest source for that is the
 * server itself having refused. It cannot be derived from the config: a row may carry a token that
 * has expired, or carry none and be a public server. Recorded on the refusal, cleared as soon as a
 * request succeeds.
 */
const authRefused = new Map<string, string>();

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
    s.transport.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
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
  if (existing && existing.transport.dead() == null) return existing;

  const spec = mcpServers(owner)[name];
  if (!spec?.command && !spec?.url) throw new Error(`no MCP server "${name}" in ${configPathFor(owner)}`);

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

  const s: Live = { transport: null as unknown as Transport, pending: new Map(), nextId: 0, tools: [], capabilities: {} };

  /** One place both transports hand a decoded JSON-RPC object to whoever is waiting for it. */
  const deliver = (msg: any): void => {
    const slot = s.pending.get(msg?.id);
    if (!slot) return;                       // a notification, or a reply to a call already timed out
    s.pending.delete(msg.id);
    if (msg.error) slot.reject(new Error(msg.error.message ?? "MCP error"));
    else slot.resolve(msg.result);
  };
  const failAll = (why: string): void => {
    for (const [, slot] of s.pending) slot.reject(new Error(why));
    s.pending.clear();
    if (live.get(key) === s) live.delete(key);
  };

  // A signed-in connector needs nothing typed into the setup form: when the row declares no
  // Authorization of its own, use whatever the app's OAuth flow stored for this URL and owner.
  // The row's own header still wins — somebody who pasted a key meant to use that key.
  const headers = { ...resolved.headers };
  if (spec.url && !Object.keys(headers).some((h) => h.toLowerCase() === "authorization")) {
    const token = oauthAccessToken(spec.url, owner);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  s.transport = spec.url
    ? httpTransport(name, spec.url, headers, spec.type, deliver, failAll,
        (why) => {
          if (why) authRefused.set(key, why); else authRefused.delete(key);
          // Also on disk: a restart must not forget that a server wants a sign-in.
          recordRefusal(name, why, owner);
        })
    : stdioTransport(name, spec, resolved, deliver, failAll);

  live.set(key, s);
  return finishHandshake(name, s);
}

/** A spawned process, talking newline-delimited JSON-RPC over its pipes. */
function stdioTransport(
  name: string,
  spec: ServerSpec,
  resolved: { args: string[]; env: Record<string, string> },
  deliver: (msg: any) => void,
  failAll: (why: string) => void,
): Transport {
  const command = spec.command as string;
  const proc = spawn(command, resolved.args, {
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
    shell: process.platform === "win32" && !isDirectExecutable(command),
  }) as ChildProcessWithoutNullStreams;

  let buf = "";
  // JSON-RPC frames are newline-delimited; a chunk can split or join them.
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { deliver(JSON.parse(line)); } catch { /* servers also log plain text here */ }
    }
  });
  // stderr is where servers print startup noise AND, sometimes, their env. Never log it.
  proc.stderr.resume();
  proc.on("exit", () => failAll(`MCP server "${name}" exited`));

  return {
    kind: "stdio",
    send: (msg) => { proc.stdin.write(`${JSON.stringify(msg)}\n`); },
    close: () => { proc.kill(); },
    dead: () => (proc.exitCode == null ? null : `Exited with code ${proc.exitCode}`),
  };
}

/**
 * MCP over HTTP — Streamable HTTP first, legacy HTTP+SSE when the server is older.
 *
 * The vendor client only ever connects REMOTE http/sse servers for plugins, and this client could
 * only spawn processes, so anything remote needed `npx mcp-remote <url>` as a stdio shim: an extra
 * Node process per server, a download on first run, and its own copy of the auth state.
 *
 * STREAMABLE HTTP (2025-03-26 and later), the default:
 *   - POST with `accept: application/json, text/event-stream`; the server picks which it sends.
 *   - A reply may arrive as one JSON object, or as an SSE stream of them, because a server streams
 *     when it wants to send progress notifications ahead of the result.
 *   - `Mcp-Session-Id` comes back on initialize and must be echoed on every later request.
 *   - A notification (no `id`) is answered with 202 and no body, so nothing is delivered for it.
 *
 * LEGACY HTTP+SSE (2024-11-05): two endpoints. GET the URL, keep that stream open, read a first
 * `event: endpoint` naming a SECOND url; POST there and get 202 back, while the actual replies come
 * down the stream that is still open. Entered when the row says `"type": "sse"`, or on a 404/405 —
 * which is what a legacy server answers when handed a Streamable HTTP POST.
 *
 * 401 is reported as itself. Remote servers advertise OAuth through `WWW-Authenticate`, and repeating
 * that header names the fix; guessing at a token here would only produce a second, vaguer failure.
 */
function httpTransport(
  name: string,
  url: string,
  headers: Record<string, string>,
  typeHint: string | undefined,
  deliver: (msg: any) => void,
  failAll: (why: string) => void,
  /** Given the reason on a 401, and given null as soon as a request succeeds. */
  onAuth: (why: string | null) => void,
): Transport {
  let sessionId: string | null = null;
  let negotiated: string | null = null;
  let closed: string | null = null;
  /**
   * Which HTTP dialect to open with.
   *
   * `"type": "sse"` in the row is explicit. Failing that, a path ending in `/sse` is the convention
   * every legacy server follows (supergateway, mcp-proxy, and the servers written before the
   * transport was replaced), and guessing from it is worth doing because the 404/405 fallback below
   * cannot be relied on alone: measured against supergateway, a POST to its `/sse` neither answers
   * nor refuses — it just hangs, so there is no status to react to.
   */
  const looksLegacy = /sse/i.test(typeHint ?? "") || /\/sse\/?$/i.test(new URL(url).pathname);
  let mode: "unknown" | "streamable" | "legacy" = looksLegacy ? "legacy" : "unknown";
  let postUrl = url;
  let legacyReady: Promise<void> | null = null;
  // The legacy GET stays open for the whole session, so closing has to be able to cut it. Without
  // this the reader keeps the event loop alive and the process never exits — which is how it was
  // found: the transport tests passed and then hung until the harness killed them.
  const legacyAbort = new AbortController();

  const unauthorized = (res: Response): Error => {
    const how = res.headers.get("www-authenticate");
    onAuth(how ?? "The server requires authentication (401)");
    return new Error(
      `MCP server "${name}" refused the request (401)` +
      (how ? ` — it wants OAuth: ${how}` : "") +
      ". Set its credential in the plugin setup, or give it an Authorization header.",
    );
  };

  /**
   * Read an SSE body, handing each complete event to `on`.
   *
   * Both modes need this, for different spans: Streamable HTTP uses it for one response, legacy for
   * the whole session — so the event NAME matters here, where it did not before.
   */
  const readSse = async (res: Response, on: (event: string, data: string) => void): Promise<void> => {
    const reader = res.body?.getReader();
    if (!reader) return;
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let sep: number;
      // Events are separated by a blank line; CRLF is legal too.
      while ((sep = buf.search(/\r?\n\r?\n/)) !== -1) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep).replace(/^\r?\n\r?\n/, "");
        const lines = raw.split(/\r?\n/);
        const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() || "message";
        const data = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
        if (data) on(event, data);
      }
    }
  };

  /** Open the legacy stream and resolve once it has named the POST endpoint. */
  const openLegacyStream = (): Promise<void> => {
    if (legacyReady) return legacyReady;
    legacyReady = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`MCP server "${name}" sent no endpoint event`)),
        START_TIMEOUT_MS,
      );
      void (async () => {
        try {
          const res = await fetch(url, { headers: { accept: "text/event-stream", ...headers }, signal: legacyAbort.signal });
          if (res.status === 401) { clearTimeout(timer); reject(unauthorized(res)); return; }
          if (!res.ok) { clearTimeout(timer); reject(new Error(`MCP server "${name}" answered HTTP ${res.status}`)); return; }
          // Runs for the life of the session: this stream carries every reply.
          await readSse(res, (event, data) => {
            if (event === "endpoint") {
              // Usually a relative path carrying a session id, so resolve it against the base.
              postUrl = new URL(data, url).toString();
              clearTimeout(timer);
              resolve();
              return;
            }
            try { deliver(JSON.parse(data)); } catch { /* comment or keep-alive */ }
          });
          if (!closed) failAll(`MCP server "${name}" closed the stream`);
        } catch (e) {
          clearTimeout(timer);
          reject(e as Error);
        }
      })();
    });
    return legacyReady;
  };

  const post = async (msg: any): Promise<void> => {
    if (mode === "legacy") {
      await openLegacyStream();
      const res = await fetch(postUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      if (res.status === 401) throw unauthorized(res);
      if (!res.ok) throw new Error(`MCP server "${name}" answered HTTP ${res.status}`);
      return;                                   // the reply comes down the open stream
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        ...(negotiated ? { "mcp-protocol-version": negotiated } : {}),
        ...headers,
      },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });

    // A legacy server has no POST route at all. Switch once, then replay this message.
    if ((res.status === 404 || res.status === 405) && mode === "unknown") {
      mode = "legacy";
      return post(msg);
    }
    mode = "streamable";

    const sid = res.headers.get("mcp-session-id");
    if (sid) sessionId = sid;

    if (res.status === 401) throw unauthorized(res);
    if (res.ok) onAuth(null);   // whatever was wrong with the credential is no longer wrong
    if (res.status === 202 || res.status === 204) return;   // notification accepted, no body
    if (!res.ok) throw new Error(`MCP server "${name}" answered HTTP ${res.status}`);

    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/event-stream")) {
      await readSse(res, (_e, data) => { try { deliver(JSON.parse(data)); } catch { /* keep-alive */ } });
      return;
    }

    const text = (await res.text()).trim();
    if (!text) return;
    // A server may batch replies into an array.
    for (const m of ((b) => (Array.isArray(b) ? b : [b]))(JSON.parse(text))) deliver(m);
  };

  return {
    kind: "http",
    send: (msg) => {
      const method = (msg as { method?: string })?.method;
      // Fire-and-forget, like the pipe write it replaces. A transport-level failure has to become a
      // rejection for THIS call, or `rpc` would sit until its timeout with no reason to report.
      void post(msg).catch((e: Error) => {
        const id = (msg as { id?: number })?.id;
        if (id == null) return;                    // a notification: nothing is waiting on it
        deliver({ id, error: { message: e.message } });
      });
      if (method === "initialize") negotiated = MCP_PROTOCOL_VERSION;
    },
    close: () => {
      closed = "Closed";
      legacyAbort.abort();          // cut the long-lived GET, if this session opened one
      const sid = sessionId;
      if (!sid) return;
      // Best effort: tell the server the session is over so it can free it.
      void fetch(url, { method: "DELETE", headers: { "mcp-session-id": sid, ...headers } }).catch(() => {});
      failAll(`MCP server "${name}" closed`);
    },
    dead: () => closed,
  };
}

/** Shared tail of both transports: initialize, say hello back, learn the tool list. */
async function finishHandshake(name: string, s: Live): Promise<Live> {
  const handshake = (async () => {
    const hello = await rpc(s, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      // We now consume resources as well as tools. Declaring nothing was fine while only tools were
      // used; a server may gate features on what the client claims, so say what we actually read.
      capabilities: { tools: {}, resources: {} },
      clientInfo: { name: "grokbot2", version: "0.1.0" },
    });
    s.capabilities = (hello?.capabilities ?? {}) as Record<string, unknown>;
    s.transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
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
  for (const [, s] of live) { try { s.transport.close(); } catch { /* already gone */ } }
  live.clear();
}

/**
 * Ask a remote server whether it wants a sign-in, without waiting to be asked.
 *
 * The status used to appear only AFTER something tried the server and failed, which put the person
 * in a loop: the Authenticate button needs `needsAuth`, `needsAuth` needs a 401, and a 401 needs a
 * call they cannot make until the connector works. So a url server with no verdict yet gets one
 * cheap POST in the background; the answer lands in the same place a real refusal does, and the next
 * status read — a second later, when the pane refreshes — has it.
 *
 * Deliberately not awaited: `mcpServerStatus` is called from response builders that are synchronous,
 * and blocking them on a network round trip would stall the pane for every row.
 *
 * Rate-limited per server. The pane asks for status often, and a probe per ask would be a request
 * storm against somebody else's service.
 */
const probedAt = new Map<string, number>();
const PROBE_EVERY_MS = 60_000;

function probeRemote(name: string, url: string, headers: Record<string, string>, owner: string): void {
  const key = `${owner}::${name}`;
  const last = probedAt.get(key) ?? 0;
  if (Date.now() - last < PROBE_EVERY_MS) return;
  probedAt.set(key, Date.now());

  void (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "initialize",
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "grokbot2-probe", version: "0.1.0" },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) {
        recordRefusal(name, res.headers.get("www-authenticate") ?? "The server requires authentication (401)", owner);
        // Start building the sign-in URL now, so it is ready when the button is pressed.
        warmAuthUrl(url, owner);
      } else if (res.ok || res.status === 202) {
        recordRefusal(name, null, owner);
      }
      // Anything else (5xx, a redirect, a non-MCP endpoint) is left unrecorded: it says the server is
      // unhappy, not that it wants OAuth, and claiming needsAuth there would offer a button that
      // cannot help.
    } catch { /* unreachable right now; the next status read tries again after the interval */ }
  })();
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
  status: "connected" | "initializing" | "needsAuth" | "error" | "disconnected";
  detail: string;
  toolCount: number;
} {
  const spec = mcpServers(owner)[name];
  if (!spec?.command && !spec?.url) return { status: "error", detail: "Not in this account's MCP config", toolCount: 0 };

  const resolved = resolveSpecSecrets(spec, owner);
  const blocking = missingArgSecrets(resolved);
  const where = "the plugin's setup, the backend environment, or .data/secrets/<user>.json";
  if (blocking.length) {
    return { status: "error", detail: `Needs ${blocking.join(", ")} — set it in ${where}`, toolCount: 0 };
  }

  // A server that answered 401 gets the client's own `needsAuth`, which is what renders the
  // Authenticate button. Only ever reported because the SERVER refused, never guessed from a config
  // that merely looks incomplete — an Authenticate button on a server that does not want OAuth would
  // just fail, and a button that fails is worse than no button.
  // A stored sign-in makes an older refusal stale evidence, so it must not outvote it. Getting this
  // order wrong kept a freshly signed-in connector reading needsAuth: the refusal only clears on a
  // successful request, and the pane never showed a reason to make one.
  const signedIn = Boolean(spec.url && oauthAccessToken(spec.url, owner));
  const refused = signedIn ? null : (authRefused.get(`${owner}::${name}`) ?? refusalFor(name, owner));
  if (signedIn) recordRefusal(name, null, owner);
  if (refused) {
    // The refusal may have come off disk after a restart, in which case no probe ran and nothing has
    // built the sign-in URL yet. Warm it here too: the click asks for the URL twice in the same
    // instant and never comes back, so it has to exist before the button is pressed.
    if (spec.url) warmAuthUrl(spec.url, owner);
    return { status: "needsAuth", detail: refused, toolCount: 0 };
  }

  const s = live.get(`${owner}::${name}`);
  if (s && s.transport.dead() == null) {
    return { status: "connected", detail: `${s.tools.length} tool(s) available`, toolCount: s.tools.length };
  }
  if (s) return { status: "error", detail: s.transport.dead() ?? "Not running", toolCount: 0 };

  // A remote server with no verdict yet: find out, in the background. Until this, the pane could
  // only learn that a connector wants a sign-in by watching something fail first.
  if (spec.url) {
    const headers = { ...resolved.headers };
    if (!Object.keys(headers).some((h) => h.toLowerCase() === "authorization")) {
      const token = oauthAccessToken(spec.url, owner);
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    probeRemote(name, spec.url, headers, owner);
    return { status: "disconnected", detail: "Checking with the server…", toolCount: 0 };
  }

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
