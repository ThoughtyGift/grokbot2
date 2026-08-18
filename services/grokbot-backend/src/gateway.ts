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
  setAutomationsSink,
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
  latestEntry,
  nextRosterOrdered,
  agentById,
} from "./chat.js";
import {
  getAgentAutomations,
  getAgentAutomationsForClient,
  toClientAutomation,
  listAllAutomations,
  createAgentAutomation,
  updateAgentAutomation,
  deleteAgentAutomation,
  setAgentAutomationEnabled,
  runAgentAutomationNow,
} from "./automations.js";
import { loadState, scheduleSave } from "./store.js";
import { foreverBoxStatus, handBackBox, beginComputerUse, endComputerUse, setBoxStatusSink } from "./forever-box.js";
import { readAttachmentImage, readAttachmentText, readAttachmentChunk, stageFile } from "./attachments.js";
import { getAgentMemories, deleteAgentMemory, clearAgentMemories } from "./memory.js";
import { closeMcp, mcpServers } from "./mcp.js";
import { stageImage, stagedCount } from "./attachments.js";
import {
  recordUnknown, recordCall, recordSseOpen, recordSseClose,
  coverageSnapshot, calledMethods, lastArgsFor, notFoundBody,
} from "./observe.js";
import { parkRequests, submitResponses, isChannelEnabled, channelSnapshot, type ChannelName } from "./channels.js";
import { checkAuth, noteAuth, authSnapshot } from "./auth-gate.js";
import { handleSlackEvent } from "./slack-events.js";
import { handleGitHubEvent } from "./github-events.js";
import { clearUnknown } from "./observe.js";

/**
 * When this process started, and when it was last doing work.
 *
 * `/health` reports both. `startedAt` cannot be derived after the fact, and `lastBusyAtMs` has to
 * be observed as it happens — so both are captured here rather than reconstructed.
 */
const STARTED_AT = Date.now();
let lastBusyAtMs = 0;

/** How many bots are mid-turn. Read by `/prepare-upgrade` to decide whether to wait. */
const runningTurns = (): number => listAgents().filter((a) => a.isRunning === true).length;

/**
 * The host's `/health` shape, field for field (contract: `health.fields`).
 *
 * Built from `listAgents()` rather than by reaching into chat.ts, because the roster row already
 * carries the presence flags this needs and adding an export there would collide with work in
 * flight on that file.
 *
 * `busyOnlyAwaitingApproval` is deliberately OMITTED. In the host it is a conditional spread —
 * present only when it can be determined — and we cannot determine it: our roster rows report
 * `awaitingUserResponse: null` unconditionally, so any value here would be invented. The contract
 * lists it as optional, so leaving it out is correct; guessing it would not be.
 */
function hostHealth() {
  const rows = listAgents();
  const running = rows.filter((a) => a.isRunning === true);
  if (running.length > 0) lastBusyAtMs = Date.now();
  return {
    ok: true,
    pid: process.pid,
    isBusy: running.length > 0,
    activeAgentId: running[0]?.id ?? null,
    startedAt: STARTED_AT,
    lastBusyAtMs,
    // Kept from the previous shape: harmless, and something may already read it.
    status: "healthy",
  };
}

export { hostHealth };

/**
 * The connector manifests, copied from the original's `src/shared/channels.ts`.
 *
 * Both entries really are `coming-soon` in the shipped app, with an empty `connectGuide` —
 * so the original cannot connect a channel either. This is not a stub standing in for
 * something richer; it is the whole feature as it ships today.
 */
const CONNECTOR_MANIFESTS = [
  { platform: "discord", displayName: "Discord", blurb: "Message in Discord servers and DMs (coming soon).", credentialLabel: "bot token", availability: "coming-soon", connectGuide: "" },
  { platform: "slack", displayName: "Slack", blurb: "Message in Slack channels and DMs (coming soon).", credentialLabel: "app token", availability: "coming-soon", connectGuide: "" },
] as const;

