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

/**
 * Lỗi router trả về (`{error, code?}`) → câu cho ĐÚNG người đọc.
 *
 * `pool exhausted … create more gb2u* accounts` là câu viết cho quản trị viên, và nó từng hiện ra
 * trước mặt người dùng thứ 6 dưới dạng "mọi tool box hỏng cùng lúc" (§5 mục 12). Người dùng cần biết
 * hai điều: không phải lỗi của họ, và ai sửa được. Số đếm giữ lại để quản trị viên đọc log biết dải
 * còn bao nhiêu.
 */
export function loiBox(json: { error?: unknown; code?: string; used?: number; size?: number }): Error {
  if (json.code === "pool-exhausted") {
    return new BoxUnavailable(
      `Máy tính của bot chưa có chỗ cho tài khoản của bạn: dải tài khoản trên máy đã cấp hết `
      + `(${json.used ?? "?"}/${json.size ?? "?"}). Không phải lỗi của bạn — báo quản trị viên thêm tài khoản `
      + `gb2u*; các tool máy tính (shell, file, trình duyệt) sẽ dùng được ngay sau đó.`,
    );
  }
  return new Error(String(json.error));
}

async function viaComputer<T>(op: string, args: Record<string, unknown>): Promise<T> {
  const base = computerBase();
  const timeout = TIMEOUT_MS();
  try {
    const res = await fetch(`${base}/internal/exec`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        /*
         * Ai đang gọi — và đây là chỗ nó từng RƠI MẤT.
         *
         * `viaDaemon` ngay bên dưới có header này, kèm nguyên một comment giải thích vì sao phải
         * luôn gửi: "thiếu nó lúc box đã bật thì mọi công cụ hỏng cùng lúc". Đường này thì không
         * có — và khi box bật `GROKBOT2_PER_USER=1`, đúng điều đó xảy ra.
         *
         * Đo ngày 28/08 trong lượt E2E thật: mọi lời gọi `run_terminal_command_v2` trả
         * `per-user mode: request carried no owner`, nên bot không chạy được một lệnh nào trên box
         * của chính nó. Ba case kịch bản cần quay màn hình đều hụt attachment vì lý do này, và
         * nhìn từ ngoài nó giống hệt "bot kém hơn app gốc".
         *
         * Bài học: một comment đúng chỉ bảo vệ được đúng nhánh mà nó đứng cạnh. Hai đường ra cùng
         * một cái box thì phải mang cùng một danh tính, nếu không cái nào chưa dùng sẽ mục.
         */
        "x-grokbot2-owner": currentOwner(),
      },
      body: JSON.stringify({ op, args }),
      signal: AbortSignal.timeout(timeout),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string; used?: number; size?: number };
    if (!res.ok) {
      throw new BoxUnavailable(
        typeof json.error === "string" ? json.error : `computer ${op} -> HTTP ${res.status}`,
      );
    }
    if (json && typeof json === "object" && "error" in json && json.error) throw loiBox(json);
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
    const json = (await res.json()) as T & { error?: string; code?: string; used?: number; size?: number };
    if (json && typeof json === "object" && "error" in json && json.error) throw loiBox(json);
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
