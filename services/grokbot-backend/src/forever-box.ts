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
import { redact } from "./redact.js";

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

/**
 * Which agents currently have the computer.
 *
 * The original does NOT give every bot a screen. It scopes the pane to a running `computerUse`
 * subagent — client `CTn` keeps only `status === "running" && subagentType === "computerUse"`
 * and emits one `{subagentId, title, vncUrl}` per session, and the box is retained per
 * `subagentId`. Its own prompt states the model outright:
 *
 *   "the machine is ONE computer shared by all of this user's agents … while the desktop is
 *    per-agent — each agent gets its own screen and browser window on that shared machine, and
 *    no agent sees or drives another's. Never claim each agent has its own machine."
 *
 * We answered `state: "running"` for every agent, so all of them showed the same desktop and a
 * bot idle since yesterday looked as busy as the one working. One X display cannot give each a
 * different picture, but it can tell the truth about WHO is using it: a bot with no session
 * reports "off", exactly as the original shows an idle bot's screen as off.
 */
const computerUsers = new Set<string>();

/**
 * A grace period after the turn ends.
 *
 * Releasing the screen the instant a tool returns measured at ~1.5s of visible pane: the agent
 * navigated, the turn ended, and the pane went dark while the user was still reading the page
 * it had just opened. The point of watching is to see the result, so the screen stays up for a
 * while after the work stops. Any new action cancels the pending release.
 */
const RELEASE_AFTER_MS = 120_000;
const releaseTimers = new Map<string, NodeJS.Timeout>();

/** This agent has started using the computer (a browser action, or a handoff it must watch). */
export const beginComputerUse = (agentId: string): void => {
  if (!agentId) return;
  const t = releaseTimers.get(agentId);
  if (t) { clearTimeout(t); releaseTimers.delete(agentId); }
  computerUsers.add(agentId);
};

/** Released a couple of minutes after the turn ends — never while a handoff is still on screen. */
export const endComputerUse = (agentId: string): void => {
  if (!agentId || handoffs.has(agentId) || releaseTimers.has(agentId)) return;
  const timer = setTimeout(() => {
    releaseTimers.delete(agentId);
    if (!handoffs.has(agentId)) computerUsers.delete(agentId);
  }, RELEASE_AFTER_MS);
  // Do not hold the process open just to turn a screen off.
  timer.unref?.();
  releaseTimers.set(agentId, timer);
};

export const isUsingComputer = (agentId: string): boolean => computerUsers.has(agentId);

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
/**
 * Called with the new request id so the caller can put the matching card in the transcript.
 * Set before the promise is returned, because the tool that awaits it never gets a chance to
 * read a return value.
 */
let onHandoffStart: ((agentId: string, handoff: BoxHandoff) => void) | null = null;
export const setHandoffStartSink = (fn: (agentId: string, handoff: BoxHandoff) => void): void => { onHandoffStart = fn; };

/** Fired whenever a handoff stops being live, so the transcript card can settle. */
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
  onHandoffStart?.(agentId, handoff);
  return new Promise((resolve) => resumers.set(agentId, resolve));
}

/** The user pressed hand-back. Clears the card and lets the waiting turn continue. */
export function handBackBox(args: { id?: unknown; agentId?: unknown; trigger?: unknown }): Record<string, never> {
  const agentId = boxId(args);
  const trigger = typeof args?.trigger === "string" ? args.trigger : "button";
  handoffs.delete(agentId);
  // Always, on both paths below. The transcript card has to stop saying "Action needed"
  // whether the waiting turn is resumed here or restarted from persisted history — hooking it
  // to `handBackSink` alone left it stuck, because that only fires on the restarted path.
  onHandoffEnd?.(agentId, "handed_back");
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
  // Only the agent actually using the computer gets a screen — see `computerUsers`. A pending
  // handoff counts as using it: the whole point of that card is "look at my screen and finish
  // this step", so the pane has to be live even though no tool is mid-flight.
  if (!computerUsers.has(agentId) && handoff == null) return { agentId, state: "off", windows: [], handoff };
  return { agentId, state: "running", vncUrl, windows: [], handoff };
}

/** Warn at boot about a URL the viewer will accept but the preload bridges will skip. */
export function reportBoxConfig(log: (msg: string) => void): void {
  const vncUrl = boxVncUrl();
  if (vncUrl == null) {
    log("[box] GROKBOT2_VNC_URL not set — the computer pane will stay empty.");
    return;
  }
  // Redacted, because this URL carries `password=` in its query string and this line is the
  // reason redact.ts exists: the box's VNC password went into the dev log five times over.
  // The startup line still has to say WHICH url is configured, so only the value is masked.
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
