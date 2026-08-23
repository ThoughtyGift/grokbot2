/**
 * The command table: every `/gw/api/<name>` the stock client can send.
 *
 * This is the only file in the repo that knows the Cursor command vocabulary —
 * `getAgentTranscriptTail`, `ensureForeverBox`, `kickstartAgent` and the rest. Each entry
 * parses the client's argument spellings, calls one port, and shapes the reply the way the
 * renderer reads it. Nothing here holds domain state.
 *
 * Two rules the table follows throughout, both learned the hard way:
 *
 * - Answer the DECLARED shape (array / record / null) rather than falling through to `{}`. A
 *   bare `{}` is indistinguishable from a method that legitimately returns nothing, so the app
 *   cannot tell "not supported here" from "worked, nothing to report" — and neither can whoever
 *   debugs it next. Where we cannot do the thing, we answer `{ok: false, reason}`.
 * - Accept every key spelling the client is known to send. A method that looks handled because
 *   something similarly spelled is handled, and then silently does nothing, is the bug class
 *   parity.md records six times.
 */
import type { AclPorts, Call } from "./ports.js";
import type { WireChannel } from "./sse.js";

/**
 * The nine shared-room commands, and the one honest answer to all of them.
 *
 * Exported so `parity-report` can say "120/120 answered, of which 9 are explicit refusals" instead
 * of letting the count read as though sharing works. A number that cannot tell a refusal from a
 * feature is the kind of metric this repo has already been burned by.
 */
export const SHARED_ROOM_COMMANDS = [
  "createRoomFromAgent", "createRoomInvite", "joinSharedRoom", "respondToRoomJoinRequest",
  "createSharedRoom", "addOwnAgentToSharedRoom", "removeOwnAgentFromSharedRoom",
  "setSharedRoomTyping", "leaveSharedRoom",
] as const;

const NO_RELAY = "Sharing needs a relay both installs can reach; this is a single local backend. Nothing was created.";

/**
 * The connector manifests, copied from the original's `src/shared/channels.ts`.
 *
 * Both entries really are `coming-soon` in the shipped app, with an empty `connectGuide` — so
 * the original cannot connect a channel either. This is not a stub standing in for something
 * richer; it is the whole feature as it ships today.
 */
const CONNECTOR_MANIFESTS = [
  { platform: "discord", displayName: "Discord", blurb: "Message in Discord servers and DMs (coming soon).", credentialLabel: "bot token", availability: "coming-soon", connectGuide: "" },
  { platform: "slack", displayName: "Slack", blurb: "Message in Slack channels and DMs (coming soon).", credentialLabel: "app token", availability: "coming-soon", connectGuide: "" },
] as const;

/**
 * Yours → Private. Empty, on purpose.
 *
 * This used to hold one fabricated row ("Local test skill", "Stub from grokbot2 so Yours → Private
 * has a row"). That was useful while checking the screen rendered at all; in a client someone uses
 * daily it is a lie on screen — a workflow that cannot be opened, run, or deleted.
 *
 * `[]` is both honest and contract-correct: the decl is `getAgentWorkflows:{args:"object",
 * reply:"array"}`, and the sibling `skillsCatalog` shows the client maps an empty array to "nothing"
 * itself (`C => C.length === 0 ? null : C`). Restore a row here only when a real workflow exists.
 */
const LOCAL_WORKFLOWS: unknown[] = [];

/** A "channels-view" is `{manifests, connections}` — the host's own shape. */
const channelsView = () => ({ manifests: CONNECTOR_MANIFESTS, connections: [] });

const idOf = (a: any): string =>
  typeof a?.id === "string" ? a.id : typeof a?.agentId === "string" ? a.agentId : "";

/**
 * `broadcast` is optional so tests and `parity-report` can enumerate the table without a hub.
 * Only commands that are themselves the sole writer of a value use it — see `createGatewayRouter`.
 */
