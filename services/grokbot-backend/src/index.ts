/**
 * Grok Bot 2 — self-host backend.
 *
 * Launch the stock Grok Bot desktop app with CURSOR_API_BASE_URL pointed here and
 * this backend serves everything the app needs: auth, the bootstrap ConnectRPC
 * gates, the box gateway (so the UI renders), and chat routed to your Claude pool.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "./config.js";
import { handleAuth } from "./auth.js";
import { handleGateway, hostHealth } from "./gateway.js";
import { bootstrapResponses, connectStreamEnd } from "@grokbot2/proto";
import { saveNow } from "./store.js";
import { chatSnapshot } from "./chat.js";
import { startScheduler } from "./automations.js";
import { reportBoxConfig } from "./forever-box.js";
import { browserProbe, isBrowserConfigured } from "./browser.js";
import { reportMcpConfig, closeMcp } from "./mcp.js";
import { boxHealth } from "./box-exec.js";
import { logSafe } from "./redact.js";
import { recordUnknown, notFoundBody, saveCoverageNow, STRICT_404 } from "./observe.js";

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "";
  const body = await readBody(req);
  const ct = String(req.headers["content-type"] ?? "");
  // Redacted: a request URL can carry `?token=` / `?password=`, and this line is on by default
  // for anyone debugging with GROKBOT2_LOG — the exact audience most likely to paste a log.
  if (process.env.GROKBOT2_LOG) logSafe(`${req.method} ${url} (${ct.split(";")[0]})`);

  // ── auth ──
  if (url.startsWith("/oauth/token") || url.includes("/auth/") || url.endsWith("/token")) {
    return handleAuth(res);
  }
  // ── local exec daemon credential ──
  if (url.includes("local-exec-daemon-credential")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ token: "exec", authToken: "exec", url: `http://localhost:${config.port}/exec` }));
  }
  // ── bare /health ──
  //
  // Not in the extracted contract, which is gateway-relative — but the observe pass caught
  // something asking for `/health` at the ROOT, where it fell into the fallback and got `200 {}`.
  // Answering the same body as `/gw/health` costs one line and is strictly better than an empty
  // object; who the caller is remains open (see docs/execution-roadmap.md §6 P2-6).
  if (url === "/health" || url.startsWith("/health?")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(hostHealth()));
  }

  // ── box gateway (JSON + SSE + chat) ──
  if (handleGateway(url, body, res, req.headers as Record<string, unknown>, req.method ?? "?")) return;

  // ── ConnectRPC bootstrap (protobuf) ──
  const rpc = url.match(/\/([a-z0-9_.]+\.v\d+\.[A-Za-z]+)\/([A-Za-z]+)/i);
  if (rpc) {
    const method = rpc[2];
    const isStream = ct.includes("connect+") || ct.includes("grpc");
    const isJson = ct.includes("json");
    const build = Object.hasOwn(bootstrapResponses, method) ? bootstrapResponses[method] : undefined;
    const payload = build ? build() : undefined;
    if (isStream) {
      res.writeHead(200, { "content-type": ct });
      return res.end(connectStreamEnd(payload));
    }
    if (isJson) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end("{}");
    }
    res.writeHead(200, { "content-type": "application/proto" });
    return res.end(payload ?? Buffer.alloc(0));
  }

  // Nothing matched: not auth, not the gateway, not a ConnectRPC method. Recorded for the same
  // reason as the gateway's own fallback — an endpoint the app needs and we have never heard of
  // is otherwise indistinguishable from one that legitimately answers nothing. Still `200 {}`
  // until GROKBOT2_STRICT_404=1.
  recordUnknown(req.method ?? "?", url, body);
  const nf = notFoundBody(req.method ?? "?", url);
  if (nf) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(nf);
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end("{}");
});

// Flush state to disk on shutdown so an in-flight debounce isn't lost. Coverage too: the
// observe pass is worthless if the list it built dies with the process it was gathered in.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { saveNow(chatSnapshot); saveCoverageNow(); closeMcp(); process.exit(0); });
}

server.listen(config.port, "127.0.0.1", () => {
  startScheduler();
  // Every startup line goes through logSafe: these carry the pool URL, the box URL, the VNC URL
  // and the CDP endpoint, and any of them can hold a credential in its query string.
  logSafe(`[grokbot2] backend on http://localhost:${config.port}`);
  logSafe(`[grokbot2] brain: ${config.poolUrl} (model=${config.model})`);
  reportBoxConfig((msg) => logSafe(`[grokbot2] ${msg}`));
  reportMcpConfig((msg) => logSafe(`[grokbot2] ${msg}`));
  if (isBrowserConfigured()) {
    void browserProbe().then((s) => logSafe(`[grokbot2] [browser] ${process.env.GROKBOT2_BROWSER_CDP} — ${s}`));
  } else {
    console.log("[grokbot2] [browser] GROKBOT2_BROWSER_CDP not set — browser_* tools are off.");
  }
  // State the truth about the box at startup: a shell tool that is quietly absent is
  // indistinguishable from one that is broken.
  void boxHealth().then((s) => logSafe(`[grokbot2] [${s}`.replace("[box:", "[box]")));
  logSafe(`[grokbot2] launch the app with CURSOR_API_BASE_URL=http://localhost:${config.port}`);
});
