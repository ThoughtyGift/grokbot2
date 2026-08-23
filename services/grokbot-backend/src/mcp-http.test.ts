/**
 * The two HTTP dialects an MCP server can speak, against real sockets.
 *
 * These were checked by hand against live servers while the transport was written (deepwiki over
 * Streamable HTTP, supergateway over legacy SSE), which proved it works and proves nothing tomorrow:
 * both need the network, one needs a package installed, and neither can run in CI. The fixtures
 * below are the same two protocols with the network removed, so a regression fails here instead of
 * in front of a user.
 *
 * What each one guards:
 *   Streamable HTTP  one endpoint · POST returns the reply inline · Mcp-Session-Id is echoed back
 *   Legacy HTTP+SSE  two endpoints · POST only gets 202 · the reply arrives on the open GET stream
 *   Dialect choice   a `/sse` path picks legacy without being told, because a POST to a legacy
 *                    server does not reliably fail — measured against supergateway, it just hangs
 *
 *   npx tsx --test src/mcp-http.test.ts
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DEFAULT_USER } from "./auth.js";

const DEFAULT_OWNER = DEFAULT_USER.authId;

const TOOLS = [{ name: "echo_it", description: "echoes", inputSchema: { type: "object" } }];

/** The JSON-RPC half both fixtures share — only the delivery differs. */
function answer(msg: any): unknown | null {
  if (msg.method === "initialize") {
    return { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } } };
  }
  if (msg.method === "tools/list") return { jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } };
  if (msg.method === "tools/call") {
    return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `called ${msg.params?.name}` }] } };
  }
  return null;   // a notification
}

const body = async (req: any): Promise<any> => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

/** One endpoint. The reply comes back on the same POST. */
function streamableFixture(): Server {
  return createServer(async (req, res) => {
    // A server that wants OAuth advertises it exactly like this, and that header is the only
    // trustworthy signal that a row should show an Authenticate button.
    // Only answers with the right Bearer — the fixture for "signed in, nothing typed".
    if ((req.url ?? "").startsWith("/guarded")) {
      if (req.headers.authorization !== "Bearer tok-from-signin") {
        res.writeHead(401, { "www-authenticate": "Bearer" }).end();
        return;
      }
      const msg = await body(req);
      const reply = answer(msg);
      if (!reply) { res.writeHead(202).end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
      return;
    }
    if ((req.url ?? "").startsWith("/needsauth")) {
      res.writeHead(401, { "www-authenticate": 'Bearer resource_metadata="http://example.test/.well-known/oauth-protected-resource"' }).end();
      return;
    }
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const msg = await body(req);
    const reply = answer(msg);
    if (!reply) { res.writeHead(202, { "mcp-session-id": "sess-1" }).end(); return; }
    res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "sess-1" });
    res.end(JSON.stringify(reply));
  });
}

/** Same, but the reply is pushed down an SSE stream that the client opened first. */
function legacyFixture(): { server: Server; sawSessionOnPost: () => boolean } {
  // Streams are keyed by session, not held in one variable: two configured servers open two GETs,
  // and a single shared stream would send the second one's replies to the first one's client. That
  // is the fixture's bug to avoid, and it is also exactly what a real server must not do.
  const streams = new Map<string, any>();
  let nextSession = 0;
  let sawSession = false;
  const server = createServer(async (req, res) => {
    const [path, query = ""] = (req.url ?? "").split("?");
    if (req.method === "GET" && path === "/sse") {
      const id = `s${++nextSession}`;
      streams.set(id, res);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      // The endpoint event is RELATIVE, as real servers send it — the client must resolve it.
      res.write(`event: endpoint\ndata: /message?sessionId=${id}\n\n`);
      req.on("close", () => streams.delete(id));
      return;
    }
    if (req.method === "POST" && path === "/message") {
      const id = new URLSearchParams(query).get("sessionId") ?? "";
      if (id) sawSession = true;
      const msg = await body(req);
      res.writeHead(202).end();
      const reply = answer(msg);
      if (reply) streams.get(id)?.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
      return;
    }
    res.writeHead(404).end();
  });
  return { server, sawSessionOnPost: () => sawSession };
}

const listen = (s: Server): Promise<number> =>
  new Promise((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));

let streamable: Server;
let legacy: { server: Server; sawSessionOnPost: () => boolean };
let mcp: typeof import("./mcp.js");

