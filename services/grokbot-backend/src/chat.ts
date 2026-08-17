/**
 * Chat bridge — the box agent-host role, backed by the Claude pool: roster mutations,
 * run interrupt, reactions, outline, paged transcripts, real token streaming, and a
 * tool-call + approval loop.
 *
 * Transcript entries use the client's real contract (verified against the bundle):
 *   user  → { id, kind:"message", role:"user", content, timestampMs }
 *   agent → { id, kind:"send-message", author:{id,name}, message:{type:"text",content} }
 *   tool  → { id, kind:"tool-call", toolCallId, name, rawArgs, status }
 *   ask   → { id, kind:"send-message", message:{type:"local-tool-permission", ask:{…}} }
 * The renderer only knows kinds: message | tool-call | send-message | user-attachment |
 * notice | event — anything else is dropped silently.
 *
 * The pool has no native tool-calling, so the system prompt teaches a
 * `TOOL_CALL: name(arg)` convention; approving the resulting card runs an allowlisted,
 * side-effect-free tool and feeds the result back for a follow-up turn. NO system commands.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { callPool, streamPool, type PoolMessage } from "@grokbot2/pool-client";
import { config, loadPoolKey } from "./config.js";
import { loadState, scheduleSave, type PersistedState } from "./store.js";
import { BROWSER_TOOL_NAMES, isBrowserConfigured, isBrowserReachable, runBrowserTool, browserProbe, closeAgentTab } from "./browser.js";
import { stageImage, imageSize } from "./attachments.js";
import { availableTools, toolProtocol as boxToolProtocol, isAutoApproved, unquote } from "./tools.js";
import { parseToolCalls, planBatches, planShape } from "./tool-calls.js";
import { boxConfigured, boxCall } from "./box-exec.js";
import { requestBoxHelp, setHandBackSink, setHandoffStartSink, setHandoffEndSink, setComputerReleaseSink, restoreHandoff, handoffEntries, beginComputerUse, endComputerUse, type BoxHandoff } from "./forever-box.js";
import { runSubagent, SUBAGENT_TYPES } from "./subagents.js";
import { getMcpTools, callMcpTool, isMcpConfigured, mcpServers } from "./mcp.js";
import { compact, applyCompaction, needsCompaction, type CompactionState } from "./compaction.js";
import { buildSystemPrompt } from "./prompt.js";
import { knowledgeBase, loadMemory, renderMemory } from "./memory.js";

export const AUTH_ID = "auth0|grokbot2-user";
/** The FE marks a reaction as the current user's when `by === "me"`. */
const ME = "me";

const IMG_MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
};
/** Read the first image attachment (a local file path the FE staged) as a data: URL for the pool. */
function readImageAttachment(atts?: { path?: string; name?: string }[]): string | undefined {
  for (const a of atts ?? []) {
    const mime = IMG_MIME[extname(a.path || a.name || "").toLowerCase()];
    if (!mime || !a.path) continue;
    try {
      if (!existsSync(a.path) || statSync(a.path).size > 6_000_000) continue;
      return `data:${mime};base64,${readFileSync(a.path).toString("base64")}`;
    } catch { /* skip unreadable */ }
  }
  return undefined;
}

/**
 * The `🔧 name(arg) → result` bubble — RETIRED, and the reason is worth keeping.
 *
 * It was a UI convenience that had to be hidden from the model: an assistant-authored message
 * that looks exactly like a tool result, so once it was in the history the model copied the
 * format and INVENTED results in it — observed live, a fabricated
 * "🔧 list_dir_v2(".") → 📁 . ├── package.json …" for files that do not exist, with nothing
 * called. (The original's prompt has a `## Never fabricate data` chapter; this was us teaching
 * the opposite.)
 *
 * It is gone now for a second reason: it does not exist in the original. Comparing the two
 * apps side by side, ours showed raw JSON arguments in the chat where the original showed
 * clean prose, and the client's own transcript builder says why —
 *
 *   if (f.kind === "tool-call") { u && (c = f); continue; }
 *
 * tool-call entries are skipped when the visible list is assembled. The original narrates what
 * it is doing in words and lets the activity indicator carry the rest; the mechanics never
 * reach the bubble column. The entries are still emitted here — they drive that indicator and
 * the outline panel — they are simply not echoed as text.
 *
 * The predicate stays so old transcripts, which still contain these bubbles, keep them out of
 * the model's history and out of sidebar previews.
 */
const TOOL_ECHO = "🔧 ";
const isToolEcho = (e: Entry): boolean =>
  e.kind === "send-message" && e.message.type === "text" && e.message.content.startsWith(TOOL_ECHO);

interface Reaction { emoji: string; by: string }
/**
 * `seq` is assigned once and never recomputed.
 *
 * It used to be the array index, handed out fresh on every request — so the same entry
 * reported a different seq depending on what else was in the transcript at the time. A
 * client that caches or dedupes by seq then sees one entry claim two positions across two
 * polls, and the observed symptom matches exactly: a reply that renders ~33s late, or never.
 * Stable and monotonic is the contract; positional was neither.
 */
interface Base { id: string; timestampMs: number; reactions?: Reaction[]; seq?: number }
interface Author { id: string; name: string }
type TextMsg = { type: "text"; content: string };
type PermMsg = { type: "local-tool-permission"; ask: { status: "pending" | "approved" | "denied" | "expired"; target: string; requestId: string } };
type ApprovalMsg = { type: "auto-review-approval"; approval: { status: "pending" | "approved" | "denied"; summary: string; requestId: string } };
/**
 * "This routine cannot fire until you connect the platform it listens on."
 *
 * The original emits one 10ms after creating a routine whose trigger is a Slack mention, verbatim:
 *   {"type":"listener-connect","platform":"slack","reason":"so this routine can fire"}
 */
type ListenerConnectMsg = { type: "listener-connect"; platform: string; reason: string };
export type TranscriptEvent =
  | { type: "name-changed"; from: string; to: string }
  | { type: "automation-changed"; action: "created" | "updated" | "deleted"; automationId: string; automationName: string };
/**
 * How an agent puts a picture in the transcript. This is the ONLY shape the renderer reads
 * for an agent-side attachment:
 *
 *   kind==="send-message" && message.type==="attachment"  →  <Img alt={message.alt} url={message.url}>
 *
 * `url` decides *which component renders it*, by file extension alone — a `data:` URL has no
 * extension and falls through to a plain file chip. So `url` is a virtual path ending in
 * `.png` and the bytes are served from `attachments.ts` through the gateway. See that file
 * for the three gates involved.
 *
 * (A previous `images?: string[]` field on TextMsg was invented — nothing assigned it and the
 * renderer has no path for it. It is gone; see docs/parity.md §2.)
 */
type AttachmentMsg = { type: "attachment"; url: string; file_name: string; alt: string };
/**
 * Drafts the agent shows before anything is sent. Field names are the client's
 * (`draft.to/subject/body`, `draft.workspace/target/thread/body`).
 *
 * These are **display cards only**: the renderer has no send/approve/dismiss action for them —
 * no `sendDraft`, no status field, nothing writes back. Actually delivering one needs the
 * channel integration, which the original itself still ships as "coming soon"
 * (`availability:"coming-soon"` for both slack and discord, baked into the client). So the
 * honest use is "here is what I would send", with the user copying or telling us to proceed.
 */
type EmailDraftMsg = { type: "email-draft"; draft: { from?: string; to: string[]; subject: string; body: string } };
type SlackDraftMsg = { type: "slack-draft"; draft: { workspace?: string; target: string; thread?: string; body: string } };
/**
 * The "Your answer" question card. Shape and limits are the client's own zod schema, lifted
 * verbatim from the widget view chunk — including its wording for what each field is for:
 *
 *   value   "Text sent back to you when this option is picked. Defaults to the label.
 *            Make it read like something the user would naturally say in reply."
 *   options min 1, MAX 6 — more than six and the card is invalid.
 *   dismissOnMoveOn  auto-dismiss once the user sends a newer message without answering.
 *
 * `prompt` must be a non-empty string or the renderer falls back to a blank card.
 */
export type WidgetOption = { label: string; value?: string; description?: string; style?: "default" | "primary" | "danger" };
type WidgetMsg = {
  type: "widget";
  widget: { prompt: string; helpText?: string; options: WidgetOption[]; allowCustom?: boolean; dismissOnMoveOn?: boolean };
};

export type Entry =
  /**
   * A message between two bots. The renderer treats `kind:"message"` with either peer field
   * set as inter-agent traffic (client: `fm`), and labels the group from direction and peer
   * count: "Message from X" / "Messaged X" / "Messaged N agents" / "N messages with N agents".
   * `toAgent.kind` is "agent" for a bot; other values mean a non-agent target.
   */
  | (Base & { kind: "message"; role: "user" | "assistant"; content: string; clientNonce?: string; isStreaming?: boolean; fromAgent?: { id: string; name: string }; toAgent?: { id: string; name: string; kind: "agent" } })
  // respondedValue / widgetDismissed live on the ENTRY, not inside message.widget — that is
  // what flips the card from "question" to "resolved" (client: HWn).
  | (Base & { kind: "send-message"; author: Author; boxRequestId?: string; boxInstruction?: string; boxResolution?: "handed_back" | "replied" | "dismissed"; message: TextMsg | PermMsg | ApprovalMsg | AttachmentMsg | WidgetMsg | EmailDraftMsg | SlackDraftMsg | ListenerConnectMsg; streaming?: boolean; respondedValue?: string; respondedValueEchoed?: boolean; widgetDismissed?: boolean; widgetSkipped?: boolean })
  // status "failed", not "error": the FE picks the tool card's icon with
  // `status==="pending" ? loading : status==="failed" ? x-circle : wrench`, so an
  // "error" tool renders as an ordinary wrench and reads as if it had succeeded.
  | (Base & { kind: "tool-call"; toolCallId: string; name: string; rawArgs: string; summary?: string; status: "pending" | "running" | "done" | "failed"; result?: string })
  /**
   * Something that HAPPENED to the bot, recorded inline in its own transcript.
   *
   * Shapes copied from the original's stored replica rather than invented — its "Thư ký" carries
   * five of these, three renames and two routine changes:
   *
   *   {"kind":"event","id":"event-<uuid>","event":{"type":"name-changed","from":"Inbox Triage","to":"Điều phối"},"timestampMs":…}
   *   {"kind":"event","id":"event-<uuid>","event":{"type":"automation-changed","action":"created",
   *     "automationId":"slack-l-nh-th-k","automationName":"Slack lệnh Thư ký"},"timestampMs":…}
   *
   * We already rename bots and create routines; we simply never wrote the fact down, so the history
   * read as if the bot had always been called what it is called now.
   */
  | (Base & { kind: "event"; event: TranscriptEvent });

/**
 * `currentActivity` — what the agent is doing, shown next to the typing indicator.
 *
 * `{kind:"thinking"}` renders "Thinking"; `{kind:"tool", tool}` is looked up in the client's
 * own table, so the tool name must be its PascalCase one or it falls back to plain "Working":
 *   WebSearch → Searching the web · WebFetch → Reading the web · Read/BoxRead → Reading file
 *   GenerateImage → Generating a photo · Task → Waiting on another agent · ReactToMessage → Messaging
 */
export type AgentActivity = { kind: "thinking" } | { kind: "tool"; tool: string; detail?: string };

export interface AgentRecord {
  id: string; name: string; agentOwnerAuthId: string; createdAtMs: number; unread: boolean; hidden: boolean;
  avatarDataUrl?: string; avatarVersion?: string; notificationsEnabled?: boolean; notifyOnUpdates?: boolean;
  /**
   * Presence — what drives the typing/working indicator and the avatar animation.
   *
   * The client computes the indicator as
   *   isAgentRunning ? (isAgentComposing ? "typing" : "working") : "none"
   * from `isRunning` and `isComposingMessage` ON THIS RECORD, and it compares presence by
   * exactly these four fields. We never sent any of them, which is why a turn showed no
   * indicator at all: as far as the app was concerned the bot was idle the whole time.
   */
  isRunning?: boolean;
  isComposingMessage?: boolean;
  isRetrying?: boolean;
  awaitingUserResponse?: unknown;
  currentActivity?: AgentActivity | null;
}

const agents = new Map<string, AgentRecord>();
const transcripts = new Map<string, Entry[]>();
const inflight = new Map<string, AbortController>();
/**
 * A turn parked waiting on the user, and everything needed to continue it.
 *
 * Approvals, unanswered question widgets and box handoffs are the same thing wearing three
 * hats: the turn stops, a card sits on screen, and when the user acts the model has to pick
 * up from `history`. Keeping one shape means one persistence path instead of three — the
 * previous three in-memory maps each silently orphaned their card on restart.
 */
export interface Parked {
  kind: "approval" | "widget" | "handoff";
  /** requestId for an approval, agentId for the other two. */
  key: string;
  agentId: string;
  history?: PoolMessage[];
  /** Approval only: the permission card and the tool-call entry it drives. */
  entryId?: string;
  toolCallId?: string;
  name?: string;
  arg?: string;
}

const parked = new Map<string, Parked>();
const parkKey = (kind: Parked["kind"], key: string) => `${kind}:${key}`;

/**
 * Hand-back after a restart: the Promise the tool was awaiting died with the old process, so
 * continue the turn from the persisted history instead. With the turn still in flight
 * forever-box resolves the Promise directly and this never fires.
 */
setHandBackSink((agentId, outcome) => {
  const waiting = unpark("handoff", agentId);
  if (!waiting?.history) return;
  continueAfterTool(agentId, waiting.history, "request_box_help", waiting.arg ?? "", outcome);
});

/**
 * The inline "Computer" card in the transcript.
 *
 * The right-rail "Needs your attention" panel came for free from `getForeverBoxStatus`, but
 * the original ALSO puts a card in the conversation — the one reading
 * `Computer · Done / <instruction> / [Open computer]`. It is driven entirely by fields on a
 * `send-message` entry (client `Obn`):
 *
 *   entry.boxRequestId   — the trigger. No card without it, whatever else is set.
 *   entry.boxInstruction — shown once the handoff is over.
 *   entry.boxResolution  — handed_back → "Done" · replied → "Answered" · dismissed → "Skipped"
 *
 * While a handoff with the same `requestId` is still live, the client ignores those two and
 * renders the waiting state (Take over / I'm done / Skip) from the live record instead. So the
 * entry is written once, at the start, and only its resolution is patched afterwards.
 */
function postBoxHandoffCard(agentId: string, handoff: BoxHandoff): void {
  tail(agentId).push({
    id: nextId(), kind: "send-message", author: authorOf(agentId), timestampMs: Date.now(),
    message: { type: "text", content: "" },
    boxRequestId: handoff.requestId,
    boxInstruction: handoff.instruction,
  });
  onUpdate(agentId);
}

function settleBoxHandoffCard(agentId: string, resolution: "handed_back" | "replied" | "dismissed"): void {
  const t = transcripts.get(agentId) ?? [];
  for (let i = t.length - 1; i >= 0; i--) {
    const e = t[i];
    if (e.kind === "send-message" && e.boxRequestId != null && e.boxResolution == null) {
      e.boxResolution = resolution;
      onUpdate(agentId);
      return;
    }
  }
}

setHandoffStartSink(postBoxHandoffCard);
setHandoffEndSink(settleBoxHandoffCard);
// When a computer session is finally released, close the tab it was driving.
setComputerReleaseSink((agentId) => { void closeAgentTab(agentId); });
const park = (p: Parked): void => { parked.set(parkKey(p.kind, p.key), p); persist(); };
const unpark = (kind: Parked["kind"], key: string): Parked | undefined => {
  const k = parkKey(kind, key);
  const hit = parked.get(k);
  if (hit) { parked.delete(k); persist(); }
  return hit;
};

/** Backwards-compatible view for the approval path, which looks up by requestId. */
const pending = {
  has: (id: string) => parked.has(parkKey("approval", id)),
  get: (id: string) => parked.get(parkKey("approval", id)),
  set: (id: string, v: Omit<Parked, "kind" | "key">) => park({ ...v, kind: "approval", key: id }),
  delete: (id: string) => { unpark("approval", id); },
  entries: () => [...parked.values()].filter((p) => p.kind === "approval").map((p) => [p.key, p] as const),
};
/** Per-agent compaction checkpoint, so a long conversation is summarised once, not per turn. */
const compaction = new Map<string, CompactionState>();
/** Per-agent checklist behind todo_write / todo_read / create_plan. Persisted with the rest. */
interface Todo { text: string; done: boolean }
const todos = new Map<string, Todo[]>();
const renderTodos = (list: Todo[]): string =>
  list.map((t, i) => `${t.done ? "[x]" : "[ ]"} ${i + 1}. ${t.text}`).join("\n");
