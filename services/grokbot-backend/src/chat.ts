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
import { BROWSER_TOOL_NAMES, isBrowserConfigured, isBrowserReachable, runBrowserTool, browserProbe } from "./browser.js";
import { stageImage } from "./attachments.js";
import { availableTools, toolProtocol as boxToolProtocol, isAutoApproved } from "./tools.js";
import { boxConfigured } from "./box-exec.js";
import { requestBoxHelp, setHandBackSink, restoreHandoff, handoffEntries, type BoxHandoff } from "./forever-box.js";
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
 * The `🔧 name(arg) → result` bubble is a UI convenience, and it must never reach the model.
 *
 * It is an assistant-authored message that looks exactly like a tool result, so once it is in
 * the history the model copies the format and INVENTS results in it — observed live: asked to
 * list a directory, it emitted a fabricated "🔧 list_dir_v2(".") → 📁 . ├── package.json …"
 * for files that do not exist, without calling anything. The real result already reaches the
 * model through continueAfterTool, so this line is redundant there and actively harmful.
 * (The original's prompt has a whole `## Never fabricate data` chapter; this was us teaching
 * the opposite.)
 */
const TOOL_ECHO = "🔧 ";
const isToolEcho = (e: Entry): boolean =>
  e.kind === "send-message" && e.message.type === "text" && e.message.content.startsWith(TOOL_ECHO);

interface Reaction { emoji: string; by: string }
interface Base { id: string; timestampMs: number; reactions?: Reaction[] }
interface Author { id: string; name: string }
type TextMsg = { type: "text"; content: string };
type PermMsg = { type: "local-tool-permission"; ask: { status: "pending" | "approved" | "denied" | "expired"; target: string; requestId: string } };
type ApprovalMsg = { type: "auto-review-approval"; approval: { status: "pending" | "approved" | "denied"; summary: string; requestId: string } };
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
  | (Base & { kind: "send-message"; author: Author; message: TextMsg | PermMsg | ApprovalMsg | AttachmentMsg | WidgetMsg | EmailDraftMsg | SlackDraftMsg; streaming?: boolean; respondedValue?: string; respondedValueEchoed?: boolean; widgetDismissed?: boolean; widgetSkipped?: boolean })
  // status "failed", not "error": the FE picks the tool card's icon with
  // `status==="pending" ? loading : status==="failed" ? x-circle : wrench`, so an
  // "error" tool renders as an ordinary wrench and reads as if it had succeeded.
  | (Base & { kind: "tool-call"; toolCallId: string; name: string; rawArgs: string; status: "pending" | "running" | "done" | "failed"; result?: string });

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
  const instruction = String(spec?.instruction ?? spec?.prompt ?? arg ?? "").trim();
  if (!instruction) return 'request_box_help cần {"instruction":"việc cần bạn làm trên màn hình"}';
  ctx.note(`Mình cần bạn thao tác trên màn hình box: ${instruction}`);
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

  return runSubagent(type, task, Object.keys(TOOLS), {
    runTool: async (name, toolArg) => {
      const fn = TOOLS[name];
      if (!fn) return `(không có công cụ ${name})`;
      try { return String(await fn(toolArg, ctx)); } catch (e) { return `lỗi: ${(e as Error).message}`; }
    },
    // The original tells the parent to keep the user posted while a subagent works; the
    // subagent's own steps are the only honest source of that.
    onStep: (text) => ctx.note(text),
  });
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

const MCP_PROTOCOL = isMcpConfigured()
  ? "\n\nMCP: các dịch vụ đã nối sẵn — " + Object.keys(mcpServers()).join(", ") + ". " +
    'Xem tool của một server bằng TOOL_CALL: get_mcp_tools(<tên server>), rồi gọi bằng ' +
    'TOOL_CALL: call_mcp_tool({"server":"…","tool_name":"…","tool_args":{…}}). ' +
    "Ưu tiên MCP hơn là mở trình duyệt khi dịch vụ đã có sẵn ở đây."
  : "";

