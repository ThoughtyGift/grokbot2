/**
 * In-process kernel: the maps `state.json` round-trips. Directory, conversation and
 * runtime all share this; they do not each open the file.
 */
import { loadState, scheduleSave, type PersistedState } from "../store.js";
import { ensureSeq } from "../conversation/seq.js";
import { publish } from "../events.js";
import { restoreHandoff, handoffEntries, type BoxHandoff } from "../forever-box.js";
import { ME, AUTH_ID } from "../identity/index.js";
import { currentOwner } from "../request-context.js";
import type { CompactionState } from "../compaction.js";
import type { AgentRecord, Entry, Parked, AcceptanceRecord, Todo } from "../conversation/types.js";

export const agents = new Map<string, AgentRecord>();
export const transcripts = new Map<string, Entry[]>();
export const inflight = new Map<string, AbortController>();

/**
 * Multi-tenant Phase 2: does agent `id` belong to the caller (currentOwner)?
 *
 * Legacy rows with no `agentOwnerAuthId`, and every agent on the single-tenant desktop, map to the
 * default owner (`AUTH_ID`), which equals `currentOwner()` outside a scoped request — so nothing
 * changes for them. Command handlers that take an agent id from the client MUST gate on this before
 * reading or mutating, or one tenant can reach another's agent by guessing an id.
 */
export const ownsAgent = (id: string): boolean => {
  const a = agents.get(id);
  return !!a && ((a.agentOwnerAuthId ?? AUTH_ID) === currentOwner());
};
export const parked = new Map<string, Parked>();
export const parkKey = (kind: Parked["kind"], key: string) => `${kind}:${key}`;

export const compaction = new Map<string, CompactionState>();
export const todos = new Map<string, Todo[]>();
export const renderTodos = (list: Todo[]): string =>
  list.map((t, i) => `${t.done ? "[x]" : "[ ]"} ${i + 1}. ${t.text}`).join("\n");

let agentSeq = 1, entrySeq = 1, reqSeq = 1, toolSeq = 1;
export const nextAgentId = (): string => `agent-${agentSeq++}`;
export const nextEntryId = (): string => `e${entrySeq++}`;
export const nextReqId = (): string => `req-${reqSeq++}`;
export const nextToolId = (): string => `tc-${toolSeq++}`;

export const acceptance = new Map<string, AcceptanceRecord>();

export const park = (p: Parked): void => { parked.set(parkKey(p.kind, p.key), p); persist(); };
export const unpark = (kind: Parked["kind"], key: string): Parked | undefined => {
  const k = parkKey(kind, key);
  const hit = parked.get(k);
  if (hit) { parked.delete(k); persist(); }
  return hit;
};

export const pending = {
  has: (id: string) => parked.has(parkKey("approval", id)),
  get: (id: string) => parked.get(parkKey("approval", id)),
  set: (id: string, v: Omit<Parked, "kind" | "key">) => park({ ...v, kind: "approval", key: id }),
  delete: (id: string) => { unpark("approval", id); },
  entries: () => [...parked.values()].filter((p) => p.kind === "approval").map((p) => [p.key, p] as const),
};