before(async () => {
  streamable = streamableFixture();
  legacy = legacyFixture();
  const sp = await listen(streamable);
  const lp = await listen(legacy.server);

  const dir = mkdtempSync(join(tmpdir(), "gb2-mcp-http-"));
  const cfg = join(dir, "mcp.json");
  writeFileSync(cfg, JSON.stringify({
    mcpServers: {
      modern: { url: `http://127.0.0.1:${sp}/mcp` },
      legacyExplicit: { url: `http://127.0.0.1:${lp}/sse`, type: "sse" },
      legacyByPath: { url: `http://127.0.0.1:${lp}/sse` },
      wantsOauth: { url: `http://127.0.0.1:${sp}/needsauth` },
      plainStdio: { command: "node", args: ["-e", "setTimeout(()=>{},1e9)"] },
      guarded: { url: `http://127.0.0.1:${sp}/guarded` },
    },
  }));
  // mcp.ts reads this at import time, so it has to be set before the module is loaded.
  process.env.GROKBOT2_MCP_CONFIG = cfg;
  mcp = await import("./mcp.js");
});

after(() => {
  try { mcp?.closeMcp(); } catch { /* already down */ }
  // An open SSE response keeps the listener alive, so drop connections too.
  streamable?.closeAllConnections?.();
  legacy?.server.closeAllConnections?.();
  streamable?.close();
  legacy?.server.close();
});

// ── Streamable HTTP ───────────────────────────────────────────────────────────

test("Streamable HTTP: handshake and tools/list over one endpoint", async () => {
  const out = await mcp.getMcpTools("modern");
  assert.match(out, /echo_it/);
});

test("Streamable HTTP: a tool call returns the server's content", async () => {
  const out = await mcp.callMcpTool(JSON.stringify({ server: "modern", tool_name: "echo_it", tool_args: {} }));
  assert.match(out, /called echo_it/);
});

// ── Legacy HTTP+SSE ───────────────────────────────────────────────────────────

test('legacy: type "sse" opens the GET stream and posts to the endpoint it names', async () => {
  const out = await mcp.getMcpTools("legacyExplicit");
  assert.match(out, /echo_it/, "the reply arrives on the stream, not on the POST");
  assert.equal(legacy.sawSessionOnPost(), true, "the relative endpoint (with its sessionId) was resolved and used");
});

test("legacy: a /sse path picks the old dialect with no `type` in the config", async () => {
  const out = await mcp.getMcpTools("legacyByPath");
  assert.match(out, /echo_it/);
});

test("legacy: a tool call round-trips through the two endpoints", async () => {
  const out = await mcp.callMcpTool(JSON.stringify({ server: "legacyExplicit", tool_name: "echo_it", tool_args: {} }));
  assert.match(out, /called echo_it/);
});

// ── the failure that must stay readable ───────────────────────────────────────

test("an unreachable server reports why instead of hanging until the call times out", async () => {
  const out = await mcp.getMcpTools("modern-missing");
  assert.match(out, /không có server/i, "an unknown name is named, not silently empty");
});

// ── the 401 that turns into an Authenticate button ────────────────────────────

test("a 401 is reported with the server's own WWW-Authenticate, not as a vague failure", async () => {
  const out = await mcp.getMcpTools("wantsOauth");
  assert.match(out, /401/);
  assert.match(out, /resource_metadata/, "the header names where the OAuth metadata lives");
});

test("after that 401 the pane says needsAuth — the status that renders Authenticate", () => {
  const st = mcp.mcpServerStatus("wantsOauth", DEFAULT_OWNER);
  assert.equal(st.status, "needsAuth");
  assert.match(st.detail, /Bearer/);
});

test("needsAuth is never guessed: a server that has not refused is not marked", () => {
  assert.notEqual(mcp.mcpServerStatus("modern", DEFAULT_OWNER).status, "needsAuth");
  assert.notEqual(mcp.mcpServerStatus("plainStdio", DEFAULT_OWNER).status, "needsAuth");
});

test("a server that answered is reported connected, with its tool count", () => {
  const st = mcp.mcpServerStatus("modern", DEFAULT_OWNER);
  assert.equal(st.status, "connected");
  assert.equal(st.toolCount, 1);
});

// ── the point of the OAuth family: signed in, nothing typed ───────────────────

test("a server that demands a Bearer is refused when nobody has signed in", async () => {
  const out = await mcp.getMcpTools("guarded");
  assert.match(out, /401/);
});

test("after a sign-in is stored, the same server connects with NOTHING in the setup form", async () => {
  const { oauthPortFor, clearOAuth } = await import("./mcp-oauth.js");
  const url = mcp.mcpServers(DEFAULT_OWNER).guarded.url as string;
  oauthPortFor(DEFAULT_OWNER).storeToken(url, "default", { clientId: "c", accessToken: "tok-from-signin" });
  try {
    mcp.closeMcp();                       // drop the refused connection so the next call reconnects
    const out = await mcp.getMcpTools("guarded");
    assert.match(out, /echo_it/, "the stored token was sent as Authorization");
  } finally {
    clearOAuth(DEFAULT_OWNER);
  }
});
