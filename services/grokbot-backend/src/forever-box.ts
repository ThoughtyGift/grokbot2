/**
 * Forever box — the status object that drives the VNC workspace pane.
 *
 * This, not `EnsureSandBox`, is what the viewer reads. The renderer keeps a per-agent box
 * store fed by `getForeverBoxStatus` / `ensureForeverBox` and opens the `<webview>` only when
 * `state === "running"` and `vncUrl` is a non-empty string (client bundle: `N2e`/`qoe`).
 * Anything else renders a placeholder instead:
 *
 *   pull != null            → "Setting up the computer"
 *   state running, no url   → "Booting up the computer"   (phase "local")
 *   read/ensure rejected    → "Can't reach <name>'s screen"
 *
 * Two details are easy to get wrong and both fail silently:
 *   - the reply must carry `agentId`; the store files the status under `status.agentId`, so a
 *     reply without it lands under `undefined` and the watched agent never leaves "off";
 *   - `vncUrl` is opened as given, with `autoconnect`/`resize`/`reconnect`/`sandInteractive`
 *     appended. The preload only installs the clipboard, liveness and chrome-hiding bridges on
 *     a path ending in `/vnc.html`, so the URL has to be the full noVNC page.
 *
 * See docs/box-architecture.md for the real descriptor this mirrors.
 */

/**
 * Full noVNC page URL for the box, e.g. `https://host/flowvnc-grokbox/vnc.html?path=…`.
 * Read per call, not captured at import, so it does not depend on this module being
 * evaluated after config.ts has loaded `.env`.
 */
const boxVncUrl = (): string | null => process.env.GROKBOT2_VNC_URL ?? null;

/**
 * A pending "you drive for a moment" request. The renderer turns this into the
 * `sand-box-handoff-card` — a snapshot with the instruction and a **Take over the computer**
 * button that opens the viewer; the user finishes the step (typically a sign-in) and hands
 * back. All three field names are the client's (`handoff.instruction / requestId /
 * snapshotDataUrl`); `snapshotDataUrl` is optional and only decorates the card.
 *
 * The original is explicit about why this exists at all: the agent "never asks for, sees, or
 * types their password or 2FA; they authenticate on the box desktop, and the session persists
 * there, so it is a one-time step."
 */
export interface BoxHandoff { instruction: string; requestId: string; snapshotDataUrl?: string }

export type ForeverBoxStatus = {
  agentId: string;
  state: "running" | "off";
  windows: never[];
  handoff: BoxHandoff | null;
  vncUrl?: string;
};

/**
 * Pending handoff per agent, and what to run once the user hands the box back.
 *
 * The card itself is data and is persisted by chat.ts (`parked`). The resolver is a live
 * Promise callback and cannot be — so after a restart there is no turn left to resolve, and
 * hand-back has to re-enter the model loop instead. That is what `handBackSink` is for:
 * resolver when the turn is still in flight, sink when it is not.
 */
const handoffs = new Map<string, BoxHandoff>();
const resumers = new Map<string, (outcome: string) => void>();
let handoffSeq = 1;

let handBackSink: (agentId: string, outcome: string) => void = () => {};
export function setHandBackSink(fn: (agentId: string, outcome: string) => void): void { handBackSink = fn; }

/** Re-arm the card after a restart, from the persisted copy. */
export function restoreHandoff(agentId: string, handoff: BoxHandoff): void {
  handoffs.set(agentId, handoff);
  const n = Number(/^boxhelp-(\d+)$/.exec(handoff.requestId)?.[1] ?? 0);
  if (n >= handoffSeq) handoffSeq = n + 1;
}

/** What chat.ts persists so the card survives a restart. */
export const handoffEntries = (): [string, BoxHandoff][] => [...handoffs.entries()];

/**
 * Ask the user to take the screen (`request_box_help` in the original catalog). Resolves when
 * they hand back, or immediately if a handoff is already pending for this agent.
 */
export function requestBoxHelp(agentId: string, instruction: string, snapshotDataUrl?: string): Promise<string> {
  if (handoffs.has(agentId)) return Promise.resolve("(đã có một yêu cầu bàn giao đang chờ)");
  const handoff: BoxHandoff = {
    instruction,
    requestId: `boxhelp-${handoffSeq++}`,
    ...(snapshotDataUrl ? { snapshotDataUrl } : {}),
  };
  handoffs.set(agentId, handoff);
  return new Promise((resolve) => resumers.set(agentId, resolve));
}

/** The user pressed hand-back. Clears the card and lets the waiting turn continue. */
export function handBackBox(args: { id?: unknown; agentId?: unknown; trigger?: unknown }): Record<string, never> {
  const agentId = boxId(args);
  const trigger = typeof args?.trigger === "string" ? args.trigger : "button";
  handoffs.delete(agentId);
  const outcome = `người dùng đã xong trên màn hình box (${trigger})`;
  const resume = resumers.get(agentId);
  if (resume) {
    resumers.delete(agentId);
    resume(outcome);          // the turn is still in flight — let the awaiting tool return
  } else {
    handBackSink(agentId, outcome);   // restarted since — resume from the persisted history
  }
  return {};
}

/** True while a handoff card is on screen for this agent. */
export const hasPendingHandoff = (agentId: string): boolean => handoffs.has(agentId);

/** The renderer sends `{id}`; accept `agentId` too rather than trust one spelling. */
function boxId(args: { id?: unknown; agentId?: unknown } | null | undefined): string {
  const raw = args?.id ?? args?.agentId;
  return typeof raw === "string" ? raw : "";
}

/**
 * Status for one agent's box. Reports "off" rather than a running box with no screen when
 * GROKBOT2_VNC_URL is unset, so the pane says "Booting up" instead of claiming a live desktop.
 */
export function foreverBoxStatus(args: { id?: unknown; agentId?: unknown }): ForeverBoxStatus {
  const agentId = boxId(args);
  const handoff = handoffs.get(agentId) ?? null;
  const vncUrl = boxVncUrl();
  if (vncUrl == null) return { agentId, state: "off", windows: [], handoff };
  return { agentId, state: "running", vncUrl, windows: [], handoff };
}

/** Warn at boot about a URL the viewer will accept but the preload bridges will skip. */
export function reportBoxConfig(log: (msg: string) => void): void {
  const vncUrl = boxVncUrl();
  if (vncUrl == null) {
    log("[box] GROKBOT2_VNC_URL not set — the computer pane will stay empty.");
    return;
  }
  log(`[box] VNC ${vncUrl}`);
  try {
    if (!new URL(vncUrl).pathname.endsWith("/vnc.html")) {
      log("[box] warning: GROKBOT2_VNC_URL does not end in /vnc.html — clipboard, liveness and");
      log("[box]          control-bar hiding are skipped for any other path.");
    }
  } catch {
    log("[box] warning: GROKBOT2_VNC_URL is not a valid URL — the viewer will refuse to open it.");
  }
}
