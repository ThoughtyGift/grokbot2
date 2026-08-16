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

interface Reaction { emoji: string; by: string }
interface Base { id: string; timestampMs: number; reactions?: Reaction[] }
interface Author { id: string; name: string }
type TextMsg = { type: "text"; content: string; images?: string[] };
type PermMsg = { type: "local-tool-permission"; ask: { status: "pending" | "approved" | "denied" | "expired"; target: string; requestId: string } };
type ApprovalMsg = { type: "auto-review-approval"; approval: { status: "pending" | "approved" | "denied"; summary: string; requestId: string } };

export type Entry =
  | (Base & { kind: "message"; role: "user" | "assistant"; content: string; images?: string[]; clientNonce?: string; isStreaming?: boolean })
  | (Base & { kind: "send-message"; author: Author; message: TextMsg | PermMsg | ApprovalMsg; streaming?: boolean })
  | (Base & { kind: "tool-call"; toolCallId: string; name: string; rawArgs: string; status: "pending" | "running" | "done" | "error"; result?: string });

export interface AgentRecord {
  id: string; name: string; agentOwnerAuthId: string; createdAtMs: number; unread: boolean; hidden: boolean;
  avatarDataUrl?: string; avatarVersion?: string; notificationsEnabled?: boolean; notifyOnUpdates?: boolean;
}

const agents = new Map<string, AgentRecord>();
const transcripts = new Map<string, Entry[]>();
const inflight = new Map<string, AbortController>();
const pending = new Map<string, { agentId: string; entryId: string; toolCallId?: string; name?: string; arg?: string; history?: PoolMessage[] }>();
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
});
export const chatSnapshot = snapshot;
let hostSettingsRef: () => Record<string, unknown> = () => ({});
export function bindHostSettings(get: () => Record<string, unknown>): void { hostSettingsRef = get; }
const persist = () => scheduleSave(() => ({ ...snapshot(), hostSettings: hostSettingsRef() }));

/** Older builds stored user-message/agent-message (a shared-room shape the renderer ignores). */
function migrate(e: any, agentName: string): Entry | null {
  if (!e || typeof e !== "object") return null;
  const id = e.id ?? e.entryId ?? `e${entrySeq++}`;
  const ts = e.timestampMs ?? Date.now();
  if (e.kind === "user-message") return { id, kind: "message", role: "user", content: e.text ?? "", timestampMs: ts, ...(e.clientNonce ? { clientNonce: e.clientNonce } : {}) };
  if (e.kind === "agent-message") return { id, kind: "send-message", author: { id: e.agentId ?? "agent", name: e.authorName ?? agentName }, message: { type: "text", content: e.text ?? "" }, timestampMs: ts };
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
  for (const a of (s.agents ?? []) as AgentRecord[]) if (a?.id) agents.set(a.id, a);
  for (const [id, entries] of Object.entries(s.transcripts ?? {})) {
    const name = agents.get(id)?.name ?? "Claude";
    transcripts.set(id, (entries as any[]).map((e) => migrate(e, name)).filter((e): e is Entry => e !== null));
  }
  for (const r of (s.acceptance ?? []) as AcceptanceRecord[]) if (r?.clientNonce) acceptance.set(r.clientNonce, r);
  // Derive counters from the highest id present — agents.size would reissue a live id.
  const maxNum = (ids: Iterable<string>, re: RegExp) => {
    let max = 0;
    for (const id of ids) { const m = re.exec(id); if (m) max = Math.max(max, Number(m[1]) || 0); }
    return max;
  };
  agentSeq = Math.max(s.seq?.agent ?? 0, maxNum(agents.keys(), /^agent-(\d+)$/) + 1, 1);
  entrySeq = Math.max(s.seq?.entry ?? 0, maxNum([...transcripts.values()].flat().map((e) => e.id), /^e(\d+)$/) + 1, 1);
  if (agents.size) console.log(`[grokbot2] restored ${agents.size} agent(s), ${[...transcripts.values()].flat().length} transcript entries`);
}

