/**
 * pool-client — thin HTTP client for the OpenClaw Claude pool (admin.halcion.vn/v1/claude).
 *
 * The pool runs Claude via subscription CLI accounts with load-balancing + failover,
 * so this is a drop-in "brain" that costs no per-token API fees.
 * Contract: POST { prompt | messages, system?, model?, maxTokens? } -> { success, result }.
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

/** Call the pool once and return the full assistant text (non-streaming). */
export async function callPool(messages: PoolMessage[], opts: PoolOptions): Promise<PoolResult> {
  const body = JSON.stringify({
    messages,
    system: opts.system,
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
    return { ok: false, status: res.status, error: json.error ?? `pool HTTP ${res.status}`, account: json.account };
  } catch (e: any) {
    return { ok: false, error: e?.name === "AbortError" ? "aborted" : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Real token streaming via the pool's OpenAI-compatible route
 * (`/v1/chat/completions` with `stream:true` → SSE `choices[].delta.content`).
 * Falls back to the caller's non-streaming path if the route or key is unavailable.
 */
export async function streamPool(
  messages: PoolMessage[],
  opts: PoolOptions,
  onDelta: (chunk: string) => void,
): Promise<PoolResult> {
  const url = opts.url.replace(/\/v1\/claude$/, "/v1/chat/completions");
  const body = JSON.stringify({
    model: opts.model ?? "sonnet",
    messages: opts.system ? [{ role: "system", content: opts.system }, ...messages] : messages,
    stream: true,
    max_tokens: opts.maxTokens ?? 2048,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 185_000);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.key}` },
      body,
      signal: controller.signal,
    });
    if (!res.ok || !res.body) return { ok: false, status: res.status, error: `stream HTTP ${res.status}` };

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const piece = JSON.parse(data)?.choices?.[0]?.delta?.content;
          if (typeof piece === "string" && piece) { full += piece; onDelta(piece); }
        } catch { /* keep-alive or partial frame */ }
      }
    }
    return { ok: true, text: full, status: res.status };
  } catch (e: any) {
    return { ok: false, error: e?.name === "AbortError" ? "aborted" : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** GET /v1/health (no key) — returns the live pool roster. */
export async function poolHealth(baseUrl: string): Promise<unknown> {
  const healthUrl = baseUrl.replace(/\/v1\/claude$/, "/v1/health");
  const res = await fetch(healthUrl);
  return res.json();
}