// Browser actions are only offered when a box browser is actually configured — advertising
// tools that cannot run just teaches the model to call them and fail.
// Registered only once the browser has actually answered. Configured-but-unreachable is
// the expensive case: the tool is offered, the model calls it, and the user waits out a
// socket timeout for "fetch failed".
if (isBrowserConfigured()) {
  void browserProbe().then(() => {
    if (!isBrowserReachable()) return;
    for (const name of BROWSER_TOOL_NAMES) TOOLS[name] = (arg, ctx) => runBrowserTool(name, arg, ctx);
  });
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
  ? "\n\nTRÌNH DUYỆT: các công cụ browser_* điều khiển Chrome trong box và người dùng nhìn thấy " +
    "trực tiếp trên màn hình. Đối số dạng JSON, ví dụ " +
    'TOOL_CALL: browser_navigate({"url":"https://example.com"}) hoặc ' +
    'TOOL_CALL: browser_fill({"selector":"#q","value":"xin chào"}). ' +
    "Mỗi hành động đã tự trả về trạng thái trang sau đó, nên KHÔNG cần gọi browser_snapshot " +
    "hay browser_take_screenshot ngay sau một hành động khác."
  : "";

const ASK_PROTOCOL =
  "\n\nHỎI NGƯỜI DÙNG: khi cần người dùng chọn giữa nhiều hướng, dùng " +
  'TOOL_CALL: ask_question({"prompt":"Câu hỏi?","options":[{"label":"Cách A"},{"label":"Cách B"}]}) ' +
  "— tối đa 6 lựa chọn, thêm \"allowCustom\":true nếu họ có thể tự gõ câu trả lời. " +
  "Đừng hỏi rồi tự trả lời: dừng lượt sau khi hỏi, câu trả lời sẽ đến ở lượt sau.";

/**
 * Memory only helps if the agent writes to it, and models do not volunteer that.
 *
 * So the rule names the trigger (a durable fact about the person, not the current task) and
 * the anti-trigger — otherwise it either never remembers anything, or fills memory with
 * transcript.
 */
const MEMORY_PROTOCOL = boxConfigured()
  ? "\n\nTRÍ NHỚ: khi người dùng nói điều gì đáng nhớ lâu dài — tên, nghề, sở thích, cách họ " +
    "muốn được trả lời, thông tin dự án của họ — hãy lưu lại bằng " +
    'TOOL_CALL: knowledge_base({"title":"nhãn ngắn","knowledge_to_store":"nội dung"}). ' +
    "Chỉ lưu điều còn đúng ở lần trò chuyện sau; KHÔNG lưu chi tiết vụn vặt của cuộc hội thoại " +
    "hiện tại. Những gì đã nhớ được đưa sẵn vào đầu mỗi lượt nên bạn không cần đọc lại."
  : "";

const DRAFT_PROTOCOL =
  "\n\nBẢN NHÁP: khi soạn thư hoặc tin nhắn thay người dùng, dùng " +
  'TOOL_CALL: email_draft({"to":["a@b.c"],"subject":"...","body":"..."}) hoac ' +
  'TOOL_CALL: slack_draft({"target":"#kenh","body":"..."}). ' +
  "Thẻ nháp chỉ để xem — hệ thống CHƯA gửi được, nên đừng nói là đã gửi; hỏi người dùng bước tiếp theo.";

const TOOL_PROTOCOL =
  "\n\nCÔNG CỤ: khi cần một trong các công cụ sau, trả lời DUY NHẤT một dòng đúng dạng " +
  "TOOL_CALL: <tên>(<đối số>) và không nói gì thêm. Công cụ: " + Object.keys(TOOLS).join(", ") +
  ". Không cần công cụ thì trả lời bình thường. Sau khi nhận kết quả công cụ, trả lời dựa trên kết quả đó." +
  BROWSER_PROTOCOL + ASK_PROTOCOL + MCP_PROTOCOL + DRAFT_PROTOCOL + MEMORY_PROTOCOL + boxToolProtocol();

function parseToolCall(text: string): { name: string; arg: string } | null {
  const m = text.match(/TOOL_CALL:\s*([A-Za-z_][\w-]*)\s*\((.*?)\)\s*$/s);
  if (!m) return null;
  const name = m[1].toLowerCase();
  return name in TOOLS ? { name, arg: m[2].trim() } : null;
}

let sink: (agentId: string) => void = () => {};
export function setUpdateSink(fn: (agentId: string) => void): void { sink = fn; }
let rosterSink: () => void = () => {};
/** Push a roster change to the FE so add/delete shows up without waiting for its next poll. */
export function setRosterSink(fn: () => void): void { rosterSink = fn; }
const rosterChanged = (): void => rosterSink();

/** PascalCase names the client's activity table knows; anything else renders plain "Working". */
const ACTIVITY_TOOL: Record<string, string> = {
  web_search: "WebSearch",
  web_fetch: "WebFetch",
  read_file_v2: "Read",
  browser_navigate: "WebFetch",
  browser_take_screenshot: "WebFetch",
  knowledge_base: "ReactToMessage",
};

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
  if (changed) { rosterChanged(); persist(); }
}