let agentSeq = 1, entrySeq = 1, reqSeq = 1, toolSeq = 1;

interface AcceptanceRecord {
  accountSlot: string; clientNonce: string; status: "pending" | "accepted" | "rejected";
  acceptedAtMs: number; agentId: string; echoEntryId: string | null; rejectionCode: string | null;
}
const acceptance = new Map<string, AcceptanceRecord>();
// Persisted: after a backend restart the composer re-polls its queued nonces, and a
// forgotten ledger makes every one of them show "Failed to send".

// ── persistence ───────────────────────────────────────────────────────────────
const snapshot = (): PersistedState => ({
  agents: [...agents.values()],
  transcripts: Object.fromEntries([...transcripts.entries()]),
  seq: { agent: agentSeq, entry: entrySeq },
  acceptance: [...acceptance.values()],
  automations: automationsRef(),
  compaction: Object.fromEntries(compaction),
  parked: [...parked.values()],
  todos: Object.fromEntries(todos),
  handoffs: handoffEntries(),
});
export const chatSnapshot = snapshot;
let hostSettingsRef: () => Record<string, unknown> = () => ({});
export function bindHostSettings(get: () => Record<string, unknown>): void { hostSettingsRef = get; }
// Routines live in automations.ts but share this one save path — a second writer to
// state.json would race the debounced write and silently drop whichever lost.
let automationsRef: () => unknown[] = () => [];
export function bindAutomationsSnapshot(get: () => unknown[]): void { automationsRef = get; }
/**
 * Injected the same way, and for the same reason: automations.ts imports THIS module, so reaching
 * back the other way with a plain import would close the cycle. `create_routine` needs a creator, and
 * this is the seam that already exists for exactly that.
 */
let automationCreateRef: ((agentId: string, spec: { name: string; prompt: string; trigger: string }) => string | null) | null = null;
export function bindAutomationCreate(fn: (agentId: string, spec: { name: string; prompt: string; trigger: string }) => string | null): void {
  automationCreateRef = fn;
}
const persist = () => scheduleSave(() => ({ ...snapshot(), hostSettings: hostSettingsRef() }));
export const persistState = persist;

/** Older builds stored user-message/agent-message (a shared-room shape the renderer ignores). */
function migrate(e: any, agentName: string): Entry | null {
  if (!e || typeof e !== "object") return null;
  const id = e.id ?? e.entryId ?? `e${entrySeq++}`;
  const ts = e.timestampMs ?? Date.now();
  if (e.kind === "user-message") return { id, kind: "message", role: "user", content: e.text ?? "", timestampMs: ts, ...(e.clientNonce ? { clientNonce: e.clientNonce } : {}) };
  if (e.kind === "agent-message") return { id, kind: "send-message", author: { id: e.agentId ?? "agent", name: e.authorName ?? agentName }, message: { type: "text", content: e.text ?? "" }, timestampMs: ts };
  // Nothing can still be streaming in a process that has only just started. A turn cut off
  // mid-generation (a backend restart, a crash) is persisted with `streaming: true`, and on
  // restore the app sees a bubble that never finishes: an empty message that sits there
  // forever with no text and no typing indicator, because as far as the client is concerned
  // the answer is still coming.
  if (e.kind === "send-message" && e.streaming) {
    e.streaming = false;
    const empty = e.message?.type === "text" && !String(e.message.content ?? "").trim();
    if (empty) return null;                       // drop it rather than leave a blank bubble
    if (e.message?.type === "text") e.message.content += "\n\n⏹ (bị ngắt giữa chừng)";
  }
  if (e.kind === "message" || e.kind === "send-message" || e.kind === "tool-call") {
    // Reactions used to be plain emoji strings; the FE needs {emoji, by}.
    if (Array.isArray(e.reactions)) {
      e.reactions = e.reactions
        .map((r: any) => (typeof r === "string" ? { emoji: r, by: ME } : r))
        .filter((r: any) => r && typeof r.emoji === "string");
    }
    return e as Entry;
  }
  return null;
}

{
  const s = loadState();
  for (const a of (s.agents ?? []) as AgentRecord[]) {
    if (!a?.id) continue;
    // Presence is live state, not saved state: restoring `isRunning: true` leaves a bot
    // typing forever with nothing generating behind it.
    a.isRunning = false; a.isComposingMessage = false; a.isRetrying = false; a.currentActivity = null;
    agents.set(a.id, a);
  }
  for (const [id, entries] of Object.entries(s.transcripts ?? {})) {
    const name = agents.get(id)?.name ?? "Claude";
    transcripts.set(id, (entries as any[]).map((e) => migrate(e, name)).filter((e): e is Entry => e !== null));
  }
  for (const r of (s.acceptance ?? []) as AcceptanceRecord[]) if (r?.clientNonce) acceptance.set(r.clientNonce, r);
  for (const p of (s.parked ?? []) as Parked[]) if (p?.kind && p.key) parked.set(parkKey(p.kind, p.key), p);
  for (const [id, list] of Object.entries((s.todos ?? {}) as Record<string, Todo[]>)) if (Array.isArray(list)) todos.set(id, list);
  for (const [id, h] of (s.handoffs ?? []) as [string, BoxHandoff][]) if (id && h?.requestId) restoreHandoff(id, h);
  if (parked.size) console.log(`[grokbot2] restored ${parked.size} parked turn(s)`);
  // Without this a restart discards every checkpoint and resends the full transcript —
  // the exact cost the compaction exists to avoid.
  for (const [id, c] of Object.entries((s.compaction ?? {}) as Record<string, CompactionState>)) {
    if (c?.summary && typeof c.coveredCount === "number") compaction.set(id, c);
  }
  // Derive counters from the highest id present — agents.size would reissue a live id.
  const maxNum = (ids: Iterable<string>, re: RegExp) => {
    let max = 0;
    for (const id of ids) { const m = re.exec(id); if (m) max = Math.max(max, Number(m[1]) || 0); }
    return max;
  };
  agentSeq = Math.max(s.seq?.agent ?? 0, maxNum(agents.keys(), /^agent-(\d+)$/) + 1, 1);
  entrySeq = Math.max(s.seq?.entry ?? 0, maxNum([...transcripts.values()].flat().map((e) => e.id), /^e(\d+)$/) + 1, 1);
  // Approval ids must keep climbing across restarts too. They were not derived from anything
  // persistent, so every restart reissued `req-1`/`tc-1`: the pending map then keyed two live
  // approvals the same, and resolving one could run the other's tool. Derive them from what
  // is already on disk, exactly as entrySeq does.
  const all = [...transcripts.values()].flat();
  reqSeq = Math.max(
    maxNum(all.flatMap((e) => (e.kind === "send-message" && e.message.type === "local-tool-permission" ? [e.message.ask.requestId] : [])), /^req-(\d+)$/) + 1,
    1,
  );
  toolSeq = Math.max(maxNum(all.flatMap((e) => (e.kind === "tool-call" ? [e.toolCallId] : [])), /^tc-(\d+)$/) + 1, 1);
  if (agents.size) console.log(`[grokbot2] restored ${agents.size} agent(s), ${[...transcripts.values()].flat().length} transcript entries`);
}

/**
 * SAFE tools — pure, no side effects, no system access. The model may request these.
 * Async is allowed: the browser tools below reach the box over CDP and take real time.
 */
/**
 * What a tool may do besides return text. `attach` drops a picture into the transcript —
 * the original's browser tools return a screenshot after every action, and this is how we
 * match that without threading the agent id through every tool signature.
 */
export interface ToolCtx {
  attach(dataUrl: string, fileName: string, alt: string): void;
  /** Put a question card in the transcript; returns its entry id, or null if malformed. */
  ask(widget: { prompt: string; helpText?: string; options: WidgetOption[]; allowCustom?: boolean; dismissOnMoveOn?: boolean }): string | null;
  /** Post a short progress line — how a long-running tool keeps the user posted. */
  note(text: string): void;
  /** Hand the screen to the user; resolves when they hand the box back. */
  requestBoxHelp(instruction: string): Promise<string>;
  /** Which agent this tool is running for — memory is per bot. */
  agentId: string;
  /** Put a draft card in the transcript (display only: the renderer has no send action). */
  draft(message: EmailDraftMsg | SlackDraftMsg): void;
}

/** Every tool the model is actually offered right now — used by scripts/tool-coverage.mjs. */
export const toolNames = (): string[] => Object.keys(TOOLS);

const TOOLS: Record<string, (arg: string, ctx: ToolCtx) => string | Promise<string>> = {
  echo: (a) => a || "(empty)",
  time: () => new Date().toISOString(),
  reverse: (a) => [...a].reverse().join(""),
  upper: (a) => a.toUpperCase(),
  count: (a) => `${a.trim().split(/\s+/).filter(Boolean).length} từ, ${a.length} ký tự`,
  calc: (a) => {
    if (!/^[\d\s+\-*/().]+$/.test(a)) return "chỉ hỗ trợ số và + - * / ( )";
    try { return String(Function(`"use strict";return(${a})`)()); } catch { return "biểu thức không hợp lệ"; }
  },
};

/**
 * Ask the user a multiple-choice question (`ask_question` in the original catalog).
 * Auto-approved: it has no side effect, and putting an approval card in front of a question
 * would make the user click twice to be asked something.
 */
/**
 * Remember something about this user (`knowledge_base` in the original catalog).
 *
 * Auto-approved: writing a note has no side effect outside the agent's own memory, and an
 * approval card in front of it would train the model to stop bothering.
 */
TOOLS.knowledge_base = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { knowledge_to_store: arg }; }
  const r = await knowledgeBase(ctx.agentId, {
    knowledge_to_store: spec?.knowledge_to_store ?? spec?.content ?? spec?.text,
    title: spec?.title,
    existing_knowledge_id: spec?.existing_knowledge_id ?? spec?.id,
    action: spec?.action,
  });
  return r.confirmation_message;
};

TOOLS.ask_question = (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { return 'ask_question cần JSON, ví dụ {"prompt":"…","options":[{"label":"A"}]}'; }
  // The client's own zod schema caps options at SIX; a seventh makes the whole card invalid
  // and it renders as nothing. Models happily produce eight, so cap here rather than let a
  // question disappear — a silently missing question reads as the agent ignoring the user.
  const options = (Array.isArray(spec?.options) ? spec.options : [])
    .map((o: any) => (typeof o === "string" ? { label: o } : o))
    .filter((o: any) => typeof o?.label === "string")
    .slice(0, 6);
  const prompt = typeof spec?.prompt === "string" ? spec.prompt : typeof spec?.title === "string" ? spec.title : "";
  const id = ctx.ask({
    prompt,
    options,
    ...(typeof spec?.helpText === "string" ? { helpText: spec.helpText } : {}),
    ...(typeof spec?.allowCustom === "boolean" ? { allowCustom: spec.allowCustom } : {}),
    ...(typeof spec?.dismissOnMoveOn === "boolean" ? { dismissOnMoveOn: spec.dismissOnMoveOn } : {}),
  });
  return id == null
    ? "ask_question cần prompt không rỗng và ít nhất một option"
    : `đã hỏi người dùng: ${prompt}`;
};

/**
 * Show a draft before anything is sent. These render as the client's own draft cards, but the
 * renderer gives them no send button — see EmailDraftMsg — so the turn should say what it wants
 * to do with the draft rather than implying it went out.
 */
/**
 * Message another bot (`send_message` in the original's tool identifiers). This is what makes
 * a roster act like a team: one bot briefs another and the reply comes back as its own turn.
 */
TOOLS.message_agent = (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch {
    const m = arg.match(/^\s*([^:,]+)\s*[:,]\s*([\s\S]+)$/);   // "Sales: nội dung"
    spec = m ? { to: m[1], content: m[2] } : null;
  }
  const raw = spec?.to ?? spec?.agent ?? spec?.name ?? spec?.agents ?? spec?.bots;
  // One target or many. The client turns several consecutive outbound entries into
  // "Messaged N agents" by itself (see the fan-out note on messageAgent), so briefing a whole
  // team is just this tool called with a list — no new entry kind, no new gateway method.
  const targets = (Array.isArray(raw) ? raw : String(raw ?? "").split(/[,;]/))
    .map((t) => String(t).trim()).filter(Boolean);
  const content = String(spec?.content ?? spec?.message ?? spec?.text ?? "").trim();
  if (targets.length === 0 || !content) return 'message_agent cần {"to":"tên bot" hoặc ["bot A","bot B"],"content":"nội dung"}';
  return targets.map((t) => messageAgent(ctx.agentId, t, content)).join("; ");
};

/**
 * Speak mid-turn — the port of the original's `SendMessage`.
 *
 * The two architectures are inverted, and this is the seam. In the original, the model's plain
 * text is a private scratchpad and `SendMessage` is the ONLY channel that reaches the user, so
 * every call is its own bubble and a long task narrates itself step by step. Here the plain
 * text IS the message, which gives exactly one bubble per turn — so a multi-step turn ran the
 * browser, attached screenshots, and said nothing at all until the very end. Reported as
 * "agent làm việc rồi vất mấy tấm ảnh, không có phản hồi nào".
 *
 * Rather than invert our model (risky, and the streaming reply is the good part), this adds the
 * missing half: the model can post an interim line whenever it wants, and its closing text is
 * still the final bubble. `ctx.note` already emits the right entry — a `send-message` with
 * `type:"text"` is exactly what the renderer draws as a bubble — so nothing new is needed on
 * the transcript side.
 *
 * The name is the catalog's (`send_to_user`, CLIENT_SIDE_TOOL_V2_SEND_TO_USER). Its parameter
 * shape is not in the extracted catalog (`paramsMessage: null`), so this takes plain text and a
 * `{"text":…}` object rather than pretending to know the original's field name.
 */
TOOLS.send_to_user = (arg, ctx) => {
  let text = arg.trim();
  if (text.startsWith("{")) {
    try {
      const o = JSON.parse(text);
      text = String(o?.text ?? o?.message ?? o?.content ?? "").trim();
    } catch { text = unquote(arg); }
  } else {
    text = unquote(arg);
  }
  if (!text) return "(send_to_user cần nội dung)";
  ctx.note(text);
  return "đã gửi";
};

/**
 * Building the roster from inside a conversation.
 *
 * The original's agent does this — its history shows one bot answering "Tạo 3 con luôn. Con
 * 'New Bot' trống mình đổi thành Quản lý, rồi thêm Gmail và Discord CSKH." and the roster
 * gaining three bots. The activity table names the tools `CreateAgent` and `UpdateAgent`
 * (both render as "Messaging"), which is why those are the activity strings used here.
 *
 * Creating is deliberately not auto-approved: it changes the user's sidebar, which is theirs.
 */
TOOLS.create_agent = (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { name: unquote(arg) }; }
  const names = (Array.isArray(spec?.names) ? spec.names : [spec?.name ?? spec?.title ?? unquote(arg)])
    .map((n: unknown) => String(n ?? "").trim()).filter(Boolean);
  if (names.length === 0) return 'create_agent cần {"name":"tên bot"} hoặc {"names":["A","B"]}';
  const made: AgentRecord[] = names.map((n: string) => createAgent({ name: n }));
  // Brief each new bot with its purpose, if one was given — an empty bot is not a colleague.
  const brief = String(spec?.brief ?? spec?.role ?? spec?.instructions ?? "").trim();
  if (brief) for (const m of made) sendPrompt({ agentId: m.id, content: brief, fromAgent: { id: ctx.agentId, name: agents.get(ctx.agentId)?.name ?? "bot" } });
  return `đã tạo ${made.map((m) => m.name).join(", ")}`;
};

/**
 * Let a bot schedule ITSELF — the piece the original has and we did not.
 *
 * Traced in the original's own history: nobody asked for a routine. The user said "mở đúng chat Thư ký
 * trên Grok Bot. Muốn thử Slack thì bảo mình install", and the bot installed the Slack connector,
 * connected it, then created a routine called "Slack lệnh Thư ký" and told the user to `/invite
 * @Cursor`. The instruction it wrote is in ENGLISH inside an otherwise Vietnamese conversation and
 * names the exact ids and roles of five sibling bots — which is the tell that the agent wrote it, not
 * the person. The later `updated` event has no bot message before it: that one WAS the routine editor.
 *
 * The backend side already existed (`createAgentAutomation`, the scheduler, the panel); only the tool
 * was missing, so the model had no way to reach any of it.
 */
