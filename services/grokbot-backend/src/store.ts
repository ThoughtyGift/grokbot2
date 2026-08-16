/**
 * Tiny JSON persistence — agents, transcripts and host settings survive a restart.
 *
 * The box host keeps this state on disk; without it every backend restart wiped the
 * user's bots and conversations. Writes are debounced so a chat burst is one save.
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".data");
// Overridable so a test backend can run against a throwaway state file instead of
// trampling the state the live instance is using.
const FILE = process.env.GROKBOT2_STATE_FILE ?? join(DIR, "state.json");
const SNAPSHOT = join(DIR, "snapshot.json");

export interface PersistedState {
  agents?: unknown[];
  transcripts?: Record<string, unknown[]>;
  hostSettings?: Record<string, unknown>;
  seq?: { agent?: number; entry?: number };
  acceptance?: unknown[];
  automations?: unknown[];
  /** Per-agent context compaction, so a restart does not resend the whole transcript. */
  compaction?: Record<string, unknown>;
  /**
   * Turns parked waiting on the user: an approval card, an unanswered question, a box handoff.
   *
   * These lived only in memory, and every restart orphaned them — the card stayed on screen
   * but answering it did nothing, because the map that knew how to continue the turn was gone.
   * (It also reissued `req-1`, so two live approvals could collide.) What persists is the
   * continuation *data*; the pending Promise itself cannot survive a process, so on restore the
   * resume path re-enters the model loop from the stored history instead of resolving it.
   */
  parked?: unknown[];
  /** Box handoff cards, so a restart does not leave a dead "Needs your attention" on screen. */
  handoffs?: unknown[];
  /** Per-agent checklist (todo_write / create_plan), so a restart mid-task keeps the plan. */
  todos?: Record<string, unknown[]>;
}

/** Load state.json, falling back to a snapshot.json import on first run. */
export function loadState(): PersistedState {
  for (const f of [FILE, SNAPSHOT]) {
    try {
      if (!existsSync(f)) continue;
      const parsed = JSON.parse(readFileSync(f, "utf8")) as PersistedState;
      if (f === SNAPSHOT) console.log("[grokbot2] imported snapshot.json");
      return parsed;
    } catch (e) {
      console.warn(`[grokbot2] could not read ${f}:`, (e as Error).message);
    }
  }
  return {};
}

let pending: NodeJS.Timeout | null = null;
let latest: (() => PersistedState) | null = null;

/** Debounced atomic save (write temp + rename) so a crash can't truncate state.json. */
export function scheduleSave(snapshot: () => PersistedState, delayMs = 400): void {
  latest = snapshot;
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const take = latest;
    if (!take) return;
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      const tmp = FILE + ".tmp";
      writeFileSync(tmp, JSON.stringify(take(), null, 1));
      renameSync(tmp, FILE);
    } catch (e) {
      console.warn("[grokbot2] save failed:", (e as Error).message);
    }
  }, delayMs);
}

/** Flush immediately (used on shutdown). */
export function saveNow(snapshot: () => PersistedState): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    const tmp = FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(snapshot(), null, 1));
    renameSync(tmp, FILE);
  } catch (e) {
    console.warn("[grokbot2] final save failed:", (e as Error).message);
  }
}
