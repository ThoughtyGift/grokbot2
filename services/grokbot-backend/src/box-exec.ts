/**
 * Client for the box exec daemon (`infra/vps/exec-daemon.mjs`).
 *
 * Deliberately has no local fallback. Shell and file tools must run inside the box, so
 * with no box configured they report unavailable rather than quietly executing on the
 * machine the desktop app happens to be running on.
 */
const BASE = process.env.GROKBOT2_BOX_EXEC_URL ?? "";
const TOKEN = process.env.GROKBOT2_EXEC_TOKEN ?? "";
const TIMEOUT_MS = Number(process.env.GROKBOT2_BOX_TIMEOUT_MS ?? 90_000);

export const boxConfigured = (): boolean => Boolean(BASE);

export class BoxUnavailable extends Error {}

/** Call one daemon op. Throws BoxUnavailable when there is no box to call. */
export async function boxCall<T = any>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!BASE) {
    throw new BoxUnavailable(
      "Chưa nối box: đặt GROKBOT2_BOX_EXEC_URL (và GROKBOT2_EXEC_TOKEN) trỏ tới exec daemon. " +
      "Công cụ shell/file chỉ chạy trong box, không chạy trên máy này."
    );
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE.replace(/\/+$/, "")}/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
      body: JSON.stringify(args),
      signal: ctl.signal,
    });
    if (!res.ok) throw new BoxUnavailable(`box ${op} -> HTTP ${res.status}`);
    const json = (await res.json()) as T & { error?: string };
    if (json && typeof json === "object" && "error" in json && json.error) throw new Error(String(json.error));
    return json;
  } catch (e) {
    if (e instanceof BoxUnavailable) throw e;
    if ((e as Error)?.name === "AbortError") throw new BoxUnavailable(`box ${op} quá ${TIMEOUT_MS}ms không phản hồi`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** One-shot reachability probe, used at startup so the log states the truth. */
export async function boxHealth(): Promise<string> {
  if (!BASE) return "box: chưa cấu hình (công cụ shell/file sẽ báo unavailable)";
  try {
    const h = await boxCall<{ root: string; info: string }>("health");
    return `box: OK ${BASE} root=${h.root}`;
  } catch (e) {
    return `box: KHÔNG tới được ${BASE} — ${(e as Error).message}`;
  }
}