TOOLS.create_routine = (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { prompt: unquote(arg) }; }
  const prompt = String(spec?.prompt ?? spec?.instruction ?? spec?.task ?? "").trim();
  if (!prompt) return 'create_routine cần {"name":"tên","prompt":"việc cần làm","trigger":"0 9 * * *"}';
  const name = String(spec?.name ?? spec?.title ?? "").trim() || "Routine";
  // The trigger is a cron string, or a platform word for an event-driven routine. Passing the word
  // through unchanged is what lets `listenerPlatform` recognise it and warn that nothing can fire it.
  const trigger = String(spec?.trigger ?? spec?.schedule ?? spec?.when ?? "0 9 * * *").trim();
  if (!automationCreateRef) return "(routine chưa sẵn sàng)";
  const made = automationCreateRef(ctx.agentId, { name, prompt, trigger });
  return made ? `đã tạo routine "${name}" — ${made}` : "(không tạo được routine)";
};

TOOLS.rename_agent = (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch {
    const m = arg.match(/^\s*([^,]+)\s*,\s*([\s\S]+)$/);      // "Cũ, Mới"
    spec = m ? { from: m[1], to: m[2] } : { to: unquote(arg) };
  }
  const wanted = String(spec?.to ?? spec?.name ?? spec?.newName ?? "").trim();
  if (!wanted) return 'rename_agent cần {"from":"tên cũ","to":"tên mới"} (bỏ "from" để tự đổi tên mình)';
  const fromRaw = String(spec?.from ?? spec?.agent ?? "").trim();
  const target = fromRaw
    ? agents.get(fromRaw) ?? [...agents.values()].find((a) => a.name.toLowerCase() === fromRaw.toLowerCase())
    : agents.get(ctx.agentId);
  if (!target) return `(không tìm thấy bot "${fromRaw}")`;
  const was = target.name;
  updateAgent({ id: target.id, profile: { name: wanted } });
  rosterChanged(target.id);
  return `đã đổi tên "${was}" thành "${wanted}"`;
};

/**
 * Attach a file the agent already wrote (with edit_file_v2) to the conversation.
 *
 * Kept separate from writing on purpose: the original writes and attaches as two visible
 * steps, and folding them together would attach every scratch file the agent touches.
 */
TOOLS.attach_file = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { path: unquote(arg) }; }
  const path = String(spec?.path ?? spec?.file ?? spec?.target_file ?? "").trim();
  if (!path) return 'attach_file cần {"path":"tên file trên máy tính của bạn"}';

  // Resolve to the absolute box path: the renderer keys the preview off exactly the string
  // in `url`, so a relative path here and an absolute one at read time never meet.
  let abs = path, size = 0;
  try {
    const r = await boxCall<{ path: string; totalSize: number }>("readBytes", { target_file: path, offset: 0, length: 0 });
    abs = r.path; size = r.totalSize;
  } catch (e) {
    return `Không đọc được ${path}: ${(e as Error).message}`;
  }
  const fileName = abs.split("/").pop() || path;
  const alt = String(spec?.alt ?? spec?.caption ?? fileName);
  postFileAttachment(ctx.agentId, abs, fileName, alt);
  return `Đã đính kèm ${fileName} (${size} byte).`;
};

/** Refuse anything larger than this. A transcript attachment is inlined as base64 to the client. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Is this host inside the machine or its network?
 *
 * Checking the literal string is not enough — `evil.test` can resolve to 127.0.0.1, and that is
 * the ordinary way a fetcher is turned against its own host. So the name is resolved and every
 * address it returns is judged; a name resolving to several addresses is only safe when all of
 * them are. Unresolvable is treated as internal: the fetch would fail anyway, and defaulting a
 * security check to "allow" on an error is how these fences stop working quietly.
 */
async function isInternalHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  let addrs: string[];
  try {
    const { lookup } = await import("node:dns/promises");
    addrs = (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return true;
  }
  return addrs.length === 0 || addrs.some(isPrivateAddress);
}

/** Loopback, link-local, and the RFC1918 / unique-local ranges, for both address families. */
function isPrivateAddress(addr: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(addr);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 127 || a === 10
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)      // link-local, incl. the 169.254.169.254 metadata address
      || (a === 100 && b >= 64 && b <= 127)
      || a >= 224;                     // multicast and reserved
  }
  const v6 = addr.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd")) return true;
  // ::ffff:127.0.0.1 and friends — an IPv4 address wearing a v6 coat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  return mapped ? isPrivateAddress(mapped[1]) : false;
}

/**
 * Show a picture that lives on the web, by fetching the bytes and attaching them.
 *
 * This is the only implementation that works. The renderer will not load a third-party URL —
 * a real CDN link renders as "Couldn't load image" — which is exactly why every image in the
 * original's transcript is an attachment and never a link (parity.md §2u). Without this tool
 * the model's only way to answer "show me the images on this page" was a markdown link, which
 * is what it was doing.
 *
 * The URL comes from the model, so this is a request forger's tool by construction. It is
 * fenced accordingly: http(s) only, and no address inside the machine or its network. That
 * matters more here than the generic advice implies — the box's Chrome DevTools port listens
 * on loopback and is unauthenticated remote code execution, so an unfenced fetcher would hand
 * a prompt-injected page a way to reach it.
 */
TOOLS.attach_image = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { url: unquote(arg) }; }

  // One call per image was the first shape, and it spends a tool step per picture against a
  // budget of MAX_TOOL_STEPS for the whole turn: asking for six images left no steps to answer
  // with. The batch form is the same tool, so the model can keep using `url` for one.
  const list: string[] = Array.isArray(spec?.urls) ? spec.urls
    : Array.isArray(spec?.url) ? spec.url
    : [spec?.url ?? spec?.src ?? spec?.href];
  const urls = list.map((u) => String(u ?? "").trim()).filter(Boolean);
  if (urls.length === 0) return 'attach_image cần {"url":"https://…"} hoặc {"urls":["…","…"]}';

  if (urls.length > 1) {
    const capped = urls.slice(0, MAX_IMAGES_PER_CALL);
    // Sequential, not Promise.all: each success posts an attachment, and the transcript should
    // fill in the order the model asked for rather than in whichever order the CDNs answer.
    const lines: string[] = [];
    for (const [i, u] of capped.entries()) lines.push(`${i + 1}. ${await attachOneImage(ctx.agentId, u, spec?.alt)}`);
    if (urls.length > capped.length) lines.push(`(bỏ qua ${urls.length - capped.length} ảnh: mỗi lần gọi tối đa ${MAX_IMAGES_PER_CALL})`);
    return lines.join("\n");
  }
  return attachOneImage(ctx.agentId, urls[0], spec?.alt);
};

/** At most this many images in one batched call, so a turn cannot be flooded with attachments. */
const MAX_IMAGES_PER_CALL = 8;

/** Fetch, fence, measure and post a single image. Returns the sentence the model reads back. */
async function attachOneImage(agentId: string, raw: string, altHint?: unknown): Promise<string> {
  let target: URL;
  try { target = new URL(raw); } catch { return `Không phải URL hợp lệ: ${raw}`; }
  if (target.protocol !== "http:" && target.protocol !== "https:") return "Chỉ tải được ảnh qua http/https.";
  if (await isInternalHost(target.hostname)) return "Không tải ảnh từ địa chỉ nội bộ.";

  let bytes: Buffer;
  let res: Response;
  try {
    res = await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return `Tải ảnh thất bại (HTTP ${res.status}).`;
    // Cap what is read. Content-Length is a claim the server makes and can omit or lie about,
    // so the buffer is checked after the read as well as before it.
    const claimed = Number(res.headers.get("content-length") ?? 0);
    if (claimed > MAX_IMAGE_BYTES) return `Ảnh quá lớn (${Math.round(claimed / 1024)} KB).`;
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return `Không tải được ảnh: ${(e as Error).message}`;
  }
  if (bytes.length > MAX_IMAGE_BYTES) return `Ảnh quá lớn (${Math.round(bytes.length / 1024)} KB).`;

  // A redirect can leave http(s) for the internal network, and the fence above only saw the
  // first hop. `res.url` is where the bytes actually came from, so re-check it.
  try {
    const landed = new URL(res.url || target.href);
    if (await isInternalHost(landed.hostname)) return "Không tải ảnh từ địa chỉ nội bộ.";
  } catch { /* keep the original verdict */ }

  const measured = imageSize(bytes);
  if (measured == null) return "Nội dung tải về không phải ảnh đọc được (PNG/JPEG/GIF/WebP).";

  const fileName = decodeURIComponent(target.pathname.split("/").pop() || "") || `image.${measured.mime.slice(6)}`;
  const alt = String(altHint ?? fileName);
  postAttachment(agentId, `data:${measured.mime};base64,${bytes.toString("base64")}`, fileName, alt);
  return `Đã đính kèm ${fileName} (${measured.width}×${measured.height}).`;
}

/**
 * Make a picture from a description — `generate_image` in the original's catalog.
 *
 * The catalog entry carries no parameter message (`paramsMessage: null`) and the shipped prompt
 * never describes it, so the contract came from the pool itself rather than from a guess:
 *
 *   POST /v1/images {model, prompt}
 *     → {model, count, images:[{url, rel, mimeType}], edited, account}
 *
 * It answers with a URL, not bytes, so the second half is `attachOneImage` unchanged — the same
 * download, internal-address fence, format measurement and staging that `attach_image` uses. The
 * client cannot load a remote image (parity.md §2u), so staging is not an optimisation here; it
 * is the only thing that puts the picture on screen.
 */
TOOLS.generate_image = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { prompt: unquote(arg) }; }
  const prompt = String(spec?.prompt ?? spec?.description ?? spec?.text ?? "").trim();
  if (!prompt) return 'generate_image cần {"prompt":"mô tả ảnh muốn vẽ"}';

  const key = loadPoolKey();
  if (!key) return "Chưa có key cho pool nên không tạo được ảnh.";

  let payload: { images?: { url?: string }[] };
  try {
    const res = await fetch(config.imagesUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: config.imageModel, prompt }),
      // Generation is slower than a chat turn; the pool answered in ~10s when probed.
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    if (!res.ok) return `Tạo ảnh thất bại (HTTP ${res.status}): ${text.slice(0, 160)}`;
    payload = JSON.parse(text);
  } catch (e) {
    return `Không tạo được ảnh: ${(e as Error).message}`;
  }

  const url = payload?.images?.[0]?.url;
  if (typeof url !== "string" || !url) return "Pool không trả về ảnh nào.";
  const alt = String(spec?.alt ?? prompt).slice(0, 200);
  return attachOneImage(ctx.agentId, url, alt);
};

TOOLS.email_draft = (arg, ctx) => {
  let d: any;
  try { d = JSON.parse(arg); } catch { return 'email_draft cần {"to":["a@b.c"],"subject":"…","body":"…"}'; }
  const to = Array.isArray(d?.to) ? d.to.filter((x: unknown) => typeof x === "string") : typeof d?.to === "string" ? [d.to] : [];
  const subject = typeof d?.subject === "string" ? d.subject : "";
  const body = typeof d?.body === "string" ? d.body : "";
  if (to.length === 0 || !body) return 'email_draft cần ít nhất {"to":[…],"body":"…"}';
  ctx.draft({ type: "email-draft", draft: { ...(typeof d.from === "string" ? { from: d.from } : {}), to, subject, body } });
  return `đã soạn nháp email tới ${to.join(", ")} (chưa gửi — cần người dùng xác nhận)`;
};

TOOLS.slack_draft = (arg, ctx) => {
  let d: any;
  try { d = JSON.parse(arg); } catch { return 'slack_draft cần {"target":"#kênh","body":"…"}'; }
  const target = typeof d?.target === "string" ? d.target : "";
  const body = typeof d?.body === "string" ? d.body : "";
  if (!target || !body) return 'slack_draft cần {"target":"#kênh hoặc @người","body":"…"}';
  ctx.draft({
    type: "slack-draft",
    draft: {
      ...(typeof d.workspace === "string" ? { workspace: d.workspace } : {}),
      target,
      ...(typeof d.thread === "string" ? { thread: d.thread } : {}),
      body,
    },
  });
  return `đã soạn nháp Slack cho ${target} (chưa gửi — cần người dùng xác nhận)`;
};

/**
 * A visible checklist for multi-step work (`todo_write` / `todo_read` in the original catalog).
 * Persisted with everything else, so a restart mid-task does not lose the plan.
 */
TOOLS.todo_write = (arg, ctx) => {
  let items: any;
  try { items = JSON.parse(arg); } catch { return 'todo_write cần một mảng, ví dụ ["việc A","việc B"] hoặc [{"text":"…","done":true}]'; }
  const list = (Array.isArray(items) ? items : items?.todos ?? [])
    .map((t: any) => (typeof t === "string" ? { text: t, done: false } : { text: String(t?.text ?? ""), done: t?.done === true }))
    .filter((t: { text: string }) => t.text.length > 0);
  if (list.length === 0) return "todo_write cần ít nhất một việc";
  todos.set(ctx.agentId, list);
  persist();
  return renderTodos(list);
};

TOOLS.todo_read = (_arg, ctx) => {
  const list = todos.get(ctx.agentId) ?? [];
  return list.length ? renderTodos(list) : "(chưa có việc nào)";
};

/**
 * `create_plan` — the original's plan tool. There is no plan card in the renderer, so the plan
 * is delivered as an ordinary message and kept as the todo list, which is what makes it visible.
 */
TOOLS.create_plan = (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { steps: arg.split(/\s*[;\n]\s*/) }; }
  const title = typeof spec?.title === "string" ? spec.title : "Kế hoạch";
  const steps = (Array.isArray(spec?.steps) ? spec.steps : Array.isArray(spec?.todos) ? spec.todos : [])
    .map((x: any) => String(typeof x === "string" ? x : x?.text ?? "")).filter((x: string) => x.trim());
  if (steps.length === 0) return 'create_plan cần {"title":"…","steps":["…","…"]}';
  const list = steps.map((text: string) => ({ text, done: false }));
  todos.set(ctx.agentId, list);
  persist();
  return `${title}\n${renderTodos(list)}`;
};

/**
 * Hand the box's screen to the user for a step only they can do — signing in, 2FA, an OAuth
 * approval (`request_box_help` in the original catalog).
 *
 * The turn blocks here until they press hand-back, which is the point: the agent must never
 * ask for, see, or type a password. They authenticate on the box desktop and the session
 * persists there, so it is a one-time step.
 */
TOOLS.request_box_help = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { instruction: arg }; }
  // Read the key the model actually used, not the one we hoped for. Falling back to the raw
  // `arg` printed `{"message":"…"}` verbatim into the chat when it sent `message` — a JSON
  // blob shown to the user as if it were a sentence. Any single string value will do.
  const named = spec?.instruction ?? spec?.prompt ?? spec?.message ?? spec?.task ?? spec?.text ?? spec?.ask;
  const onlyString = named == null && spec && typeof spec === "object"
    ? Object.values(spec).find((v) => typeof v === "string" && v.trim())
    : undefined;
  const instruction = String(named ?? onlyString ?? (typeof spec === "string" ? spec : "")).trim();
  if (!instruction) return 'request_box_help cần {"instruction":"việc cần bạn làm trên màn hình"}';
  ctx.note(`Mình cần bạn thao tác trên màn hình máy tính của mình: ${instruction}`);
  return ctx.requestBoxHelp(instruction);
};

/**
 * Hand a self-contained chunk of work to a subagent (`task_v2` in the original catalog).
 * This is how the original drives the browser: not from the main turn, but through a
 * `browserUse` subagent carrying its own prompt and tool set (see subagents.ts).
 */
TOOLS.task_v2 = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { subagent_type: "browserUse", prompt: arg }; }
  const type = String(spec?.subagent_type ?? spec?.type ?? "browserUse");
  const task = String(spec?.prompt ?? spec?.task ?? spec?.description ?? "").trim();
  if (!task) return 'task_v2 cần {"subagent_type":"browserUse","prompt":"…"}';

  // The title is the first line of the task, which is what the original's registry stores and
  // what the subagent list shows. Registering before the run is the point: a list that only
  // gains a row once the work finishes never shows anything as "running".
  const title = task.split("\n")[0].slice(0, 80);
  const subagentId = startSubagentRun(ctx.agentId, type, title);
  try {
    const out = await runSubagent(type, task, Object.keys(TOOLS), {
      runTool: async (name, toolArg) => {
        const fn = TOOLS[name];
        if (!fn) return `(không có công cụ ${name})`;
        try { return String(await fn(toolArg, ctx)); } catch (e) { return `lỗi: ${(e as Error).message}`; }
      },
      // The original tells the parent to keep the user posted while a subagent works; the
      // subagent's own steps are the only honest source of that.
      onStep: (text) => ctx.note(text),
    });
    // runSubagent reports its own refusals as text rather than throwing, so a leading "(" is
    // the difference between "ran and answered" and "never started".
    finishSubagentRun(ctx.agentId, subagentId, out.startsWith("(") ? "error" : "done");
    return out;
  } catch (e) {
    finishSubagentRun(ctx.agentId, subagentId, "error");
    throw e;
  }
};

