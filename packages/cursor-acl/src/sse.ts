/**
 * The push half of the Cursor dialect: `/gw/events` and the sixteen wire channel names.
 *
 * Everything in this file is a client fact, which is why it lives in the ACL and not in the
 * domain: which channel a change goes out on, whether it carries an `ordered` envelope, and
 * whether an entry counts as `appended` or `updated` are all decisions about the client's
 * replicas — the domain only knows that something changed.
 */
import type { ServerResponse } from "node:http";
import type { AclPorts } from "./ports.js";

/**
 * The channel names the client's coordinator will forward.
 *
 * Its table is `SSE_CHANNEL_BY_FAMILY`, and it drops anything missing from it:
 *
 *   const family = coordinatorEventFamilyForSseChannel(event.channel);
 *   if (family == null) return;                       // silent, no log, no error
 *
 * That silence is why six correct-looking payload fixes changed nothing while the roster
 * events went out on `roster` — a REPLICA key, not a wire name (parity.md §2w). Listed here
 * so a new push has to pick from the set instead of inventing a name.
 */
export const WIRE_CHANNELS = [
  "transcript", "agents", "agent-upserted", "tray", "workflows", "subagents", "async-tasks",
  "automations", "mcp-servers", "forever-box", "teach-recording", "box-disk-pressure",
  "computer-action", "outline", "sharing", "host-settings",
  // Hai tên 0.29/0.30 thêm vào, trích 2026-08-29 từ bảng kênh trong `node-agent-coordinator`
  // (`extract-host-0-30.mjs`). Danh sách này tồn tại để một push mới PHẢI chọn trong tập, nên nó
  // thiếu tên là đúng cái bẫy nó sinh ra để chặn. Không cái nào có producer bên ta — xem
  // NO_DATA_CHANNELS bên dưới.
  "agent-activity", "mcp-auth",
] as const;
export type WireChannel = (typeof WIRE_CHANNELS)[number];

/**
 * Channels this hub actually emits. Keep in lockstep with the pushes in `createSseHub`.
 * 5/16 at the F0 baseline, 10/16 after F4. Naming a channel here without an actual broadcast is
 * how the old 0/120 lie happened, so `contract-test --only channels` reads THIS list.
 */
export const PUSHED_CHANNELS = [
  "transcript", "agents", "agent-upserted", "forever-box", "automations",
  "subagents", "outline", "host-settings", "mcp-servers", "async-tasks",
  "teach-recording", "computer-action",
] as const satisfies readonly WireChannel[];

/**
 * The six channels we do NOT push, and why — so 10/16 is not read as "six left to wire up".
 *
 * Measured 2026-08-20, revised 2026-08-21 (roadmap F4). None of these is an SSE gap: there is no
 * data behind them to send. Pushing them would move the parity number without changing one
 * pixel, which is the false-green this repo already paid for once at 0/120.
 *
 * `async-tasks` was on this list and came OFF it: the client has a real, visible tray for it
 * (`sand-async-task` rows keyed `subagent | shell | cloud-agent`), so the emptiness was ours —
 * `getAsyncTasks` answered `[]`. "No producer in our backend" and "no surface in the client"
 * are different findings, and only the second one belongs here.
 *
 *   tray               the `trays` array in commands.ts is read/dismissed/cleared, never written
 *   workflows          `LOCAL_WORKFLOWS`, a constant stub row
 *   sharing            `{rooms: []}` — no relay exists (roadmap F5 decides relay vs honest refusal)
 *   box-disk-pressure  no producer anywhere in the repo
 *   agent-activity     0.29+ only; tên có trong bảng client, chưa đo được nó vẽ gì
 *   mcp-auth           0.29+ only; ta báo OAuth MCP xong bằng `mcp-servers` (rộng hơn, vẫn đúng)
 */
export const NO_DATA_CHANNELS = [
  "tray", "workflows", "sharing", "box-disk-pressure",
  // Hai tên mới của 0.29/0.30. Có mặt trong bảng kênh client CHẤP NHẬN, chưa có gì bên ta để gửi:
  //   agent-activity   client có tên kênh, ta chưa đo được nó vẽ gì — chưa đủ để hứa một payload
  //   mcp-auth         bí danh `mcp-auth-completed`; ta đã có luồng OAuth MCP nhưng báo xong bằng
  //                    `mcp-servers`, nên đây là kênh hẹp hơn chứ không phải tính năng thiếu
  "agent-activity", "mcp-auth",
] as const satisfies readonly WireChannel[];

