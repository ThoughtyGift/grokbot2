/**
 * Chat bridge — turns the stubbed box gateway into an agent host backed by the
 * Claude pool. Supports roster mutations, run interrupt, reactions, outline,
 * progressive reveal, and (P1) a SAFE tool-call + approval demo pipeline.
 *
 * The pool returns plain text (no native tool-calls), so tool-calls are produced
 * by a local demo trigger (`/tool <name> <arg>`) using an allowlisted, side-effect-free
 * tool registry — NO system commands. This exists to exercise the approval UI.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { callPool, type PoolMessage } from "@grokbot2/pool-client";
import { config, loadPoolKey } from "./config.js";
import { loadState, scheduleSave, type PersistedState } from "./store.js";

export const AUTH_ID = "auth0|grokbot2-user";

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

interface BaseEntry {
  entryId: string;
  timestampMs: number;
  agentId?: string;
  reactions?: string[];
}
type Entry =
  | (BaseEntry & { kind: "user-message"; text: string; images: string[]; clientNonce?: string })
  | (BaseEntry & { kind: "agent-message"; agentOwnerAuthId: string; authorName: string; text: string; images: string[]; streaming?: boolean })
  | (BaseEntry & { kind: "tool-call"; toolCallId: string; name: string; rawArgs: string; status: "pending" | "running" | "done" | "error"; result?: string })
  | (BaseEntry & { kind: "send-message"; message: PermissionMessage | ApprovalMessage | SecretMessage });

interface PermissionMessage { type: "local-tool-permission"; ask: { status: "pending" | "approved" | "denied" | "expired"; target: string; requestId: string } }
interface ApprovalMessage { type: "auto-review-approval"; approval: { status: "pending" | "approved" | "denied"; summary: string; requestId: string } }
interface SecretMessage { type: "secret-request"; secret: { status: "pending" | "provided"; name: string; requestId: string } }

export interface AgentRecord {
  id: string; name: string; agentOwnerAuthId: string; createdAtMs: number; unread: boolean; hidden: boolean;
  avatarDataUrl?: string; avatarVersion?: string; notificationsEnabled?: boolean; notifyOnUpdates?: boolean;
}

const agents = new Map<string, AgentRecord>();
const transcripts = new Map<string, Entry[]>();
const inflight = new Map<string, AbortController>();
const pending = new Map<string, { agentId: string; entryId: string; kind: string; toolCallId?: string; name?: string; arg?: string }>();
let agentSeq = 1, entrySeq = 1, reqSeq = 1, toolSeq = 1;

// ── persistence: restore on boot, save (debounced) on every mutation ──
const snapshot = (): PersistedState => ({
  agents: [...agents.values()],
  transcripts: Object.fromEntries([...transcripts.entries()]),
  seq: { agent: agentSeq, entry: entrySeq },
});
export const chatSnapshot = snapshot;
const persist = () => scheduleSave(() => ({ ...snapshot(), hostSettings: hostSettingsRef() }));
let hostSettingsRef: () => Record<string, unknown> = () => ({});
/** The gateway owns host settings; let it contribute them to the same save file. */
export function bindHostSettings(get: () => Record<string, unknown>): void { hostSettingsRef = get; }

{
  const s = loadState();
  for (const a of (s.agents ?? []) as AgentRecord[]) if (a?.id) agents.set(a.id, a);
  for (const [id, entries] of Object.entries(s.transcripts ?? {})) transcripts.set(id, entries as Entry[]);
  // Derive the counters from the highest id actually present — using agents.size would
  // hand out an id that already exists and silently overwrite a restored agent.
  const maxNum = (ids: Iterable<string>, prefix: RegExp) => {
    let max = 0;
    for (const id of ids) { const m = prefix.exec(id); if (m) max = Math.max(max, Number(m[1]) || 0); }
    return max;
  };
  const maxEntry = maxNum([...transcripts.values()].flat().map((e) => e.entryId), /^e(\d+)$/);
  agentSeq = Math.max(s.seq?.agent ?? 0, maxNum(agents.keys(), /^agent-(\d+)$/) + 1, 1);
  entrySeq = Math.max(s.seq?.entry ?? 0, maxEntry + 1, 1);
  if (agents.size) console.log(`[grokbot2] restored ${agents.size} agent(s), ${[...transcripts.values()].flat().length} transcript entries`);
}

/** SAFE demo tools — pure, no side effects, no system access. */
const DEMO_TOOLS: Record<string, (arg: string) => string> = {
  echo: (a) => a || "(empty)",
  time: () => new Date().toISOString(),
  reverse: (a) => [...a].reverse().join(""),
  upper: (a) => a.toUpperCase(),
};

