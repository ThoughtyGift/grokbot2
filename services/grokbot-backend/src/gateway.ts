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
import { foreverBoxStatus, handBackBox, beginComputerUse } from "./forever-box.js";
import { readAttachmentImage, readAttachmentText, readAttachmentChunk } from "./attachments.js";
import { getAgentMemories, deleteAgentMemory, clearAgentMemories } from "./memory.js";
import {
  recordUnknown, recordCall, recordSseOpen, recordSseClose,
  coverageSnapshot, calledMethods, lastArgsFor, notFoundBody,
} from "./observe.js";
import { parkRequests, submitResponses, isChannelEnabled, channelSnapshot, type ChannelName } from "./channels.js";

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
// The client replicates an ordered log: an event without `ordered` is discarded, and until
// one arrives it has no anchor, so every polled page after the first is thrown away too.
// See docs/transcript-replica.md — the envelope is the whole point, the nudge was never enough.
const announced = new Map<string, number>();
setUpdateSink((agentId) => {
  const last = latestEntry(agentId);
  if (!last) { broadcast("transcript", { agentId }); return; }
  // onUpdate fires on every streamed token, so the same entry would be announced over and
  // over at the same sequence. A replica accepts a sequence once; repeats read as already
  // seen and are dropped, taking the real update with them. So "added" is sent once per
  // sequence, and later touches of that entry are "updated".
  const seen = announced.get(agentId);
  const type = seen === last.seq ? "updated" : "added";
  announced.set(agentId, last.seq);
  broadcast("transcript", {
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
  ensureForeverBox: (a) => {
    const id = typeof a?.id === "string" ? a.id : typeof a?.agentId === "string" ? a.agentId : "";
    if (id) beginComputerUse(id);
    return foreverBoxStatus(a);
  },
  resetForeverBox: (a) => foreverBoxStatus(a),
  updateForeverBox: (a) => foreverBoxStatus(a),
  // Clears the handoff card AND resumes the turn that was waiting on the user.
  handBackForeverBox: (a) => handBackBox(a),
  startTeachRecording: () => ({ isRecording: false, ok: false }),
  stopTeachRecording: () => ({ isRecording: false, ok: false }),
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
    // Establish the replica epoch immediately with a FULL roster snapshot.
    //
    // Until the client has an epoch it treats every event as foreign — it buffers them and
    // returns — so per-agent presence updates were being discarded no matter how correct
    // their envelope was. `coverage: complete-roster` is the client's own expected kind
    // (K0t is constructed with expectedCoverageKind: "complete-roster").
    res.write(`data: ${JSON.stringify({ channel: "roster", payload: { agents: listAgents() } })}

`);
    res.on("close", () => { sseClients.delete(res); sseStats.closed += 1; recordSseClose(); });
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