/**
 * Channels whose feature exists here but which nothing broadcasts yet. Empty since 25/08/2026 —
 * `teach-recording` and `computer-action` were the last two and are now wired.
 *
 * Both sat in NO_DATA_CHANNELS with a comment saying the feature did not exist. That was true when
 * it was written and stopped being true on 24/08/2026, which is the failure mode this whole file
 * argues against: a stale reason reads exactly like a measured one, and the parity report kept
 * printing "real gaps: none" over two features that had shipped.
 *
 *   teach-recording   teach.ts and desktop-record.ts both record; the client has a whole host
 *                     module for this channel (`id:"teach-recording"`), so the pane is real
 *   computer-action   `computer_use` acts on the box every turn; the host emits
 *                     `{channel:"computer-action", payload:{agentId, ...action}}` for it
 */
export const PENDING_CHANNELS = [] as const satisfies readonly WireChannel[];

export interface SseHub {
  /** `targetOwner` routes to one tenant's connections (multi-tenant Phase 3); omitted = every client
   *  (global channels only — host-settings, mcp-servers). Never omit it for per-agent data. */
  broadcast(channel: WireChannel, payload: unknown, targetOwner?: string): void;
  attach(res: ServerResponse, open: unknown): void;
  drop(): number;
  stats(): { opened: number; closed: number; lastOpenedMs: number; lastOpen?: unknown; connected: number };
}

