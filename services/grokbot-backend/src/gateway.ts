/**
 * Box gateway (JSON) — the `/gw/*` surface the frontend polls once it has a
 * sandbox descriptor. Returning healthy shapes here is what lets the app show
 * its main window. Chat methods delegate to the chat bridge.
 */
import type { ServerResponse } from "node:http";
import {
  createAgent,
  listAgents,
  countAgents,
  transcriptTail,
  sendPrompt,
  setUpdateSink,
  type SendArgs,
} from "./chat.js";

const sseClients = new Set<ServerResponse>();

// Push a nudge so the frontend re-fetches the transcript when chat updates.
setUpdateSink((agentId) => {
  const line = `data: ${JSON.stringify({ kind: "transcript-updated", agentId })}\n\n`;
  for (const r of sseClients) {
    try {
      r.write(line);
    } catch {
      /* client gone */
    }
  }
});
setInterval(() => {
  for (const r of sseClients) {
    try {
      r.write(": ping\n\n");
    } catch {
      /* client gone */
    }
  }
}, 5000);

const HOST_SETTINGS = {
  notifications: { isEnabled: false },
  mcpCustomInstructions: "",
  mcpCustomInstructionsByServerId: {},
  mcpDisabledToolsByServerId: {},
  mcpBoxServers: [],
  autoReviewInstructions: { isEnabled: false, allowInstructions: [], blockInstructions: [] },
  localToolPermission: "ask",
  webauthnProxyEnabled: false,
  userTimeZone: "UTC",
  sidebarSections: [],
  hasSeenOnboarding: true,
};

/** Gateway JSON method -> response value. Unknown methods return {}. */
const methods: Record<string, (args: any) => unknown> = {
  getHostSettings: () => HOST_SETTINGS,
  setHostSettings: () => ({}),
  getHostStatus: () => ({ isBusy: false, capabilities: {}, current: "applied", version: "0.20.0", state: "current" }),
  listAgents: () => listAgents(),
  countAgents: () => countAgents(),
  createAgent: (a) => createAgent(a),
  sendPrompt: (a: SendArgs) => sendPrompt(a),
  getAgentTranscriptTail: (a) => transcriptTail(a?.agentId),
  openAgentTail: (a) => transcriptTail(a?.agentId),
  getAgentTranscript: (a) => transcriptTail(a?.agentId),
  getAgentTranscriptPage: (a) => transcriptTail(a?.agentId),
  getAgentThread: (a) => transcriptTail(a?.agentId),
  getTrays: () => [],
  clearTrays: () => ({}),
  skillsCatalog: () => [],
  syncPluginSkills: () => [],
  getPluginSyncStatus: () => ({}),
  getListenerIntegrations: () => ({}),
  getTeachRecordingStatus: () => ({ isRecording: false }),
  listBoxMcpServers: () => ({ servers: [] }),
  getBoxSecretsStatus: () => ({}),
  setBoxSecrets: () => ({}),
  setWindowFocused: () => ({}),
  getSharingState: () => ({}),
  isGlobalSearchEnabled: () => false,
  isEgressTunnelAvailable: () => false,
  isAgentNetworkEnabled: () => false,
  getForeverBoxStatus: () => ({ status: "disabled" }),
};

/** Returns true if it handled the request. */
export function handleGateway(url: string, body: Buffer, res: ServerResponse): boolean {
  if (!url.startsWith("/gw/")) return false;

  if (url.startsWith("/gw/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "healthy", ok: true }));
    return true;
  }
  if (url.startsWith("/gw/events")) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(": connected\n\n");
    res.write('event: ready\ndata: {"kind":"ready"}\n\n');
    sseClients.add(res);
    res.on("close", () => sseClients.delete(res));
    return true;
  }
  if (url.startsWith("/gw/webauthn/requests")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ frames: [] }));
    return true;
  }
  const m = url.match(/\/gw\/api\/([A-Za-z]+)/);
  if (m) {
    let args: any = {};
    if (body.length) {
      try {
        args = JSON.parse(body.toString("utf8"));
      } catch {
        /* keep {} */
      }
    }
    const fn = methods[m[1]];
    let val: unknown = {};
    try {
      val = fn ? fn(args) : {};
    } catch (e) {
      console.error(`[gateway] ${m[1]} threw:`, e);
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(val));
    return true;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end("{}");
  return true;
}
