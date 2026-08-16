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
  setRosterSink,
  updateAgent,
  deleteAgents,
  duplicateAgent,
  setAgentUnread,
  setAgentHiddenFromSidebar,
  interruptAgentRun,
  reactToMessage,
  voteFeedback,
  promptAcceptanceStatus,
  getConversationOutline,
  resolveLocalToolPermission,
  resolveAutoReviewApproval,
  respondToWidget,
  submitSecret,
  dismissWidget,
  setAgentNotificationsEnabled,
  setAgentNotifyOnUpdates,
  setAgentAvatarBytes,
  getAgentAvatar,
  searchAgents,
  kickstartAgent,
  broadcastToAgents,
  getSubagents,
  getAsyncTasks,
  bindHostSettings,
  chatSnapshot,
  type SendArgs,
} from "./chat.js";
import { loadState, scheduleSave } from "./store.js";

/** In-memory notification trays (the FE lists/dismisses these). */
const trays: { id: string; kind: string; title: string; timestampMs: number }[] = [];

/** Every gateway method the FE has called this session — powers GET /gw/__coverage. */
const called = new Set<string>();

/** Persist host settings by piggybacking on the chat snapshot (same state.json). */
const saveSettings = () => scheduleSave(() => ({ ...chatSnapshot(), hostSettings }));

const sseClients = new Set<ServerResponse>();

// Push a nudge so the frontend re-fetches the transcript when chat updates.
const broadcast = (payload: unknown): void => {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const r of sseClients) {
    try { r.write(line); } catch { /* client gone */ }
  }
};
setUpdateSink((agentId) => broadcast({ kind: "transcript-updated", agentId }));
// Roster add/delete: push immediately so the sidebar doesn't wait for its next poll.
setRosterSink(() => broadcast({ kind: "roster-updated" }));
setInterval(() => {
  for (const r of sseClients) {
    try {
      r.write(": ping\n\n");
    } catch {
      /* client gone */
    }
  }
}, 5000);

/** Host settings are persisted in-memory and merged on write (the FE sends partial patches). */
const hostSettings: Record<string, unknown> = {
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
  ...(loadState().hostSettings ?? {}),   // restore persisted settings over the defaults
};
bindHostSettings(() => hostSettings);   // so settings save alongside agents/transcripts

