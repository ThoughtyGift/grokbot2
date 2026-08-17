/**
 * pool-client — thin HTTP client for the OpenClaw Claude pool (admin.halcion.vn/v1/claude).
 *
 * The pool runs Claude via subscription CLI accounts with load-balancing + failover,
 * so this is a drop-in "brain" that costs no per-token API fees.
 * Contract: POST { prompt | messages, system?, model?, maxTokens? } -> { success, result }.
 *
 * The `system` field is part of that contract but is NOT usable: the pool discards it for every
 * Claude model. See `foldSystem` for the measured channel table and what we send instead.
 */

export interface PoolMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PoolOptions {
  /** e.g. https://admin.halcion.vn/v1/claude */
  url: string;
  /** hal_xxx bearer key */
  key: string;
  /** haiku | sonnet | opus (default sonnet) */
  model?: string;
  system?: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** external abort signal (e.g. from interruptAgentRun) */
  signal?: AbortSignal;
  /** optional image — base64 (data: URL or raw) or a URL; the pool supports vision */
  image?: string;
}

export interface PoolResult {
  ok: boolean;
  text?: string;
  account?: string;
  error?: string;
  status?: number;
}

/**
 * Deliver the system prompt as the head of the FIRST user turn instead of the `system` field.
 *
 * The pool's `system` field is silently discarded for the entire Claude family. Proven with a canary
 * system prompt ("your first word must be BANANA"): gemini and grok say BANANA, every Claude model
 * ignores it and introduces itself as a generic "neutral API assistant" — it never received our
 * 31k-char tool protocol. That is the whole reason Claude models reported having no tools, and it is
 * why the earlier explanation in docs/agent-brain.md ("Claude ships its own agent identity that
 * overrides our tool table") was wrong: nothing was overridden, because nothing arrived.
 *
 * Measured 17/08, three sequential attempts per cell, real 31,302-char prompt, "does the reply emit
 * `TOOL_CALL: <name>(<args>)`":
 *
 *   channel                                            gemini-3.7  opus-4-8  opus-5  grok-4.5
 *   A  /v1/claude          `system` field                  3/3        0/3       —      0/3
 *   B  /v1/chat/completions role:"system" message          0/3        0/3       —       —
 *   C  /v1/claude          folded into user message        3/3        3/3      3/3     0/3
 *   D  /v1/chat/completions folded, stream:true            0/3        1/3       —       —
 *
 * C is the only channel that works for more than one family, and it costs gemini nothing. Note that
 * a short canary passing through a channel does NOT mean the real prompt does — B carries the canary
 * for every model yet carries the tool protocol for none. That mistake was made here first: channel
 * B was shipped on canary evidence alone and regressed gemini from 3/3 to 0/3 before measurement
 * caught it.
 *
 * grok-4.5 fails in every channel for an unrelated, structural reason — the xAI CLI behind the pool
 * runs its own tools on the pool's VPS — so it is not a delivery problem and C costs nothing there.
 */
function foldSystem(messages: PoolMessage[], system?: string): PoolMessage[] {
  if (!system) return messages;
  const head = messages.findIndex((m) => m.role === "user");
  if (head === -1) return [{ role: "user", content: system }, ...messages];
  return messages.map((m, i) => (i === head ? { ...m, content: `${system}\n\n---\n\n${m.content}` } : m));
}

/** Call the pool once and return the full assistant text (non-streaming). */
export async function callPool(messages: PoolMessage[], opts: PoolOptions): Promise<PoolResult> {
  const body = JSON.stringify({
    messages: foldSystem(messages, opts.system),
    model: opts.model ?? "sonnet",
    maxTokens: opts.maxTokens ?? 2048,
    ...(opts.image ? { image: opts.image } : {}),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 185_000);
  // let an external signal (interrupt) abort this request too
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const res = await fetch(opts.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.key}` },
      body,
      signal: controller.signal,
    });
    const raw = await res.text();
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false, status: res.status, error: `pool bad response (${res.status}): ${raw.slice(0, 120)}` };
    }
    if (json.success && typeof json.result === "string") {
      return { ok: true, text: json.result, account: json.account, status: res.status };
    }
    // The pool reports errors as a string or a nested object — flatten so callers can show it.
    const err = json.error?.message ?? json.error?.type ?? json.error ?? json.message;
    return {
      ok: false,
      status: res.status,
      error: typeof err === "string" ? err : `pool HTTP ${res.status}: ${JSON.stringify(err ?? json).slice(0, 200)}`,
      account: json.account,
    };
  } catch (e: any) {
    return { ok: false, error: e?.name === "AbortError" ? "aborted" : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deliver an assistant turn, reporting the text through `onDelta` as it becomes available.
 *
 * This used to stream tokens from `/v1/chat/completions` (SSE `choices[].delta.content`) and fall
 * back to `callPool` only when the stream came back empty. That is no longer the primary path, and
 * the reason is worth stating precisely, because the SSE route LOOKS healthier than it is.
 *
 * Two independent defects, both measured 17/08 over three sequential attempts per cell:
 *
 *   1. It frequently returns nothing at all — HTTP 200, one chunk carrying `delta:{}` and
 *      `finish_reason:"stop"`, then `[DONE]`. gemini-3.7/3.6/3.5-flash 0/3 non-empty, 2.5-pro and
 *      2.5-flash 1/3, while the non-streaming route answered every time. So this is the route, not
 *      one bad model — switching models only changes how often you lose, a mistake made here once
 *      already when the brain was moved to gemini-2.5-flash on the strength of ONE lucky sample.
 *
 *   2. Worse, when it DOES return text, that text does not honor the tool protocol. Asked to list a
 *      directory with the real 31k prompt, the SSE route emitted `TOOL_CALL:` in 0/3 attempts for
 *      gemini-3.7-flash — with the prompt as a system message AND with it folded into the user turn
 *      (see `foldSystem` for the full channel table). The non-streaming `/v1/claude` route: 3/3.
 *
 * Defect 2 is the one that hid, because defect 1 masked it: the old empty-stream fallback fired ~2/3
 * of the time and those turns worked, so the brain appeared functional while every turn that got a
 * non-empty stream silently lost its tool call. That is the measured cause of the standing E2E
 * failure "a tool actually ran against the box — no completed tool-call in 60s".
 *
 * So the reliable channel is the only channel used. The cost is real and named: token-by-token
 * streaming is gone, and the whole answer arrives as one delta (callers doing typewriter output still
 * animate). Restoring it needs a pool-side fix to `/v1/chat/completions`, not a change here; the
 * previous SSE reader is in git history, one revert away, should that route start honoring prompts.
 */
export async function streamPool(
  messages: PoolMessage[],
  opts: PoolOptions,
  onDelta: (chunk: string) => void,
): Promise<PoolResult> {
  const plain = await callPool(messages, opts);
  if (plain.ok && (plain.text ?? "").trim()) onDelta(plain.text ?? "");
  return plain;
}

/** GET /v1/health (no key) — returns the live pool roster. */
export async function poolHealth(baseUrl: string): Promise<unknown> {
  const healthUrl = baseUrl.replace(/\/v1\/claude$/, "/v1/health");
  const res = await fetch(healthUrl);
  return res.json();
}
