/**
 * S10/S11 ops process — scheduler clock + public Slack/GitHub webhooks.
 *
 * The BFF (`:8788`) owns automation CRUD, run history, sqlite, seq/SSE, and `sendPrompt`.
 * This process owns the 10s tick and public webhook HTTP. It must not write sqlite (ADR-P4-2).
 *
 *   GROKBOT2_OPS_PORT=8791  (default)
 *   GROKBOT2_BFF_URL=http://127.0.0.1:8788
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startScheduler, pokeTick } from "./scheduler.js";
import { handleSlackEvent } from "./slack.js";
import { handleGitHubEvent } from "./github.js";

const here = dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(join(here, "..", "..", "..", ".env"));
} catch { /* env vars and defaults only */ }

const PORT = Number(process.env.GROKBOT2_OPS_PORT ?? 8791);

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
    json(res, { ok: true, pid: process.pid, role: "ops" });
    return;
  }

  try {
    if (url.startsWith("/internal/tick") && method === "POST") {
      const body = await parseBody(req);
      const now = body.now != null ? new Date(String(body.now)) : new Date();
      if (Number.isNaN(now.getTime())) { json(res, { error: "bad now" }, 400); return; }
      const out = await pokeTick(now);
      json(res, { ok: !out.error, ...out }, out.error ? 503 : 200);
      return;
    }
    if (url.startsWith("/slack/events") && method === "POST") {
      const body = await parseBody(req);
      const out = await handleSlackEvent(body);
      json(res, out.body, out.status);
      return;
    }
    if (url.startsWith("/github/events") && method === "POST") {
      const body = await parseBody(req);
      const event = String(req.headers["x-github-event"] ?? "");
      const out = await handleGitHubEvent(event, body);
      json(res, out.body, out.status);
      return;
    }
  } catch (e) {
    json(res, { error: e instanceof Error ? e.message : "bad json" }, 400);
    return;
  }

  json(res, { error: "not found" }, 404);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[grokbot-ops] ops on http://127.0.0.1:${PORT}`);
  startScheduler();
});
