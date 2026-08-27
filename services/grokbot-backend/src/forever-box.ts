/**
 * Forever box — the status object that drives the VNC workspace pane.
 *
 * This, not `EnsureSandBox`, is what the viewer reads. The renderer keeps a per-agent box
 * store fed by `getForeverBoxStatus` / `ensureForeverBox` and opens the `<webview>` only when
 * `state === "running"` and `vncUrl` is a non-empty string (client bundle: `N2e`/`qoe`).
 *
 * Two details are easy to get wrong and both fail silently:
 *   - the reply must carry `agentId`; the store files the status under `status.agentId`, so a
 *     reply without it lands under `undefined` and the watched agent never leaves "off";
 *   - `vncUrl` is opened as given. The preload only installs the clipboard bridges on a path
 *     ending in `/vnc.html`.
 *
 * When `GROKBOT2_COMPUTER_URL` is set, who-is-using / VNC / handoff *data* live on
 * `services/grokbot-computer`. This module keeps the release timer, in-flight Promises, transcript
 * sinks and SSE publish (seq stays on the BFF). URL unset = in-process maps (e2e that spawn one
 * BFF). URL set but down = `{ agentId, state: "off" }` — pane off, never a 500 on sendPrompt.
 *
 * See docs/architecture/box-architecture.md for the real descriptor this mirrors.
 */
import { redact } from "./redact.js";
import { publish } from "./events.js";
import { slotVncUrl, ensureDisplay, perBotDisplays } from "./displays.js";

/**
 * Màn hình của MỘT bot — của riêng nó nếu nó có slot, còn không thì màn dùng chung.
 *
 * `getForeverBoxStatus` vốn đã hỏi theo từng `agentId`, nên chỗ này không cần client đổi gì: mỗi
 * bot nhận một địa chỉ khác nhau qua đúng cái RPC nó vẫn gọi. Đó là lý do chặng 5 gọn hơn vẻ ngoài
 * — phần khó nằm ở việc **dựng** noVNC cho từng slot (`displays.ts`), không ở việc giao nó.
 *
 * Không có slot thì trả màn dùng chung: một bot chạy trên Chrome chung vẫn phải nhìn thấy được.
 */
const boxVncUrl = (agentId?: string): string | null =>
  (agentId ? slotVncUrl(agentId) : null) ?? process.env.GROKBOT2_VNC_URL ?? null;

const computerBase = (): string => (process.env.GROKBOT2_COMPUTER_URL ?? "").replace(/\/$/, "");

export interface BoxHandoff { instruction: string; requestId: string; snapshotDataUrl?: string }

export type ForeverBoxStatus = {
  agentId: string;
  state: "running" | "off";
  windows: never[];
  handoff: BoxHandoff | null;
  vncUrl?: string;
  /** Có màn hình cấu hình hay không — xem chú thích ở nơi dựng status. */
  screenConfigured?: boolean;
};

const handoffs = new Map<string, BoxHandoff>();
const resumers = new Map<string, (outcome: string) => void>();
let handoffSeq = 1;

const computerUsers = new Set<string>();

const RELEASE_AFTER_MS = Number(process.env.GROKBOT2_COMPUTER_RELEASE_MS ?? 120_000);
const releaseTimers = new Map<string, NodeJS.Timeout>();

let onComputerReleased: ((agentId: string) => void) | null = null;
export const setComputerReleaseSink = (fn: (agentId: string) => void): void => { onComputerReleased = fn; };

const statusChanged = (agentId: string): void => {
  if (agentId) publish({ type: "computer.status", agentId });
};

function offStatus(agentId: string): ForeverBoxStatus {
  return { agentId, state: "off", windows: [], handoff: handoffs.get(agentId) ?? null };
}

async function computerRpc(path: string, body: unknown, timeoutMs = 2500): Promise<Record<string, unknown> | null> {
  const base = computerBase();
  if (!base) return null;
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `computer HTTP ${res.status}`);
  return json;
}

