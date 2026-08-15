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
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 185_000);
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
    return { ok: false, error: e?.name === "AbortError" ? "pool timeout" : String(e) };
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
