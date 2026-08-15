/**
 * Chat bridge — turns the stubbed box gateway into an agent host backed by the
 * Claude pool. Beyond basic text it now supports roster mutations, run interrupt,
 * message reactions, conversation outline, prompt-acceptance, and progressive
 * (typing-style) reveal of the pool reply.
 *
 * Transcript entry shapes (reconstructed from the client bundle):
 *   { kind: "user-message", entryId, text, images, timestampMs, clientNonce? }
 *   { kind: "agent-message", entryId, agentId, agentOwnerAuthId, authorName, text, images, timestampMs }
 */
import { callPool, type PoolMessage } from "@grokbot2/pool-client";
import { config, loadPoolKey } from "./config.js";

export const AUTH_ID = "auth0|grokbot2-user";

interface Entry {
  kind: "user-message" | "agent-message";
  entryId: string;
  text: string;
  images: string[];
  timestampMs: number;
  clientNonce?: string;
  agentId?: string;
  agentOwnerAuthId?: string;
  authorName?: string;
  reactions?: string[];
  streaming?: boolean;
}

export interface AgentRecord {
  id: string;
  name: string;
  agentOwnerAuthId: string;
  createdAtMs: number;
  unread: boolean;
  hidden: boolean;
}

const agents = new Map<string, AgentRecord>();
const transcripts = new Map<string, Entry[]>();
const inflight = new Map<string, AbortController>();
let agentSeq = 1;
let entrySeq = 1;

/** SSE nudge sink — set by the gateway so chat updates reach the frontend. */
let onUpdate: (agentId: string) => void = () => {};
export function setUpdateSink(fn: (agentId: string) => void): void {
  onUpdate = fn;
}

// ── roster ──────────────────────────────────────────────────────────────────
export function createAgent(args: { name?: string } = {}): AgentRecord {
  const id = `agent-${agentSeq++}`;
  const rec: AgentRecord = {
    id,
    name: args.name || "Claude",
    agentOwnerAuthId: AUTH_ID,
    createdAtMs: Date.now(),
    unread: false,
    hidden: false,
  };
  agents.set(id, rec);
  transcripts.set(id, []);
  return rec;
}

export const listAgents = (): AgentRecord[] => [...agents.values()].filter((a) => !a.hidden);
export const countAgents = (): number => listAgents().length;

export function updateAgent(a: { id?: string; agentId?: string; name?: string }): AgentRecord | null {
  const rec = agents.get(a.id ?? a.agentId ?? "");
  if (!rec) return null;
  if (typeof a.name === "string" && a.name.length > 0) rec.name = a.name;
  return rec;
}

export function deleteAgents(a: { ids?: string[]; agentIds?: string[]; id?: string }): { deleted: string[] } {
  const ids = a.ids ?? a.agentIds ?? (a.id ? [a.id] : []);
  for (const id of ids) {
    agents.delete(id);
    transcripts.delete(id);
    inflight.get(id)?.abort();
    inflight.delete(id);
  }
  return { deleted: ids };
}

export function duplicateAgent(a: { id?: string; agentId?: string }): AgentRecord | null {
  const src = agents.get(a.id ?? a.agentId ?? "");
  if (!src) return null;
  const rec = createAgent({ name: `${src.name} (copy)` });
  transcripts.set(rec.id, structuredClone(transcripts.get(src.id) ?? []));
  return rec;
}

export function setAgentUnread(a: { id?: string; agentId?: string; unread?: boolean }): Record<string, never> {
  const rec = agents.get(a.id ?? a.agentId ?? "");
  if (rec) rec.unread = a.unread ?? false;
  return {};
}

export function setAgentHiddenFromSidebar(a: { id?: string; agentId?: string; hidden?: boolean }): Record<string, never> {
  const rec = agents.get(a.id ?? a.agentId ?? "");
  if (rec) rec.hidden = a.hidden ?? true;
  return {};
}

// ── transcript ────────────────────────────────────────────────────────────────
export const transcriptTail = (agentId?: string) => ({
  entries: (agentId && transcripts.get(agentId)) || [],
  hasMore: false,
});

export function getConversationOutline(a: { agentId?: string }) {
  const t = (a.agentId && transcripts.get(a.agentId)) || [];
  return t
    .filter((e) => e.kind === "user-message" && e.text)
    .map((e) => ({ entryId: e.entryId, text: e.text.slice(0, 80), timestampMs: e.timestampMs }));
}

