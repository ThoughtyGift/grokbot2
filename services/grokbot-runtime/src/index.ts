/**
 * S4/S5 runtime process — the only process that talks to the Claude pool.
 *
 * The BFF (`:8788`) owns transcript seq, SSE, Cursor dialect, tool execution and park.
 * This process owns one model step: pool + parse. Canonical path is `POST /internal/turns`.
 * `POST /internal/complete` remains the pool-only JSON shape for callers that do not want parse.
 *
 * A streaming turn is NDJSON (`delta` then `done`). Sequence numbers never originate here
 * (parity.md §2ac). Interrupt is an aborted fetch; `req` close aborts the pool call.
 *
 *   GROKBOT2_RUNTIME_PORT=8789  (default)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { streamPool, callPool, type PoolMessage, type PoolOptions, type PoolResult } from "@grokbot2/pool-client";
import { parseToolCalls, hasIncompleteToolCall, type ToolCall } from "./tool-calls.js";

const PORT = Number(process.env.GROKBOT2_RUNTIME_PORT ?? 8789);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

interface TurnBody {
  messages?: PoolMessage[];
  url?: string;
  key?: string;
  model?: string;
  system?: string;
  maxTokens?: number;
  image?: string;
  timeoutMs?: number;
  stream?: boolean;
  knownTools?: string[];
}

export type TurnResult = PoolResult & { calls?: ToolCall[]; incomplete?: boolean };

function isTurnPath(url: string): boolean {
  return url.startsWith("/internal/turns") || url.startsWith("/internal/complete");
}

function parseStep(text: string, knownTools?: string[]): { calls: ToolCall[]; incomplete: boolean } {
  if (!knownTools?.length) return { calls: [], incomplete: false };
  const set = new Set(knownTools.map((n) => n.toLowerCase()));
  const known = (n: string) => set.has(n);
  return { calls: parseToolCalls(text, known), incomplete: hasIncompleteToolCall(text, known) };
}

function attachParse(result: PoolResult, knownTools?: string[]): TurnResult {
  if (!result.ok) return result;
  const step = parseStep(result.text ?? "", knownTools);
  return { ...result, ...step };
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "";
  if (url.startsWith("/health") || url.startsWith("/internal/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, pid: process.pid, role: "runtime" }));
    return;
  }
  if (!(isTurnPath(url) && req.method === "POST")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  let body: TurnBody = {};
  try {
    const raw = await readBody(req);
    if (raw.length) body = JSON.parse(raw.toString("utf8")) as TurnBody;
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "bad json" }));
    return;
  }

  if (!body.url || !body.key || !Array.isArray(body.messages)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "url, key and messages are required" }));
    return;
  }

  const opts: PoolOptions = {
    url: body.url,
    key: body.key,
    model: body.model,
    system: body.system,
    maxTokens: body.maxTokens,
    timeoutMs: body.timeoutMs,
    image: body.image,
  };
  const ac = new AbortController();
  req.on("close", () => ac.abort());
  opts.signal = ac.signal;

  const wantParse = url.startsWith("/internal/turns");
  const stream = body.stream === true;

  try {
    if (stream) {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      const result = await streamPool(body.messages, opts, (chunk) => {
        if (ac.signal.aborted || res.writableEnded) return;
        res.write(`${JSON.stringify({ type: "delta", text: chunk })}\n`);
      });
      const done: TurnResult = wantParse ? attachParse(result, body.knownTools) : result;
      if (!res.writableEnded) {
        res.write(`${JSON.stringify({ type: "done", ...done })}\n`);
        res.end();
      }
      return;
    }

    const result = await callPool(body.messages, opts);
    const done: TurnResult = wantParse ? attachParse(result, body.knownTools) : result;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(done));
  } catch (e) {
    const result: PoolResult = { ok: false, error: String((e as Error).message ?? e) };
    if (stream && res.headersSent) {
      if (!res.writableEnded) {
        res.write(`${JSON.stringify({ type: "done", ...result })}\n`);
        res.end();
      }
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[grokbot-runtime] brain on http://127.0.0.1:${PORT}  POST /internal/turns`);
});