let sink: (agentId: string) => void = () => {};
export function setUpdateSink(fn: (agentId: string) => void): void { sink = fn; }
/** Notify the FE and persist — every transcript/roster mutation goes through here. */
const onUpdate = (agentId: string): void => { sink(agentId); persist(); };
const nextEntryId = () => `e${entrySeq++}`;
const tail = (agentId: string) => transcripts.get(agentId) ?? (transcripts.set(agentId, []), transcripts.get(agentId)!);

// ── roster ──────────────────────────────────────────────────────────────────
export function createAgent(args: { name?: string } = {}): AgentRecord {
  const id = `agent-${agentSeq++}`;
  const rec: AgentRecord = { id, name: args.name || "Claude", agentOwnerAuthId: AUTH_ID, createdAtMs: Date.now(), unread: false, hidden: false };
  agents.set(id, rec); transcripts.set(id, []);
  persist();
  return rec;
}
export const listAgents = (): AgentRecord[] => [...agents.values()].filter((a) => !a.hidden);
export const countAgents = (): number => listAgents().length;
export function updateAgent(a: { id?: string; agentId?: string; name?: string }): AgentRecord | null {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (!rec) return null;
  if (typeof a.name === "string" && a.name.length > 0) rec.name = a.name;
  persist(); return rec;
}
export function deleteAgents(a: { ids?: string[]; agentIds?: string[]; id?: string }): { deleted: string[] } {
  const ids = a.ids ?? a.agentIds ?? (a.id ? [a.id] : []);
  for (const id of ids) { agents.delete(id); transcripts.delete(id); inflight.get(id)?.abort(); inflight.delete(id); }
  persist();
  return { deleted: ids };
}
export function duplicateAgent(a: { id?: string; agentId?: string }): AgentRecord | null {
  const src = agents.get(a.id ?? a.agentId ?? ""); if (!src) return null;
  const rec = createAgent({ name: `${src.name} (copy)` });
  transcripts.set(rec.id, structuredClone(transcripts.get(src.id) ?? []));
  persist(); return rec;
}
// NOTE: the FE sends {id, isUnread} / {id, isHidden} — accept both spellings.
export function setAgentUnread(a: { id?: string; agentId?: string; unread?: boolean; isUnread?: boolean }): Record<string, never> {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (rec) rec.unread = a.isUnread ?? a.unread ?? false; persist(); return {};
}
export function setAgentHiddenFromSidebar(a: { id?: string; agentId?: string; hidden?: boolean; isHidden?: boolean }): Record<string, never> {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (rec) rec.hidden = a.isHidden ?? a.hidden ?? true; persist(); return {};
}
export function setAgentNotificationsEnabled(a: { id?: string; agentId?: string; enabled?: boolean }): Record<string, never> {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (rec) rec.notificationsEnabled = a.enabled ?? true; persist(); return {};
}
export function setAgentNotifyOnUpdates(a: { id?: string; agentId?: string; enabled?: boolean }): Record<string, never> {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (rec) rec.notifyOnUpdates = a.enabled ?? true; persist(); return {};
}
export function setAgentAvatarBytes(a: { id?: string; agentId?: string; pngBase64?: string; bytes?: string }): AgentRecord | null {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (!rec) return null;
  const b64 = a.pngBase64 ?? a.bytes;
  if (b64) { rec.avatarDataUrl = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`; rec.avatarVersion = String((entrySeq++)); persist(); }
  return rec;
}
export function getAgentAvatar(a: { id?: string; agentId?: string }) {
  const rec = agents.get(a.id ?? a.agentId ?? "");
  return { avatarDataUrl: rec?.avatarDataUrl ?? "", avatarVersion: rec?.avatarVersion ?? "" };
}

// ── transcript ────────────────────────────────────────────────────────────────
export const transcriptTail = (agentId?: string) => ({ entries: (agentId && transcripts.get(agentId)) || [], hasMore: false });
export function getConversationOutline(a: { agentId?: string }) {
  const t = (a.agentId && transcripts.get(a.agentId)) || [];
  return t.filter((e): e is Extract<Entry, { kind: "user-message" }> => e.kind === "user-message" && !!e.text)
    .map((e) => ({ entryId: e.entryId, text: e.text.slice(0, 80), timestampMs: e.timestampMs }));
}
export function reactToMessage(a: { agentId?: string; entryId?: string; reaction?: string; emoji?: string }): Record<string, never> {
  const t = (a.agentId && transcripts.get(a.agentId)) || [];
  const e = t.find((x) => x.entryId === a.entryId); if (e) (e.reactions ??= []).push(a.reaction ?? a.emoji ?? "👍"); return {};
}
export const voteFeedback = (): Record<string, never> => ({});
export const promptAcceptanceStatus = () => ({ accepted: true, status: "accepted" });

// ── P2: roster search / run helpers ───────────────────────────────────────────
/** Match agents by name, and (cheaply) by transcript text so search feels real. */
export function searchAgents(a: { query?: string; q?: string; text?: string }): AgentRecord[] {
  const q = (a.query ?? a.q ?? a.text ?? "").toLowerCase().trim();
  if (!q) return listAgents();
  return listAgents().filter((rec) => {
    if (rec.name.toLowerCase().includes(q)) return true;
    return (transcripts.get(rec.id) ?? []).some((e) => "text" in e && e.text.toLowerCase().includes(q));
  });
}

/** Wake an agent — marks it read and returns the record the FE opens. */
export function kickstartAgent(a: { id?: string; agentId?: string }): AgentRecord | null {
  const rec = agents.get(a.id ?? a.agentId ?? ""); if (!rec) return null;
  rec.unread = false;
  return rec;
}

/** Send one prompt to many agents (defaults to all visible). */
export function broadcastToAgents(a: { ids?: string[]; agentIds?: string[]; prompt?: string; content?: string; text?: string }) {
  const ids = a.ids ?? a.agentIds ?? listAgents().map((x) => x.id);
  const text = a.prompt ?? a.content ?? a.text ?? "";
  const sent: string[] = [];
  for (const id of ids) if (agents.has(id)) { sendPrompt({ agentId: id, content: text }); sent.push(id); }
  return { sent, count: sent.length };
}

/** No subagent/async-task model yet — return the declared empty arrays, not a bare {}. */
export const getSubagents = (): unknown[] => [];
export const getAsyncTasks = (): unknown[] => [];

// ── run control ────────────────────────────────────────────────────────────────
export function interruptAgentRun(a: { agentId?: string; id?: string }) {
  const agentId = a.agentId ?? a.id ?? "";
  inflight.get(agentId)?.abort(); inflight.delete(agentId);
  const last = [...(transcripts.get(agentId) ?? [])].reverse().find((e): e is Extract<Entry, { kind: "agent-message" }> => e.kind === "agent-message");
  if (last && !last.text) { last.text = "⏹ đã dừng"; last.streaming = false; last.timestampMs = Date.now(); onUpdate(agentId); }
  return { id: agentId, interrupted: true };
}

// ── P1: tool-call + approval pipeline (SAFE demo) ────────────────────────────
/** `/tool <name> <arg>` injects a tool-call + a pending permission card instead of calling the pool. */
function injectDemoTool(agentId: string, spec: string): { accepted: true; entryId: string; agentId: string } {
  const [name = "", ...rest] = spec.trim().split(/\s+/);
  const arg = rest.join(" ");
  const t = tail(agentId);
  const toolCallId = `tc-${toolSeq++}`;
  const requestId = `req-${reqSeq++}`;
  const known = name in DEMO_TOOLS;
  const tc: Entry = { kind: "tool-call", entryId: nextEntryId(), agentId, timestampMs: Date.now(), toolCallId, name, rawArgs: JSON.stringify({ arg }), status: "pending" };
  const perm: Entry = {
    kind: "send-message", entryId: nextEntryId(), agentId, timestampMs: Date.now(),
    message: { type: "local-tool-permission", ask: { status: known ? "pending" : "denied", target: `${name}(${arg})`, requestId } },
  };
  t.push(tc, perm);
  if (known) pending.set(requestId, { agentId, entryId: perm.entryId, kind: "local-tool-permission", toolCallId, name, arg });
  onUpdate(agentId);
  return { accepted: true, entryId: perm.entryId, agentId };
}

function findPending(requestId?: string) {
  if (requestId && pending.has(requestId)) return { requestId, ...pending.get(requestId)! };
  const first = [...pending.entries()][0];
  return first ? { requestId: first[0], ...first[1] } : null;
}

export function resolveLocalToolPermission(a: { requestId?: string; approved?: boolean; decision?: string; allow?: boolean }) {
  const p = findPending(a.requestId);
  const approved = a.approved ?? a.allow ?? (a.decision === "approve" || a.decision === "allow");
  if (!p) return {};
  pending.delete(p.requestId);
  const t = transcripts.get(p.agentId) ?? [];
  const perm = t.find((e) => e.entryId === p.entryId);
  if (perm && perm.kind === "send-message" && perm.message.type === "local-tool-permission") {
    perm.message.ask.status = approved ? "approved" : "denied";
  }
  const tc = t.find((e): e is Extract<Entry, { kind: "tool-call" }> => e.kind === "tool-call" && e.toolCallId === p.toolCallId);
  if (tc) {
    if (approved) {
      const fn = DEMO_TOOLS[p.name ?? ""];
      tc.result = fn ? fn(p.arg ?? "") : "(unknown tool)";
      tc.status = "done";
      t.push({ kind: "agent-message", entryId: nextEntryId(), agentId: p.agentId, agentOwnerAuthId: AUTH_ID, authorName: "Claude", text: `🔧 ${p.name}(${p.arg}) → ${tc.result}`, images: [], timestampMs: Date.now() });
    } else {
      tc.status = "error"; tc.result = "denied";
    }
  }
  onUpdate(p.agentId);
  return {};
}
export function resolveAutoReviewApproval(a: { requestId?: string; approved?: boolean }) {
  const p = findPending(a.requestId); if (!p) return {};
  pending.delete(p.requestId);
  const t = transcripts.get(p.agentId) ?? [];
  const e = t.find((x) => x.entryId === p.entryId);
  if (e && e.kind === "send-message" && e.message.type === "auto-review-approval") e.message.approval.status = a.approved ? "approved" : "denied";
  onUpdate(p.agentId); return {};
}
export function respondToWidget(a: { requestId?: string }) {
  const p = findPending(a.requestId); if (p) { pending.delete(p.requestId); onUpdate(p.agentId); } return {};
}
export function submitSecret(a: { requestId?: string }) {
  const p = findPending(a.requestId); if (p) { pending.delete(p.requestId); onUpdate(p.agentId); } return {}; // value intentionally ignored / not stored
}
export function dismissWidget(a: { requestId?: string; agentId?: string; entryId?: string }): Record<string, never> {
  if (a.requestId) pending.delete(a.requestId);
  if (a.agentId) onUpdate(a.agentId);
  return {};
}

// ── send + progressive reveal ────────────────────────────────────────────────
function reveal(entry: Extract<Entry, { kind: "agent-message" }>, full: string, agentId: string): void {
  if (process.env.GROKBOT2_PROGRESSIVE === "0") { entry.text = full; entry.streaming = false; onUpdate(agentId); return; }
  const tokens = full.match(/\S+\s*/g) ?? [full];
  const per = Math.max(1, Math.ceil(tokens.length / 24));
  let i = 0; entry.streaming = true;
  const tick = (): void => {
    i += per;
    if (i >= tokens.length) { entry.text = full; entry.streaming = false; onUpdate(agentId); return; }
    entry.text = tokens.slice(0, i).join(""); onUpdate(agentId); setTimeout(tick, 45);
  };
  tick();
}

export interface SendArgs { agentId?: string; content?: string; prompt?: string; text?: string; richText?: { text?: string }; clientNonce?: string; attachments?: { path?: string; name?: string }[] }

export function sendPrompt(args: SendArgs) {
  let agentId = args.agentId || [...agents.keys()][0];
  if (!agentId) agentId = createAgent({}).id;
  const text = args.content ?? args.prompt ?? args.text ?? args.richText?.text ?? "";

  // SAFE tool-call demo: "/tool echo hello"
  const m = text.match(/^\/tool\s+(.+)/i);
  if (m) {
    const t = tail(agentId);
    t.push({ kind: "user-message", entryId: nextEntryId(), text, images: [], timestampMs: Date.now(), clientNonce: args.clientNonce });
    return injectDemoTool(agentId, m[1]);
  }

  const t = tail(agentId);
  const userEntry: Entry = { kind: "user-message", entryId: nextEntryId(), text, images: [], timestampMs: Date.now(), clientNonce: args.clientNonce };
  t.push(userEntry);
  const aEntry: Extract<Entry, { kind: "agent-message" }> = { kind: "agent-message", entryId: nextEntryId(), agentId, agentOwnerAuthId: AUTH_ID, authorName: agents.get(agentId)?.name ?? "Claude", text: "", images: [], timestampMs: Date.now(), streaming: true };
  t.push(aEntry);
  onUpdate(agentId);

  const key = loadPoolKey();
  if (!key) {
    aEntry.text = "[grokbot2] Chưa có key — dán hal_xxx vào services/grokbot-backend/pool-key.txt";
    aEntry.streaming = false; onUpdate(agentId);
    return { accepted: true, entryId: userEntry.entryId, agentId };
  }

  const history: PoolMessage[] = t
    .filter((e): e is Extract<Entry, { kind: "user-message" | "agent-message" }> => e.kind === "user-message" || (e.kind === "agent-message" && !!e.text))
    .map((e) => ({ role: e.kind === "user-message" ? "user" : "assistant", content: e.text }));

  const image = readImageAttachment(args.attachments);
  const controller = new AbortController();
  inflight.set(agentId, controller);
  void callPool(history.length ? history : [{ role: "user", content: text }], { url: config.poolUrl, key, model: config.model, system: config.system, signal: controller.signal, ...(image ? { image } : {}) })
    .then((r) => {
      inflight.delete(agentId);
      if (controller.signal.aborted) return;
      if (r.ok) reveal(aEntry, r.text ?? "", agentId);
      else { aEntry.text = `[grokbot2] Pool error: ${r.error}`; aEntry.streaming = false; onUpdate(agentId); }
    });

  return { accepted: true, entryId: userEntry.entryId, agentId };
}
