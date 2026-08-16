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

export type ForeverBoxStatus = {
  agentId: string;
  state: "running" | "off";
  windows: never[];
  handoff: null;
  vncUrl?: string;
};

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
  const vncUrl = boxVncUrl();
  if (vncUrl == null) return { agentId, state: "off", windows: [], handoff: null };
  return { agentId, state: "running", vncUrl, windows: [], handoff: null };
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