/** This agent has started using the computer (a browser action, or a handoff it must watch). */
export async function beginComputerUse(agentId: string): Promise<void> {
  if (!agentId) return;
  const t = releaseTimers.get(agentId);
  if (t) { clearTimeout(t); releaseTimers.delete(agentId); }
  /*
   * Xin luôn màn riêng — "ensure" phải thật sự ensure.
   *
   * Trước đây slot chỉ được cấp khi bot **tự** chạm vào trình duyệt. Nên người dùng mở khung máy
   * tính (đúng lúc cần nhìn màn nhất) lại nhận địa chỉ màn **dùng chung**, và muốn đăng nhập một
   * lần vào Shopee trong màn của chính con bot thì không có cách nào tới đó.
   *
   * `ensureDisplay` tự trả lại lease cũ nếu đã có, nên gọi thêm ở đây không dựng thừa cái gì.
   * Không chặn nếu hỏng: khung máy tính vẫn phải mở được với màn dùng chung.
   */
  if (perBotDisplays()) {
    try { await ensureDisplay(agentId); } catch { /* rơi về màn dùng chung */ }
  }
  if (computerBase()) {
    try {
      const r = await computerRpc("/internal/begin", { agentId });
      if (r?.added) statusChanged(agentId);
    } catch {
      // Computer down: pane will report off. Do not throw — chat/tools must keep going.
    }
    return;
  }
  const wasUsing = computerUsers.has(agentId);
  computerUsers.add(agentId);
  if (!wasUsing) statusChanged(agentId);
}

/** Released a couple of minutes after the turn ends — never while a handoff is still on screen. */
export function endComputerUse(agentId: string): void {
  if (!agentId || handoffs.has(agentId) || releaseTimers.has(agentId)) return;
  const timer = setTimeout(() => {
    releaseTimers.delete(agentId);
    if (handoffs.has(agentId)) return;
    void (async () => {
      if (computerBase()) {
        try { await computerRpc("/internal/release", { agentId }); } catch { /* pane off anyway */ }
      } else {
        computerUsers.delete(agentId);
      }
      onComputerReleased?.(agentId);
      statusChanged(agentId);
    })();
  }, RELEASE_AFTER_MS);
  timer.unref?.();
  releaseTimers.set(agentId, timer);
}

export const isUsingComputer = (agentId: string): boolean => computerUsers.has(agentId);

let handBackSink: (agentId: string, outcome: string) => void = () => {};
export function setHandBackSink(fn: (agentId: string, outcome: string) => void): void { handBackSink = fn; }

export function restoreHandoff(agentId: string, handoff: BoxHandoff): void {
  handoffs.set(agentId, handoff);
  const n = Number(/^boxhelp-(\d+)$/.exec(handoff.requestId)?.[1] ?? 0);
  if (n >= handoffSeq) handoffSeq = n + 1;
  if (computerBase()) {
    void computerRpc("/internal/handoff/start", { agentId, ...handoff }).catch(() => { /* retry on next status */ });
  }
}

export const handoffEntries = (): [string, BoxHandoff][] => [...handoffs.entries()];

let onHandoffStart: ((agentId: string, handoff: BoxHandoff) => void) | null = null;
export const setHandoffStartSink = (fn: (agentId: string, handoff: BoxHandoff) => void): void => { onHandoffStart = fn; };

let onHandoffEnd: ((agentId: string, resolution: "handed_back" | "replied" | "dismissed") => void) | null = null;
export const setHandoffEndSink = (fn: (agentId: string, resolution: "handed_back" | "replied" | "dismissed") => void): void => { onHandoffEnd = fn; };

export function requestBoxHelp(agentId: string, instruction: string, snapshotDataUrl?: string): Promise<string> {
  if (handoffs.has(agentId)) return Promise.resolve("(đã có một yêu cầu bàn giao đang chờ)");
  const handoff: BoxHandoff = {
    instruction,
    requestId: `boxhelp-${handoffSeq++}`,
    ...(snapshotDataUrl ? { snapshotDataUrl } : {}),
  };
  handoffs.set(agentId, handoff);
  if (computerBase()) {
    void computerRpc("/internal/handoff/start", { agentId, ...handoff }).catch(() => { /* local card still parks */ });
  }
  onHandoffStart?.(agentId, handoff);
  statusChanged(agentId);
  return new Promise((resolve) => resumers.set(agentId, resolve));
}

