/**
 * Client for the box exec daemon (`infra/vps/exec-daemon.mjs`), or the computer process proxy.
 *
 * Deliberately has no local fallback. Shell and file tools must run inside the box, so
 * with no box configured they report unavailable rather than quietly executing on the
 * machine the desktop app happens to be running on.
 *
 * When `GROKBOT2_COMPUTER_URL` is set, this process does not talk to the daemon — the computer
 * service does (ROADMAP §5.5). A set URL that is down is `computer down`, not a silent hop to
 * the daemon.
 */
import { currentOwner } from "./request-context.js";

const daemonBase = (): string => process.env.GROKBOT2_BOX_EXEC_URL ?? "";
const computerBase = (): string => (process.env.GROKBOT2_COMPUTER_URL ?? "").replace(/\/$/, "");
const TOKEN = (): string => process.env.GROKBOT2_EXEC_TOKEN ?? "";
const TIMEOUT_MS = (): number => Number(process.env.GROKBOT2_BOX_TIMEOUT_MS ?? 90_000);

export const boxConfigured = (): boolean => Boolean(computerBase() || daemonBase());

export class BoxUnavailable extends Error {}

async function viaComputer<T>(op: string, args: Record<string, unknown>): Promise<T> {
  const base = computerBase();
  const timeout = TIMEOUT_MS();
  try {
    const res = await fetch(`${base}/internal/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op, args }),
      signal: AbortSignal.timeout(timeout),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      throw new BoxUnavailable(
        typeof json.error === "string" ? json.error : `computer ${op} -> HTTP ${res.status}`,
      );
    }
    if (json && typeof json === "object" && "error" in json && json.error) throw new Error(String(json.error));
    return json as T;
  } catch (e) {
    if (e instanceof BoxUnavailable) throw e;
    if ((e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError") {
      throw new BoxUnavailable(`computer ${op} quá ${timeout}ms không phản hồi`);
    }
    throw new BoxUnavailable(`computer down — ${(e as Error).message}`);
  }
}

async function viaDaemon<T>(op: string, args: Record<string, unknown>): Promise<T> {
  const BASE = daemonBase();
  if (!BASE) {
    throw new BoxUnavailable(
      "Chưa nối box: đặt GROKBOT2_BOX_EXEC_URL (và GROKBOT2_EXEC_TOKEN) trỏ tới exec daemon. " +
      "Công cụ shell/file chỉ chạy trong box, không chạy trên máy này.",
    );
  }
  const timeout = TIMEOUT_MS();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`${BASE.replace(/\/+$/, "")}/${op}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(TOKEN() ? { authorization: `Bearer ${TOKEN()}` } : {}),
        /*
         * Ai đang gọi. Box dùng nó để chạy lệnh dưới tài khoản hệ điều hành của đúng người đó
         * (chặng 5, tầng 1) — xem `infra/vps/exec-daemon.mjs`.
         *
         * Gửi kể cả khi box chưa bật tách: một header dư thì bị bỏ qua, còn thiếu nó lúc box đã bật
         * thì mọi công cụ hỏng cùng lúc. Rẻ hơn nhiều so với một cờ phải nhớ đồng bộ ở hai đầu.
         */
        "x-grokbot2-owner": currentOwner(),
      },
      body: JSON.stringify(args),
      signal: ctl.signal,
    });
    if (!res.ok) throw new BoxUnavailable(`box ${op} -> HTTP ${res.status}`);
    const json = (await res.json()) as T & { error?: string };
    if (json && typeof json === "object" && "error" in json && json.error) throw new Error(String(json.error));
    return json;
  } catch (e) {
    if (e instanceof BoxUnavailable) throw e;
    if ((e as Error)?.name === "AbortError") throw new BoxUnavailable(`box ${op} quá ${timeout}ms không phản hồi`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Call one daemon op. Throws BoxUnavailable when there is no box to call. */
export async function boxCall<T = any>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  if (computerBase()) return viaComputer<T>(op, args);
  return viaDaemon<T>(op, args);
}

/** One-shot reachability probe, used at startup so the log states the truth. */
export async function boxHealth(): Promise<string> {
  const cu = computerBase();
  if (cu) {
    try {
      const h = await boxCall<{ root: string; info: string }>("health");
      return `box: via computer ${cu} OK root=${h.root}`;
    } catch (e) {
      return `box: computer ${cu} — ${(e as Error).message}`;
    }
  }
  if (!daemonBase()) return "box: chưa cấu hình (công cụ shell/file sẽ báo unavailable)";
  try {
    const h = await boxCall<{ root: string; info: string }>("health");
    return `box: OK ${daemonBase()} root=${h.root}`;
  } catch (e) {
    return `box: KHÔNG tới được ${daemonBase()} — ${(e as Error).message}`;
  }
}