/**
 * MCP tools (`get_mcp_tools` / `call_mcp_tool` in the original catalog) — structured access to
 * connected services. Only offered when `.mcp.json` declares at least one server.
 */
if (isMcpConfigured()) {
  // Listing is read-only; calling one is not, so only the call needs an approval card.
  TOOLS.get_mcp_tools = (arg) => getMcpTools(arg);
  TOOLS.call_mcp_tool = (arg) => callMcpTool(arg);
}

/**
 * These protocol strings are ENGLISH on purpose, like the rest of the prompt.
 *
 * `BASE_SYSTEM_PROMPT` is generated from the original app (79 of its 179 chapters) and is English
 * throughout; these seams were written here in Vietnamese, which left the shipped prompt a mix —
 * measured, 18 of 100 non-empty lines and 8% of its characters. Where the original has a sentence for
 * something, its wording is quoted below rather than paraphrased, so a model that knows the original
 * behaves the same way here. Only the mechanics of `TOOL_CALL: name(args)` are ours, because the
 * original invokes tools as native ClientSideToolV2Call protobufs and the pool has no native tool
 * calling at all.
 *
 * Measured before switching, three sequential attempts per cell with gemini-3.7-flash: tool calling is
 * IDENTICAL between the two languages (two-file task 6 calls either way, shell 3/3 either way, no
 * spurious calls either way), and a Vietnamese question still gets a Vietnamese answer 3/3 with an
 * English seam — the reply language follows the user, not the prompt. So this change buys consistency
 * with the original, not behaviour, and it is claimed as nothing more.
 *
 * What stays Vietnamese: every string the USER reads. `"[grokbot2] Pool trả về rỗng — thử gửi lại."`
 * and its kind are rendered in the app, not read by the model.
 */
const MCP_PROTOCOL = isMcpConfigured()
  ? "\n\nMCP: these services are already connected — " + Object.keys(mcpServers()).join(", ") + ". " +
    "List a server's tools with TOOL_CALL: get_mcp_tools(<server name>), then call one with " +
    'TOOL_CALL: call_mcp_tool({"server":"…","tool_name":"…","tool_args":{…}}). ' +
    "Prefer MCP over opening a browser when the service is already here."
  : "";

// Browser actions are only offered when a box browser is actually configured — advertising
// tools that cannot run just teaches the model to call them and fail.
// Registered only once the browser has actually answered. Configured-but-unreachable is
// the expensive case: the tool is offered, the model calls it, and the user waits out a
// socket timeout for "fetch failed".
// Registration follows CONFIGURATION, not a one-shot reachability probe.
//
// Gating on the probe meant a tunnel that happened to be down for those few seconds removed
// the browser tools for the whole life of the process — they never came back when the tunnel
// did, and the model simply answered as if it had no browser. A per-call failure is honest and
// recoverable ("no page target - is Chrome running on the box?"); a silently missing tool is
// neither. The probe stays, but only to say so in the startup line.
if (isBrowserConfigured()) {
  for (const name of BROWSER_TOOL_NAMES) TOOLS[name] = (arg, ctx) => runBrowserTool(name, arg, ctx);
  void browserProbe();
}

// Tools under their real ClientSideToolV2 names. availableTools() drops the shell/file ones
// when no box is attached — they run inside it and nowhere else — while web_search and
// web_fetch need neither a box nor a key, so they are always on.
for (const [name, spec] of Object.entries(availableTools())) TOOLS[name] = (arg) => spec.run(arg);

/**
 * The names and the "you already get the page back" rule come from the original's own
 * browser-use subagent reminder (docs/extracted/subagent-prompts.md); reusing its vocabulary
 * means a model that knows the original behaves correctly here.
 */
const BROWSER_PROTOCOL = isBrowserConfigured()
  // "box" is internal jargon; the original forbids saying it to the user, and the model repeats
  // whatever the tool text uses — it introduced itself as running on a "Linux Box" in a live reply.
  ? "\n\nBROWSER: the browser_* tools drive Chrome on your computer, and the user watches it live on " +
    "screen. Arguments are JSON, e.g. " +
    'TOOL_CALL: browser_navigate({"url":"https://example.com"}) or ' +
    'TOOL_CALL: browser_fill({"selector":"#q","value":"hello"}). ' +
    "Every action already returns the page state that follows it, so do NOT call browser_snapshot " +
    "or browser_take_screenshot right after another action. " +
    // Observed: asked to pull the images out of an article it had just opened, the model wrote a
    // python3 + urllib scraper and called run_terminal_command_v2 — which needs approval, refetches
    // the page as a bot, and loses everything JavaScript had rendered. The page was already there.
    "To pull content OUT of the page that is already open (images, links, titles, tables…), use " +
    "browser_evaluate on that page — do not re-fetch it with a shell command (curl/python) or " +
    "web_fetch: the open page has run its JavaScript and carries the cookies and sign-in, while a " +
    "re-fetch is usually blocked and loses everything rendered dynamically. " +
    'To collect images: TOOL_CALL: browser_evaluate({"expression":' +
    '"[...document.querySelectorAll(\'img\')].map(i=>i.currentSrc||i.src).filter(u=>u.startsWith(\'http\')).slice(0,20)"})' +
    // Having the URLs was only half of it: the model then wrote them out as markdown links,
    // which is the one thing that cannot work — the client refuses to load a third-party image
    // and shows "Couldn't load image" (parity.md §2u). Naming the tool here is what closes the
    // loop between finding an image and the user seeing it.
    // "Show your work. When you've done something visible, attach the screenshot or file that proves
    // it." — the original's own words; this is the tool that carries them out.
    "\nShow your work: once you have the image URLs, attach them so the USER actually SEES them, with " +
    'TOOL_CALL: attach_image({"urls":["https://…","https://…"]}) — send ALL of them in ONE call ' +
    '(max 8); for a single image use {"url":"https://…","alt":"description"}. ' +
    "A markdown link ![](…) will NOT display the image."
  : "";

/**
 * Image generation is advertised separately from the browser rules.
 *
 * The `attach_image` instructions live inside BROWSER_PROTOCOL because they are about pictures
 * found on a page, and that block disappears when no browser is configured. Drawing one does not
 * need a browser, so putting it there would have hidden the tool on exactly the setups where it
 * is the only way to produce an image at all.
 */
const IMAGE_PROTOCOL =
  "\n\nDRAWING IMAGES: when the user wants a picture that does not exist yet (an illustration, a rough " +
  "logo, a cover image…), call " +
  'TOOL_CALL: generate_image({"prompt":"a detailed description in English"}) — the image appears in the ' +
  "chat by itself. The more specific the description (composition, colour, style), the closer the " +
  "result. This draws something new; for a picture that already exists on the web, use attach_image.";

const ASK_PROTOCOL =
  // "…if you need a decision first, ask with a widget rather than stalling." — the original's rule,
  // and `ask_question` is the widget it means.
  "\n\nASKING THE USER: when the user has to choose between directions, ask with the widget rather than " +
  "stalling: " +
  'TOOL_CALL: ask_question({"prompt":"The question?","options":[{"label":"Option A"},{"label":"Option B"}]}) ' +
  "— up to 6 options, add \"allowCustom\":true if they may type their own answer. " +
  "Do not ask and then answer yourself: end the turn after asking, the answer arrives on the next one.";

/**
 * Memory only helps if the agent writes to it, and models do not volunteer that.
 *
 * So the rule names the trigger (a durable fact about the person, not the current task) and
 * the anti-trigger — otherwise it either never remembers anything, or fills memory with
 * transcript.
 */
const MEMORY_PROTOCOL = boxConfigured()
  ? "\n\nMEMORY: when the user says something worth keeping for the long term — their name, their job, " +
    "preferences, how they want to be answered, facts about their projects — store it with " +
    'TOOL_CALL: knowledge_base({"title":"a short label","knowledge_to_store":"the content"}). ' +
    "Only store what will still be true in a later conversation; do NOT store passing details of the " +
    "current one. Whatever is already remembered is placed at the start of every turn, so there is no " +
    "need to read it back."
  : "";

const DRAFT_PROTOCOL =
  "\n\nDRAFTS: when composing mail or a message on the user's behalf, use " +
  'TOOL_CALL: email_draft({"to":["a@b.c"],"subject":"...","body":"..."}) or ' +
  'TOOL_CALL: slack_draft({"target":"#channel","body":"..."}). ' +
  "A draft card is for review only — the system CANNOT send yet, so never say it was sent; ask the " +
  "user what to do next.";

const PEER_PROTOCOL =
  "\n\nMESSAGING OTHER BOTS: the bots in the sidebar can message each other with " +
  'TOOL_CALL: message_agent({"to":"bot name","content":"..."}). ' +
  "Use it when the work belongs to another bot's speciality; tell the user who you messaged. " +
  "Their reply arrives on a later turn — do not wait for it within this one. " +
  // The original narrates step by step because SendMessage is its only voice. Ours streams the
  // final text, so without this a multi-step turn is silent until the end — screenshots pile up
  // with no words. Tell the model it can speak between steps.
  // "Work out loud. Do the work while keeping the user posted on meaningful beats; never vanish into a
  // long run of silent tool calls." — the original's sentence, quoted, and then the tool that does it.
  "\n\nWORK OUT LOUD: do the work while keeping the user posted on meaningful beats; never vanish into " +
  "a long run of silent tool calls. After each meaningful beat, " +
  'TOOL_CALL: send_to_user("one short line about what you just did and what comes next") — each one is ' +
  "its own message, shown to the user immediately. The final answer is still written normally. Do not " +
  "use it for single-step work, and do not repeat what you already said. " +
  'Brief several bots at once with a list: {"to":["Sales","Marketing"],"content":"..."}. ' +
  "\n\nCREATING / RENAMING BOTS: " +
  'TOOL_CALL: create_agent({"name":"Manager","brief":"the role and how to work together"}) — add "names":[…] to create several. ' +
  'TOOL_CALL: rename_agent({"from":"New Bot","to":"Manager"}) — drop "from" to rename yourself. ' +
  "Brief a bot on its role as soon as you create it; never leave an empty one.";

/**
 * Scaffolding from the first spike — `calc`, `echo` and friends. They stay callable so the
 * older e2e scripts keep working, but they are no longer advertised: the original has nothing
 * like them, and a model shown a `calc` tool reaches for it instead of doing arithmetic in an
 * ordinary sentence.
 */
const DEV_TOOLS = new Set(["echo", "time", "reverse", "upper", "count", "calc"]);

const TOOL_PROTOCOL =
  // "DUY NHẤT một dòng" is why a multi-step turn went silent. The model obeyed it exactly: every
  // step was a bare TOOL_CALL, so the user watched screenshots pile up with no words — measured,
  // the bubble mid-turn contained the call itself and nothing else. The parser already accepts
  // prose in front (TOOL_CALL is anchored at the END) and the bubble now keeps whatever was
  // said, so this instruction was the only thing forbidding it.
  // The one-call-per-reply half of that instruction is also gone, and for the same reason: it was
  // ours, while the original's own subagent prompts say "Parallel tool calls are critical … call all
  // tools together in a single response". Now that runTurn reads every call and batches the read-only
  // ones, saying "exactly one line" would cap the fan-out at one again — from the other end of the
  // prompt, where it would be easy to miss. Both protocol strings have to agree.
  "\n\nTOOLS: when you need one of the tools below, say ONE short line about what you are about to do, " +
  "then END the reply with lines of the form TOOL_CALL: <name>(<args>), one call per line. " +
  // Verbatim from the original's buildBugbotSubagentPrompt; two more of its subagent prompts repeat it.
  "Parallel tool calls are critical. For maximum efficiency, invoke all relevant tools simultaneously " +
  "rather than sequentially. When you need to verify multiple things, call all tools together in a " +
  "single response. Write nothing after those lines. Tools: " +
  Object.keys(TOOLS).filter((n) => !DEV_TOOLS.has(n)).join(", ") +
  ". If no tool is needed, just answer. Once tool results come back, answer from them." +
  BROWSER_PROTOCOL + IMAGE_PROTOCOL + ASK_PROTOCOL + MCP_PROTOCOL + DRAFT_PROTOCOL + PEER_PROTOCOL + MEMORY_PROTOCOL + boxToolProtocol();

/** Every tool this install can run — chat-level tools plus the box tools from tools.ts. */
const isKnownTool = (name: string): boolean => name.toLowerCase() in TOOLS;

/**
 * Which tools may run side by side in one batch.
 *
 * Deliberately narrower than "auto-approved". Three kinds of tool are auto-approved yet must NOT
 * be parallelised:
 *
 *   browser_*        — stateful and ordered. navigate then screenshot describes one page; run them
 *                      together and the screenshot races the navigation.
 *   ask_question     — parks the turn waiting on a human, so it cannot be one of several results
 *   request_box_help   arriving together; the turn resumes when the person acts.
 *
 * What is left is the read-only box surface — read_file_v2, list_dir_v2, glob_file_search,
 * ripgrep_raw_search, web_search, web_fetch — which is exactly the set P5 wanted to fan out.
 */
const BARRIER_TOOLS = new Set(["ask_question", "request_box_help"]);
const isParallelSafe = (name: string): boolean => {
  const l = name.toLowerCase();
  if (BARRIER_TOOLS.has(l) || l.startsWith("browser_")) return false;
  return isAutoApproved(l);
};

let sink: (agentId: string) => void = () => {};
export function setUpdateSink(fn: (agentId: string) => void): void { sink = fn; }

/**
 * Epoch for the ordered-replica protocol the client uses.
 *
 * The client keeps a replica of the transcript and only accepts events whose epoch matches
 * the one it joined on; a mismatch parks them as "foreign" and drops them. So the epoch must
 * be stable for as long as the history is append-only, and change only when history is
 * rewritten — which for us means process start, since a restart reloads from disk.
 */
const EPOCH = Date.now();
export const transcriptEpoch = (_agentId: string): number => EPOCH;

/**
 * The envelope the client's replica requires — with a sequence that is contiguous PER AGENT.
 *
 * This is where the transcript quietly stopped updating. The client's rule is strict:
 *
 *   if (t.sequence === this.acceptedSequence + 1) { applyEvent(…); acceptedSequence = t.sequence }
 *   else { this.bufferBounded(t.sequence, e.event); this.startAttempt() }   // gap → park + resync
 *
 * Exactly `+1`, or the event is parked in a bounded buffer and the replica asks for a resync.
 * We were passing the entry's **global** seq, which is shared by every agent — so as soon as
 * any other bot wrote an entry, this bot's replica saw a jump and stopped applying anything.
 * The roster never had the bug because it always used its own counter (`++rosterSeq`), which
 * is why the sidebar preview kept updating while the bubble stood still: same push, same
 * connection, two different sequence sources.
 *
 * Symptoms it explains: a bubble frozen at "Để" while the backend held 1118 characters, and a
 * finished reply that appeared only minutes later when something forced a refetch.
 *
 * Counting pushes rather than entries is deliberate — a streamed reply emits many events for
 * one entry, and each of those is an event the replica counts.
 */
const transcriptSeq = new Map<string, number>();

/**
 * The current sequence for an agent, started from its history rather than from zero.
 *
 * A restart reloads the whole transcript from disk, so beginning the counter at 0 while the agent
 * already has N entries publishes an anchor covering `1..0` — an empty range for a conversation that
 * is not empty. The client then has a snapshot that proves nothing and a pane that never fills.
 * Seeding from the entry count keeps the anchor honest across restarts and keeps the next event one
 * past what the snapshot already covers.
 */
function seqFor(agentId: string): number {
  const known = transcriptSeq.get(agentId);
  if (known !== undefined) return known;
  const seeded = (transcripts.get(agentId) ?? []).length;
  transcriptSeq.set(agentId, seeded);
  return seeded;
}

/** Read-only view of the anchor a tail response must carry. */
export function transcriptAnchor(agentId: string) {
  return { epoch: EPOCH, sequence: seqFor(agentId) };
}

export function nextTranscriptOrdered(agentId: string) {
  const next = seqFor(agentId) + 1;
  transcriptSeq.set(agentId, next);
  return { replicaKey: `transcript:${agentId}`, epoch: EPOCH, sequence: next };
}

/** Newest entry of an agent, with its stable seq — what an event announces. */
export function latestEntry(agentId: string): (Entry & { seq: number }) | null {
  const all = transcripts.get(agentId) ?? [];
  if (!all.length) return null;
  const withSeq = ensureSeq(agentId, all);
  return withSeq[withSeq.length - 1] ?? null;
}
let rosterSink: (agentId?: string) => void = () => {};
/** Push a roster change to the FE so add/delete shows up without waiting for its next poll. */
export function setRosterSink(fn: (agentId?: string) => void): void { rosterSink = fn; }

/**
 * Roster ordering, separate from the transcript's.
 *
 * The client replicates the roster under its own key ("roster", coverage "complete-roster")
 * and drops a single-agent update that has no envelope — which is exactly how presence, and
 * therefore the typing indicator, never arrived.
 */