/** SAFE tools — pure, no side effects, no system access. The model may request these. */
const TOOLS: Record<string, (arg: string) => string> = {
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
const TOOL_PROTOCOL =
  "\n\nCÔNG CỤ: khi cần một trong các công cụ sau, trả lời DUY NHẤT một dòng đúng dạng " +
  "TOOL_CALL: <tên>(<đối số>) và không nói gì thêm. Công cụ: " + Object.keys(TOOLS).join(", ") +
  ". Không cần công cụ thì trả lời bình thường. Sau khi nhận kết quả công cụ, trả lời dựa trên kết quả đó.";

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
  const rec: AgentRecord = { id, name: args.name || "Claude", agentOwnerAuthId: AUTH_ID, createdAtMs: Date.now(), unread: false, hidden: false };
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
export function interruptAgentRun(a: { agentId?: string; id?: string }) {
  const agentId = a.agentId ?? a.id ?? "";
  inflight.get(agentId)?.abort(); inflight.delete(agentId);
  const last = [...(transcripts.get(agentId) ?? [])].reverse().find((e) => e.kind === "send-message" && e.message.type === "text");
  if (last && !textOf(last)) { setText(last, "⏹ đã dừng"); if (last.kind === "send-message") last.streaming = false; last.timestampMs = Date.now(); onUpdate(agentId); }
  return { id: agentId, interrupted: true };
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
      tc.result = fn ? fn(p.arg ?? "") : "(unknown tool)";
      tc.status = "done";
      t.push({ id: nextId(), kind: "send-message", author: authorOf(p.agentId), message: { type: "text", content: `🔧 ${p.name}(${p.arg}) → ${tc.result}` }, timestampMs: Date.now() });
      if (p.history) continueAfterTool(p.agentId, p.history, p.name ?? "", p.arg ?? "", tc.result);
    } else { tc.status = "error"; tc.result = "denied"; }
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
export function respondToWidget(a: { requestId?: string }) {
  const p = findPending(a.requestId); if (p) { pending.delete(p.requestId); onUpdate(p.agentId); } return {};
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

  const history: PoolMessage[] = t.filter((e) => textOf(e))
    .map((e) => ({ role: e.kind === "message" && e.role === "user" ? "user" : "assistant", content: textOf(e) }));
  const image = readImageAttachment(args.attachments);
  const controller = new AbortController();
  inflight.set(agentId, controller);
  void runTurn(agentId, bubble, history.length ? history : [{ role: "user", content: text }], key, controller, image);
  return { accepted: true, entryId: userEntry.id, agentId };
}

/** Turn a tool request into a tool-call entry + a pending permission card. */
function injectTool(agentId: string, spec: string, history?: PoolMessage[]): void {
  const [name = "", ...rest] = spec.trim().split(/\s+/);
  const arg = rest.join(" ");
  const t = tail(agentId);
  const toolCallId = `tc-${toolSeq++}`;
  const requestId = `req-${reqSeq++}`;
  const known = name.toLowerCase() in TOOLS;
  t.push({ id: nextId(), kind: "tool-call", toolCallId, name, rawArgs: JSON.stringify({ arg }), status: "pending", timestampMs: Date.now() });
  const card: Entry = { id: nextId(), kind: "send-message", author: authorOf(agentId), timestampMs: Date.now(),
    message: { type: "local-tool-permission", ask: { status: known ? "pending" : "denied", target: `${name}(${arg})`, requestId } } };
  t.push(card);
  if (known) pending.set(requestId, { agentId, entryId: card.id, toolCallId, name: name.toLowerCase(), arg, history });
  onUpdate(agentId);
}

/** One model turn: stream tokens into `bubble`, then handle a TOOL_CALL if the model asked. */
async function runTurn(agentId: string, bubble: Entry, history: PoolMessage[], key: string, controller: AbortController, image?: string): Promise<void> {
  const opts = { url: config.poolUrl, key, model: config.model, system: config.system + TOOL_PROTOCOL, signal: controller.signal, ...(image ? { image } : {}) };
  let acc = "";
  let r = await streamPool(history, opts, (chunk) => {
    if (controller.signal.aborted) return;
    acc += chunk; setText(bubble, acc); bubble.timestampMs = Date.now(); onUpdate(agentId);
  });
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
  if (bubble.kind === "send-message") bubble.streaming = false;

  const call = parseToolCall(textOf(bubble));
  if (!call) { onUpdate(agentId); return; }
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
