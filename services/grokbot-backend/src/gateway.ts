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
  orderedFor,
  latestEntry,
  nextRosterOrdered,
  agentById,
} from "./chat.js";
import {
  getAgentAutomations,
  listAllAutomations,
  createAgentAutomation,
  updateAgentAutomation,
  deleteAgentAutomation,
  setAgentAutomationEnabled,
  runAgentAutomationNow,
} from "./automations.js";
import { loadState, scheduleSave } from "./store.js";
import { foreverBoxStatus, handBackBox } from "./forever-box.js";
import { readAttachmentImage, readAttachmentText, readAttachmentChunk } from "./attachments.js";
import { getAgentMemories, deleteAgentMemory, clearAgentMemories } from "./memory.js";

/** In-memory notification trays (the FE lists/dismisses these). */
const trays: { id: string; kind: string; title: string; timestampMs: number }[] = [];

/** Every gateway method the FE has called this session — powers GET /gw/__coverage. */
const called = new Set<string>();

/** Last payload seen per method, so wrong-key bugs are visible instead of inferred. */
const lastArgs = new Map<string, unknown>();

/**
 * How many times each method has been called, and when it was last seen.
 *
 * Names alone cannot answer "does the client poll?" — that question is about RATE, and it
 * decides whether a missing update is a broken push or a poll that never runs.
 */
const callCounts = new Map<string, { n: number; lastMs: number }>();

/** Persist host settings by piggybacking on the chat snapshot (same state.json). */
const saveSettings = () => scheduleSave(() => ({ ...chatSnapshot(), hostSettings }));

const sseClients = new Set<ServerResponse>();
/**
 * How many times the client has opened the event stream, and when it last did.
 *
 * Without this you cannot tell "the push was delivered and ignored" from "the client is not
 * listening at all", and those need opposite fixes.
 */
const sseStats: { opened: number; closed: number; lastOpenedMs: number; lastOpen?: unknown } = { opened: 0, closed: 0, lastOpenedMs: 0 };