export function reactToMessage(a: { agentId?: string; entryId?: string; reaction?: string; emoji?: string }): Record<string, never> {
  const t = (a.agentId && transcripts.get(a.agentId)) || [];
  const e = t.find((x) => x.entryId === a.entryId);
  if (e) (e.reactions ??= []).push(a.reaction ?? a.emoji ?? "👍");
  return {};
}

export const voteFeedback = (): Record<string, never> => ({});
export const promptAcceptanceStatus = () => ({ accepted: true, status: "accepted" });

// ── run control ────────────────────────────────────────────────────────────────
export function interruptAgentRun(a: { agentId?: string; id?: string }) {
  const agentId = a.agentId ?? a.id ?? "";
  inflight.get(agentId)?.abort();
  inflight.delete(agentId);
  const t = transcripts.get(agentId) ?? [];
  const last = [...t].reverse().find((e) => e.kind === "agent-message");
  if (last && !last.text) {
    last.text = "⏹ đã dừng";
    last.streaming = false;
    last.timestampMs = Date.now();
    onUpdate(agentId);
  }
  return { id: agentId, interrupted: true };
}

// ── send + progressive reveal ────────────────────────────────────────────────
function reveal(entry: Entry, full: string, agentId: string): void {
  if (process.env.GROKBOT2_PROGRESSIVE === "0") {
    entry.text = full;
    entry.streaming = false;
    onUpdate(agentId);
    return;
  }
  const tokens = full.match(/\S+\s*/g) ?? [full];
  const per = Math.max(1, Math.ceil(tokens.length / 24));
  let i = 0;
  entry.streaming = true;
  const tick = (): void => {
    i += per;
    if (i >= tokens.length) {
      entry.text = full;
      entry.streaming = false;
      onUpdate(agentId);
      return;
    }
    entry.text = tokens.slice(0, i).join("");
    onUpdate(agentId);
    setTimeout(tick, 45);
  };
  tick();
}

export interface SendArgs {
  agentId?: string;
  content?: string;
  prompt?: string;
  text?: string;
  richText?: { text?: string };
  clientNonce?: string;
}

export function sendPrompt(args: SendArgs) {
  let agentId = args.agentId || [...agents.keys()][0];
  if (!agentId) agentId = createAgent({}).id;
  const text = args.content ?? args.prompt ?? args.text ?? args.richText?.text ?? "";

  const t = transcripts.get(agentId) ?? [];
  transcripts.set(agentId, t);

  const userEntry: Entry = {
    kind: "user-message",
    entryId: `e${entrySeq++}`,
    text,
    images: [],
    timestampMs: Date.now(),
    clientNonce: args.clientNonce,
  };
  t.push(userEntry);

  const aEntry: Entry = {
    kind: "agent-message",
    entryId: `e${entrySeq++}`,
    agentId,
    agentOwnerAuthId: AUTH_ID,
    authorName: agents.get(agentId)?.name ?? "Claude",
    text: "",
    images: [],
    timestampMs: Date.now(),
    streaming: true,
  };
  t.push(aEntry);
  onUpdate(agentId);

  const key = loadPoolKey();
  if (!key) {
    aEntry.text = "[grokbot2] Chưa có key — dán hal_xxx vào services/grokbot-backend/pool-key.txt";
    aEntry.streaming = false;
    onUpdate(agentId);
    return { accepted: true, entryId: userEntry.entryId, agentId };
  }

  const history: PoolMessage[] = t
    .filter((e) => e.kind === "user-message" || (e.kind === "agent-message" && e.text))
    .map((e) => ({ role: e.kind === "user-message" ? "user" : "assistant", content: e.text }));

  const controller = new AbortController();
  inflight.set(agentId, controller);
  void callPool(history.length ? history : [{ role: "user", content: text }], {
    url: config.poolUrl,
    key,
    model: config.model,
    system: config.system,
    signal: controller.signal,
  }).then((r) => {
    inflight.delete(agentId);
    if (controller.signal.aborted) return; // interruptAgentRun already set the text
    if (r.ok) reveal(aEntry, r.text ?? "", agentId);
    else {
      aEntry.text = `[grokbot2] Pool error: ${r.error}`;
      aEntry.streaming = false;
      onUpdate(agentId);
    }
  });

  return { accepted: true, entryId: userEntry.entryId, agentId };
}