/** Gateway JSON method -> response value. Unknown methods return {}. */
const methods: Record<string, (args: any) => unknown> = {
  getHostSettings: () => hostSettings,
  // FE sends partial patches ({notifications:{…}}, {userTimeZone:…}) — merge, don't discard.
  setHostSettings: (a) => {
    if (a && typeof a === "object") for (const [k, v] of Object.entries(a)) if (v !== undefined) hostSettings[k] = v;
    saveSettings();
    return hostSettings;
  },
  getHostStatus: () => ({ isBusy: false, capabilities: {}, current: "applied", version: "0.20.0", state: "current" }),
  listAgents: () => listAgents(),
  countAgents: () => countAgents(),
  // The client reads `result.agent.id`, so createAgent/duplicateAgent must wrap the record
  // as { agent, transcript } (matches the box host: `return { agent: u, transcript: Gn() }`).
  createAgent: (a) => ({ agent: createAgent(a), transcript: { entries: [], hasMore: false } }),
  updateAgent: (a) => updateAgent(a),
  deleteAgents: (a) => deleteAgents(a),
  duplicateAgent: (a) => {
    const rec = duplicateAgent(a);
    return rec ? { agent: rec, transcript: transcriptTail(rec.id) } : null;
  },
  setAgentUnread: (a) => setAgentUnread(a),
  setAgentHiddenFromSidebar: (a) => setAgentHiddenFromSidebar(a),
  interruptAgentRun: (a) => interruptAgentRun(a),
  sendPrompt: (a: SendArgs) => sendPrompt(a),
  promptAcceptanceStatus: (a) => promptAcceptanceStatus(a),
  reactToMessage: (a) => reactToMessage(a),
  voteFeedback: () => voteFeedback(),
  getConversationOutline: (a) => getConversationOutline(a),
  resolveLocalToolPermission: (a) => resolveLocalToolPermission(a),
  resolveAutoReviewApproval: (a) => resolveAutoReviewApproval(a),
  respondToWidget: (a) => respondToWidget(a),
  submitSecret: (a) => submitSecret(a),
  dismissWidget: (a) => dismissWidget(a),
  getAgentTranscriptTail: (a) => transcriptTail(a),
  openAgentTail: (a) => transcriptTail(a),
  getAgentTranscript: (a) => transcriptTail(a),
  getAgentTranscriptPage: (a) => transcriptTail(a),
  getAgentThread: (a) => transcriptTail(a),
  getTrays: () => trays,
  dismissTray: (a) => { const i = trays.findIndex((t) => t.id === (a?.id ?? a?.trayId)); if (i >= 0) trays.splice(i, 1); return {}; },
  clearTrays: () => { trays.length = 0; return {}; },
  setAgentNotificationsEnabled: (a) => setAgentNotificationsEnabled(a),
  setAgentNotifyOnUpdates: (a) => setAgentNotifyOnUpdates(a),
  setAgentAvatarBytes: (a) => setAgentAvatarBytes(a),
  getAgentAvatar: (a) => getAgentAvatar(a),
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

  // ── P2: real behavior ──
  searchAgents: (a) => searchAgents(a),
  kickstartAgent: (a) => kickstartAgent(a),
  broadcastToAgents: (a) => broadcastToAgents(a),
  getSubagents: () => getSubagents(),
  getAsyncTasks: () => getAsyncTasks(),

  // ── P2: features we don't model yet — answer the DECLARED shape (array / record /
  // null / channels-view) instead of falling through to {}, so the FE renders an honest
  // empty state rather than silently mis-parsing a bare object. ──
  searchMedia: () => [],
  getAgentWorkflows: () => [],
  createAgentWorkflow: () => [],
  updateAgentWorkflow: () => [],
  setAgentWorkflowEnabled: () => [],
  deleteAgentWorkflow: () => [],
  runAgentWorkflowNow: () => ({}),
  importAgentWorkflowText: () => ({ ok: false, reason: "workflows not supported by this backend" }),
  importAgentWorkflowUrl: () => ({ ok: false, reason: "workflows not supported by this backend" }),
  portAgentLocalSkills: () => ({ ok: false, reason: "skills not supported by this backend" }),
  getAgentAutomations: () => [],
  listAllAutomations: () => [],
  setAgentAutomationEnabled: () => [],
  createAgentAutomation: () => [],
  updateAgentAutomation: () => [],
  deleteAgentAutomation: () => [],
  runAgentAutomationNow: () => ({}),
  getAgentChannels: () => ({ channels: [] }),
  connectChannel: () => ({ channels: [] }),
  disconnectChannel: () => ({ channels: [] }),
  refreshChannel: () => ({ channels: [] }),
  getListenerConnectUrl: () => ({ url: "" }),
  getSkillPublishTargets: () => ({ targets: [] }),
  publishSkill: () => ({ ok: false }),
  resyncPublishedSkill: () => ({ ok: false }),
  unpublishSkill: () => ({ ok: false }),
  getCloudAgentInfo: () => null,
  requestDiskSaverAudit: () => null,
  createGroup: () => null,
  setGroupMembers: () => null,
  ensureForeverBox: () => ({ status: "disabled" }),
  handBackForeverBox: () => ({}),
  startTeachRecording: () => ({ isRecording: false, ok: false }),
  stopTeachRecording: () => ({ isRecording: false, ok: false }),
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
  // Coverage report: which gateway methods the FE exercised, and which are still unmapped.
  if (url.startsWith("/gw/__coverage")) {
    const unmapped = [...called].filter((n) => !(n in methods)).sort();
    const mapped = [...called].filter((n) => n in methods).sort();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ calledTotal: called.size, mapped, unmapped, implemented: Object.keys(methods).sort() }, null, 2));
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
    called.add(m[1]);
    if (process.env.GROKBOT2_LOG) console.log(`  gw ${m[1]} ${JSON.stringify(args).slice(0, 220)}`);
    const fn = methods[m[1]];
    if (!fn) console.warn(`[gateway] UNMAPPED ${m[1]} ${body.length ? body.toString("utf8").slice(0, 120) : ""}`);
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