const snapshot = (): PersistedState => ({
  agents: [...agents.values()],
  // Seq is stamped here, not by the store: the replica parks on a gap, so the number that
  // went out on SSE has to be the number that comes back after a restart (parity.md §2ac).
  transcripts: Object.fromEntries([...transcripts.entries()].map(([id, es]) => [id, ensureSeq(id, es)])),
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
export { hostSettingsRef };

let automationsRef: () => unknown[] = () => [];
export function bindAutomationsSnapshot(get: () => unknown[]): void { automationsRef = get; }

let automationCreateRef: ((agentId: string, spec: { name: string; prompt: string; trigger: string }) => string | null) | null = null;
export function bindAutomationCreate(fn: (agentId: string, spec: { name: string; prompt: string; trigger: string }) => string | null): void {
  automationCreateRef = fn;
}
export { automationCreateRef };

let automationCleanupRef: ((agentId: string) => void) | null = null;
export function bindAutomationCleanup(fn: (agentId: string) => void): void { automationCleanupRef = fn; }
export { automationCleanupRef };

export const persist = () => scheduleSave(() => ({ ...snapshot(), hostSettings: hostSettingsRef() }));

function migrate(e: any, agentName: string): Entry | null {
  if (!e || typeof e !== "object") return null;
  const id = e.id ?? e.entryId ?? `e${entrySeq++}`;
  const ts = e.timestampMs ?? Date.now();
  if (e.kind === "user-message") return { id, kind: "message", role: "user", content: e.text ?? "", timestampMs: ts, ...(e.clientNonce ? { clientNonce: e.clientNonce } : {}) };
  if (e.kind === "agent-message") return { id, kind: "send-message", author: { id: e.agentId ?? "agent", name: e.authorName ?? agentName }, message: { type: "text", content: e.text ?? "" }, timestampMs: ts };
  if (e.kind === "send-message" && e.streaming) {
    e.streaming = false;
    const empty = e.message?.type === "text" && !String(e.message.content ?? "").trim();
    if (empty) return null;
    if (e.message?.type === "text") e.message.content += "\n\n⏹ (bị ngắt giữa chừng)";
  }
  if (e.kind === "message" || e.kind === "send-message" || e.kind === "tool-call") {
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
  for (const [id, c] of Object.entries((s.compaction ?? {}) as Record<string, CompactionState>)) {
    if (c?.summary && typeof c.coveredCount === "number") compaction.set(id, c);
  }
  const maxNum = (ids: Iterable<string>, re: RegExp) => {
    let max = 0;
    for (const id of ids) { const m = re.exec(id); if (m) max = Math.max(max, Number(m[1]) || 0); }
    return max;
  };
  agentSeq = Math.max(s.seq?.agent ?? 0, maxNum(agents.keys(), /^agent-(\d+)$/) + 1, 1);
  entrySeq = Math.max(s.seq?.entry ?? 0, maxNum([...transcripts.values()].flat().map((e) => e.id), /^e(\d+)$/) + 1, 1);
  const all = [...transcripts.values()].flat();
  reqSeq = Math.max(
    maxNum(all.flatMap((e) => (e.kind === "send-message" && e.message.type === "local-tool-permission" ? [e.message.ask.requestId] : [])), /^req-(\d+)$/) + 1,
    1,
  );
  toolSeq = Math.max(maxNum(all.flatMap((e) => (e.kind === "tool-call" ? [e.toolCallId] : [])), /^tc-(\d+)$/) + 1, 1);
  if (agents.size) console.log(`[grokbot2] restored ${agents.size} agent(s), ${[...transcripts.values()].flat().length} transcript entries`);
}

export const EPOCH = Date.now();
export const transcriptEpoch = (_agentId: string): number => EPOCH;

/**
 * A transcript changed. Announced, then persisted — in that order, because the frame is what the
 * screen is waiting for and the save is debounced anyway.
 */
export const onUpdate = (agentId: string): void => {
  publish({ type: "transcript.append", agentId });
  persist();
};

export const tail = (agentId: string) => transcripts.get(agentId) ?? (transcripts.set(agentId, []), transcripts.get(agentId)!);
export const authorOf = (agentId: string): { id: string; name: string } => ({ id: agentId, name: agents.get(agentId)?.name ?? "Claude" });

export function automationsChanged(agentId: string): void {
  publish({ type: "automations.changed", agentId });
}

/**
 * Whether a bot is still here.
 *
 * Exists for the scheduler: a routine outlives the bot it belongs to when the bot is removed by a
 * path that does not reach `bindAutomationCleanup`, and four such orphans were found firing — one of
 * them a daily cron sending a prompt into a bot nobody could read. Asking before firing is cheaper
 * than a pool call into nothing.
 */
export function agentExists(id: string): boolean {
  return agents.has(id);
}