/** Everything presence-related back to idle. Called on every exit path, including failures. */
const clearPresence = (agentId: string): void =>
  setPresence(agentId, { isRunning: false, isComposingMessage: false, isRetrying: false, currentActivity: null });
const onUpdate = (agentId: string): void => { sink(agentId); persist(); };
const nextId = () => `e${entrySeq++}`;
const tail = (agentId: string) => transcripts.get(agentId) ?? (transcripts.set(agentId, []), transcripts.get(agentId)!);
const authorOf = (agentId: string): Author => ({ id: agentId, name: agents.get(agentId)?.name ?? "Claude" });
const textOf = (e: Entry): string =>
  e.kind === "message" ? e.content : e.kind === "send-message" && e.message.type === "text" ? e.message.content : "";
/** Write into an assistant bubble (the content lives under message.content). */
const setText = (e: Entry, v: string): void => { if (e.kind === "send-message" && e.message.type === "text") e.message.content = v; };

// ── roster ────────────────────────────────────────────────────────────────────
export function createAgent(args: { name?: string } = {}): AgentRecord {
  const id = `agent-${agentSeq++}`;
  // Presence is stated explicitly rather than left undefined. The client tolerates missing
  // fields (`n?.isRunning ?? false`), but a record that never mentions them is how nobody
  // noticed the indicator was unimplemented for this long.
  const rec: AgentRecord = {
    id, name: args.name || "Claude", agentOwnerAuthId: AUTH_ID, createdAtMs: Date.now(), unread: false, hidden: false,
    isRunning: false, isComposingMessage: false, isRetrying: false, currentActivity: null,
  };
  agents.set(id, rec); transcripts.set(id, []); persist(); rosterChanged();
  return rec;
}
export const listAgents = (): AgentRecord[] => [...agents.values()].filter((a) => !a.hidden);
export const countAgents = (): number => listAgents().length;
// The FE sends {id, profile:{name,…}} — a bare `name` never arrives.
export function updateAgent(a: { id?: string; agentId?: string; name?: string; profile?: { name?: string } }): AgentRecord | null {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (!rec) return null;
  const name = a.profile?.name ?? a.name;
  if (typeof name === "string" && name.length > 0) rec.name = name;
  persist(); return rec;
}
export function deleteAgents(a: { ids?: string[]; agentIds?: string[]; id?: string }): { deleted: string[] } {
  const ids = a.ids ?? a.agentIds ?? (a.id ? [a.id] : []);
  for (const id of ids) { agents.delete(id); transcripts.delete(id); inflight.get(id)?.abort(); inflight.delete(id); }
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
  const withSeq = all.map((e, i) => ({ ...e, seq: i + 1 }));
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
export const getSubagents = (): unknown[] => [];
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
const AUTO_APPROVED = new Set(["ask_question", "request_box_help", "get_mcp_tools", "echo", "time", "reverse", "upper", "count", "calc"]);

/**
 * Run one tool and report it, whether it was auto-approved or the user clicked Allow.
 * Async by design: browser actions take seconds, so the tool card goes "running" and the
 * result lands out of band instead of blocking the gateway reply the FE is waiting on.
 */
function runTool(agentId: string, toolCallId: string, name: string, arg: string, history?: PoolMessage[]): void {
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
  void Promise.resolve(fn(arg, ctxFor(agentId, history)))
    .catch((e: Error) => `tool error: ${e.message}`)
    .then((result) => {
      tc.result = result;
      tc.status = "done";
      t.push({ id: nextId(), kind: "send-message", author: authorOf(agentId), message: { type: "text", content: `🔧 ${name}(${arg}) → ${result}` }, timestampMs: Date.now() });
      onUpdate(agentId);
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
        t.push({ id: nextId(), kind: "send-message", author: authorOf(p.agentId), message: { type: "text", content: `🔧 ${p.name}(${p.arg}) → ${tc.result}` }, timestampMs: Date.now() });
      } else {
        // Browser actions take seconds, so show "running" and finish out of band rather than
        // blocking the gateway reply the FE is waiting on.
        tc.status = "running";
        void Promise.resolve(fn(p.arg ?? "", ctxFor(p.agentId, p.history)))
          .catch((e: Error) => `tool error: ${e.message}`)
          .then((result) => {
            tc.result = result;
            tc.status = "done";
            t.push({ id: nextId(), kind: "send-message", author: authorOf(p.agentId), message: { type: "text", content: `🔧 ${p.name}(${p.arg}) → ${result}` }, timestampMs: Date.now() });
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
}

export function sendPrompt(args: SendArgs) {
  let agentId = args.agentId || [...agents.keys()][0];
  if (!agentId) agentId = createAgent({}).id;
  const text = args.content ?? args.prompt ?? args.text ?? args.richText?.text ?? "";
  const t = tail(agentId);

  const userEntry: Entry = { id: nextId(), kind: "message", role: "user", content: text, timestampMs: Date.now(), ...(args.clientNonce ? { clientNonce: args.clientNonce } : {}) };
  t.push(userEntry);

  // Record acceptance so the composer's poll confirms the bubble and refreshes the transcript.
  if (args.clientNonce) {
    acceptance.set(args.clientNonce, {
      accountSlot: "default", clientNonce: args.clientNonce, status: "accepted",
      acceptedAtMs: Date.now(), agentId, echoEntryId: userEntry.id, rejectionCode: null,
    });
  }

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

  const history: PoolMessage[] = t.filter((e) => textOf(e) && !isToolEcho(e))
    .map((e) => ({ role: e.kind === "message" && e.role === "user" ? "user" : "assistant", content: textOf(e) }));
  const image = readImageAttachment(args.attachments);
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
  t.push({ id: nextId(), kind: "tool-call", toolCallId, name, rawArgs: JSON.stringify({ arg }), status: "pending", timestampMs: Date.now() });

  // Read-only tools and questions run straight away. `isAutoApproved` existed but nothing
  // called it, so every harmless read still made the user click Allow.
  if (known && (AUTO_APPROVED.has(lower) || isAutoApproved(lower))) {
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
  if (controller.signal.aborted) return;
  if (!r.ok) {
    setText(bubble, `[grokbot2] Pool error: ${r.error}`);
    if (bubble.kind === "send-message") bubble.streaming = false;
    onUpdate(agentId); return;
  }
  // Both routes can answer HTTP 200 with no content. Leaving the bubble empty looks like the
  // app silently lost the reply; say so instead, so the failure is visible rather than blank.
  if (!(r.text ?? "").trim() && !acc.trim()) {
    console.warn("[grokbot2] pool returned no content on either route");
    setText(bubble, "[grokbot2] Pool trả về rỗng — thử gửi lại.");
  }
  if (bubble.kind === "send-message") bubble.streaming = false;

  const call = parseToolCall(textOf(bubble));
  if (!call) { clearPresence(agentId); onUpdate(agentId); return; }
  // A tool call is not the end of the turn: stay running, and name what is being done.
  setPresence(agentId, {
    isComposingMessage: false,
    currentActivity: { kind: "tool", tool: ACTIVITY_TOOL[call.name] ?? call.name },
  });
  setText(bubble, `Cần dùng công cụ \`${call.name}\`.`);
  injectTool(agentId, `${call.name} ${call.arg}`, history);
}

/** After approval, hand the tool result back to the model for a final answer. */
function continueAfterTool(agentId: string, history: PoolMessage[], toolName: string, arg: string, result: string): void {
  const key = loadPoolKey(); if (!key) return;
  const t = tail(agentId);
  const bubble: Entry = { id: nextId(), kind: "send-message", author: authorOf(agentId), message: { type: "text", content: "" }, timestampMs: Date.now(), streaming: true };
  t.push(bubble); onUpdate(agentId);
  const controller = new AbortController();
  inflight.set(agentId, controller);
  void runTurn(agentId, bubble, [
    ...history,
    { role: "assistant", content: `TOOL_CALL: ${toolName}(${arg})` },
    { role: "user", content: `Kết quả công cụ ${toolName}: ${result}\nHãy trả lời người dùng dựa trên kết quả này (không gọi công cụ nữa).` },
  ], key, controller);
}

/** Run one tool with a real ToolCtx. Exported for the e2e scripts only. */
export function runToolForTest(agentId: string, name: string, arg: string): Promise<string> {
  const fn = TOOLS[name];
  if (!fn) return Promise.resolve(`(no tool ${name})`);
  return Promise.resolve(fn(arg, ctxFor(agentId)));
}