const channelsView = () => ({ manifests: CONNECTOR_MANIFESTS, connections: [] });

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
/**
 * Send one event on the stream.
 *
 * The coordinator's decoder is unforgiving, and silent about it:
 *
 *   const event = JSON.parse(dataLines.join("\n"));
 *   if (typeof event.channel !== "string" || event.channel.length === 0) return;
 *   this.options.onEvent({ channel: event.channel, payload: event.payload });
 *
 * No `channel`, no delivery — and no error either. Every event this backend has ever sent
 * was dropped on that line, which is why correcting the envelope INSIDE the payload three
 * times changed nothing: none of it ever got past the first check to be looked at.
 *
 * Channel names come from the client's own method-to-domain map: transcript, roster, send,
 * widgets, approvals, capabilities, sharing, automations, plus forever-box.
 */
const broadcast = (channel: string, payload: unknown): void => {
  const line = `data: ${JSON.stringify({ channel, payload })}\n\n`;
  for (const r of sseClients) {
    try { r.write(line); } catch { /* client gone */ }
  }
};
// That claim was TRUE OF THE ROSTER AND WRONG OF THE TRANSCRIPT, and the difference cost a night:
// "the client replicates an ordered log, an event without `ordered` is discarded, so the envelope is
// the whole point". It is the point for the roster, whose rows carry snapshotEpoch/snapshotSeq in the
// original too. Applying it to transcripts froze the pane instead — see the block below for what each
// client wrote to disk. Generalising a measured fix to a neighbouring surface is the trap here.
const announced = new Map<string, number>();
setUpdateSink((agentId) => {
  const last = latestEntry(agentId);
  if (!last) { broadcast("transcript", { agentId }); return; }
  // onUpdate fires on every streamed token, so the same entry is announced many times. The
  // first announcement of an entry is "added" and every later touch is "updated" — the event
  // TYPE is what distinguishes them. The SEQUENCE must advance on every push regardless, and
  // must advance by exactly one: see nextTranscriptOrdered for why the entry's own seq was the
  // wrong number to send.
  //
  // The type name is `appended`, not `added`. The client's reducer is a bare switch with no
  // default:
  //
  //   case "appended": …find by id, replace or push…
  //   case "updated":  return n.map(t => t.id === e.entry.id ? e.entry : t)
  //   case "removed":  …    case "cleared": return []
  //
  // `added` matches nothing there, so the reducer returns undefined for it. Renamed for that
  // reason alone. It is NOT the cause of any observed bug: streaming measured working both
  // before and after the rename (the screen tracked the backend 7/7 → 39/49 → 180/180 either
  // way). An earlier reading that showed the screen frozen while the backend grew was taken
  // against a conversation the app was not displaying — the giveaway was a negative delta,
  // believed for one round before being re-measured with a conversation opened on purpose.
  const seen = announced.get(agentId);
  const type = seen === last.seq ? "updated" : "appended";
  announced.set(agentId, last.seq);
  // ── NO `ordered` on transcript events. The original does not send one either. ──────────────
  //
  // Sending it is what froze the conversation pane. An `ordered` envelope opts the client into its
  // strict replica mode, where every event must arrive with the next sequence for the epoch it
  // joined on and anything else is parked as foreign and dropped. Proof is in what each client
  // WROTE TO DISK — same binary, two servers:
  //
  //   original  6 of 6 transcripts   epochHint absent   acceptedSequenceHint absent
  //   ours      agent-162            epochHint 1786987101659   acceptedSequenceHint 1
  //
  // The original never anchors a transcript at all; ours accepted exactly ONE event and then stood
  // still, which is precisely the symptom — pane frozen or spinning while the sidebar, a different
  // replica, stayed correct. It survived an app restart, which is what ruled out a stale epoch held
  // by a long-lived client and pointed here instead.
  //
  // The envelope IS required for the roster — that was measured, and its rows carry snapshotEpoch and
  // snapshotSeq in the original too. The mistake was generalising a roster fix to transcripts.
  broadcast("transcript", { agentId, event: { type, entry: last } });
});
// Computer status: push it, rather than making the client wait for its own poll.
//
// The payload is the status object unchanged — the coordinator special-cases this channel and
// runs `proxifyForeverBoxStatus(payload, vncProxy)` over it before forwarding, rewriting
// `vncUrl` (and any `windows[].vncUrl`) through the VNC proxy. The renderer then files it by
// `payload.agentId`: `ingestForeverBox: I => { const P = m(I.agentId); … }`. `foreverBoxStatus`
// already returns exactly that shape, agentId included, so there is nothing to reshape here.
setBoxStatusSink((agentId) => broadcast("forever-box", foreverBoxStatus({ id: agentId })));
// Roster add/delete: push immediately so the sidebar doesn't wait for its next poll.
setRosterSink((agentId) => {
  // A single-agent update needs the envelope or the client discards it outright; presence
  // (isRunning / isComposingMessage) rides here, so without it the indicator never mounts.
  const agent = agentId ? agentById(agentId) : undefined;
  // The enveloped form, retried on purpose.
  //
  // An earlier note here said the envelope "measurably made things WORSE" and the wholesale
  // `{agents: […]}` replace "was already working". Re-measured: it is NOT working — a bot
  // created through the gateway never appears in the sidebar (12s, list scrolled to the bottom,
  // window focused), and presence never animates. The client has no `applyEvent` branch for
  // `{agents}` at all; it reads `ev.agent.id` and `ev.activeAgentId`.
  //
  // The old measurement is still explainable: it was taken when roster rows carried no
  // `snapshotEpoch`, so the replica had no epoch and every enveloped event was discarded on
  // arrival — the envelope looked like the culprit when the missing epoch was. Rows carry
  // `snapshotEpoch`/`snapshotSeq` now, so the ordered path finally has an anchor.
  // The channel is `agents` / `agent-upserted`, NOT `roster`.
  //
  // Every payload shape we tried was correct and every one was thrown away, because the name
  // was wrong. The event never reached the renderer at all: the coordinator decodes the frame,
  // looks the channel up in its own table, and drops anything missing from it —
  //
  //   const family = coordinatorEventFamilyForSseChannel(event.channel);
  //   if (family == null) return;                       // silent, no log, no error
  //
  // and its table (`SSE_CHANNEL_BY_FAMILY`) lists exactly: transcript · agents ·
  // agent-upserted · tray · workflows · subagents · async-tasks · automations · mcp-servers ·
  // forever-box · teach-recording · box-disk-pressure · computer-action · outline · sharing ·
  // host-settings. "roster" is not one of them, so the roster replica was never offered a
  // single event — which is why six correct-looking fixes to the payload changed nothing.
  //
  // `agent-upserted` carries one changed agent; `agents` carries the whole list. Both are
  // forwarded as `{kind, event: payload}` to the renderer.
  if (agent) broadcast("agent-upserted", { ordered: nextRosterOrdered(), agent, activeAgentId: agent.id });
  broadcast("agents", { agents: listAgents() });
});

