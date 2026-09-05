/**
 * Forever-box session state for the computer process.
 *
 * Who is using the screen, pending handoff cards, and the VNC URL. Release timers, transcript
 * cards and in-flight Promises stay on the BFF (same cut as P4: seq/park stay on the BFF).
 *
 * Status always carries `agentId`. A reply without it lands under `undefined` in the client's
 * store and the pane never leaves "Booting up the computer".
 */

export interface BoxHandoff { instruction: string; requestId: string; snapshotDataUrl?: string }

export type ForeverBoxStatus = {
  agentId: string;
  state: "running" | "off";
  windows: never[];
  handoff: BoxHandoff | null;
  vncUrl?: string | null;
  /**
   * Có màn hình để xem hay không — khác hẳn với "đang có ai dùng".
   *
   * `state: "off"` xảy ra ở HAI tình huống trái ngược: chưa cấu hình `GROKBOT2_VNC_URL`, hoặc đã
   * cấu hình mà lúc này không bot nào chiếm màn hình. Payload cũ không phân biệt được, nên FE hiện
   * "Chưa có VNC" ngay cả khi URL đã có — một câu sai dẫn người dùng đi cấu hình lại thứ vốn đúng.
   * App gốc phân biệt rõ: rảnh thì hiện icon màn hình, mất kết nối mới nói "Can't reach".
   */
  screenConfigured: boolean;
};

const computerUsers = new Set<string>();
const handoffs = new Map<string, BoxHandoff>();
let handoffSeq = 1;

const boxVncUrl = (): string | null => process.env.GROKBOT2_VNC_URL ?? null;

function boxId(args: { id?: unknown; agentId?: unknown } | null | undefined): string {
  const raw = args?.id ?? args?.agentId;
  return typeof raw === "string" ? raw : "";
}

/** Add this agent to the set of users. Returns whether this was the off → running edge. */
export function begin(agentId: string): { added: boolean } {
  if (!agentId) return { added: false };
  const added = !computerUsers.has(agentId);
  computerUsers.add(agentId);
  return { added };
}

/** Drop this agent from the set. The BFF calls this when its release timer fires. */
export function release(agentId: string): { removed: boolean } {
  if (!agentId) return { removed: false };
  const removed = computerUsers.delete(agentId);
  return { removed };
}

export function startHandoff(body: {
  agentId?: unknown;
  instruction?: unknown;
  requestId?: unknown;
  snapshotDataUrl?: unknown;
}): BoxHandoff | null {
  const agentId = typeof body.agentId === "string" ? body.agentId : "";
  if (!agentId) return null;
  const existing = handoffs.get(agentId);
  if (existing) return existing;
  const instruction = typeof body.instruction === "string" ? body.instruction : "";
  const requestId = typeof body.requestId === "string" && body.requestId
    ? body.requestId
    : `boxhelp-${handoffSeq++}`;
  const n = Number(/^boxhelp-(\d+)$/.exec(requestId)?.[1] ?? 0);
  if (n >= handoffSeq) handoffSeq = n + 1;
  const snapshot = typeof body.snapshotDataUrl === "string" ? body.snapshotDataUrl : undefined;
  const handoff: BoxHandoff = {
    instruction,
    requestId,
    ...(snapshot ? { snapshotDataUrl: snapshot } : {}),
  };
  handoffs.set(agentId, handoff);
  return handoff;
}

export function clearHandoff(agentId: string): { cleared: boolean } {
  if (!agentId) return { cleared: false };
  return { cleared: handoffs.delete(agentId) };
}

export function status(args: { id?: unknown; agentId?: unknown }): ForeverBoxStatus {
  const agentId = boxId(args);
  const handoff = handoffs.get(agentId) ?? null;
  const vncUrl = boxVncUrl();
  const screenConfigured = vncUrl != null;
  // `SandForeverBoxStatus` 0.43 bắt buộc `vncUrl` (null khi chưa có màn) — coordinator 0.43 kiểm reply theo schema.
  if (vncUrl == null) return { agentId, state: "off", vncUrl: null, windows: [], handoff, screenConfigured };
  // Đã cấu hình nhưng không ai đang dùng: vẫn `off`, nhưng `screenConfigured` cho FE nói đúng.
  if (!computerUsers.has(agentId) && handoff == null) return { agentId, state: "off", vncUrl: null, windows: [], handoff, screenConfigured };
  return { agentId, state: "running", vncUrl, windows: [], handoff, screenConfigured };
}

export function reportVnc(log: (msg: string) => void): void {
  const vncUrl = boxVncUrl();
  if (vncUrl == null) {
    log("[box] GROKBOT2_VNC_URL not set — the computer pane will stay empty.");
    return;
  }
  const redacted = vncUrl.replace(/([?&](?:password|passwd|pwd|token|auth)=)[^&\s]*/gi, "$1***");
  log(`[box] VNC ${redacted}`);
  try {
    if (!new URL(vncUrl).pathname.endsWith("/vnc.html")) {
      log("[box] warning: GROKBOT2_VNC_URL does not end in /vnc.html — clipboard, liveness and");
      log("[box]          control-bar hiding are skipped for any other path.");
    }
  } catch {
    log("[box] warning: GROKBOT2_VNC_URL is not a valid URL — the viewer will refuse to open it.");
  }
}