let rosterSeq = 0;
export const nextRosterOrdered = () => ({ replicaKey: "roster", epoch: EPOCH, sequence: ++rosterSeq });
// Summarised, not raw: this feeds the roster SSE push as well as lookups, and a pushed row
// without `updatedAt`/`lastEntry` blanks the preview the polled list had just filled in.
export const agentById = (id: string): AgentRecord | undefined => {
  const a = agents.get(id);
  return a ? summarise(a) : undefined;
};
const rosterChanged = (agentId?: string): void => rosterSink(agentId);

/** PascalCase names the client's activity table knows; anything else renders plain "Working". */
/**
 * Our tool names → the names the client's activity table knows.
 *
 * This is the ONLY tool feedback the original gives during a turn: it never renders a tool
 * card (see the tool-call note at the top of this file), it changes the line beside the
 * avatar. The client's `dse()` maps a name to a verb + icon:
 *
 *   WebSearch → "Searching the web"   Read/BoxRead   → "Reading file"
 *   WebFetch  → "Reading the web"     Shell/BoxShell → "Running commands"
 *   Task      → "Waiting on another agent"           (…with `detail` → "Drafting the file")
 *   Screenshot / Computer / request_box_help → "On its computer"
 *   SendToAgent → "Messaging <name>"  CallMcpTool → "Connecting to <service>"
 *   anything starting `browser_` → "Browsing the web"
 *   anything else → "Working"
 *
 * That last-but-one rule is why the browser tools are NOT listed here any more: they were
 * being rewritten to `WebFetch`, which reads "Reading the web" while the agent is clicking
 * around a page. Passing the real name through hits the `browser_` branch and says
 * "Browsing the web", which is what the original shows.
 */
const ACTIVITY_TOOL: Record<string, string> = {
  web_search: "WebSearch",
  web_fetch: "WebFetch",
  read_file_v2: "Read",
  list_dir_v2: "Read",
  glob_file_search: "Read",
  ripgrep_raw_search: "Read",
  run_terminal_command_v2: "Shell",
  task_v2: "Task",
  message_agent: "SendToAgent",
  create_agent: "CreateAgent",
  rename_agent: "UpdateAgent",
  attach_file: "Screenshot",
  attach_image: "Screenshot",
  generate_image: "Screenshot",
  call_mcp_tool: "CallMcpTool",
  get_mcp_tools: "GetMcpTools",
  knowledge_base: "ReactToMessage",
  // `Shell` + a non-empty `detail` is the client's "Drafting the file" state; the detail is
  // attached at the call site, where the path is known.
  edit_file_v2: "Shell",
  edit_file: "Shell",
  delete_file: "Shell",
};

/** The file a write-style tool is touching, for the "Drafting the file" activity detail. */
function activityDetail(name: string, arg: string): string | undefined {
  if (name !== "edit_file_v2" && name !== "edit_file" && name !== "delete_file") return undefined;
  try {
    const o = JSON.parse(arg);
    if (o && typeof o.path === "string") return o.path;
  } catch { /* positional form */ }
  return unquote(arg.split(",")[0] ?? "") || undefined;
}

/**
 * Update presence and tell the roster, so the indicator actually moves.
 *
 * Pushed rather than left for the next poll: the whole value of a typing indicator is that
 * it appears within a beat of the user hitting send.
 */
function setPresence(agentId: string, patch: Partial<Pick<AgentRecord, "isRunning" | "isComposingMessage" | "isRetrying" | "currentActivity" | "awaitingUserResponse">>): void {
  const rec = agents.get(agentId);
  if (!rec) return;
  const bag = rec as unknown as Record<string, unknown>;
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (bag[k] !== v) { bag[k] = v; changed = true; }
  }
  if (changed) { rosterChanged(agentId); persist(); }
}

/** Everything presence-related back to idle. Called on every exit path, including failures. */
const clearPresence = (agentId: string): void => {
  // A turn that stopped is not driving the computer any more, so its screen goes off — the
  // original shows an idle bot's pane as off. `endComputerUse` refuses while a handoff is still
  // on screen, because that card exists precisely to make the user look at it.
  endComputerUse(agentId);
  finishComputerUseRun(agentId);
  setPresence(agentId, { isRunning: false, isComposingMessage: false, isRetrying: false, currentActivity: null });
};
const onUpdate = (agentId: string): void => { sink(agentId); persist(); };
const nextId = () => `e${entrySeq++}`;
const tail = (agentId: string) => transcripts.get(agentId) ?? (transcripts.set(agentId, []), transcripts.get(agentId)!);
const authorOf = (agentId: string): Author => ({ id: agentId, name: agents.get(agentId)?.name ?? "Claude" });
const textOf = (e: Entry): string =>
  e.kind === "message" ? e.content : e.kind === "send-message" && e.message.type === "text" ? e.message.content : "";
/** Write into an assistant bubble (the content lives under message.content). */
const setText = (e: Entry, v: string): void => { if (e.kind === "send-message" && e.message.type === "text") e.message.content = v; };

// ── roster ────────────────────────────────────────────────────────────────────
/**
 * The name arrives under several spellings depending on the caller: `updateAgent` takes
 * `{id, profile:{name}}` (that nesting is why rename silently did nothing once — HANDOFF §5),
 * so accept the same shape here rather than assuming create is the one that uses a flat key.
 */
export function createAgent(args: { name?: string; profile?: { name?: string }; displayName?: string } = {}): AgentRecord {
  const wanted = args.name ?? args.profile?.name ?? args.displayName;
  const id = `agent-${agentSeq++}`;
  // Presence is stated explicitly rather than left undefined. The client tolerates missing
  // fields (`n?.isRunning ?? false`), but a record that never mentions them is how nobody
  // noticed the indicator was unimplemented for this long.
  const rec: AgentRecord = {
    id, name: wanted?.trim() || "Claude", agentOwnerAuthId: AUTH_ID, createdAtMs: Date.now(), unread: false, hidden: false,
    isRunning: false, isComposingMessage: false, isRetrying: false, currentActivity: null,
  };
  agents.set(id, rec); transcripts.set(id, []); persist();
  // With the id: the client's roster replica applies an event by reading `ev.agent.id`, so the
  // id-less branch (`{agents: […]}`) is a shape it has no case for and silently drops. Creating
  // a bot therefore did not show up until a reload — measured: 12s, no new row.
  rosterChanged(id);
  return rec;
}
/**
 * The second line of a sidebar row, and its timestamp.
 *
 * Found by comparing the two apps side by side: the original's rows read
 * `name / <time> / <last message>`, ours read only the name. The row component takes both
 * from the agent summary — `put(t.lastEntry)` for the preview and `l5e(t.updatedAt)` for the
 * time — so an agent record without them renders a name and two blanks, which is exactly
 * what we shipped.
 *
 *   updatedAt : ms. `l5e` returns "" for 0 or missing, hence no timestamp at all.
 *   lastEntry : {kind:"text", text}
 *             | {kind:"attachment", count, kinds:[{kind, count}]}
 *             | {kind:"link", url}
 *
 * The attachment branch is where "Sent 1 Markdown file" comes from: the client pluralises
 * `kinds` itself from a fixed table (image · video · audio · pdf · markdown · table · json ·
 * text · document · archive · file), and anything outside it degrades to "file". So the kind
 * has to be one of those words — a MIME type or an extension would silently read "1 file".
 */
type LastEntry =
  | { kind: "text"; text: string }
  | { kind: "attachment"; count: number; kinds: { kind: string; count: number }[] }
  | { kind: "link"; url: string };

