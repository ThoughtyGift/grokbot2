/**
 * Grok Bot 2 — self-host backend.
 *
 * Launch the stock Grok Bot desktop app with CURSOR_API_BASE_URL pointed here and
 * this backend serves everything the app needs: auth, the bootstrap ConnectRPC
 * gates, the box gateway (so the UI renders), and chat routed to your Claude pool.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "./config.js";
import { handleAuth, userFromToken, ownerFromAuth, DEFAULT_USER } from "./auth.js";
import { accessVerdict } from "./billing.js";
import { runWithOwner } from "./request-context.js";
import { handleGateway, hostHealth, handleBootstrapRpc } from "./gateway.js";
import { saveNow, persistenceInfo } from "./store.js";
import { runtimeHealth } from "./brain.js";
import { chatSnapshot } from "./chat/state.js";
import { startScheduler, opsHealth, tick, dueIds, routinesForOps, fireById, fireListeners } from "./automations.js";
import { reportBoxConfig, computerHealth } from "./forever-box.js";
import { browserProbe, isBrowserConfigured } from "./browser.js";
import { reportMcpConfig, closeMcp } from "./mcp.js";
import { boxHealth } from "./box-exec.js";
import { logSafe } from "./redact.js";
import { recordUnknown, notFoundBody, saveCoverageNow } from "./observe.js";
import { ensureGatewayToken, authMode } from "./auth-gate.js";
import { reportModelToolSupport } from "./model-probe.js";
import { handleNative } from "./native.js";

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
  // ── telemetry sink ──
  //
  // The observe pass caught `POST /v1/traces` — the app's OpenTelemetry exporter, which is also
  // what the `traceparent` header in the client's constant table is for. It is fire-and-forget:
  // a 404 makes the exporter retry and fill the log with failures over something we do not want
  // anyway. Accept and discard, which is exactly what a sink that stores nothing should do.
  //
  // Deliberately BEFORE the strict-404 fallback, so turning strict mode on cannot start breaking
  // telemetry. Deliberately not forwarded anywhere: traces would leave this machine otherwise.
  if (url.startsWith("/v1/traces") || url.startsWith("/v1/metrics") || url.startsWith("/v1/logs")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end("{}");
  }

  // ── bare /health ──
  //
  // Not in the extracted contract, which is gateway-relative — but the observe pass caught
  // something asking for `/health` at the ROOT, where it fell into the fallback and got `200 {}`.
  // Answering the same body as `/gw/health` costs one line and is strictly better than an empty
  // object; who the caller is remains open (see docs/history/execution-roadmap.md §6 P2-6).
  if (url === "/health" || url.startsWith("/health?")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(hostHealth()));
  }

  // ── ops internal (loopback — this server binds 127.0.0.1, not via /gw) ──
  if (url.startsWith("/internal/ops/")) {
    const json = (value: unknown, code = 200) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      const bodyJ = body.length ? JSON.parse(body.toString("utf8")) as Record<string, unknown> : {};
      const nowOf = () => {
        if (bodyJ.now == null) return new Date();
        const d = new Date(bodyJ.now as string | number);
        if (Number.isNaN(d.getTime())) throw new Error("bad now");
        return d;
      };
      if (url.startsWith("/internal/ops/routines") && (req.method === "GET" || req.method === "POST")) {
        return json({ routines: routinesForOps() });
      }
      if (url.startsWith("/internal/ops/due") && req.method === "POST") {
        return json({ ids: dueIds(nowOf()) });
      }
      if (url.startsWith("/internal/ops/tick") && req.method === "POST") {
        tick(nowOf());
        return json({ ok: true });
      }
      if (url.startsWith("/internal/ops/fire-listeners") && req.method === "POST") {
        const n = fireListeners(String(bodyJ.platform ?? ""), String(bodyJ.context ?? ""));
        return json({ ok: true, fired: n });
      }
      if (url.startsWith("/internal/ops/fire") && req.method === "POST") {
        const trigger = bodyJ.trigger === "event" || bodyJ.trigger === "manual" ? bodyJ.trigger : "schedule";
        const ok = fireById(String(bodyJ.automationId ?? ""), trigger, typeof bodyJ.context === "string" ? bodyJ.context : undefined);
        return json({ ok }, ok ? 200 : 404);
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: e instanceof Error ? e.message : "bad json" }));
    }
  }

  // ── native API (S13; OpenAPI docs/api/grokbot2-v0.yaml) — beside /gw, not through it ──
  // Native /v1 (grokbot-web) — scope to the caller's owner from a VERIFIED user JWT (Phase 4),
  // default identity when absent/unsigned (the desktop, or the gateway-ticket session token).
  const nativeOwner = ownerFromAuth(req.headers.authorization);
  if (await runWithOwner(nativeOwner, () => handleNative(url, body, res, req.headers, req.method ?? "?"))) return;

  // ── box gateway (JSON + SSE + chat) ──
  // Multi-tenant Phase 2: scope every /gw command to the caller's owner (from the token, default
  // identity when absent). Domain code reads currentOwner(); this is the one place it is set.
  const gwOwner = ownerFromAuth(req.headers.authorization);
  if (runWithOwner(gwOwner, () => handleGateway(url, body, res, req.headers as Record<string, unknown>, req.method ?? "?"))) return;

  // ── ConnectRPC bootstrap (protobuf) ──
  //
  // Framing and payloads are the ACL's business; this shell only carries bytes. The content type
  // is passed through because it decides the framing — a `connect+` stream has to be answered as
  // one, and the response echoes the request's own type.
  // Resolve the caller (falling back to the single default identity) so the access gate has a user.
  // Under GROKBOT2_BILLING off/warn, accessVerdict is always "granted" — this stays inert.
  const rpcUser = userFromToken(req.headers.authorization) ?? DEFAULT_USER;
  const rpc = handleBootstrapRpc(url, ct, { user: rpcUser, access: accessVerdict(rpcUser) });
  if (rpc) {
    res.writeHead(rpc.status, { "content-type": rpc.contentType });
    return res.end(rpc.body);
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
  if (config.opsUrl) {
    logSafe(`[grokbot2] ops process ${config.opsUrl} owns scheduler + public webhooks (in-process cron off)`);
    void opsHealth().then((s) => logSafe(`[grokbot2] ops: ${s}`));
  } else {
    startScheduler();
  }
  // Mint the gateway ticket BEFORE anything can serve EnsureSandBox, so the descriptor and the
  // check are guaranteed to carry the same value.
  ensureGatewayToken();
  logSafe(`[grokbot2] [auth] mode=${authMode()} · token minted, harness copy at .data/gateway-token.txt`);
  // Every startup line goes through logSafe: these carry the pool URL, the box URL, the VNC URL
  // and the CDP endpoint, and any of them can hold a credential in its query string.
  logSafe(`[grokbot2] backend on http://localhost:${config.port}`);
  const persist = persistenceInfo();
  logSafe(`[grokbot2] persistence: sqlite ${persist.sqlite}${persist.imported ? " (state.json frozen)" : ""}`);
  void runtimeHealth().then((s) => logSafe(`[grokbot2] runtime: ${s}`));
  void computerHealth().then((s) => logSafe(`[grokbot2] computer: ${s}`));
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
  // P5-5: a model that will not speak the TOOL_CALL convention removes every tool the bot has, and
  // says so only by being unhelpful. Cached per model, so `tsx watch` does not re-buy the answer.
  void reportModelToolSupport((msg) => logSafe(`[grokbot2] ${msg}`));
  logSafe(`[grokbot2] native API http://localhost:${config.port}/v1/health  (FE: pnpm web)`);
  logSafe(`[grokbot2] launch the stock app with CURSOR_API_BASE_URL=http://localhost:${config.port}`);
});