// Routine changes → the Routines panel, on the `agents-automation` channel (NOT "automations", the
// family name). The client's handler is `"agents-automation": e => ingestAutomationsEvent(e)` and it
// reads `{agentId, automations}`, so we send the whole list for that agent. Without this the routine
// was created but the panel only learned about it on reopen, which read as "the bot didn't create it".
setAutomationsSink((agentId) => {
  broadcast("agents-automation", { agentId, automations: getAgentAutomationsForClient({ id: agentId }) });
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
  // ── P3-1 · transcript readers the client can send and we were not answering ──
  //
  // `getTranscript` takes NO body (contract: `takesBody: false`), unlike every sibling above.
  // It is the whole-transcript read for whichever agent is current, so with no argument the only
  // honest answer is the first agent's tail — and saying that out loud beats returning `{}`, which
  // the renderer maps over without a guard.
  getTranscript: () => transcriptTail(listAgents()[0]?.id ?? ""),
  getAgentTranscriptWindow: (a) => transcriptTail(a),

  // ── P3-1 · `deleteAgent`, singular ──────────────────────────────────────────
  //
  // We only had `deleteAgents`. The client can send either, and the singular one is precisely the
  // wrong-name class of bug that parity.md records six times: a method that looks handled because
  // something similarly spelled is, then silently does nothing. Reuses the plural path so the two
  // can never drift.
  deleteAgent: (a) => deleteAgents({ ids: [a?.id ?? a?.agentId].filter(Boolean) }),

  // ── P3-1 · opening a bot ────────────────────────────────────────────────────
  //
  // Same reply shape as `createAgent`/`duplicateAgent` — `{agent, transcript}` — because the
  // client reads `result.agent.id` off all three. `openAgentWindowed` is the detached-window
  // variant; the payload it needs is identical, only the frame differs, and the frame is the
  // app's business.
  openAgent: (a) => {
    const rec = agentById(a?.id ?? a?.agentId ?? "");
    if (!rec) return null;
    // Opening a conversation is what marks it read. Doing it here rather than making the client
    // send a second call matches what the sidebar already assumes.
    setAgentUnread({ id: rec.id, isUnread: false });
    return { agent: rec, transcript: transcriptTail(rec.id) };
  },
  openAgentWindowed: (a) => {
    const rec = agentById(a?.id ?? a?.agentId ?? "");
    return rec ? { agent: rec, transcript: transcriptTail(rec.id) } : null;
  },

  // ── P3-1 · MCP refresh ──────────────────────────────────────────────────────
  //
  // `.mcp.json` is read fresh on every call by design (mcp.ts), so a refresh is about dropping
  // the live child processes and letting the next tool call restart them against the new config.
  refreshMcp: () => {
    closeMcp();
    return { ok: true, servers: Object.keys(mcpServers()) };
  },

  // ── P3-1 · attachment upload ────────────────────────────────────────────────
  //
  // The client pushes bytes in; attachments.ts already owns staging and serving them, so this is
  // the entry point it never had. Only PNG can be measured (the renderer needs real width/height,
  // see attachments.ts), so anything else is refused with a reason rather than stored broken.
  uploadAttachment: (a) => {
    // The client's field names are `filename` + `bytesBase64`, and it reads `path` back. Taken from
    // its own commit step in the bundle, which is unambiguous:
    //
    //   return (await e.uploadAttachment({ filename: I, bytesBase64: R.toString("base64") })).path
    //
    // We accepted `dataUrl`/`bytes`/`pngBase64` + `fileName` and answered `{ok, url}` — so a real
    // upload from the app matched NOTHING: `b64` came out empty, the call was refused, and the
    // client read `.path` as undefined. That is the whole "Couldn't send your message" / no-thumbnail
    // report: the bytes never landed, so there was no attachment to preview or to send. Our own test
    // scripts passed because they spoke our invented dialect, which is exactly how a contract bug
    // survives a green test suite. The old spellings stay accepted so those scripts keep working.
    const b64 = typeof a?.bytesBase64 === "string" ? a.bytesBase64
      : typeof a?.dataUrl === "string" ? a.dataUrl
      : typeof a?.bytes === "string" ? a.bytes
      : typeof a?.pngBase64 === "string" ? `data:image/png;base64,${a.pngBase64}`
      : "";
    const name = typeof a?.filename === "string" ? a.filename
      : typeof a?.fileName === "string" ? a.fileName
      : typeof a?.name === "string" ? a.name : "upload.png";
    if (!b64) return { ok: false, reason: "uploadAttachment needs bytesBase64 / dataUrl / bytes / pngBase64" };
    const dataUrl = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
    // Images go through stageImage (it measures dimensions the renderer needs); anything else — a PDF,
    // a .txt, a .docx — falls back to stageFile so "Attach files" is not images-only. The mime the
    // client declared in the data URL is what stageFile keeps.
    const mime = typeof a?.mimeType === "string" ? a.mimeType : undefined;
    const url = stageImage(dataUrl, name) ?? stageFile(dataUrl, name, mime);
    // `path` is what the client keeps and later sends back in `attachments[]`; `url`/`fileName` are
    // kept for our own scripts. Same value — the staged virtual path readImageAttachment resolves.
    return url ? { ok: true, path: url, url, fileName: name } : { ok: false, reason: "empty or unreadable attachment bytes" };
  },

  // ── P3-1 · connector card ───────────────────────────────────────────────────
  //
  // Answered, but answered NO — following the `importAgentWorkflowText` precedent a few lines
  // below rather than returning `{ok:true}` for work that did not happen. Writing the card needs a
  // plain-text transcript writer, and chat.ts exports only `postAttachment`, `postFileAttachment`
  // and `postWidget`; a question widget is the wrong shape for a connector notice, and inventing
  // an entry kind the renderer has no branch for is exactly what the `images?: string[]` note in
  // chat.ts records as a mistake.
  //
  // It costs nothing to leave: both connectors ship `availability: "coming-soon"` in the original,
  // so there is no card to append until P6 wires the hermes bridge. The reason travels with the
  // reply so the gap is legible instead of looking like success.
  appendConnectorCard: (a) => {
    const agentId = a?.id ?? a?.agentId ?? "";
    if (!agentId || !agentById(agentId)) return { ok: false, reason: "unknown agent" };
    return { ok: false, reason: "connector cards need a transcript writer; connectors are coming-soon in the original too" };
  },
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
  // Every automation reply goes out in the CLIENT'S shape (trigger as an object, not our cron string)
  // — the mutating calls too, because the FE stores their reply as the new list and the editor then
  // reads `trigger.type` off it. Sending the raw record is what crashed the editor on click.
  getAgentAutomations: (a) => getAgentAutomationsForClient(a),
  listAllAutomations: () => listAllAutomations().map(toClientAutomation),
  setAgentAutomationEnabled: (a) => setAgentAutomationEnabled(a).map(toClientAutomation),
  createAgentAutomation: (a) => createAgentAutomation(a).map(toClientAutomation),
  updateAgentAutomation: (a) => updateAgentAutomation(a).map(toClientAutomation),
  deleteAgentAutomation: (a) => deleteAgentAutomation(a).map(toClientAutomation),
  runAgentAutomationNow: (a) => runAgentAutomationNow(a),
  // A "channels-view" is `{manifests, connections}` — the host builds it as
  // `{manifests: CONNECTOR_MANIFESTS, connections: <filtered>}`. The previous `{channels: []}`
  // was an invented key, so our channels panel rendered empty while the original's lists both
  // platforms. Since nothing here is connectable, matching it exactly costs one constant.
  getAgentChannels: () => channelsView(),
  connectChannel: () => channelsView(),
  disconnectChannel: () => channelsView(),
  refreshChannel: () => channelsView(),
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
  /**
   * `ensure` means the USER asked for the screen — so give it to them.
   *
   * Scoping the pane to a running `computerUse` session was right for the passive
   * `getForeverBoxStatus` poll, and wrong here: opening the computer pane calls this, we
   * answered "off" because the bot had not browsed yet, and the app sat on "Starting desktop"
   * with a progress bar that never finished. A person clicking "open the computer" IS the
   * session starting; only the poll should infer it from the agent's own activity.
   */
  /**
   * The client calls this when the user opens the computer pane.
   *
   * It must report `running`, not the truth-as-of-now. Answering `off` leaves the pane on its
   * fallback branch for ever — `emptyMessage ?? "Booting up the computer"` with a spinner, and
   * `emptyMessage` is a component prop we cannot reach from a status reply. That is the hang
   * this line was added to fix.
   *
   * But a session opened this way had nothing to close it: the release timer is armed by the end
   * of a TURN, and opening a pane is not a turn. So an idle bot the user glanced at kept
   * reporting `running` until its next turn finished — an idle bot showing a live screen, which
   * is the exact thing §2z set out to stop, reached from the other side. Arming the release here
   * closes it with the machinery that already exists: any tool action cancels the timer
   * (`beginComputerUse` clears it) and the end of a turn re-arms it, so nothing else changes.
   *
   * Safe against the client's own repeat calls — ensure is fired on open, focus and reconnect,
   * not on a poll (the poll is `getForeverBoxStatus`), so this cannot be pushed out indefinitely.
   */
  ensureForeverBox: (a) => {
    const id = typeof a?.id === "string" ? a.id : typeof a?.agentId === "string" ? a.agentId : "";
    if (id) { beginComputerUse(id); endComputerUse(id); }
    return foreverBoxStatus(a);
  },
  resetForeverBox: (a) => foreverBoxStatus(a),
  updateForeverBox: (a) => foreverBoxStatus(a),
  // Clears the handoff card AND resumes the turn that was waiting on the user.
  handBackForeverBox: (a) => handBackBox(a),
  startTeachRecording: () => ({ isRecording: false, ok: false }),
  stopTeachRecording: () => ({ isRecording: false, ok: false }),

  // ── P3-2 · box lifecycle ────────────────────────────────────────────────────
  //
  // Ten commands the app can send about updating, snapshotting and recreating the box. This
  // backend does not own the box's lifecycle — `infra/vps/grok-box-up.sh` brings it up and the
  // exec daemon is reached over HTTP (box-exec.ts) — so none of these can honestly *do* the thing.
  //
  // They are answered anyway, and with a REASON rather than a bare `{}`, for the same argument the
  // rest of this table already makes: a method that falls through to `{}` is indistinguishable
  // from one that legitimately returns nothing, so the app cannot tell "not supported here" from
  // "worked, nothing to report" and neither can whoever debugs it next. `getBoxStoreStatus` is the
  // one that reports something real, because it can.
  autoUpdateBoxNow: () => ({ ok: false, reason: "the box is provisioned outside this backend (infra/vps/grok-box-up.sh)" }),
  updateHostNow: () => ({ ok: false, reason: "this backend IS the host; update it by restarting it" }),
  snapshotBoxStoreNow: () => ({ ok: false, reason: "no box store to snapshot — state lives in .data/state.json, backed up on write" }),
  clearBoxStoreNow: () => ({ ok: false, reason: "refusing to clear: state.json holds the user's bots and transcripts" }),
  // Real numbers: what this backend actually holds on the user's behalf.
  getBoxStoreStatus: () => ({
    ok: true,
    // Reported from where the data really is, so the panel is not lying by omission.
    agents: countAgents(),
    attachments: stagedCount(),
    isMigrating: false,
    note: "state is local to this backend, not in a box store",
  }),
  setBoxMigrating: () => ({ ok: false, reason: "no box migration in this backend" }),
  prepareBoxForRecreate: () => ({ ok: false, reason: "the box is not recreated from here" }),
  resumeBoxAfterRecreate: () => ({ ok: false, reason: "the box is not recreated from here" }),

  // ── P3-2 · MCP OAuth and WebAuthn ceremonies ────────────────────────────────
  //
  // Both are multi-step flows with a browser leg. `completeMcpOAuth` would finish a flow this
  // backend never starts (mcp.ts speaks stdio to local servers, which need no OAuth), and
  // `requestWebAuthnCeremony` would have to push a request into the webauthn channel — the channel
  // exists and accepts responses now (channels.ts), but nothing here has a reason to ask for a
  // signature, and issuing one to see what happens would be a prompt on the user's real security key.
  completeMcpOAuth: () => ({ ok: false, reason: "stdio MCP servers need no OAuth; no flow to complete" }),
  requestWebAuthnCeremony: () => ({ ok: false, reason: "nothing here initiates a WebAuthn ceremony" }),
};

/** Returns true if it handled the request. */
export function handleGateway(
  url: string,
  body: Buffer,
  res: ServerResponse,
  headers: Record<string, unknown> = {},
  // Needed to record an unmatched request the way the real host reports it: the host's own
  // fallback is `404 "not found: <METHOD> <path>"`, and METHOD is half of what identifies it —
  // `GET /avatars/x` and `POST /avatars/x` are different routes there.
  method = "?",
): boolean {
  if (!url.startsWith("/gw/")) return false;

  // P0-5. In `warn` this only records the verdict; in `enforce` it answers 401 with the host's own
  // message. `/gw/health` and `/gw/__coverage` are exempt inside checkAuth — they are how you
  // diagnose a bad rollout, so they must not be behind the credential that broke it.
  const verdict = checkAuth(url, headers);
  noteAuth(url, verdict);
  if (!verdict.allow) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: verdict.message }));
    return true;
  }

  if (url.startsWith("/gw/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(hostHealth()));
    return true;
  }
  // ── /avatars/<agentId>?v=<version> ──────────────────────────────────────────
  //
  // The app fetches bot avatars over HTTP, not through a gateway command, and we never served
  // this route — which is why the sidebar showed initials where the original shows pictures.
  // Every branch below is the host's own (`E3s`), including the ones that are easy to skip:
  // the cross-site refusal, the version check, and the 304.
  if (url.startsWith("/gw/avatars/")) {
    const parsed = new URL(url, "http://x");
    // The host decodes the id, so a bot id with a reserved character still resolves.
    const agentId = decodeURIComponent(parsed.pathname.slice("/gw/avatars/".length));
    const send = (status: number, msg: string) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
      return true;
    };
    // An avatar is an image the renderer embeds; a cross-site read of it is never legitimate.
    if (String(headers["sec-fetch-site"] ?? "") === "cross-site") return send(403, "cross-site avatar loads are not allowed");
    if (!agentId) return send(404, "missing agent id");

    const { avatarDataUrl, avatarVersion } = getAgentAvatar({ id: agentId });
    const m = /^data:([a-z0-9.+/-]+);base64,(.*)$/i.exec(avatarDataUrl ?? "");
    if (!avatarVersion || !m) return send(404, "agent has no avatar");

    // `?v=` is a cache-busting pin. A stale pin must 404 rather than silently serve the new
    // image, or a client caching immutably would keep a picture it asked not to have.
    const asked = parsed.searchParams.get("v");
    if (asked != null && asked !== avatarVersion) return send(404, "no such avatar version");

    const etag = `"${avatarVersion}"`;
    // Pinned requests are immutable for a year; unpinned ones must never be cached, because the
    // same URL will answer differently the moment the avatar changes.
    const caching = asked != null
      ? { "cache-control": "private, max-age=31536000, immutable", etag }
      : { "cache-control": "no-store", etag };

    if (String(headers["if-none-match"] ?? "") === etag) {
      res.writeHead(304, caching);
      res.end();
      return true;
    }
    const bytes = Buffer.from(m[2], "base64");
    res.writeHead(200, {
      ...caching,
      "content-type": m[1],
      "content-length": bytes.byteLength,
      // The host's three hardening headers. An avatar is untrusted bytes from the box: never
      // rendered as a document, never sniffed into one.
      "content-disposition": "attachment",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    });
    res.end(bytes);
    return true;
  }
  // ── /prepare-upgrade ────────────────────────────────────────────────────────
  //
  // Asked before the app replaces the host. `runningTurns` is read to decide whether to wait, so
  // a hardcoded 0 would tell the app it is safe to swap the host out from under a live turn.
  if (url.startsWith("/gw/prepare-upgrade")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ quiescing: false, runningTurns: runningTurns() }));
    return true;
  }
  // ── the responses half of the two channels ──────────────────────────────────
  //
  // Both were missing, and the observe pass caught the app posting to both. See channels.ts.
  if (url.startsWith("/gw/local-exec/responses") || url.startsWith("/gw/webauthn/responses")) {
    const name: ChannelName = url.includes("webauthn") ? "webauthn" : "local-exec";
    if (!isChannelEnabled(name)) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `${name} channel not enabled` }));
      return true;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(submitResponses(name, body)));
    return true;
  }
  // Slack Events API — Tầng 1 of the Slack bridge. A Slack mention lands here and wakes the matching
  // routine (see slack-events.ts). Exempt from the gateway ticket in auth-gate.ts because Slack posts
  // with its own signature, not our bearer.
  if (url.startsWith("/gw/slack/events")) {
    let parsed: Record<string, unknown> = {};
    try { parsed = body.length ? JSON.parse(body.toString("utf8")) : {}; } catch { /* bad JSON → treated as unknown event */ }
    const out = handleSlackEvent(parsed);
    res.writeHead(out.status, { "content-type": "application/json" });
    res.end(JSON.stringify(out.body));
    return true;
  }
  // GitHub webhooks — the event name rides in the X-GitHub-Event header, not the body. Exempt from the
  // gateway ticket in auth-gate.ts: GitHub signs with X-Hub-Signature-256, not our bearer.
  if (url.startsWith("/gw/github/events")) {
    let parsed: Record<string, unknown> = {};
    try { parsed = body.length ? JSON.parse(body.toString("utf8")) : {}; } catch { /* bad JSON */ }
    const event = String(headers["x-github-event"] ?? "");
    const out = handleGitHubEvent(event, parsed);
    res.writeHead(out.status, { "content-type": "application/json" });
    res.end(JSON.stringify(out.body));
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
    recordSseOpen();   // persisted, so a tsx restart does not erase the reconnect history
    // A full roster snapshot the moment the stream opens, so a reconnect re-anchors instead of
    // waiting for the next change.
    //
    // This frame used to be sent on `channel: "roster"` and was therefore never delivered at
    // all: "roster" is the client's REPLICA key, not one of the sixteen SSE channel names its
    // coordinator will forward, so the decoder dropped it silently — the same trap that hid the
    // presence bug. The channel is `agents`; the replica key stays "roster" inside the envelope.
    //
    // Sent without `ordered` on purpose. The client's own handler reads that as "replace
    // wholesale" (`we.ordered == null ? x = b(Pe) : x.ingestSnapshot(…)`), which is exactly what
    // a fresh connection wants — no epoch negotiation, no chance of a stale sequence.
    res.write(`data: ${JSON.stringify({ channel: "agents", payload: { agents: listAgents() } })}\n\n`);
    res.on("close", () => { sseClients.delete(res); sseStats.closed += 1; recordSseClose(); });
    return true;
  }
  // Drop every live event stream on purpose, with the server still answering.
  //
  // This exists to tell two failures apart, because they look identical from the app and want
  // opposite fixes: a client that never retries needs the connection never to break, while a
  // client that retries only needs the restart to be quick. Killing the backend cannot answer
  // that — it takes the retry target away at the same moment — so the drop has to come from a
  // server that stays up. Diagnostic only; nothing in the product calls it.
  if (url.startsWith("/gw/__dropsse")) {
    const n = sseClients.size;
    for (const r of [...sseClients]) { try { r.end(); } catch { /* already gone */ } }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ dropped: n }));
    return true;
  }
  // Long-poll channels: the box holds these open until it has work. Answering instantly makes
  // the client reconnect in a tight loop and read the box as flapping, so park them and
  // return an empty batch on timeout.
  if (url.startsWith("/gw/webauthn/requests") || url.startsWith("/gw/local-exec/requests")) {
    // Moved into channels.ts so the requests half and the responses half live together — they are
    // one protocol, and having them in two places is how the responses half stayed missing.
    parkRequests(url.includes("webauthn") ? "webauthn" : "local-exec", res);
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
    // `persisted` is the half that survives a restart, and it is the half that matters:
    // `tsx watch` reloads on every save and the in-memory counters above were seen resetting
    // three times inside an hour. `unknownPaths` is the new column — every request that matched
    // no route, which is the list P2/P3 are meant to empty.
    // `?reset=unknown` forgets the recorded unknown paths. Needed because the record is
    // historical by design: implementing a route does not remove its row, so after P2 the list
    // still showed routes that now exist. A to-do list that only grows is not one.
    const reset = new URL(url, "http://x").searchParams.get("reset");
    const cleared = reset === "unknown" ? clearUnknown() : undefined;
    const persisted = coverageSnapshot();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      calledTotal: called.size, mapped, unmapped, lastArgs: args,
      sse: { ...sseStats, connected: sseClients.size },
      calls: Object.fromEntries([...callCounts].sort((a, b) => b[1].n - a[1].n)),
      implemented: Object.keys(methods).sort(),
      // What each request/response channel has actually seen. The app posts frames we do not yet
      // consume, and reading their real shape here beats guessing it.
      channels: channelSnapshot(),
      auth: authSnapshot(),
      ...(cleared !== undefined ? { clearedUnknownPaths: cleared } : {}),
      persisted: {
        ...persisted,
        // Same split as `mapped`/`unmapped` above, but computed over everything ever seen
        // rather than only this process's lifetime.
        everCalled: calledMethods().length,
        everUnmapped: calledMethods().filter((n) => !(n in methods)).sort(),
        lastArgs: lastArgsFor(filter),
      },
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
    recordCall(m[1], args, body.length > 0);   // same numbers, but surviving a restart
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
  // A `/gw/...` request that matched nothing above.
  //
  // The real box host ends its router with `404 "not found: <METHOD> <path>"`. We answer that
  // only once GROKBOT2_STRICT_404=1; until then the path is RECORDED and still answered `200 {}`,
  // because flipping it blind breaks the app without telling you which path did it. The observe
  // pass is what turns "what does the app need that we lack?" into a list.
  recordUnknown(method, url, body);
  const nf = notFoundBody(method, url);
  if (nf) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(nf);
    return true;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end("{}");
  return true;
}
