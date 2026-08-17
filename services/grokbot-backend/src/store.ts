/**
 * Tiny JSON persistence — agents, transcripts and host settings survive a restart.
 *
 * The box host keeps this state on disk; without it every backend restart wiped the
 * user's bots and conversations. Writes are debounced so a chat burst is one save.
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, statSync, copyFileSync } from "node:fs";
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

/**
 * Rolling backups — the only thing standing between a mistake and permanent loss.
 *
 * Every save rewrites `state.json` wholesale, so one bad write or one over-broad delete takes
 * the lot. That is not hypothetical: a 214 KB state holding 45 bots and 46 transcripts went to
 * 48 KB when the app sent a single `deleteAgents` carrying 43 ids. The call was legitimate and
 * the write was correct — and there was no way back.
 *
 * Rotation is time-based, not per-save. Saves are debounced to 400 ms and a chat burst produces
 * many of them; rotating each time would shift ten copies out of the ring inside a minute and
 * leave nothing but the last few seconds. One recovery point every ROTATE_EVERY_MS gives a
 * window measured in hours instead.
 */
const KEEP_BACKUPS = 10;
const ROTATE_EVERY_MS = Number(process.env.GROKBOT2_BACKUP_EVERY_MS ?? 10 * 60_000);
const backupPath = (n: number): string => `${FILE}.${n}.bak`;

/** True when the newest backup is missing or older than the interval. */
function backupIsStale(): boolean {
  try {
    return Date.now() - statSync(backupPath(1)).mtimeMs > ROTATE_EVERY_MS;
  } catch {
    return true;                                  // no backup yet — take one
  }
}

/**
 * Shift the ring: .9→.10, .8→.9, … .1→.2, then copy the CURRENT state to .1.
 *
 * Copy rather than rename, because `state.json` has to stay in place for the write that follows.
 * Never throws: a backup that fails must not stop the save it was protecting.
 */
function rotateBackups(): void {
  if (!existsSync(FILE) || !backupIsStale()) return;
  try {
    for (let n = KEEP_BACKUPS - 1; n >= 1; n--) {
      if (existsSync(backupPath(n))) renameSync(backupPath(n), backupPath(n + 1));
    }
    copyFileSync(FILE, backupPath(1));
  } catch (e) {
    console.warn("[grokbot2] backup rotation failed:", (e as Error).message);
  }
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
      rotateBackups();
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
    rotateBackups();
    const tmp = FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(snapshot(), null, 1));
    renameSync(tmp, FILE);
  } catch (e) {
    console.warn("[grokbot2] final save failed:", (e as Error).message);
  }
}
