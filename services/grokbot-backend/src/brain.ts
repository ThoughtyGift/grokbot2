/**
 * S5 client — the turn loop calls this instead of `@grokbot2/pool-client` directly.
 *
 * When `GROKBOT2_RUNTIME_URL` is set, the model step is `POST /internal/turns` (parse lives on
 * the runtime). `/internal/complete` is the pool-only fallback. An abort here is
 * `interruptAgentRun` (the runtime drops the pool call on `req` close). When the URL is unset
 * (e2e that spawn only this backend, like `e2e-pool-failure`), the pool is called in-process.
 * A *set* URL that is down is an error, not a silent fallback (ROADMAP §5.4).
 *
 * Sequence numbers never originate here (parity.md §2ac). The BFF stamps seq when it writes
 * the transcript. Streaming turns are NDJSON (`delta` / `done`).
 */
import { streamPool, callPool, type PoolMessage, type PoolOptions, type PoolResult } from "@grokbot2/pool-client";
import { config } from "./config.js";
import { parseToolCalls, hasIncompleteToolCall, type ToolCall } from "./tool-calls.js";

export type BrainOpts = PoolOptions & { knownTools?: string[] };
export type TurnResult = PoolResult & { calls?: ToolCall[]; incomplete?: boolean };

function attachParse(result: PoolResult, knownTools?: string[]): TurnResult {
  if (!result.ok || !knownTools?.length) return result;
  const set = new Set(knownTools.map((n) => n.toLowerCase()));
  const known = (n: string) => set.has(n);
  return {
    ...result,
    calls: parseToolCalls(result.text ?? "", known),
    incomplete: hasIncompleteToolCall(result.text ?? "", known),
  };
}

function poolOpts(opts: BrainOpts): PoolOptions {
  const { knownTools: _k, ...rest } = opts;
  return rest;
}

async function readNdjson(res: Response, onDelta?: (chunk: string) => void): Promise<TurnResult> {
  const reader = res.body?.getReader();
  if (!reader) return { ok: false, error: "runtime returned no body" };
  const dec = new TextDecoder();
  let buf = "";
  let last: TurnResult = { ok: false, error: "empty stream" };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let ev: { type?: string; text?: string } & TurnResult;
      try { ev = JSON.parse(line) as typeof ev; } catch { continue; }
      if (ev.type === "delta" && ev.text) onDelta?.(ev.text);
      else if (ev.type === "done") last = ev;
    }
  }
  if (buf.trim()) {
    try {
      const ev = JSON.parse(buf) as { type?: string } & TurnResult;
      if (ev.type === "done" || ev.ok !== undefined) last = ev;
    } catch { /* incomplete trailer */ }
  }
  return last;
}

async function viaRuntime(
  messages: PoolMessage[],
  opts: BrainOpts,
  stream: boolean,
  onDelta?: (chunk: string) => void,
): Promise<TurnResult> {
  const base = config.runtimeUrl;
  if (!base) {
    const inner = stream
      ? await streamPool(messages, poolOpts(opts), onDelta ?? (() => {}))
      : await callPool(messages, poolOpts(opts));
    return attachParse(inner, opts.knownTools);
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/internal/turns`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: stream ? "application/x-ndjson" : "application/json" },
      body: JSON.stringify({
        messages,
        url: opts.url,
        key: opts.key,
        model: opts.model,
        system: opts.system,
        maxTokens: opts.maxTokens,
        timeoutMs: opts.timeoutMs,
        image: opts.image,
        stream,
        knownTools: opts.knownTools,
      }),
      signal: opts.signal,
    });
    const ctype = res.headers.get("content-type") ?? "";
    if (stream && /ndjson/i.test(ctype) && res.body) {
      const json = await readNdjson(res, onDelta);
      if (!res.ok) return { ok: false, error: json.error ?? `runtime HTTP ${res.status}`, status: res.status };
      return json;
    }
    const json = await res.json() as TurnResult;
    if (!res.ok) return { ok: false, error: json.error ?? `runtime HTTP ${res.status}`, status: res.status };
    if (onDelta && json.ok && json.text) onDelta(json.text);
    return json;
  } catch (e: any) {
    if (e?.name === "AbortError") return { ok: false, error: "aborted" };
    return { ok: false, error: `runtime down: ${String(e?.message ?? e)}` };
  }
}

export function completeTurn(messages: PoolMessage[], opts: BrainOpts, onDelta: (chunk: string) => void): Promise<TurnResult> {
  return viaRuntime(messages, opts, true, onDelta);
}

export function completeTurnPlain(messages: PoolMessage[], opts: BrainOpts): Promise<TurnResult> {
  return viaRuntime(messages, opts, false);
}

export async function runtimeHealth(): Promise<string> {
  const base = config.runtimeUrl;
  if (!base) return "in-process (GROKBOT2_RUNTIME_URL unset)";
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? `up ${base}` : `HTTP ${r.status} ${base}`;
  } catch (e) {
    return `DOWN ${base} (${(e as Error).message})`;
  }
}