// Push a nudge so the frontend re-fetches the transcript when chat updates.
const broadcast = (payload: unknown): void => {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const r of sseClients) {
    try { r.write(line); } catch { /* client gone */ }
  }
};
// The client replicates an ordered log: an event without `ordered` is discarded, and until
// one arrives it has no anchor, so every polled page after the first is thrown away too.
// See docs/transcript-replica.md — the envelope is the whole point, the nudge was never enough.
const announced = new Map<string, number>();
setUpdateSink((agentId) => {
  const last = latestEntry(agentId);
  if (!last) { broadcast({ kind: "transcript-updated", agentId }); return; }
  // onUpdate fires on every streamed token, so the same entry would be announced over and
  // over at the same sequence. A replica accepts a sequence once; repeats read as already
  // seen and are dropped, taking the real update with them. So "added" is sent once per
  // sequence, and later touches of that entry are "updated".
  const seen = announced.get(agentId);
  const type = seen === last.seq ? "updated" : "added";
  announced.set(agentId, last.seq);
  broadcast({
    kind: "transcript-updated",
    agentId,
    ordered: orderedFor(agentId, last.seq),
    event: { type, entry: last },
  });
});
// Roster add/delete: push immediately so the sidebar doesn't wait for its next poll.
setRosterSink((agentId) => {
  // A single-agent update needs the envelope or the client discards it outright; presence
  // (isRunning / isComposingMessage) rides here, so without it the indicator never mounts.
  const agent = agentId ? agentById(agentId) : undefined;
  broadcast(agent
    ? { kind: "roster-updated", ordered: nextRosterOrdered(), agent, activeAgentId: agent.id }
    : { kind: "roster-updated" });
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
  // The app's own memory screen. Answering with the real entries beats an empty {} — the
  // reply shape is unverified (no renderer call site to read it from), so GROKBOT2_LOG will
  // show what actually comes in the first time the screen is opened.
  getAgentMemories: (a) => getAgentMemories(a),
  deleteAgentMemory: (a) => deleteAgentMemory(a),
  clearAgentMemories: (a) => clearAgentMemories(a),
  // The desktop asks the box for attachment bytes once its own filesystem lookup misses.
  readAttachmentImage: (a) => readAttachmentImage(a),
  // Non-image attachments (a .md the agent wrote, say). The file chip's preview asks for
  // text; the markdown/pdf/table previews ask for raw bytes through chunked reads.
  readAttachmentText: (a) => readAttachmentText(a),
  readAttachmentChunk: (a) => readAttachmentChunk(a),
  // `rooms` is mapped without a guard on every poll, so a bare {} throws in the store.
  getSharingState: () => ({ rooms: [] }),
  isGlobalSearchEnabled: () => false,
  isEgressTunnelAvailable: () => false,
  isAgentNetworkEnabled: () => false,

  // ── P2: real behavior ──
  searchAgents: (a) => searchAgents(a),
  kickstartAgent: (a) => kickstartAgent(a),
  broadcastToAgents: (a) => broadcastToAgents(a),
  // `{id: <parent agent id>}` — the client asks per parent, so dropping the argument here
  // would return one agent's subagents under every agent.
  getSubagents: (a) => getSubagents(a),
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
  // Routines: every mutating call answers with the agent's FULL list, because the FE
  // stores the reply as the new list instead of re-fetching. The old `() => []` stub
  // therefore looked like "created, then vanished".
  getAgentAutomations: (a) => getAgentAutomations(a),
  listAllAutomations: () => listAllAutomations(),
  setAgentAutomationEnabled: (a) => setAgentAutomationEnabled(a),
  createAgentAutomation: (a) => createAgentAutomation(a),
  updateAgentAutomation: (a) => updateAgentAutomation(a),
  deleteAgentAutomation: (a) => deleteAgentAutomation(a),
  runAgentAutomationNow: (a) => runAgentAutomationNow(a),
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
  // ── The computer pane. All four return the same decorated status the box host returns,
  // because that status is the only thing the viewer reads (see forever-box.ts). ──
  getForeverBoxStatus: (a) => foreverBoxStatus(a),
  ensureForeverBox: (a) => foreverBoxStatus(a),
  resetForeverBox: (a) => foreverBoxStatus(a),
  updateForeverBox: (a) => foreverBoxStatus(a),
  // Clears the handoff card AND resumes the turn that was waiting on the user.
  handBackForeverBox: (a) => handBackBox(a),
  startTeachRecording: () => ({ isRecording: false, ok: false }),
  stopTeachRecording: () => ({ isRecording: false, ok: false }),
};

/** Returns true if it handled the request. */
export function handleGateway(url: string, body: Buffer, res: ServerResponse, headers: Record<string, unknown> = {}): boolean {
  if (!url.startsWith("/gw/")) return false;

  if (url.startsWith("/gw/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "healthy", ok: true }));
    return true;
  }
  if (url.startsWith("/gw/events")) {
    // Record who opens the stream and what they ask for. Something connects here, but no
    // command table references it, so identifying the caller is the open question — the
    // headers say whether this is the app's main process or one of our own probes.
    sseStats.lastOpen = {
      url,
      accept: String(headers["accept"] ?? ""),
      userAgent: String(headers["user-agent"] ?? ""),
      lastEventId: String(headers["last-event-id"] ?? ""),
    };
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(": connected\n\n");
    res.write('event: ready\ndata: {"kind":"ready"}\n\n');
    sseClients.add(res);
    sseStats.opened += 1; sseStats.lastOpenedMs = Date.now();
    // Establish the replica epoch immediately with a FULL roster snapshot.
    //
    // Until the client has an epoch it treats every event as foreign — it buffers them and
    // returns — so per-agent presence updates were being discarded no matter how correct
    // their envelope was. `coverage: complete-roster` is the client's own expected kind
    // (K0t is constructed with expectedCoverageKind: "complete-roster").
    const snap = listAgents();
    res.write(`data: ${JSON.stringify({
      kind: "roster-snapshot",
      ordered: nextRosterOrdered(),
      coverage: { kind: "complete-roster" },
      agents: snap,
      activeAgentId: snap[0]?.id ?? null,
    })}

`);
    res.on("close", () => { sseClients.delete(res); sseStats.closed += 1; });
    return true;
  }
  // Long-poll channels: the box holds these open until it has work. Answering instantly makes
  // the client reconnect in a tight loop and read the box as flapping, so park them and
  // return an empty batch on timeout.
  if (url.startsWith("/gw/webauthn/requests") || url.startsWith("/gw/local-exec/requests")) {
    const empty = url.includes("webauthn") ? { frames: [] } : { requests: [] };
    const timer = setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(empty));
    }, 25_000);
    res.on("close", () => clearTimeout(timer));
    return true;
  }
  // Coverage report: which gateway methods the FE exercised, and which are still unmapped.
  //
  // `lastArgs` is the important half. Coverage alone says a method is handled, never that
  // the handler reads the right keys — the bug class that has silently killed a feature
  // six times here. Recording what actually came over the wire makes it checkable.
  if (url.startsWith("/gw/__coverage")) {
    const unmapped = [...called].filter((n) => !(n in methods)).sort();
    const mapped = [...called].filter((n) => n in methods).sort();
    const filter = new URL(url, "http://x").searchParams.get("method");
    const args = Object.fromEntries(
      [...lastArgs].filter(([n]) => !filter || n.toLowerCase().includes(filter.toLowerCase())).sort()
    );
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      calledTotal: called.size, mapped, unmapped, lastArgs: args,
      sse: { ...sseStats, connected: sseClients.size },
      calls: Object.fromEntries([...callCounts].sort((a, b) => b[1].n - a[1].n)),
      implemented: Object.keys(methods).sort(),
    }, null, 2));
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
    const prev = callCounts.get(m[1]);
    callCounts.set(m[1], { n: (prev?.n ?? 0) + 1, lastMs: Date.now() });
    if (body.length) lastArgs.set(m[1], args);
    if (process.env.GROKBOT2_LOG) console.log(`  gw ${m[1]} ${JSON.stringify(args).slice(0, 220)}`);
    const fn = methods[m[1]];
    if (!fn) console.warn(`[gateway] UNMAPPED ${m[1]} ${body.length ? body.toString("utf8").slice(0, 120) : ""}`);
    let val: unknown = {};
    try {
      val = fn ? fn(args) : {};
    } catch (e) {
      console.error(`[gateway] ${m[1]} threw:`, e);
    }
    const finish = (v: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(v ?? null));
    };
    // Handlers may be async. Every one used to be synchronous, so the result was stringified
    // directly — which turns a Promise into `{}`: a 200 with an empty body, indistinguishable
    // from a method that legitimately returns nothing. Awaiting is what makes the attachment
    // readers (which have to reach the box) return anything at all.
    if (val != null && typeof (val as { then?: unknown }).then === "function") {
      void (val as Promise<unknown>).then(finish, (e) => {
        console.error(`[gateway] ${m[1]} rejected:`, e);
        finish(null);
      });
    } else finish(val);
    return true;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end("{}");
  return true;
}
