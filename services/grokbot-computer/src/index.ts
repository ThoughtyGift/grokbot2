/**
 * S6 computer process — forever-box status, handoff data, exec proxy.
 *
 * The BFF (`:8788`) owns transcript seq, SSE, Cursor dialect, handoff Promises and the release
 * timer. This process owns who is using the screen, the VNC URL, handoff *data*, and the HTTP
 * hop to the exec daemon. Browser CDP stays on the BFF this cut (ADR-P5-1).
 *
 *   GROKBOT2_COMPUTER_PORT=8790  (default)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { begin, release, startHandoff, clearHandoff, status, reportVnc } from "./session.js";
import { daemonCall, BoxUnavailable } from "./exec.js";

const here = dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(join(here, "..", "..", "..", ".env"));
} catch { /* env vars and defaults only */ }

const PORT = Number(process.env.GROKBOT2_COMPUTER_PORT ?? 8790);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function json(res: ServerResponse, value: unknown, code = 200): void {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

async function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.length) return {};
  return JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "";
  const method = req.method ?? "GET";

  if (url.startsWith("/health") || url.startsWith("/internal/health")) {
    json(res, { ok: true, pid: process.pid, role: "computer" });
    return;
  }

  try {
    if ((url.startsWith("/internal/status") && (method === "GET" || method === "POST"))) {
      const body = method === "POST" ? await parseBody(req) : {};
      const q = new URL(url, "http://127.0.0.1").searchParams;
      json(res, status({ id: body.id ?? body.agentId ?? q.get("id") ?? q.get("agentId") ?? "" }));
      return;
    }
    if (url.startsWith("/internal/begin") && method === "POST") {
      const body = await parseBody(req);
      const agentId = typeof body.agentId === "string" ? body.agentId : typeof body.id === "string" ? body.id : "";
      json(res, { ok: true, ...begin(agentId) });
      return;
    }
    if (url.startsWith("/internal/release") && method === "POST") {
      const body = await parseBody(req);
      const agentId = typeof body.agentId === "string" ? body.agentId : typeof body.id === "string" ? body.id : "";
      json(res, { ok: true, ...release(agentId) });
      return;
    }
    if (url.startsWith("/internal/handoff/start") && method === "POST") {
      const body = await parseBody(req);
      const handoff = startHandoff(body);
      if (!handoff) { json(res, { error: "agentId required" }, 400); return; }
      json(res, { ok: true, handoff });
      return;
    }
    if (url.startsWith("/internal/handoff/back") && method === "POST") {
      const body = await parseBody(req);
      const agentId = typeof body.agentId === "string" ? body.agentId : typeof body.id === "string" ? body.id : "";
      json(res, { ok: true, ...clearHandoff(agentId) });
      return;
    }
    if (url.startsWith("/internal/exec") && method === "POST") {
      const body = await parseBody(req);
      const op = typeof body.op === "string" ? body.op : "";
      if (!op) { json(res, { error: "op required" }, 400); return; }
      const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? body.args as Record<string, unknown>
        : {};
      try {
        const result = await daemonCall(op, args);
        json(res, result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        json(res, { error: msg }, e instanceof BoxUnavailable ? 503 : 500);
      }
      return;
    }
  } catch (e) {
    json(res, { error: e instanceof Error ? e.message : "bad json" }, 400);
    return;
  }

  json(res, { error: "not found" }, 404);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[grokbot-computer] computer on http://127.0.0.1:${PORT}`);
  reportVnc((msg) => console.log(`[grokbot-computer] ${msg}`));
});