export function createSseHub(ports: AclPorts): SseHub {
  /**
   * Each open stream carries its owner (multi-tenant Phase 3), captured from the token at
   * `/gw/events` open. A per-agent event is written only to its owner's connections; one tenant
   * never sees another's transcript, roster or presence. Global channels pass no owner and reach all.
   */
  const clients = new Map<ServerResponse, string>();
  /**
   * How many times the client has opened the stream, and when it last did.
   *
   * Without this you cannot tell "the push was delivered and ignored" from "the client is not
   * listening at all", and those need opposite fixes.
   */
  const stats: { opened: number; closed: number; lastOpenedMs: number; lastOpen?: unknown } =
    { opened: 0, closed: 0, lastOpenedMs: 0 };

  /**
   * Send one event on the stream.
   *
   * The coordinator's decoder is unforgiving, and silent about it:
   *
   *   const event = JSON.parse(dataLines.join("\n"));
   *   if (typeof event.channel !== "string" || event.channel.length === 0) return;
   *   this.options.onEvent({ channel: event.channel, payload: event.payload });
   *
   * No `channel`, no delivery — and no error either. Correcting the envelope INSIDE the
   * payload three times changed nothing, because none of it ever got past that first check.
   */
  const broadcast = (channel: WireChannel, payload: unknown, targetOwner?: string): void => {
    const line = `data: ${JSON.stringify({ channel, payload })}\n\n`;
    for (const [r, owner] of clients) {
      // Phase 3: a targeted event reaches only its owner's streams; an untargeted one (global
      // channel) reaches all. This is the single choke that prevents cross-tenant leakage.
      if (targetOwner !== undefined && owner !== targetOwner) continue;
      try { r.write(line); } catch { /* client gone */ }
    }
  };

  /** The owner an event belongs to: its agent's owner, or (for a roster-wide event with no agent id)
   *  the caller's own owner — valid because publish() is synchronous within the request scope. */
  const ownerFor = (agentId?: string): string =>
    (agentId ? ports.directory.ownerOf(agentId) : undefined) ?? ports.currentOwner();

  /**
   * Broadcast only when the payload actually differs from the last one sent for this key.
   *
   * `subagents` and `outline` are both derived from the transcript, and `transcript.append`
   * fires on EVERY streamed token. Recomputing is cheap; re-sending is not — it would put a
   * frame per token on two channels whose value changes a handful of times per turn, and the
   * renderer would diff identical lists all the way through a reply.
   *
   * Keyed by channel+agent so two agents streaming at once do not cancel each other's dedup.
   */
  const lastSent = new Map<string, string>();
  const broadcastIfChanged = (channel: WireChannel, key: string, payload: unknown, targetOwner?: string): void => {
    const k = `${channel}:${key}`;
    const json = JSON.stringify(payload);
    if (lastSent.get(k) === json) return;
    lastSent.set(k, json);
    broadcast(channel, payload, targetOwner);
  };

  // ── transcript.append → channel `transcript` ────────────────────────────────
  //
  // The domain publishes on every streamed token, so the same entry is announced many times.
  // The first announcement of an entry is "appended" and every later touch is "updated" — the
  // event TYPE is what distinguishes them.
  //
  // The type name is `appended`, not `added`. The client's reducer is a bare switch with no
  // default: `appended` / `updated` / `removed` / `cleared`. `added` matches nothing there,
  // so the reducer returns undefined for it.
  //
  // NO `ordered` on transcript events — the original does not send one either. Sending it is
  // what froze the conversation pane: an `ordered` envelope opts the client into its strict
  // replica mode, where anything that is not the next sequence for the epoch it joined on is
  // parked as foreign and dropped. Proof is in what each client WROTE TO DISK, same binary,
  // two servers: the original never anchors a transcript at all (no epochHint), ours accepted
  // exactly ONE event and then stood still. The envelope IS required for the roster below —
  // generalising that measured fix to transcripts was the mistake.
  const announced = new Map<string, number>();
  const onTranscriptAppend = (agentId: string): void => {
    const owner = ownerFor(agentId);
    ports.runAsOwner(owner, () => {
      const last = ports.conversation.latestEntry(agentId);
      if (!last) { broadcast("transcript", { agentId }, owner); return; }
      const type = announced.get(agentId) === last.seq ? "updated" : "appended";
      announced.set(agentId, last.seq);
      broadcast("transcript", { agentId, event: { type, entry: last } }, owner);
    });
  };

  // ── agent.upserted → channels `agent-upserted` + `agents` ───────────────────
  //
  // A single-agent update needs the `ordered` envelope or the client discards it outright;
  // presence (isRunning / isComposingMessage) rides here, so without it the indicator never
  // mounts. An earlier note claimed the envelope made things worse and the wholesale
  // `{agents: […]}` replace already worked — re-measured, it does not: the client has no
  // `applyEvent` branch for `{agents}` at all, it reads `ev.agent.id` and `ev.activeAgentId`.
  // The old measurement was taken when rows carried no `snapshotEpoch`, so the replica had no
  // anchor and every enveloped event was discarded on arrival.
  //
  // `agent-upserted` carries one changed agent; `agents` carries the whole list. Both are
  // forwarded to the renderer as `{kind, event: payload}`.
  const onAgentUpserted = (agentId?: string): void => {
    const owner = ownerFor(agentId);
    ports.runAsOwner(owner, () => {
      const agent = agentId ? ports.directory.agentById(agentId) : undefined;
      if (agent) {
        broadcast("agent-upserted", { ordered: ports.directory.nextRosterOrdered(), agent, activeAgentId: agent.id }, owner);
      }
      broadcast("agents", { agents: ports.directory.listAgents() }, owner);
    });
  };

  // ── computer.status → channel `forever-box` ─────────────────────────────────
  //
  // Push the status rather than making the client wait for its own poll. The payload is the
  // status object unchanged: the coordinator special-cases this channel and runs
  // `proxifyForeverBoxStatus(payload, vncProxy)` over it, rewriting `vncUrl` (and any
  // `windows[].vncUrl`) through the VNC proxy, and the renderer then files it by
  // `payload.agentId` — which the status already carries.
  const onComputerStatus = (agentId: string): void => {
    // Status is async when S6 lives in the computer process. Broadcasting the Promise itself
    // would JSON as `{}` and the pane would file it under no agentId.
    const owner = ownerFor(agentId);
    void Promise.resolve(ports.computer.status({ id: agentId })).then((st) => broadcast("forever-box", st, owner));
  };

  // ── automations.changed → channel `automations` ─────────────────────────────
  //
  // The renderer's ingest map is keyed `"agents-automation"`, but that is the *family* name;
  // the coordinator only forwards wire names and remaps family `agents-automation` → channel
  // `automations`. Sending the family name is dropped silently — same trap as `roster`.
  const onAutomationsChanged = (agentId: string): void => {
    const owner = ownerFor(agentId);
    ports.runAsOwner(owner, () => broadcast("automations", { agentId, automations: ports.automations.forAgentClientShape({ id: agentId }) }, owner));
  };

  // ── transcript.append → channels `subagents` + `outline` ───────────────────
  //
  // Both are derived from the same transcript the event announces, so they ride it rather than
  // needing their own domain events — through `broadcastIfChanged`, since the event fires per
  // streamed token and neither value changes anywhere near that often.
  //
  // `subagents` is the one with real motion: `getSubagents` reads the run registry, whose rows
  // go `running → done | aborted | error` mid-turn. Without a push the subagent list only
  // refreshes when the client next polls, so a finished subagent keeps showing as running.
  //
  // Payload keys are READ OFF THE RENDERER's ingest map, not inferred from the command replies.
  // Inferring is what shipped `subagents` with the wrong key for one afternoon: the envelope
  // convention is not uniform, and mirroring the sibling that happened to be checked first is
  // exactly how the six silent-drop bugs in parity.md happened.
  //
  //   subagents      t => { store.replace(t.parentAgentId, t.subagents) }   ← parentAgentId
  //   async-tasks    t => { store.replace(t.parentAgentId, t.tasks) }       ← parentAgentId
  //   automations    j => { apply(j.agentId, j.automations) }               ← agentId
  //   workflows      C => { store.replace(C.agentId, C.workflows) }         ← agentId
  //   forever-box    C => { get(C.agentId) … }                             ← agentId
  //   outline        m => { get(m.agentId).snapshots.set(merge(prev, m)) }  ← agentId, whole frame
  //
  // With `agentId` on a subagents frame, `t.parentAgentId` is undefined and the rows are filed
  // under the key `undefined` — delivered, no error logged, and invisible in the panel. That is
  // precisely what a DOM probe showed before this was corrected.
  const onDerivedFromTranscript = (agentId: string): void => {
    if (!agentId) return;
    const owner = ownerFor(agentId);
    ports.runAsOwner(owner, () => {
    broadcastIfChanged("subagents", agentId, { parentAgentId: agentId, subagents: ports.runtime.getSubagents({ id: agentId }) }, owner);
    // The tray the user can actually see. `getSubagents` feeds a store the conversation screen
    // does not render; this is the `sand-async-task` list, and it was empty because the backend
    // answered `[]` — not because the channel was missing.
    broadcastIfChanged("async-tasks", agentId, { parentAgentId: agentId, tasks: ports.runtime.getAsyncTasks({ id: agentId }) }, owner);
    // `{type:"snapshot", items}` — the outline reducer is a switch on `type` that FALLS THROUGH
    // TO `return e`:
    //   (prev, e) => { switch (e.type) { case "snapshot": return e.items
    //                                    case "appended":  return […prev, e.item]
    //                                    case "updated":   return prev.map(…) } return e }
    // A frame with no `type` therefore becomes the state itself, so the store holds the frame
    // OBJECT where an array belongs — and the next `appended` frame dies on
    // `prev.some is not a function`. That is worse than being ignored: `{agentId, outline}`
    // corrupts the store rather than missing it.
    broadcastIfChanged("outline", agentId, {
      agentId,
      type: "snapshot",
      items: ports.conversation.getConversationOutline({ id: agentId }),
    }, owner);
    });
  };

  ports.events.subscribe((e) => {
    switch (e.type) {
      case "transcript.append": {
        onTranscriptAppend(e.agentId);
        return onDerivedFromTranscript(e.agentId);
      }
      case "agent.upserted": return onAgentUpserted(e.agentId);
      case "computer.status": return onComputerStatus(e.agentId);
      case "automations.changed": return onAutomationsChanged(e.agentId);
      /**
       * Hai kênh này từng nằm trong "không có gì để gửi" vì tính năng chưa có. Giờ có rồi.
       *
       * `computer-action` gửi đúng hình dạng host gốc gửi — hành động được trải phẳng cạnh
       * `agentId`, không bọc thêm một lớp: `payload:{agentId, ...action}`.
       *
       * `teach-recording` gửi nguyên trạng thái, vì ở client **câu trả lời CHÍNH LÀ trạng thái**
       * (`{state, agentId, startedAtMs, maxDurationMs}`); bọc thêm là renderer không có nhánh nào
       * khớp và pane đứng im ở chỗ mặc định.
       */
      case "computer.action":
        return broadcast("computer-action", { agentId: e.agentId, ...e.action }, ownerFor(e.agentId));
      case "teach.recording":
        return broadcast("teach-recording", e.state);
    }
  });

  setInterval(() => {
    for (const r of clients.keys()) {
      try { r.write(": ping\n\n"); } catch { /* client gone */ }
    }
  }, 5000);

  return {
    broadcast,
    attach(res, open) {
      stats.lastOpen = open;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(": connected\n\n");
      res.write('event: ready\ndata: {"kind":"ready"}\n\n');
      // Phase 3: tag this stream with the caller's owner (from the token, via the runWithOwner scope
      // index.ts set around this whole /gw request). Every targeted push below routes on it.
      const owner = ports.currentOwner();
      clients.set(res, owner);
      stats.opened += 1; stats.lastOpenedMs = Date.now();
      ports.observe.recordSseOpen();   // persisted, so a tsx restart does not erase the reconnect history
      // A full roster snapshot the moment the stream opens, so a reconnect re-anchors instead
      // of waiting for the next change. Sent WITHOUT `ordered` on purpose: the client's own
      // handler reads that as "replace wholesale" (`we.ordered == null ? x = b(Pe) : …`),
      // which is exactly what a fresh connection wants — no epoch negotiation, no chance of a
      // stale sequence.
      res.write(`data: ${JSON.stringify({ channel: "agents", payload: { agents: ports.directory.listAgents() } })}\n\n`);
      res.on("close", () => { clients.delete(res); stats.closed += 1; ports.observe.recordSseClose(); });
    },
    drop() {
      const n = clients.size;
      for (const r of [...clients.keys()]) { try { r.end(); } catch { /* already gone */ } }
      return n;
    },
    stats: () => ({ ...stats, connected: clients.size }),
  };
}