export function buildCommands(ports: AclPorts, broadcast?: (channel: WireChannel, payload: unknown) => void): Record<string, Call> {
  const { identity, directory, conversation, runtime, computer, media, memory, automations, extensions } = ports;
  const push = (channel: WireChannel, payload: unknown) => { broadcast?.(channel, payload); };

  /**
   * The MCP server summary rows the client reads.
   *
   * Hoisted out of `listBoxMcpServers` because the `mcp-servers` SSE push needs the SAME rows:
   * the renderer's handler is `X => { for (const se of X.servers) d.set(se.serverIdentifier, se) }`,
   * so it keys the map on `serverIdentifier` and stores the whole object. Pushing bare names — as
   * this did until the renderer was actually read — gives every entry the key `undefined`.
   */
  const mcpServerRows = (want: string[] = []) =>
    Object.entries(extensions.mcpServers()).flatMap(([name, spec], i) => {
      if (want.length && !want.includes(name)) return [];
      const sp = spec && typeof spec === "object" ? spec as Record<string, unknown> : {};
      const command = typeof sp.command === "string" ? sp.command : "";
      const url = typeof sp.url === "string" ? sp.url : undefined;
      const transport = typeof sp.type === "string" ? sp.type : url ? "sse" : "stdio";
      return [{
        id: String(i + 1),
        name,
        serverIdentifier: name,
        accountKey: "default",
        rowServerIdentifier: name,
        transport,
        ...(command ? { command } : {}),
        ...(url ? { url } : {}),
        toolCount: 0,
        isTeamServer: false,
        status: "disconnected",
        statusDetail: "Runs on Grok Bot's computer",
      }];
    });

  /** In-memory notification trays (the FE lists/dismisses these). Pure client state. */
  const trays: { id: string; kind: string; title: string; timestampMs: number }[] = [];

  return {
    getHostSettings: () => identity.getHostSettings(),
    setHostSettings: (a) => {
      const next = identity.patchHostSettings(a);
      /**
       * `{fields: [...]}` — the names that changed, NOT the settings object.
       *
       * Read off the renderer, which does exactly this and nothing else with the frame:
       *   "host-settings": e => {
       *     e.fields.includes("pinnedAgentIds") && loadPinnedAgentsFromBox();
       *     e.fields.includes("sidebarSections") && loadFromBox();
       *   }
       * So the payload is a CHANGE NOTICE that triggers a refetch — sending the object gives
       * `e.fields === undefined` and `.includes` throws inside the handler.
       */
      const fields = a && typeof a === "object" ? Object.keys(a as Record<string, unknown>) : [];
      push("host-settings", { fields });
      return next;
    },
    getHostStatus: () => ({ isBusy: false, capabilities: {}, current: "applied", version: "0.20.0", state: "current" }),

    listAgents: () => directory.listAgents(),
    countAgents: () => directory.countAgents(),
    // The client reads `result.agent.id`, so createAgent/duplicateAgent/openAgent must wrap the
    // record as `{agent, transcript}` (matches the box host: `return { agent: u, transcript: Gn() }`).
    createAgent: (a) => ({ agent: directory.createAgent(a), transcript: { entries: [], hasMore: false } }),
    updateAgent: (a) => directory.updateAgent(a),
    deleteAgents: (a) => directory.deleteAgents(a),
    // We only had `deleteAgents`. The client can send either; the singular one reuses the plural
    // path so the two can never drift.
    deleteAgent: (a) => directory.deleteAgents({ ids: [a?.id ?? a?.agentId].filter(Boolean) }),
    duplicateAgent: (a) => {
      const rec = directory.duplicateAgent(a);
      return rec ? { agent: rec, transcript: conversation.transcriptTail({ id: rec.id }) } : null;
    },
    setAgentUnread: (a) => directory.setAgentUnread(a),
    setAgentHiddenFromSidebar: (a) => directory.setAgentHiddenFromSidebar(a),
    setAgentNotificationsEnabled: (a) => directory.setAgentNotificationsEnabled(a),
    setAgentNotifyOnUpdates: (a) => directory.setAgentNotifyOnUpdates(a),
    setAgentAvatarBytes: (a) => directory.setAgentAvatarBytes(a),
    getAgentAvatar: (a) => directory.getAgentAvatar(a),

    // Opening a conversation is what marks it read — doing it here rather than making the client
    // send a second call matches what the sidebar already assumes. `openAgentWindowed` is the
    // detached-window variant: same payload, only the frame differs, and the frame is the app's
    // business.
    openAgent: (a) => {
      const rec = directory.agentById(idOf(a));
      if (!rec) return null;
      directory.setAgentUnread({ id: rec.id, isUnread: false });
      return { agent: rec, transcript: conversation.transcriptTail({ id: rec.id }) };
    },
    openAgentWindowed: (a) => {
      const rec = directory.agentById(idOf(a));
      return rec ? { agent: rec, transcript: conversation.transcriptTail({ id: rec.id }) } : null;
    },

    interruptAgentRun: (a) => runtime.interruptAgentRun(a),
    sendPrompt: (a) => runtime.sendPrompt(a),
    promptAcceptanceStatus: (a) => conversation.promptAcceptanceStatus(a),
    reactToMessage: (a) => conversation.reactToMessage(a),
    voteFeedback: () => conversation.voteFeedback(),
    getConversationOutline: (a) => conversation.getConversationOutline(a),
    resolveLocalToolPermission: (a) => runtime.resolveLocalToolPermission(a),
    resolveAutoReviewApproval: (a) => runtime.resolveAutoReviewApproval(a),
    respondToWidget: (a) => runtime.respondToWidget(a),
    submitSecret: (a) => runtime.submitSecret(a),
    dismissWidget: (a) => runtime.dismissWidget(a),

    // Every transcript reader the client can send. They differ only in name in the bundle; the
    // tail is the honest answer to all of them.
    getAgentTranscriptTail: (a) => conversation.transcriptTail(a),
    openAgentTail: (a) => conversation.transcriptTail(a),
    getAgentTranscript: (a) => conversation.transcriptTail(a),
    getAgentTranscriptPage: (a) => conversation.transcriptTail(a),
    getAgentThread: (a) => conversation.transcriptTail(a),
    getAgentTranscriptWindow: (a) => conversation.transcriptTail(a),
    // `getTranscript` takes NO body (contract: `takesBody: false`), unlike every sibling above.
    // It is the whole-transcript read for whichever agent is current, so with no argument the
    // only honest answer is the first agent's tail — and saying that out loud beats returning
    // `{}`, which the renderer maps over without a guard.
    getTranscript: () => conversation.transcriptTail({ id: directory.listAgents()[0]?.id ?? "" }),

    // `.mcp.json` is read fresh on every call by design, so a refresh is about dropping the live
    // child processes and letting the next tool call restart them against the new config.
    refreshMcp: () => {
      extensions.closeMcp();
      const rows = mcpServerRows();
      // Wire name `mcp-servers`; the coordinator remaps it to the family `mcp-servers-updated`,
      // which is the key the renderer's ingest map uses. Sending the family name is dropped
      // silently, same trap as `roster`.
      //
      // Rows, not names: the renderer does `for (const se of X.servers) d.set(se.serverIdentifier, se)`.
      push("mcp-servers", { servers: rows });
      return { ok: true, servers: rows.map((r) => r.serverIdentifier) };
    },

    // ── attachment upload ───────────────────────────────────────────────────────
    //
    // The client's field names are `filename` + `bytesBase64`, and it reads `path` back. Taken
    // from its own commit step in the bundle, which is unambiguous:
    //
    //   return (await e.uploadAttachment({ filename: I, bytesBase64: R.toString("base64") })).path
    //
    // We accepted `dataUrl`/`bytes`/`pngBase64` + `fileName` and answered `{ok, url}`, so a real
    // upload from the app matched NOTHING — that is the whole "Couldn't send your message" /
    // no-thumbnail report. Our own scripts passed because they spoke our invented dialect, which
    // is exactly how a contract bug survives a green suite; the old spellings stay accepted so
    // those scripts keep working.
    uploadAttachment: (a) => {
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
      // Images go through stageImage (it measures the dimensions the renderer needs); anything
      // else — a PDF, a .txt, a .docx — falls back to stageFile so "Attach files" is not
      // images-only. The mime the client declared in the data URL is what stageFile keeps.
      const mime = typeof a?.mimeType === "string" ? a.mimeType : undefined;
      const url = media.stageImage(dataUrl, name) ?? media.stageFile(dataUrl, name, mime);
      // `path` is what the client keeps and later sends back in `attachments[]`; `url`/`fileName`
      // are kept for our own scripts. Same value — the staged virtual path.
      return url ? { ok: true, path: url, url, fileName: name } : { ok: false, reason: "empty or unreadable attachment bytes" };
    },

    // Answered, but answered NO. Writing the card needs a plain-text transcript writer; a
    // question widget is the wrong shape for a connector notice, and inventing an entry kind the
    // renderer has no branch for is its own mistake. It costs nothing to leave: both connectors
    // ship `availability: "coming-soon"` in the original, so there is no card to append until the
    // hermes bridge exists.
    appendConnectorCard: (a) => {
      const agentId = idOf(a);
      if (!agentId || !directory.agentById(agentId)) return { ok: false, reason: "unknown agent" };
      return { ok: false, reason: "connector cards need a transcript writer; connectors are coming-soon in the original too" };
    },

    getTrays: () => trays,
    dismissTray: (a) => { const i = trays.findIndex((t) => t.id === (a?.id ?? a?.trayId)); if (i >= 0) trays.splice(i, 1); return {}; },
    clearTrays: () => { trays.length = 0; return {}; },

    skillsCatalog: () => [],
    syncPluginSkills: () => [],
    /**
     * The plugin-sync record. `{}` CRASHED the Plugins panel's "Yours" tab.
     *
     * The host persists `{fetchedAt, currentUserId, skills[], authBlocked[]}` (its own reader
     * defaults the last two to `[]`), and the overlay's Yours view reads `authBlocked.length`
     * directly — an empty object gave it `undefined`, so clicking Yours threw
     * `Cannot read properties of undefined (reading 'length')` and closed the panel. Reported by the
     * user, reproduced over CDP at view--8LkllMO.js `Ni` (the `sand-plugins__yours` section).
     *
     * There is nothing to sync here — skills are not published to a registry — so the honest answer
     * is a well-formed record with empty lists, not an empty object.
     */
    getPluginSyncStatus: () => ({ fetchedAt: Date.now(), skills: [], authBlocked: [] }),
    getListenerIntegrations: () => ({}),
    getTeachRecordingStatus: () => ({ isRecording: false }),
    // Box-host summary rows. The overlay's Yours → Installed list is built from the *host's*
    // MCP settings, using this reply only to fill status/toolCount — so `.mcp.json` alone will
    // not create cards. `id` must be a positive integer string (`/^[1-9]\d*$/`). Never echo `env`.
    listBoxMcpServers: (a) => {
      const want = Array.isArray(a?.serverIdentifiers)
        ? (a.serverIdentifiers as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      return { servers: mcpServerRows(want) };
    },
    // ── shared rooms: answered, and answered NO ──────────────────────────────
    //
    // All nine are declared in the renderer (`reply:"record"`, except `setSharedRoomTyping` which
    // is `"void"`), so the UI can call them. Leaving them out of this table meant the router's
    // fallthrough answered `{}` with HTTP 200 — the exact shape this file's own rule forbids,
    // because the client cannot tell "not supported here" from "worked, nothing to report".
    //
    // Faking success is worse than refusing: `createSharedRoom` returning an id creates a room
    // nobody can ever join, and the UI would then show a member list that never fills. Sharing
    // needs a relay both installs can reach; this is one local backend. `{ok:false, reason}` is a
    // plain object, so it satisfies the declared `record` reply while saying plainly that the
    // answer is no. ROADMAP F5 chose this over building a relay.
    ...Object.fromEntries(SHARED_ROOM_COMMANDS.map((name) => [
      name,
      () => (name === "setSharedRoomTyping" ? {} : { ok: false, reason: NO_RELAY }),
    ])),

    getBoxSecretsStatus: () => ({}),
    setBoxSecrets: () => ({}),
    setWindowFocused: () => ({}),

    // The app's own memory screen. Answering with the real entries beats an empty {}; the reply
    // shape is unverified (no renderer call site to read it from), so GROKBOT2_LOG will show what
    // actually comes in the first time the screen is opened.
    getAgentMemories: (a) => memory.getAgentMemories(a),
    deleteAgentMemory: (a) => memory.deleteAgentMemory(a),
    clearAgentMemories: (a) => memory.clearAgentMemories(a),

    // The desktop asks the box for attachment bytes once its own filesystem lookup misses. The
    // file chip's preview asks for text; the markdown/pdf/table previews ask for raw bytes
    // through chunked reads.
    readAttachmentImage: (a) => media.readAttachmentImage(a),
    readAttachmentText: (a) => media.readAttachmentText(a),
    readAttachmentChunk: (a) => media.readAttachmentChunk(a),

    // `rooms` is mapped without a guard on every poll, so a bare {} throws in the store.
    getSharingState: () => ({ rooms: [] }),
    isGlobalSearchEnabled: () => false,
    isEgressTunnelAvailable: () => false,
    isAgentNetworkEnabled: () => false,

    searchAgents: (a) => directory.searchAgents(a),
    kickstartAgent: (a) => directory.kickstartAgent(a),
    broadcastToAgents: (a) => runtime.broadcastToAgents(a),
    // `{id: <parent agent id>}` — the client asks per parent, so dropping the argument here would
    // return one agent's subagents under every agent.
    getSubagents: (a) => runtime.getSubagents(a),
    getAsyncTasks: (a) => runtime.getAsyncTasks(a),

    searchMedia: () => [],
    // Yours → Private filters `source === "workflow"` (or a plugin published by this user).
    getAgentWorkflows: () => LOCAL_WORKFLOWS,
    createAgentWorkflow: () => LOCAL_WORKFLOWS,
    updateAgentWorkflow: () => LOCAL_WORKFLOWS,
    setAgentWorkflowEnabled: () => LOCAL_WORKFLOWS,
    deleteAgentWorkflow: () => LOCAL_WORKFLOWS,
    runAgentWorkflowNow: () => ({}),
    importAgentWorkflowText: () => ({ ok: false, reason: "workflows not supported by this backend" }),
    importAgentWorkflowUrl: () => ({ ok: false, reason: "workflows not supported by this backend" }),
    portAgentLocalSkills: () => ({ ok: false, reason: "skills not supported by this backend" }),

    // Routines: every mutating call answers with the agent's FULL list, because the FE stores the
    // reply as the new list instead of re-fetching — a `() => []` stub therefore looked like
    // "created, then vanished". And every reply goes out in the CLIENT'S shape (trigger as an
    // object, not our cron string), the mutating ones included: the editor reads `trigger.type`
    // off what it stored, and sending the raw record is what crashed it on click.
    getAgentAutomations: (a) => automations.forAgentClientShape(a),
    listAllAutomations: () => automations.listAll().map(automations.toClientShape),
    setAgentAutomationEnabled: (a) => automations.setEnabled(a).map(automations.toClientShape),
    createAgentAutomation: (a) => automations.create(a).map(automations.toClientShape),
    updateAgentAutomation: (a) => automations.update(a).map(automations.toClientShape),
    deleteAgentAutomation: (a) => automations.remove(a).map(automations.toClientShape),
    runAgentAutomationNow: (a) => automations.runNow(a),

    // The previous `{channels: []}` was an invented key, so our channels panel rendered empty
    // while the original's lists both platforms. Since nothing here is connectable, matching the
    // host exactly costs one constant.
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

    // ── the computer pane ───────────────────────────────────────────────────────
    //
    // All of these return the same decorated status the box host returns, because that status is
    // the only thing the viewer reads.
    getForeverBoxStatus: (a) => computer.status(a),
    /**
     * The client calls this when the user opens the computer pane, and it must report `running`
     * rather than the truth-as-of-now.
     *
     * Answering `off` leaves the pane on its fallback branch for ever — `emptyMessage ?? "Booting
     * up the computer"` with a spinner, and `emptyMessage` is a component prop we cannot reach
     * from a status reply. That is the hang this exists to fix: a person clicking "open the
     * computer" IS the session starting; only the passive poll should infer it from activity.
     *
     * But a session opened this way had nothing to close it — the release timer is armed by the
     * end of a TURN, and opening a pane is not a turn — so an idle bot the user glanced at kept
     * reporting `running` until its next turn finished. Arming the release here closes it with
     * machinery that already exists: any tool action cancels the timer and the end of a turn
     * re-arms it. Safe against the client's own repeat calls, since ensure fires on open, focus
     * and reconnect, not on a poll.
     */
    ensureForeverBox: async (a) => {
      const id = idOf(a);
      if (id) { await computer.beginUse(id); await computer.endUse(id); }
      return computer.status(a);
    },
    resetForeverBox: (a) => computer.status(a),
    updateForeverBox: (a) => computer.status(a),
    // Clears the handoff card AND resumes the turn that was waiting on the user.
    handBackForeverBox: (a) => computer.handBack(a),
    startTeachRecording: () => ({ isRecording: false, ok: false }),
    stopTeachRecording: () => ({ isRecording: false, ok: false }),

    // ── box lifecycle ──────────────────────────────────────────────────────────
    //
    // Commands the app can send about updating, snapshotting and recreating the box. This backend
    // does not own the box's lifecycle — `infra/vps/grok-box-up.sh` brings it up and the exec
    // daemon is reached over HTTP — so none of these can honestly *do* the thing.
    // `getBoxStoreStatus` is the one that reports something real, because it can.
    autoUpdateBoxNow: () => ({ ok: false, reason: "the box is provisioned outside this backend (infra/vps/grok-box-up.sh)" }),
    updateHostNow: () => ({ ok: false, reason: "this backend IS the host; update it by restarting it" }),
    snapshotBoxStoreNow: () => ({ ok: false, reason: "no box store to snapshot — state lives in .data/state.json, backed up on write" }),
    clearBoxStoreNow: () => ({ ok: false, reason: "refusing to clear: state.json holds the user's bots and transcripts" }),
    getBoxStoreStatus: () => ({
      ok: true,
      // Reported from where the data really is, so the panel is not lying by omission.
      agents: directory.countAgents(),
      attachments: media.stagedCount(),
      isMigrating: false,
      note: "state is local to this backend, not in a box store",
    }),
    setBoxMigrating: () => ({ ok: false, reason: "no box migration in this backend" }),
    prepareBoxForRecreate: () => ({ ok: false, reason: "the box is not recreated from here" }),
    resumeBoxAfterRecreate: () => ({ ok: false, reason: "the box is not recreated from here" }),

    // Both are multi-step flows with a browser leg. `completeMcpOAuth` would finish a flow this
    // backend never starts (stdio MCP servers need no OAuth), and `requestWebAuthnCeremony` would
    // have to ask for a signature nothing here wants — issuing one to see what happens would be a
    // prompt on the user's real security key.
    completeMcpOAuth: () => ({ ok: false, reason: "stdio MCP servers need no OAuth; no flow to complete" }),
    requestWebAuthnCeremony: () => ({ ok: false, reason: "nothing here initiates a WebAuthn ceremony" }),
  };
}
