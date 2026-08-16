/**
 * Agent memory — what makes the bot better at working with you over time.
 *
 * The original describes it plainly: `/home/box` holds "your profile, memory, routines,
 * workflows, channels". So memory is not a special subsystem, it is files the agent curates
 * and re-reads. hermes-agent lands in the same place ("agent-curated memory with periodic
 * nudges"), which is good evidence this is the shape rather than a Cursor quirk.
 *
 * Two halves, and both are needed:
 *   - the agent writes with `knowledge_base` (the original's own tool name and params)
 *   - what it wrote is injected into the prompt's CONTEXT tier every turn, so it does not
 *     have to remember to go and look. A memory the agent must choose to read is a memory
 *     it usually does not read.
 */
import { boxCall, boxConfigured } from "./box-exec.js";

export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

/** Cache per agent so a turn costs at most one box round trip. */
const cache = new Map<string, MemoryEntry[]>();

/** Total characters injected into the prompt. Memory that crowds out the conversation is worse than none. */
const BUDGET = Number(process.env.GROKBOT2_MEMORY_BUDGET ?? 4000);
const MAX_ENTRIES = Number(process.env.GROKBOT2_MEMORY_MAX ?? 40);

const keyFor = (agentId: string): string => agentId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64) || "default";

export async function loadMemory(agentId: string): Promise<MemoryEntry[]> {
  if (cache.has(agentId)) return cache.get(agentId)!;
  if (!boxConfigured()) return [];
  try {
    const r = await boxCall<{ entries: MemoryEntry[] }>("memoryLoad", { key: keyFor(agentId) });
    const entries = Array.isArray(r.entries) ? r.entries.filter((e) => e?.id && typeof e.content === "string") : [];
    cache.set(agentId, entries);
    return entries;
  } catch (e) {
    // Never fail a turn over memory: an agent with no memory still works.
    console.warn(`[grokbot2] memory load failed for ${agentId}:`, (e as Error).message);
    return [];
  }
}

async function save(agentId: string, entries: MemoryEntry[]): Promise<void> {
  cache.set(agentId, entries);
  await boxCall("memorySave", { key: keyFor(agentId), entries });
}

export interface KnowledgeArgs {
  knowledge_to_store?: string;
  title?: string;
  existing_knowledge_id?: string;
  action?: string;
}

/**
 * `knowledge_base` — create, update or delete one memory entry.
 *
 * Shape and result are the original's: params {knowledge_to_store, title,
 * existing_knowledge_id, action}, result {success, confirmation_message, id}.
 */
export async function knowledgeBase(agentId: string, a: KnowledgeArgs): Promise<{ success: boolean; confirmation_message: string; id: string }> {
  if (!boxConfigured()) {
    return { success: false, confirmation_message: "Chưa nối box nên chưa lưu được trí nhớ.", id: "" };
  }
  const entries = [...(await loadMemory(agentId))];
  const action = (a.action ?? "create").toLowerCase();
  const id = a.existing_knowledge_id ?? "";

  if (action === "delete") {
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0) return { success: false, confirmation_message: `Không tìm thấy mục ${id}.`, id };
    const [gone] = entries.splice(i, 1);
    await save(agentId, entries);
    return { success: true, confirmation_message: `Đã xoá "${gone.title}".`, id };
  }

  const content = (a.knowledge_to_store ?? "").trim();
  if (!content) return { success: false, confirmation_message: "knowledge_to_store không được rỗng.", id: "" };
  const title = (a.title ?? content.split("\n")[0]).trim().slice(0, 80) || "Ghi chú";
  const now = Date.now();

  const existing = id ? entries.find((e) => e.id === id) : undefined;
  if (existing) {
    existing.content = content;
    existing.title = title;
    existing.updatedAt = now;
    await save(agentId, entries);
    return { success: true, confirmation_message: `Đã cập nhật "${title}".`, id: existing.id };
  }

  // A near-duplicate title is almost always the agent re-learning the same fact; replacing
  // beats accumulating three slightly different copies of it.
  const dup = entries.find((e) => e.title.toLowerCase() === title.toLowerCase());
  if (dup) {
    dup.content = content;
    dup.updatedAt = now;
    await save(agentId, entries);
    return { success: true, confirmation_message: `Đã cập nhật "${title}".`, id: dup.id };
  }

  const rec: MemoryEntry = { id: `k${now.toString(36)}${entries.length}`, title, content, createdAt: now, updatedAt: now };
  entries.push(rec);
  // Oldest-updated first out, so facts the agent keeps confirming survive.
  entries.sort((x, y) => x.updatedAt - y.updatedAt);
  while (entries.length > MAX_ENTRIES) entries.shift();
  await save(agentId, entries);
  return { success: true, confirmation_message: `Đã nhớ "${title}".`, id: rec.id };
}

/**
 * Memory as it goes into the prompt's context tier.
 *
 * Newest first and hard-capped: an agent that has learned forty things must still leave
 * room for the conversation it is having now.
 */
export function renderMemory(entries: MemoryEntry[]): string {
  if (!entries.length) return "";
  const lines: string[] = [];
  let used = 0;
  for (const e of [...entries].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const line = `- ${e.title}: ${e.content}`;
    if (used + line.length > BUDGET) break;
    used += line.length;
    lines.push(line);
  }
  if (!lines.length) return "";
  return `Những điều bạn đã ghi nhớ về người dùng này (dùng khi liên quan, đừng nhắc lại máy móc):\n${lines.join("\n")}`;
}

/** Drop the cache for one agent — used when its memory is edited outside this process. */
export const forgetCached = (agentId: string): void => { cache.delete(agentId); };

// ── the app's own memory screen ───────────────────────────────────────────────
//
// `getAgentMemories` / `deleteAgentMemory` / `clearAgentMemories` are gateway commands the
// MAIN process sends; they appear nowhere in the renderer, so there is no call site to read
// the expected reply shape from. Rather than answer `{}` and leave the screen blank, these
// return the real entries under both a bare array and a `memories` key — and GROKBOT2_LOG
// prints the arguments, so the true shape can be pinned the first time the screen is opened.

const agentIdOf = (a: any): string => a?.id ?? a?.agentId ?? "";

export async function getAgentMemories(a: any): Promise<{ memories: MemoryEntry[]; total: number }> {
  const entries = await loadMemory(agentIdOf(a));
  return { memories: entries, total: entries.length };
}

export async function deleteAgentMemory(a: any): Promise<{ memories: MemoryEntry[]; success: boolean }> {
  const agentId = agentIdOf(a);
  const id = a?.memoryId ?? a?.knowledgeId ?? a?.entryId ?? "";
  const before = await loadMemory(agentId);
  const after = before.filter((e) => e.id !== id);
  if (after.length !== before.length && boxConfigured()) await save(agentId, after);
  return { memories: after, success: after.length !== before.length };
}

export async function clearAgentMemories(a: any): Promise<{ memories: MemoryEntry[]; success: boolean }> {
  const agentId = agentIdOf(a);
  if (boxConfigured()) await save(agentId, []);
  return { memories: [], success: true };
}