/** Maps a file name onto the client's attachment-kind vocabulary. */
function attachmentKind(name: string): string {
  const ext = (name.split(/[/\\]/).pop() ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (["md", "markdown", "mdx"].includes(ext)) return "markdown";
  if (["csv", "tsv", "xlsx", "xls"].includes(ext)) return "table";
  if (["json", "jsonc", "ndjson"].includes(ext)) return "json";
  if (["txt", "text", "log", "yaml", "yml", "toml", "ini", "conf"].includes(ext)) return "text";
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return "document";
  if (["zip", "tar", "gz", "7z", "rar"].includes(ext)) return "archive";
  return "file";
}

function lastEntryOf(agentId: string): LastEntry | undefined {
  const t = transcripts.get(agentId);
  if (!t?.length) return undefined;
  // Walk backwards to the last entry a human would call "the last message": tool cards,
  // notices and approval prompts are not what the original previews.
  for (let i = t.length - 1; i >= 0; i--) {
    const e = t[i];
    if (e.kind === "send-message" && e.message.type === "attachment") {
      const name = e.message.file_name || e.message.url;
      return { kind: "attachment", count: 1, kinds: [{ kind: attachmentKind(name), count: 1 }] };
    }
    // Skip the "🔧 tool(args) → result" echo: it is a transcript affordance, not a message,
    // and previewing it puts raw JSON arguments in the sidebar where the reply belongs.
    if (isToolEcho(e)) continue;
    const text = textOf(e).trim();
    if (text) return { kind: "text", text };
  }
  return undefined;
}

/** The summary the sidebar renders, built fresh so `updatedAt`/`lastEntry` are never stale. */
type RosterRow = AgentRecord & Record<string, unknown>;
function summarise(a: AgentRecord): RosterRow {
  const t = transcripts.get(a.id);
  const updatedAt = t?.length ? t[t.length - 1].timestampMs : a.createdAtMs;
  const lastEntry = lastEntryOf(a.id);
  // `snapshotEpoch` / `snapshotSeq` anchor the ROSTER replica, exactly as `ordered` anchors the
  // transcript one — and their absence broke presence the same way.
  //
  // The client reads the epoch off the first row of the polled list:
  //
  //     const Le = je.rows[0]?.snapshotEpoch;
  //     if (Le == null) { …; x = b(je); return }      // rebuild, WITHOUT an epoch
  //     x.ingestSnapshot({ replicaKey, epoch: Le, throughSequence, … })
  //
  // With no epoch the replica has nothing for a pushed event to line up against, so every
  // roster event we sent — `{replicaKey:"roster", epoch, sequence}` from nextRosterOrdered —
  // was dropped on arrival. The bot list therefore only ever changed on a full refetch, which
  // is why `isRunning`/`currentActivity` were correct in the API and the avatar never moved.
  // The client VALIDATES every roster row and drops the whole row on the first missing field:
  //
  //   if (!isObj(n) || typeof n.id !== "string" || !n.id.length || typeof n.name !== "string"
  //       || typeof n.description !== "string" || typeof n.path !== "string"
  //       || typeof n.createdAt !== "number" || !isFinite(n.createdAt)
  //       || typeof n.updatedAt !== "number" || !isFinite(n.updatedAt)
  //       || typeof n.hasUnread !== "boolean" || typeof n.notificationsEnabled !== "boolean"
  //       || typeof n.notifyOnUpdatesEnabled !== "boolean" || typeof n.isGroup !== "boolean"
  //       || typeof n.origin !== "string"
  //       || (n.lastMessageId !== null && typeof n.lastMessageId !== "string")
  //       || (n.lastEntry !== null && !isObj(n.lastEntry))
  //       || (n.awaitingUserResponse !== null && !isObj(n.awaitingUserResponse))
  //       || !isStringArray(n.memberIds) || !isStringArray(n.conversationPartnerIds)) return null;
  //
  // We were sending five of the sixteen. Names and previews still drew, because those come from
  // a more forgiving path — but the ORDERED replica, the one that carries live presence, threw
  // every row away. `null` and `[]` are values here, not omissions: an absent field fails the
  // typeof check just as hard as a wrong one.
  const t2 = transcripts.get(a.id);
  const last = t2?.length ? t2[t2.length - 1] : null;
  return {
    ...a,
    updatedAt,
    snapshotEpoch: EPOCH,
    snapshotSeq: rosterSeq,
    description: "",
    path: `/agents/${a.id}`,
    createdAt: a.createdAtMs,
    hasUnread: a.unread === true,
    notificationsEnabled: a.notificationsEnabled === true,
    notifyOnUpdatesEnabled: a.notifyOnUpdates === true,
    isGroup: false,
    origin: "user",
    lastMessageId: last ? last.id : null,
    awaitingUserResponse: a.awaitingUserResponse ?? null,
    memberIds: [],
    conversationPartnerIds: [],
    lastEntry: lastEntry ?? null,
    // The client prefers `isRunningTurn` over `isRunning` wherever both exist
    // (`Bon(n) = n.isRunningTurn ?? n.isRunning`), and its own default row template sets both.
    isRunningTurn: a.isRunning === true,
  };
}

export const listAgents = (): RosterRow[] =>
  [...agents.values()].filter((a) => !a.hidden).map(summarise);
export const countAgents = (): number => listAgents().length;
// The FE sends {id, profile:{name,…}} — a bare `name` never arrives.
/**
 * Write an event into a bot's own transcript, the way the original records what happened to it.
 *
 * `id` carries the `event-` prefix the original uses; the client keys entries by id and the prefix is
 * what distinguishes these from ordinary bubbles at a glance in a stored replica.
 */
export function pushTranscriptEvent(agentId: string, event: TranscriptEvent): void {
  const t = transcripts.get(agentId);
  if (!t) return;
  t.push({ id: `event-${nextId()}`, kind: "event", event, timestampMs: Date.now() });
  persist();
  onUpdate(agentId);
}

/** Tell the user a routine cannot fire until its platform is connected. */
export function pushListenerConnect(agentId: string, platform: string, reason = "so this routine can fire"): void {
  const t = transcripts.get(agentId);
  if (!t) return;
  t.push({
    id: nextId(), kind: "send-message", author: authorOf(agentId),
    message: { type: "listener-connect", platform, reason }, timestampMs: Date.now(),
  });
  persist();
  onUpdate(agentId);
}

export function updateAgent(a: { id?: string; agentId?: string; name?: string; profile?: { name?: string } }): AgentRecord | null {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (!rec) return null;
  const name = a.profile?.name ?? a.name;
  if (typeof name === "string" && name.length > 0 && name !== rec.name) {
    // Record the rename before applying it — the original keeps `from` and `to`, which is only
    // possible while the old name is still here.
    pushTranscriptEvent(rec.id, { type: "name-changed", from: rec.name, to: name });
    rec.name = name;
  }
  persist(); return rec;
}
export function deleteAgents(a: { ids?: string[]; agentIds?: string[]; id?: string }): { deleted: string[] } {
  const ids = a.ids ?? a.agentIds ?? (a.id ? [a.id] : []);
  for (const id of ids) {
    agents.delete(id); transcripts.delete(id); inflight.get(id)?.abort(); inflight.delete(id);
    // A deleted bot cannot own a browser tab. Without this the box kept one open per bot that
    // ever browsed, long after the bot was gone.
    void closeAgentTab(id);
  }
  persist(); rosterChanged(); return { deleted: ids };
}
export function duplicateAgent(a: { id?: string; agentId?: string }): AgentRecord | null {
  const src = agents.get(a.id ?? a.agentId ?? ""); if (!src) return null;
  const rec = createAgent({ name: `${src.name} (copy)` });
  transcripts.set(rec.id, structuredClone(transcripts.get(src.id) ?? []));
  persist(); return rec;
}
// The FE sends {id, isUnread} / {id, isHidden} — accept both spellings.
export function setAgentUnread(a: { id?: string; agentId?: string; unread?: boolean; isUnread?: boolean }): Record<string, never> {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (rec) rec.unread = a.isUnread ?? a.unread ?? false; persist(); return {};
}
export function setAgentHiddenFromSidebar(a: { id?: string; agentId?: string; hidden?: boolean; isHidden?: boolean }): Record<string, never> {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (rec) rec.hidden = a.isHidden ?? a.hidden ?? true; persist(); return {};
}
export function setAgentNotificationsEnabled(a: { id?: string; agentId?: string; enabled?: boolean; isEnabled?: boolean }): Record<string, never> {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (rec) rec.notificationsEnabled = a.isEnabled ?? a.enabled ?? true; persist(); return {};
}
export function setAgentNotifyOnUpdates(a: { id?: string; agentId?: string; enabled?: boolean; isEnabled?: boolean }): Record<string, never> {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (rec) rec.notifyOnUpdates = a.isEnabled ?? a.enabled ?? true; persist(); return {};
}
export function setAgentAvatarBytes(a: { id?: string; agentId?: string; pngBase64?: string; bytes?: string }): AgentRecord | null {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (!rec) return null;
  const b64 = a.pngBase64 ?? a.bytes;
  if (b64) { rec.avatarDataUrl = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`; rec.avatarVersion = String(Date.now()); persist(); }
  return rec;
}
export function getAgentAvatar(a: { id?: string; agentId?: string }) {
  const rec = agents.get(a.id ?? a.agentId ?? "");
  return { avatarDataUrl: rec?.avatarDataUrl ?? "", avatarVersion: rec?.avatarVersion ?? "" };
}

// ── transcript ────────────────────────────────────────────────────────────────
const PAGE = 200;

/**
 * Give every entry a stable sequence number, assigning only the ones that lack it.
 *
 * Ordering rules the client relies on: monotonic, and increasing with position. Entry ids
 * are already minted from a monotonic counter (`e12`), so the number inside the id is the
 * natural seq — it survives restarts and never shifts when older entries are trimmed. An id
 * that does not parse (an imported snapshot, a hand-edited state file) falls back to one
 * past its predecessor, which keeps the sequence monotonic without renumbering anything.
 */
function ensureSeq(agentId: string | undefined, all: Entry[]): (Entry & { seq: number })[] {
  let assigned = false;
  let prev = 0;
  for (const e of all) {
    if (typeof e.seq !== "number" || e.seq <= prev) {
      const fromId = /^e(\d+)$/.exec(e.id)?.[1];
      const n = fromId ? Number(fromId) : 0;
      e.seq = n > prev ? n : prev + 1;
      assigned = true;
    }
    prev = e.seq;
  }
  // Persist so the numbers survive a restart; recomputing them later would defeat the point.
  if (assigned && agentId) persist();
  return all as (Entry & { seq: number })[];
}
/**
 * Transcript page in the client's shape: `{reachable, entries, beforeSeq, nextBeforeSeq}`.
 *
 * The FE pages with a NUMERIC `beforeSeq` and keys each page by it; `nextBeforeSeq` (or its
 * absence) tells it whether older entries remain. It also needs `reachable:true` — without it
 * the transcript is treated as unavailable and nothing renders. Entries carry a numeric `seq`
 * so ordering and the next anchor are well defined.
 */
export function transcriptTail(a?: { agentId?: string; id?: string; limit?: number; beforeSeq?: number; before?: string; cursor?: string } | string) {
  const args = typeof a === "string" || a === undefined ? { agentId: a as string | undefined } : a;
  // The FE asks with {id, limit, beforeSeq} — reading only `agentId` returned an empty
  // transcript for every request, so nothing ever rendered.
  const agentId = args.agentId ?? args.id;
  const all = (agentId && transcripts.get(agentId)) || [];
  const withSeq = ensureSeq(agentId, all);
  const limit = Math.max(1, Math.min(args.limit ?? PAGE, 1000));

  let end = withSeq.length;
  if (typeof args.beforeSeq === "number") end = Math.max(0, withSeq.findIndex((e) => e.seq >= args.beforeSeq!));
  else if (args.before ?? args.cursor) {
    const at = withSeq.findIndex((e) => e.id === (args.before ?? args.cursor));
    if (at >= 0) end = at;
  }
  const start = Math.max(0, end - limit);
  const entries = withSeq.slice(start, end);
  return {
    reachable: true,
    entries,
    beforeSeq: typeof args.beforeSeq === "number" ? args.beforeSeq : null,
    nextBeforeSeq: start > 0 ? entries[0]?.seq ?? null : null,
    hasMore: start > 0,
    cursor: entries[0]?.id ?? null,
    total: withSeq.length,
    // ── the anchor, without which the conversation pane spins forever ──────────
    //
    // The client builds its transcript replica from THIS response plus an anchor, and it takes the
    // anchor from these two fields. Its own reducer, from the shipped bundle:
    //
    //   (R.observedAnchor = {epoch: Z.epoch, sequence: Z.sequence})
    //   q = (R, Z, X) => {
    //     if (X.anchor == null) { …; if (oe.epoch != null || oe.value !== X.windowAtDispatch || B(R)) return; … }
    //     …R.replica.ingestSnapshot({replicaKey: Nde(R.agentId), epoch: X.anchor.epoch,
    //        throughSequence: X.anchor.sequence, coverage: {kind: "transcript-live-range", …},
    //        value: {isInstalled: true, liveRange: re, entries: Z.entries}})
    //
    // `Z` is this object. With no `epoch`/`sequence` the anchor is null, and the fallback branch
    // RETURNS WITHOUT DOING ANYTHING once the replica is in any state other than pristine — so the
    // pane keeps its spinner and never renders. Measured: openAgentTail answered in 4-12ms with a
    // correct 107KB body while the app span forever, and a bot created mid-run (its replica never
    // built) span from the moment it appeared in the sidebar. The sidebar stayed correct throughout
    // because the roster is a different replica, which is what made this look like a stuck backend.
    //
    // Sending the anchor also gives a drifted replica a way back: the client re-anchors on the epoch
    // and sequence here instead of appending forever onto a replica that has silently fallen behind.
    ...transcriptAnchor(agentId ?? ""),
  };
}
export function getConversationOutline(a: { agentId?: string; id?: string }) {
  const t = ((a.agentId ?? a.id) && transcripts.get((a.agentId ?? a.id)!)) || [];
  return t.filter((e) => e.kind === "message" && e.role === "user" && e.content)
    .map((e) => ({ entryId: e.id, text: textOf(e).slice(0, 80), timestampMs: e.timestampMs }));
}
/**
 * Toggle a reaction. The FE calls reactToMessage({entryId, emoji, agentId}) and groups
 * entry.reactions by `{emoji, by}`, treating `by === "me"` as the current user — a plain
 * array of emoji strings produced no chips at all.
 */
export function reactToMessage(a: { agentId?: string; entryId?: string; id?: string; reaction?: string; emoji?: string }): Record<string, never> {
  const t = ((a.agentId ?? a.id) && transcripts.get((a.agentId ?? a.id)!)) || [];
  const e = t.find((x) => x.id === a.entryId);
  const emoji = a.emoji ?? a.reaction;
  if (e && emoji) {
    const list = (e.reactions ??= []);
    const at = list.findIndex((r) => r.emoji === emoji && r.by === ME);
    if (at >= 0) list.splice(at, 1);        // clicking the same emoji again removes it
    else list.push({ emoji, by: ME });
  }
  if (a.agentId) onUpdate(a.agentId); else persist();
  return {};
}
export const voteFeedback = (): Record<string, never> => ({});

/**
 * Send-acceptance ledger, keyed by the FE's clientNonce.
 *
 * The composer sends optimistically and then polls this. It needs
 * `{outcome:"found", record:{status, echoEntryId, …}}`; on a non-rejected record with an
 * echoEntryId it confirms the bubble and refreshes the transcript. Returning anything else
 * (the old `{accepted:true}`) left every message stuck at "Failed to send" and the reply
 * never rendered. Statuses mirror the box: pending | accepted | rejected.
 */

export function promptAcceptanceStatus(a: { clientNonce?: string; accountSlot?: string }) {
  const rec = a?.clientNonce ? acceptance.get(a.clientNonce) : undefined;
  return rec ? { outcome: "found", record: rec } : { outcome: "not-found" };
}

// ── search / run helpers ──────────────────────────────────────────────────────
export function searchAgents(a: { query?: string; q?: string; text?: string }): AgentRecord[] {
  const q = (a.query ?? a.q ?? a.text ?? "").toLowerCase().trim();
  if (!q) return listAgents();
  return listAgents().filter((rec) =>
    rec.name.toLowerCase().includes(q) || (transcripts.get(rec.id) ?? []).some((e) => textOf(e).toLowerCase().includes(q)));
}
export function kickstartAgent(a: { id?: string; agentId?: string }): AgentRecord | null {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (!rec) return null;
  rec.unread = false; persist(); return rec;
}
export function broadcastToAgents(a: { ids?: string[]; agentIds?: string[]; prompt?: string; content?: string; text?: string }) {
  const ids = a.ids ?? a.agentIds ?? listAgents().map((x) => x.id);
  const text = a.prompt ?? a.content ?? a.text ?? "";
  const sent: string[] = [];
  for (const id of ids) if (agents.has(id)) { sendPrompt({ agentId: id, content: text }); sent.push(id); }
  return { sent, count: sent.length };
}
/**
 * The subagent list behind `getSubagents({id}) → array`.
 *
 * Shape is the host's `listSubagents()` verbatim — it maps its registry to
 * `{subagentId, subagentType, title, status, startedAtMs}` and sorts by `startedAtMs`
 * ascending. Two details are worth stating because guessing either one produces a list that
 * renders but is wrong:
 *
 *  - `status` is `running | done | aborted | error`. **Not** "completed": that string is the
 *    *outcome*'s value, which the host maps to `"done"` on the way into the registry
 *    (`outcome.status === "completed" ? "done" : "error"`).
 *  - `subagentType` is a free string taken straight from the task's `subagent_type`, not an
 *    enum, so our own type names (browserUse / explore / shell) belong here as they are.
 *
 * The client also accepts a push: `ingestSubagentsEvent({parentAgentId, subagents})`.
 */
export interface SubagentRow {
  subagentId: string;
  subagentType: string;
  title: string;
  status: "running" | "done" | "aborted" | "error";
  startedAtMs: number;
}

const subagentRuns = new Map<string, Map<string, SubagentRow>>();
let subagentSeq = 1;

/**
 * The computer session, as a `computerUse` subagent.
 *
 * That name is not decoration: the client filters the panes it draws with
 * `status === "running" && subagentType === "computerUse"` (`CTn`/`eht`), so a session under any
 * other type contributes no screen. One per bot at a time — a bot has one desktop, and opening a
 * second row would claim it has two.
 */
const COMPUTER_USE = "computerUse";
const computerRuns = new Map<string, string>();   // agentId → subagentId

function startComputerUseRun(agentId: string, tool: string): void {
  beginComputerUse(agentId);
  if (computerRuns.has(agentId)) return;
  const title = tool.startsWith("browser_") ? "Đang dùng trình duyệt" : "Đang cần bạn thao tác";
  computerRuns.set(agentId, startSubagentRun(agentId, COMPUTER_USE, title));
}

function finishComputerUseRun(agentId: string): void {
  const id = computerRuns.get(agentId);
  if (id == null) return;
  computerRuns.delete(agentId);
  finishSubagentRun(agentId, id, "done");
}

/** Register a starting subagent and return its id, so the caller can settle it later. */
export function startSubagentRun(parentAgentId: string, subagentType: string, title: string): string {
  const subagentId = `sub-${subagentSeq++}`;
  let rows = subagentRuns.get(parentAgentId);
  if (!rows) { rows = new Map(); subagentRuns.set(parentAgentId, rows); }
  rows.set(subagentId, { subagentId, subagentType, title, status: "running", startedAtMs: Date.now() });
  onUpdate(parentAgentId);
  return subagentId;
}

export function finishSubagentRun(parentAgentId: string, subagentId: string, status: SubagentRow["status"]): void {
  const row = subagentRuns.get(parentAgentId)?.get(subagentId);
  if (!row) return;
  // Immutable update: the row is handed straight to the client, and mutating one it already
  // holds is how a list stops re-rendering on a status change.
  subagentRuns.get(parentAgentId)!.set(subagentId, { ...row, status });
  onUpdate(parentAgentId);
}

export const getSubagents = (a: { id?: string; agentId?: string } = {}): SubagentRow[] => {
  const rows = subagentRuns.get(a.id ?? a.agentId ?? "");
  return rows ? [...rows.values()].sort((x, y) => x.startedAtMs - y.startedAtMs) : [];
};

export const getAsyncTasks = (): unknown[] => [];

// ── run control ───────────────────────────────────────────────────────────────
/** True while a turn is streaming — lets a routine settle its run record. */
export const isAgentRunning = (agentId: string): boolean => inflight.has(agentId);

export function interruptAgentRun(a: { agentId?: string; id?: string }) {
  const agentId = a.agentId ?? a.id ?? "";
  inflight.get(agentId)?.abort(); inflight.delete(agentId);
  const last = [...(transcripts.get(agentId) ?? [])].reverse().find((e) => e.kind === "send-message" && e.message.type === "text");
  if (last && !textOf(last)) { setText(last, "⏹ đã dừng"); if (last.kind === "send-message") last.streaming = false; last.timestampMs = Date.now(); onUpdate(agentId); }
  clearPresence(agentId);
  return { id: agentId, interrupted: true };
}

/**
 * Put a picture in the transcript. Only `data:` and `https:` URLs render without a host-side
 * resolver, so callers pass a data URL (see AttachmentMsg).
 */
export function postAttachment(agentId: string, dataUrl: string, fileName: string, alt: string): void {
  // `url` must be a path whose extension the renderer can read, not the data URL itself —
  // the bytes come back through the gateway's readAttachmentImage. See attachments.ts.
  const path = stageImage(dataUrl, fileName);
  if (path == null) return;
  tail(agentId).push({
    id: nextId(),
    kind: "send-message",
    author: authorOf(agentId),
    message: { type: "attachment", url: path, file_name: fileName, alt },
    timestampMs: Date.now(),
  });
  onUpdate(agentId);
}

/**
 * Put a file the agent wrote into the transcript as a chip.
 *
 * The same `type:"attachment"` message as a screenshot, but the url is the box path. The
 * renderer picks the chip over the image component purely from the extension, and asks for
 * the content through readAttachmentText / readAttachmentChunk when the chip is opened —
 * so nothing is copied here, only referenced. See attachments.ts for both contracts.
 */
export function postFileAttachment(agentId: string, path: string, fileName: string, alt: string): void {
  tail(agentId).push({
    id: nextId(),
    kind: "send-message",
    author: authorOf(agentId),
    message: { type: "attachment", url: path, file_name: fileName, alt },
    timestampMs: Date.now(),
  });
  onUpdate(agentId);
}

const MAX_WIDGET_OPTIONS = 6;   // the client's own schema caps it here

/**
 * Ask the user a question with buttons. Returns the entry id so the answer can be routed back
 * to the turn that asked.
 */
export function postWidget(
  agentId: string,
  widget: { prompt: string; helpText?: string; options: WidgetOption[]; allowCustom?: boolean; dismissOnMoveOn?: boolean },
): string | null {
  const options = widget.options.filter((o) => typeof o?.label === "string" && o.label.trim().length > 0).slice(0, MAX_WIDGET_OPTIONS);
  if (widget.prompt.trim().length === 0 || options.length === 0) return null;
  const id = nextId();
  tail(agentId).push({
    id,
    kind: "send-message",
    author: authorOf(agentId),
    message: { type: "widget", widget: { ...widget, options } },
    timestampMs: Date.now(),
  });
  onUpdate(agentId);
  return id;
}

/** The capability object handed to a tool while it runs for one agent. */
const ctxFor = (agentId: string, history?: PoolMessage[]): ToolCtx => ({
  agentId,
  draft: (message) => {
    tail(agentId).push({ id: nextId(), kind: "send-message", author: authorOf(agentId), message, timestampMs: Date.now() });
    onUpdate(agentId);
  },
  attach: (dataUrl, fileName, alt) => postAttachment(agentId, dataUrl, fileName, alt),
  ask: (widget) => postWidget(agentId, widget),
  note: (text) => {
    tail(agentId).push({ id: nextId(), kind: "send-message", author: authorOf(agentId), message: { type: "text", content: text }, timestampMs: Date.now() });
    onUpdate(agentId);
  },
  requestBoxHelp: (instruction) => {
    const waited = requestBoxHelp(agentId, instruction);
    // Park the continuation too: if the backend restarts while the card is up, hand-back
    // has no Promise left to resolve and resumes from this instead.
    park({ kind: "handoff", key: agentId, agentId, name: "request_box_help", arg: instruction, history });
    onUpdate(agentId);   // push the handoff card out without waiting for the next poll
    // Resolved in-process, so the parked copy is no longer the resume path — drop it, or a
    // later restart would replay a handoff the user already finished.
    return waited.finally(() => { unpark("handoff", agentId); });
  },
});

/** Tools that never need an approval card, on top of the read-only box tools. */
// `request_box_help` belongs here for the same reason as `ask_question`: it asks the user to
// do something, it does not do anything itself. An approval card in front of it would make
// them click Allow before being allowed to be asked for help.
// `attach_file` is here for consistency with screenshots: browser tools call ctx.attach() and
// drop an image into the transcript with no prompt, so asking permission to show a file the
// agent could already read with read_file_v2 buys nothing. The tools that WRITE (edit_file_v2,
// edit_file, delete_file) still ask.
/**
 * Tools that run without a permission card.
 *
 * The bar is not "is this harmless" but "does the card tell the truth about it". The client's
 * copy for `local-tool-permission` is fixed and we cannot change it — the app is signed — and it
 * reads *"Allow Grok Bot and all Bots to run commands on your local computer?"*. Asked to suggest
 * a name for itself and told "Lumen", the model called `rename_agent({"to":"Lumen"})` and the user
 * was shown that sentence. Renaming a bot writes one string in the roster: no shell, no file, no
 * network. A warning that describes the wrong action is worse than no warning, because it teaches
 * people to click through the ones that matter.
 *
 * `create_agent` is deliberately NOT here. It is equally mis-described by that copy, but it brings
 * a new actor into the workspace rather than editing a label, so the call is the user's to make.
 */
const AUTO_APPROVED = new Set(["ask_question", "request_box_help", "get_mcp_tools", "message_agent", "attach_file", "attach_image", "generate_image", "send_to_user", "rename_agent", "echo", "time", "reverse", "upper", "count", "calc"]);

/**
 * Run one tool and report it, whether it was auto-approved or the user clicked Allow.
 * Async by design: browser actions take seconds, so the tool card goes "running" and the
 * result lands out of band instead of blocking the gateway reply the FE is waiting on.
 */
function runTool(
  agentId: string,
  toolCallId: string,
  name: string,
  arg: string,
  history?: PoolMessage[],
  /**
   * Set by a batch owner. When present, this call does NOT continue the turn on its own — the owner
   * waits for every call in the batch and sends one combined follow-up instead. Without this, N
   * parallel calls would each start their own follow-up turn and the model would answer N times.
   */
  onDone?: (result: string) => void,
): void {
  const t = tail(agentId);
  const tc = t.find((e): e is Extract<Entry, { kind: "tool-call" }> => e.kind === "tool-call" && e.toolCallId === toolCallId);
  if (!tc) return;
  const fn = TOOLS[name];
  if (!fn) {
    tc.result = "(unknown tool)";
    tc.status = "failed";
    onUpdate(agentId);
    return;
  }
  tc.status = "running";
  // Claim the computer for this bot. Browser actions drive its Chrome window; a handoff puts a
  // card on screen the user has to act on. Either way this bot — and only this bot — should
  // show a live screen while it lasts.
  if (name.startsWith("browser_") || name === "request_box_help") startComputerUseRun(agentId, name);
  // A box handoff waits on a human, which can be minutes or never. Leaving the turn "running"
  // meanwhile is what made the app look dead: `isRunning` stayed true, the avatar spun behind
  // a card that needed a click, and because the promise had not settled nothing ever cleared
  // it. The same reasoning the ask_question branch below already applies — a parked turn is
  // waiting, not working — just applied at the right moment rather than after the wait.
  if (name === "request_box_help") clearPresence(agentId);

  void Promise.resolve(fn(arg, ctxFor(agentId, history)))
    .catch((e: Error) => `tool error: ${e.message}`)
    .then((result) => {
      tc.result = result;
      tc.status = "done";
      onUpdate(agentId);
      if (onDone) { onDone(result); return; }
      // A question is not a result to reason about — the follow-up turn happens when the
      // user answers it, not now, or the model talks over its own question.
      if (history && name !== "ask_question") continueAfterTool(agentId, history, name, arg, result);
      if (name === "ask_question" && history) park({ kind: "widget", key: agentId, agentId, history });
      // A parked turn is waiting on the user, not working: leaving it "running" spins the
      // indicator forever behind a card that needs a click.
      if (!history || name === "ask_question") clearPresence(agentId);
    });
}



// ── approvals ─────────────────────────────────────────────────────────────────
function findPending(requestId?: string) {
  if (requestId && pending.has(requestId)) return { requestId, ...pending.get(requestId)! };
  const first = [...pending.entries()][0];
  return first ? { requestId: first[0], ...first[1] } : null;
}
// The FE sends {entryId, requestId, resolution, agentId} where resolution is
// "always" | "allow-once" | "never" | "deny" — reading approved/decision never matched.
export function resolveLocalToolPermission(a: { requestId?: string; entryId?: string; agentId?: string; resolution?: string; approved?: boolean; decision?: string; allow?: boolean }) {
  const p = findPending(a.requestId); if (!p) return {};
  const approved = a.resolution != null
    ? a.resolution === "always" || a.resolution === "allow-once" || a.resolution === "allow"
    : a.approved ?? a.allow ?? (a.decision === "approve" || a.decision === "allow");
  pending.delete(p.requestId);
  const t = transcripts.get(p.agentId) ?? [];
  const card = t.find((e) => e.id === p.entryId);
  if (card && card.kind === "send-message" && card.message.type === "local-tool-permission") card.message.ask.status = approved ? "approved" : "denied";
  const tc = t.find((e): e is Extract<Entry, { kind: "tool-call" }> => e.kind === "tool-call" && e.toolCallId === p.toolCallId);
  if (tc) {
    if (approved) {
      const fn = TOOLS[p.name ?? ""];
      if (!fn) {
        tc.result = "(unknown tool)";
        tc.status = "done";
      } else {
        // Browser actions take seconds, so show "running" and finish out of band rather than
        // blocking the gateway reply the FE is waiting on.
        tc.status = "running";
        void Promise.resolve(fn(p.arg ?? "", ctxFor(p.agentId, p.history)))
          .catch((e: Error) => `tool error: ${e.message}`)
          .then((result) => {
            tc.result = result;
            tc.status = "done";
            onUpdate(p.agentId);
            if (p.history) continueAfterTool(p.agentId, p.history, p.name ?? "", p.arg ?? "", result);
          });
      }
    } else { tc.status = "failed"; tc.result = "denied"; }
  }
  onUpdate(p.agentId); return {};
}
export function resolveAutoReviewApproval(a: { requestId?: string; approved?: boolean }) {
  const p = findPending(a.requestId); if (!p) return {};
  pending.delete(p.requestId);
  const card = (transcripts.get(p.agentId) ?? []).find((e) => e.id === p.entryId);
  if (card && card.kind === "send-message" && card.message.type === "auto-review-approval") card.message.approval.status = a.approved ? "approved" : "denied";
  onUpdate(p.agentId); return {};
}
/**
 * The user picked an option (or typed a custom answer).
 *
 * The declared reply is "record-or-null", so the updated entry goes back, not `{}`.
 * Key names are read broadly on purpose: the call site is built in the renderer and could not
 * be read statically, and guessing one spelling is exactly how five features died before
 * (HANDOFF §5). `GROKBOT2_LOG=1` prints the real payload.
 */
export function respondToWidget(a: any) {
  const entryId: string | undefined = a?.entryId ?? a?.id ?? a?.messageId;
  const agentId: string = a?.agentId ?? a?.id ?? "";
  const answer: string | undefined =
    a?.value ?? a?.answer ?? a?.respondedValue ?? a?.text ?? a?.freeformText ?? a?.selectedValue;

  // Find the widget entry: by id when we were given one, else the newest unanswered widget.
  const isWidget = (e: Entry): e is Extract<Entry, { kind: "send-message" }> =>
    e.kind === "send-message" && e.message.type === "widget";
  const search = (list: Entry[]) =>
    (entryId != null ? list.find((e) => e.id === entryId && isWidget(e)) : undefined) ??
    [...list].reverse().find((e) => isWidget(e) && e.respondedValue == null && e.widgetDismissed !== true);

  let found: Extract<Entry, { kind: "send-message" }> | undefined;
  let owner = agentId;
  const direct = transcripts.get(agentId);
  if (direct) found = search(direct) as typeof found;
  if (!found) {
    for (const [id, list] of transcripts) {
      const hit = search(list) as typeof found;
      if (hit) { found = hit; owner = id; break; }
    }
  }
  if (!found || found.message.type !== "widget") return null;

  const chosen = found.message.widget.options.find((o) => (o.value ?? o.label) === answer);
  const value = answer ?? chosen?.value ?? chosen?.label ?? "";
  found.respondedValue = value;

  // Echo the answer as a user turn so the transcript reads like a conversation, then let the
  // model continue from the question it asked.
  tail(owner).push({ id: nextId(), kind: "message", role: "user", content: value, timestampMs: Date.now() });
  onUpdate(owner);

  const waiting = unpark("widget", owner);
  if (waiting?.history) {
    continueAfterTool(owner, waiting.history, "ask_question", found.message.widget.prompt, value);
  }
  return found;
}
export function submitSecret(a: { requestId?: string }) {   // value intentionally not stored
  const p = findPending(a.requestId); if (p) { pending.delete(p.requestId); onUpdate(p.agentId); } return {};
}
export function dismissWidget(a: { requestId?: string; agentId?: string }): Record<string, never> {
  if (a.requestId) pending.delete(a.requestId);
  if (a.agentId) onUpdate(a.agentId);
  return {};
}

// ── send ──────────────────────────────────────────────────────────────────────
function reveal(target: Entry, full: string, agentId: string): void {
  if (process.env.GROKBOT2_PROGRESSIVE === "0") { setText(target, full); if (target.kind === "send-message") target.streaming = false; onUpdate(agentId); return; }
  const tokens = full.match(/\S+\s*/g) ?? [full];
  const per = Math.max(1, Math.ceil(tokens.length / 24));
  let i = 0;
  const tick = (): void => {
    i += per;
    if (i >= tokens.length) { setText(target, full); if (target.kind === "send-message") target.streaming = false; onUpdate(agentId); return; }
    setText(target, tokens.slice(0, i).join("")); onUpdate(agentId); setTimeout(tick, 45);
  };
  tick();
}

export interface SendArgs {
  agentId?: string; content?: string; prompt?: string; text?: string; richText?: { text?: string };
  clientNonce?: string; attachments?: { path?: string; name?: string }[];
  /** Set when the prompt came from another bot rather than the user — see messageAgent. */
  fromAgent?: { id: string; name: string };
}

/**
 * Bot-to-bot messaging.
 *
 * The original's transcript shows this as "Messaged Thư ký" / "Message from Sales" /
 * "2 messages with 2 Bots". The renderer decides that purely from a `kind:"message"` entry
 * carrying `toAgent` (outbound) or `fromAgent` (inbound) — client: `fm`. Both sides get an
 * entry, so each bot's own transcript reads as a conversation.
 *
 * A hop budget is not optional. Two bots that answer each other will do so forever, burning
 * pool quota with nobody watching; the original has orchestration to stop that and we do not.
 */
const MAX_HOPS = 3;
const hops = new Map<string, number>();

export function messageAgent(fromId: string, target: string, content: string): string {
  const from = agents.get(fromId);
  const wanted = target.trim().toLowerCase().replace(/^@/, "");
  const to = agents.get(target) ??
    [...agents.values()].find((a) => a.name.toLowerCase() === wanted) ??
    [...agents.values()].find((a) => a.name.toLowerCase().includes(wanted));
  if (!from || !to) {
    const names = [...agents.values()].map((a) => a.name).slice(0, 12).join(", ");
    return `(không tìm thấy bot "${target}"; có: ${names})`;
  }
  if (to.id === fromId) return "(không thể tự nhắn cho chính mình)";

  const hop = (hops.get(fromId) ?? 0) + 1;
  if (hop > MAX_HOPS) return `(đã đạt trần ${MAX_HOPS} lượt chuyển tiếp giữa các bot — dừng để tránh vòng lặp)`;

  const now = Date.now();
  // Outbound on the sender's side: the renderer labels this "Messaged <name>".
  tail(fromId).push({ id: nextId(), kind: "message", role: "assistant", content, timestampMs: now,
    toAgent: { id: to.id, name: to.name, kind: "agent" } });
  onUpdate(fromId);

  // Inbound on the recipient's side. sendPrompt writes that entry itself, so pass `fromAgent`
  // through rather than pushing one here too — doing both showed the message twice in the
  // recipient's transcript, once labelled and once as a plain "[từ bot X] …" prompt.
  to.unread = true;
  hops.set(to.id, hop);
  sendPrompt({ agentId: to.id, content, fromAgent: { id: from.id, name: from.name } });

  return `đã nhắn cho ${to.name}`;
}

export function sendPrompt(args: SendArgs) {
  let agentId = args.agentId || [...agents.keys()][0];
  if (!agentId) agentId = createAgent({}).id;
  const text = args.content ?? args.prompt ?? args.text ?? args.richText?.text ?? "";
  const t = tail(agentId);

  const userEntry: Entry = { id: nextId(), kind: "message", role: "user", content: text, timestampMs: Date.now(), ...(args.clientNonce ? { clientNonce: args.clientNonce } : {}), ...(args.fromAgent ? { fromAgent: args.fromAgent } : {}) };
  t.push(userEntry);

  // Record acceptance so the composer's poll confirms the bubble and refreshes the transcript.
  if (args.clientNonce) {
    acceptance.set(args.clientNonce, {
      accountSlot: "default", clientNonce: args.clientNonce, status: "accepted",
      acceptedAtMs: Date.now(), agentId, echoEntryId: userEntry.id, rejectionCode: null,
    });
  }

  // A new user message gets a fresh tool-step budget; without this the cap is cumulative and
  // the tenth message of a session gets no tools at all.
  resetToolSteps(agentId);
  // The bot-to-bot hop budget needs the same reset, and never had one.
  //
  // `hops` only ever counted up: nothing deleted or cleared it, in any file. So a bot that had
  // once received a relayed message at depth MAX_HOPS could never call `message_agent` again —
  // every later attempt answered "đã đạt trần 3 lượt", in a brand new conversation, with no
  // error anywhere. The team-of-bots feature quietly switched itself off as the roster got used.
  //
  // The reset belongs here and only here: a message FROM THE USER is what starts a new chain,
  // while one carrying `fromAgent` IS the chain and must keep counting or the loop guard is gone.
  if (!args.fromAgent) hops.delete(agentId);

  // Manual trigger: "/tool echo hello"
  const m = text.match(/^\/tool\s+(.+)/i);
  if (m) { injectTool(agentId, m[1]); return { accepted: true, entryId: userEntry.id, agentId }; }

  const bubble: Entry = { id: nextId(), kind: "send-message", author: authorOf(agentId), message: { type: "text", content: "" }, timestampMs: Date.now(), streaming: true };
  t.push(bubble);
  onUpdate(agentId);

  const key = loadPoolKey();
  if (!key) {
    setText(bubble, "[grokbot2] Chưa có key — dán hal_xxx vào services/grokbot-backend/pool-key.txt");
    if (bubble.kind === "send-message") bubble.streaming = false;
    onUpdate(agentId);
    return { accepted: true, entryId: userEntry.id, agentId };
  }

  // A message from another bot is attributed in the model's history, not in the entry text —
  // the entry carries `fromAgent` so the renderer can label it, and prefixing the stored text
  // instead would put "[từ bot X]" inside the visible bubble as well.
  const history: PoolMessage[] = t.filter((e) => textOf(e) && !isToolEcho(e))
    .map((e) => {
      const from = e.kind === "message" ? e.fromAgent : undefined;
      return {
        role: e.kind === "message" && e.role === "user" ? "user" : "assistant",
        content: from ? `[tin nhắn từ bot ${from.name}] ${textOf(e)}` : textOf(e),
      } as PoolMessage;
    });
  const image = readImageAttachment(args.attachments);
  // Abort whatever was still running for this bot before replacing it. `inflight` is keyed by
  // agent, so overwriting it left the previous turn streaming into an older bubble with no way
  // to stop it — two turns writing at once, and the presence flags set by whichever finished
  // last. Sending a new message means the user has moved on.
  inflight.get(agentId)?.abort();
  const controller = new AbortController();
  inflight.set(agentId, controller);
  void startTurn(agentId, bubble, history.length ? history : [{ role: "user", content: text }], key, controller, image);
  return { accepted: true, entryId: userEntry.id, agentId };
}

/** Turn a tool request into a tool-call entry + a pending permission card. */
function injectTool(agentId: string, spec: string, history?: PoolMessage[]): void {
  const [name = "", ...rest] = spec.trim().split(/\s+/);
  const arg = rest.join(" ");
  const t = tail(agentId);
  const toolCallId = `tc-${toolSeq++}`;
  const requestId = `req-${reqSeq++}`;
  const lower = name.toLowerCase();
  const known = lower in TOOLS;
  // `summary` is the client's own one-line description of a tool step — the outline panel
  // reads it (`n.summary != null ? firstLine(n.summary) : ""`) and shows nothing without it.
  t.push({ id: nextId(), kind: "tool-call", toolCallId, name, rawArgs: JSON.stringify({ arg }), summary: `${name}(${arg})`.slice(0, 160), status: "pending", timestampMs: Date.now() });

  // Read-only tools and questions run straight away. `isAutoApproved` existed but nothing
  // called it, so every harmless read still made the user click Allow.
  // Browser actions drive the BOX's own Chrome, which the user is watching live in the VNC
  // pane. The original asks for nothing here — a sign-in flow there runs navigate → screenshot
  // → click → screenshot in one breath, and a card per step would make that impossible. What
  // still asks is anything that writes to disk.
  const isBrowserAction = lower.startsWith("browser_");
  /**
   * The user's standing answer to the permission card, which we were storing and ignoring.
   *
   * The client persists it through `setHostSettings` as `localToolPermission` and its own card
   * says so — "Always allow … It can always be changed in Settings". Read off the live settings
   * on this machine it was already `"always"`, meaning the button had been pressed at some point
   * and every later request still put the card up again. From the user's side that is the app
   * forgetting an answer it explicitly promised to remember.
   *
   * `never` is honoured too, and honoured as a refusal rather than a silent drop: a tool that
   * does nothing and says nothing is indistinguishable from one that is broken.
   */
  const standing = String((hostSettingsRef() as { localToolPermission?: unknown }).localToolPermission ?? "ask");
  if (known && standing === "never") {
    const denied: Entry = { id: nextId(), kind: "send-message", author: authorOf(agentId), timestampMs: Date.now(),
      message: { type: "local-tool-permission", ask: { status: "denied", target: `${name}(${arg})`, requestId } } };
    t.push(denied);
    const tc = t.find((e): e is Extract<Entry, { kind: "tool-call" }> => e.kind === "tool-call" && e.toolCallId === toolCallId);
    if (tc) { tc.status = "done"; tc.result = "(người dùng đã chặn công cụ chạy lệnh trên máy)"; }
    onUpdate(agentId);
    return;
  }
  if (known && (standing === "always" || AUTO_APPROVED.has(lower) || isBrowserAction || isAutoApproved(lower))) {
    runTool(agentId, toolCallId, lower, arg, history);
    onUpdate(agentId);
    return;
  }

  const card: Entry = { id: nextId(), kind: "send-message", author: authorOf(agentId), timestampMs: Date.now(),
    message: { type: "local-tool-permission", ask: { status: known ? "pending" : "denied", target: `${name}(${arg})`, requestId } } };
  t.push(card);
  if (known) pending.set(requestId, { agentId, entryId: card.id, toolCallId, name: lower, arg, history });
  onUpdate(agentId);
}

/** One model turn: stream tokens into `bubble`, then handle a TOOL_CALL if the model asked. */
/**
 * Compact if the conversation has outgrown its budget, then run the turn.
 *
 * Compaction happens before the request rather than after a failure: once the window is
 * exceeded the call fails outright, and a retry with the same oversized history fails the
 * same way.
 */
async function startTurn(agentId: string, bubble: Entry, history: PoolMessage[], key: string, controller: AbortController, image?: string): Promise<void> {
  // The indicator must appear before the first token, not after it — that gap is exactly
  // what reads as a frozen app.
  setPresence(agentId, { isRunning: true, isComposingMessage: false, currentActivity: { kind: "thinking" } });
  const prior = compaction.get(agentId) ?? null;
  if (needsCompaction(history)) {
    const next = await compact(history, key, prior, controller.signal);
    if (next) { compaction.set(agentId, next); persist(); }
  }
  return runTurn(agentId, bubble, applyCompaction(history, compaction.get(agentId) ?? null), key, controller, image);
}

async function runTurn(agentId: string, bubble: Entry, history: PoolMessage[], key: string, controller: AbortController, image?: string): Promise<void> {
  // Tiered so the ~5k-token base prompt stays a stable cacheable prefix; the timestamp and
  // anything else per-turn goes last. See prompt.ts.
  const system = buildSystemPrompt(TOOL_PROTOCOL, {
    memory: renderMemory(await loadMemory(agentId)),
    agentName: agents.get(agentId)?.name,
    boxOn: boxConfigured(),
    browserOn: isBrowserConfigured(),
    timeZone: (hostSettingsRef() as { userTimeZone?: string }).userTimeZone,
  });
  const opts = { url: config.poolUrl, key, model: config.model, system, signal: controller.signal, ...(image ? { image } : {}) };
  // Typewriter buffer: the pool often delivers a whole answer in one chunk, which would pop
  // in with no motion. Feed chunks into a target and let the displayed text catch up on a
  // timer, so the reply always animates in (GROKBOT2_PROGRESSIVE=0 disables).
  let target = "";
  let shown = 0;
  let ticking = false;
  const instant = process.env.GROKBOT2_PROGRESSIVE === "0";
  const pump = (): void => {
    if (controller.signal.aborted) { ticking = false; return; }
    if (shown >= target.length) { ticking = false; return; }
    ticking = true;
    const step = Math.max(2, Math.ceil((target.length - shown) / 12));
    shown = Math.min(target.length, shown + step);
    setText(bubble, target.slice(0, shown));
    bubble.timestampMs = Date.now();
    onUpdate(agentId);
    setTimeout(pump, 40);
  };
  let r = await streamPool(history, opts, (chunk) => {
    if (controller.signal.aborted) return;
    // First token: the indicator switches from "working" to "typing", which is the whole
    // difference between "it is doing something" and "it is answering you now".
    if (!target) setPresence(agentId, { isComposingMessage: true, currentActivity: null });
    target += chunk;
    if (instant) { setText(bubble, target); onUpdate(agentId); return; }
    if (!ticking) pump();
  });
  // Let the buffer drain before finishing the turn.
  if (!instant && r.ok) {
    for (let i = 0; i < 80 && shown < target.length && !controller.signal.aborted; i++) {
      await new Promise((res) => setTimeout(res, 40));
    }
  }
  const acc = target;
  // The pool's streaming route intermittently completes with no deltas (HTTP 200,
  // finish_reason "stop", empty content) while the non-streaming route answers fine —
  // so treat an empty stream as a failure and retry without streaming.
  const streamedNothing = r.ok && !(r.text ?? "").trim();
  if ((!r.ok || streamedNothing) && r.error !== "aborted" && !controller.signal.aborted) {
    if (streamedNothing) console.warn("[grokbot2] stream returned no content — falling back to non-streaming");
    r = await callPool(history, opts);
    if (r.ok) reveal(bubble, r.text ?? "", agentId);
  }
  inflight.delete(agentId);
  if (controller.signal.aborted) {
    // An aborted turn used to just return, and it left two kinds of wreckage on screen.
    //
    // `sendPrompt` aborts whatever is running for that bot before starting the next turn, which
    // in a multi-agent conversation happens constantly — a peer messaging a bot mid-turn is the
    // normal case, not an edge case. Measured in a real run: Frontend Dev's transcript held an
    // EMPTY bubble right before an inbound message, and later a 28k-character bubble whose text
    // ended in a complete `TOOL_CALL: edit_file_v2({...})` that never ran. Both come from here:
    // the return happens before the bubble is tidied and before the call is parsed, so an empty
    // bubble stays empty for ever and a finished answer is shown with its machine line exposed.
    //
    // Deliberately NOT running the tool. The turn was abandoned because the user (or a peer)
    // moved on; acting on a superseded decision is worse than dropping it. Stripping the line is
    // enough — what the model SAID is kept, what it was about to DO is discarded with the turn.
    const text = textOf(bubble);
    const spoken = text.replace(/TOOL_CALL:\s*[A-Za-z_][\w-]*\s*\([\s\S]*?\)\s*$/, "").trim();
    if (spoken) {
      setText(bubble, spoken);
      if (bubble.kind === "send-message") bubble.streaming = false;
    } else {
      const at = tail(agentId).indexOf(bubble);
      if (at >= 0) tail(agentId).splice(at, 1);
    }
    onUpdate(agentId);
    return;
  }
  if (!r.ok) {
    setText(bubble, `[grokbot2] Pool error: ${r.error}`);
    if (bubble.kind === "send-message") bubble.streaming = false;
    // Presence has to be cleared here too, and it was not. Every other exit from this function
    // clears it; this one returned early, so a pool failure left `isRunning` true with nothing
    // generating behind it — the bot span in the sidebar until the process restarted. It is the
    // one path the user is most likely to hit, because it is the path an outage takes.
    clearPresence(agentId);
    onUpdate(agentId); return;
  }
  // Both routes can answer HTTP 200 with no content. Leaving the bubble empty looks like the
  // app silently lost the reply; say so instead, so the failure is visible rather than blank.
  if (!(r.text ?? "").trim() && !acc.trim()) {
    console.warn("[grokbot2] pool returned no content on either route");
    setText(bubble, "[grokbot2] Pool trả về rỗng — thử gửi lại.");
  }
  if (bubble.kind === "send-message") bubble.streaming = false;

  // P5-2. `parseToolCalls` reads every call in the reply, not just a trailing one, and `planBatches`
  // decides what may run together: read-only calls accumulate, anything side-effecting stands alone
  // as a barrier. Only the FIRST batch runs now — its results go back to the model, which re-issues
  // whatever is left. That keeps approval and browser ordering exactly as they were while turning a
  // read-two-files request into one round trip instead of two.
  const calls = parseToolCalls(textOf(bubble), isKnownTool);
  if (!calls.length) { clearPresence(agentId); onUpdate(agentId); return; }
  const batches = planBatches(calls, isParallelSafe);
  const batch = batches[0];
  const call = batch[0];
  if (batches.length > 1) {
    // Never drop work silently: say what is deferred, or a turn that quietly ran 1 of 4 calls looks
    // like a turn that ran everything.
    const shape = planShape(batches);
    console.log(`[grokbot2] ${shape.calls} tool call(s) in one reply → ${shape.batches} batch(es), widest ${shape.widest}; running batch 1 of ${shape.batches}`);
  }
  // A tool call is not the end of the turn: stay running, and name what is being done.
  setPresence(agentId, {
    isComposingMessage: false,
    currentActivity: {
      kind: "tool",
      tool: ACTIVITY_TOOL[call.name] ?? call.name,
      ...(activityDetail(call.name, call.arg) ? { detail: activityDetail(call.name, call.arg) } : {}),
    },
  });
  // Keep whatever the model SAID; drop only the machine-readable line.
  //
  // The parser accepts prose in front of a call, so a narrating reply matches too — and this used
  // to delete the whole bubble on the assumption that the content was
  // "the model's raw TOOL_CALL: name(args)" and nothing else. That assumption was never checked.
  // If the model narrated before acting ("Mình mở trang trước đã." then the call), the narration
  // was thrown away, which is exactly the symptom we were blaming on the model: a multi-step
  // turn that runs tools, attaches screenshots and says nothing until the end.
  //
  // So: strip the call, keep the words. An empty remainder still removes the bubble, which is
  // the common case and the original's behaviour — a turn that only acts renders nothing.
  //
  // Strip by the EXACT text each call was parsed from (`ToolCall.raw`) rather than by a pattern.
  // A pattern anchored to the end of the reply removes only the last call, leaving the earlier ones
  // rendered to the user as raw `TOOL_CALL:` lines; and a global pattern would have to re-solve the
  // balanced-parenthesis problem the parser already solved.
  const spoken = calls.reduce((text, c) => text.replace(c.raw, ""), textOf(bubble)).trim();
  if (spoken) {
    setText(bubble, spoken);
    if (bubble.kind === "send-message") bubble.streaming = false;
    onUpdate(agentId);
  } else {
    const at = tail(agentId).indexOf(bubble);
    if (at >= 0) tail(agentId).splice(at, 1);
  }
  if (batch.length > 1) runToolBatch(agentId, batch.map((c) => ({ name: c.name, arg: c.arg })), history);
  else injectTool(agentId, `${call.name} ${call.arg}`, history);
}

/**
 * How many tools one user message may set off.
 *
 * This used to be 1: the follow-up prompt said "không gọi công cụ nữa", so a turn could open a
 * page and then had to stop. The original chains — navigate, screenshot, narrate, click,
 * screenshot, hand the box over — all from a single message, and a one-shot loop cannot
 * reproduce any flow with more than one step in it.
 *
 * Bounded rather than open-ended because each step is a full model round trip, and a model
 * that misreads a tool result can otherwise retry forever. On the last step the instruction
 * goes back to "answer now", so the turn always ends with a reply rather than a silent stop.
 */
const MAX_TOOL_STEPS = 8;
const toolSteps = new Map<string, number>();

/** A fresh user message starts a new budget. */
export const resetToolSteps = (agentId: string): void => { toolSteps.delete(agentId); };

/**
 * P5-2 — run one batch of read-only calls at the same time, then continue the turn ONCE.
 *
 * The turn loop was built around exactly one call per reply: `runTool` continued the turn itself, and
 * `continueAfterTool` fed one name/arg/result triple back. Fanning out therefore needs two things
 * beyond a wider parser — a batch owner that waits for all of them (`onDone` on `runTool`), and a
 * follow-up that carries every result in one message. Without the second, each finished call starts
 * its own turn and the model answers the user once per file it read.
 *
 * Calls are started together and awaited together, so the batch costs the slowest call rather than
 * the sum. Entries are pushed for all of them first, so the outline panel shows the whole fan-out
 * immediately instead of revealing it one row at a time.
 */
function runToolBatch(agentId: string, calls: { name: string; arg: string }[], history?: PoolMessage[]): void {
  const t = tail(agentId);
  const results: (string | undefined)[] = new Array(calls.length).fill(undefined);
  let left = calls.length;

  const started = calls.map((c) => {
    const toolCallId = `tc-${toolSeq++}`;
    t.push({
      id: nextId(), kind: "tool-call", toolCallId, name: c.name, rawArgs: JSON.stringify({ arg: c.arg }),
      summary: `${c.name}(${c.arg})`.slice(0, 160), status: "pending", timestampMs: Date.now(),
    });
    return { ...c, toolCallId };
  });
  onUpdate(agentId);

  for (const [i, c] of started.entries()) {
    runTool(agentId, c.toolCallId, c.name, c.arg, history, (result) => {
      results[i] = result;
      left -= 1;
      if (left > 0 || !history) return;
      continueAfterTools(agentId, history, started.map((s, j) => ({ name: s.name, arg: s.arg, result: results[j] ?? "" })));
    });
  }
}

/** Hand a whole batch of results back in ONE follow-up, in the order the model asked for them. */
function continueAfterTools(agentId: string, history: PoolMessage[], done: { name: string; arg: string; result: string }[]): void {
  if (done.length === 1) {
    continueAfterTool(agentId, history, done[0].name, done[0].arg, done[0].result);
    return;
  }
  const key = loadPoolKey(); if (!key) return;
  const t = tail(agentId);
  const step = (toolSteps.get(agentId) ?? 0) + 1;
  toolSteps.set(agentId, step);
  const last = step >= MAX_TOOL_STEPS;

  const bubble: Entry = { id: nextId(), kind: "send-message", author: authorOf(agentId), message: { type: "text", content: "" }, timestampMs: Date.now(), streaming: true };
  t.push(bubble); onUpdate(agentId);
  const controller = new AbortController();
  inflight.set(agentId, controller);
  void runTurn(agentId, bubble, [
    ...history,
    { role: "assistant", content: done.map((d) => `TOOL_CALL: ${d.name}(${d.arg})`).join("\n") },
    {
      role: "user",
      // Label each result with its own call. A batch of reads comes back as several blocks of text
      // and, unlabelled, the model has to guess which file it is looking at — it guesses wrong.
      content: `${done.map((d) => `Kết quả công cụ ${d.name}(${d.arg}):\n${d.result}`).join("\n\n")}\n` + (last
        ? "Đã dùng đủ số bước công cụ cho lượt này — hãy trả lời người dùng ngay, không gọi công cụ nữa."
        : "Nếu công việc đã xong thì trả lời người dùng. Nếu còn bước tiếp theo, hãy gọi công cụ kế tiếp."),
    },
  ], key, controller);
}

/** Hand the tool result back to the model, which may call another tool or answer. */
function continueAfterTool(agentId: string, history: PoolMessage[], toolName: string, arg: string, result: string): void {
  const key = loadPoolKey(); if (!key) return;
  const t = tail(agentId);
  const step = (toolSteps.get(agentId) ?? 0) + 1;
  toolSteps.set(agentId, step);
  const last = step >= MAX_TOOL_STEPS;

  const bubble: Entry = { id: nextId(), kind: "send-message", author: authorOf(agentId), message: { type: "text", content: "" }, timestampMs: Date.now(), streaming: true };
  t.push(bubble); onUpdate(agentId);
  const controller = new AbortController();
  inflight.set(agentId, controller);
  void runTurn(agentId, bubble, [
    ...history,
    { role: "assistant", content: `TOOL_CALL: ${toolName}(${arg})` },
    {
      role: "user",
      content: `Kết quả công cụ ${toolName}: ${result}\n` + (last
        ? "Đã dùng đủ số bước công cụ cho lượt này — hãy trả lời người dùng ngay, không gọi công cụ nữa."
        : "Nếu công việc đã xong thì trả lời người dùng. Nếu còn bước tiếp theo, hãy gọi công cụ kế tiếp."),
    },
  ], key, controller);
}

/** Run one tool with a real ToolCtx. Exported for the e2e scripts only. */
export function runToolForTest(agentId: string, name: string, arg: string): Promise<string> {
  const fn = TOOLS[name];
  if (!fn) return Promise.resolve(`(no tool ${name})`);
  return Promise.resolve(fn(arg, ctxFor(agentId)));
}