export async function handBackBox(args: { id?: unknown; agentId?: unknown; trigger?: unknown }): Promise<Record<string, never>> {
  const agentId = boxId(args);
  const trigger = typeof args?.trigger === "string" ? args.trigger : "button";
  handoffs.delete(agentId);
  if (computerBase()) {
    try { await computerRpc("/internal/handoff/back", { agentId, trigger }); } catch { /* local card already cleared */ }
  }
  statusChanged(agentId);
  onHandoffEnd?.(agentId, "handed_back");
  const outcome = `người dùng đã xong trên màn hình box (${trigger})`;
  const resume = resumers.get(agentId);
  if (resume) {
    resumers.delete(agentId);
    resume(outcome);
  } else {
    handBackSink(agentId, outcome);
  }
  return {};
}

export const hasPendingHandoff = (agentId: string): boolean => handoffs.has(agentId);

function boxId(args: { id?: unknown; agentId?: unknown } | null | undefined): string {
  const raw = args?.id ?? args?.agentId;
  return typeof raw === "string" ? raw : "";
}

function mergeLocalHandoff(st: ForeverBoxStatus): ForeverBoxStatus {
  const local = handoffs.get(st.agentId) ?? null;
  if (!local || st.handoff) return st;
  if (!st.vncUrl) return { ...st, handoff: local };
  return { ...st, handoff: local, state: "running" };
}

export async function foreverBoxStatus(args: { id?: unknown; agentId?: unknown }): Promise<ForeverBoxStatus> {
  const agentId = boxId(args);
  if (computerBase()) {
    try {
      const st = await computerRpc("/internal/status", { id: agentId }) as ForeverBoxStatus;
      if (!st || typeof st.agentId !== "string") return offStatus(agentId);
      const merged = mergeLocalHandoff({ ...st, agentId: st.agentId || agentId, windows: [] });
      if (merged.handoff && !st.handoff) {
        void computerRpc("/internal/handoff/start", { agentId, ...merged.handoff }).catch(() => { /* next poll */ });
      }
      return merged;
    } catch {
      return offStatus(agentId);
    }
  }
  const handoff = handoffs.get(agentId) ?? null;
  const vncUrl = boxVncUrl(agentId);
  // Cùng lý do như services/grokbot-computer/src/session.ts: "off" vì chưa cấu hình và "off" vì
  // không ai đang dùng là hai chuyện khác nhau, và FE phải nói đúng cái nào.
  const screenConfigured = vncUrl != null;
  if (vncUrl == null) return { agentId, state: "off", windows: [], handoff, screenConfigured };
  if (!computerUsers.has(agentId) && handoff == null) return { agentId, state: "off", windows: [], handoff };
  return { agentId, state: "running", vncUrl, windows: [], handoff, screenConfigured };
}

export async function computerHealth(): Promise<string> {
  const base = computerBase();
  if (!base) return "in-process (GROKBOT2_COMPUTER_URL unset)";
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
    const body = r.ok ? await r.json() as { role?: string } : null;
    if (!r.ok) return `HTTP ${r.status} ${base}`;
    return body?.role === "computer" ? `up ${base}` : `up ${base} (role=${body?.role ?? "?"})`;
  } catch (e) {
    return `DOWN ${base} (${(e as Error).message})`;
  }
}

export function reportBoxConfig(log: (msg: string) => void): void {
  const base = computerBase();
  if (base) {
    log(`[box] computer process ${base} (VNC/exec live there, not in this BFF)`);
    void computerHealth().then((s) => log(`[box] computer: ${s}`));
    return;
  }
  const vncUrl = boxVncUrl();
  if (vncUrl == null) {
    log("[box] GROKBOT2_VNC_URL not set — the computer pane will stay empty.");
    return;
  }
  log(`[box] VNC ${redact(vncUrl)}`);
  try {
    if (!new URL(vncUrl).pathname.endsWith("/vnc.html")) {
      log("[box] warning: GROKBOT2_VNC_URL does not end in /vnc.html — clipboard, liveness and");
      log("[box]          control-bar hiding are skipped for any other path.");
    }
  } catch {
    log("[box] warning: GROKBOT2_VNC_URL is not a valid URL — the viewer will refuse to open it.");
  }
}
