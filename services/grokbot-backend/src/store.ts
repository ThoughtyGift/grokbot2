/**
 * Persistence — SQLite is the hot path; `state.json` is a frozen backup after migrate.
 *
 * Domain still speaks `loadState` / `scheduleSave` / `saveNow` with a `PersistedState`
 * snapshot. This module is what turns that snapshot into rows (ROADMAP P3/P4). One call is one
 * transaction covering agents + entries (with per-agent seq) + parked + the rest, so a crash
 * cannot leave a turn half-written — the gap that froze the transcript when seq skipped
 * (parity.md §2ac). Writes are UPSERT + keyed prune, not DELETE FROM the whole table.
 *
 * `node:sqlite` (Node ≥ 22.5) rather than better-sqlite3: no native compile on Windows, and
 * the API is synchronous like the debounce this replaced. WAL so a reader (the gate) can
 * inspect the file while the backend holds it open.
 */
import {
  readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, statSync, copyFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".data");

/**
 * Tests under `node:test` must not open the user's `.data` — `cron.test.ts` imports automations
 * which used to `loadState()` the live file as a side effect. `NODE_TEST_CONTEXT` is set by the
 * test runner; production never has it.
 */
function dataDir(): string {
  if (process.env.GROKBOT2_STATE_FILE) return dirname(process.env.GROKBOT2_STATE_FILE);
  if (process.env.NODE_TEST_CONTEXT) return join(tmpdir(), "grokbot2-test-store");
  return DEFAULT_DIR;
}

export const jsonPath = (): string => process.env.GROKBOT2_STATE_FILE ?? join(dataDir(), "state.json");
export const sqlitePath = (): string => process.env.GROKBOT2_SQLITE_FILE ?? join(dataDir(), "grokbot.sqlite");

const SNAPSHOT = join(DEFAULT_DIR, "snapshot.json");

export interface PersistedState {
  agents?: unknown[];
  transcripts?: Record<string, unknown[]>;
  hostSettings?: Record<string, unknown>;
  seq?: { agent?: number; entry?: number };
  acceptance?: unknown[];
  automations?: unknown[];
  compaction?: Record<string, unknown>;
  parked?: unknown[];
  handoffs?: unknown[];
  todos?: Record<string, unknown[]>;
}

export interface AttachmentMeta {
  path: string;
  mime?: string;
  width?: number;
  height?: number;
  bytes?: number;
  fileName?: string;
}

/** Optional catalog of staged files — filled by `bindAttachmentCatalog`, empty until then. */
let attachmentCatalogRef: () => AttachmentMeta[] = () => [];
export function bindAttachmentCatalog(fn: () => AttachmentMeta[]): void { attachmentCatalogRef = fn; }

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  unread INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  agent_id TEXT NOT NULL,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (agent_id, id)
);
CREATE INDEX IF NOT EXISTS entries_agent_seq ON entries (agent_id, seq);
CREATE TABLE IF NOT EXISTS parked (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (kind, key)
);
CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments_meta (
  path TEXT PRIMARY KEY,
  mime TEXT,
  width INTEGER,
  height INTEGER,
  bytes INTEGER,
  file_name TEXT
);
CREATE TABLE IF NOT EXISTS acceptance (
  client_nonce TEXT PRIMARY KEY,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS todos (
  agent_id TEXT PRIMARY KEY,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS handoffs (
  agent_id TEXT PRIMARY KEY,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS compaction (
  agent_id TEXT PRIMARY KEY,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS host_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  auth_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_expires_ms INTEGER,
  created_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  auth_id TEXT NOT NULL,
  day TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (auth_id, day)
);
CREATE TABLE IF NOT EXISTS plans (
  name TEXT PRIMARY KEY,
  monthly_token_cap INTEGER,
  checkout_url TEXT
);
`;

/**
 * Multi-tenant Phase 1 — every user-owned table carries `owner_id`.
 *
 * Added by ALTER (idempotent) rather than in SCHEMA above, so one code path covers BOTH a fresh DB
 * and the existing single-tenant `.data`. Backfill is the column DEFAULT: every pre-existing row
 * becomes owned by the single default user (auth.ts DEFAULT_USER `auth0|grokbot2-user`).
 *
 * INERT: nothing filters on `owner_id` yet — that is Phase 2 (docs/plan/multi-tenant-roadmap.md). Adding
 * the column changes no behaviour; the app still sees every row because no query scopes by owner.
 */
const OWNED_TABLES = [
  "agents", "entries", "parked", "automations", "todos", "handoffs", "compaction",
  "attachments_meta", "acceptance",
] as const;
/** Kept in sync with auth.ts DEFAULT_USER.authId; a literal here avoids a store→auth import cycle. */
const DEFAULT_OWNER = "auth0|grokbot2-user";

function migrateOwnerId(database: DatabaseSync): void {
  for (const t of OWNED_TABLES) {
    try {
      database.exec(`ALTER TABLE ${t} ADD COLUMN owner_id TEXT NOT NULL DEFAULT '${DEFAULT_OWNER}'`);
    } catch (e) {
      // "duplicate column name" means the column is already there — the whole point of idempotency.
      // Anything else is a real problem and must not be swallowed.
      if (!String((e as Error).message).toLowerCase().includes("duplicate column")) throw e;
    }
  }
}

let db: DatabaseSync | null = null;
let dbFile = "";

function getDb(): DatabaseSync {
  const want = sqlitePath();
  if (db && dbFile === want) return db;
  db?.close();
  mkdirSync(dirname(want), { recursive: true });
  db = new DatabaseSync(want);
  dbFile = want;
  db.exec(SCHEMA);
  db.exec("PRAGMA journal_mode = WAL");
  migrateOwnerId(db);
  // Phase 4: users carry a password hash for web login (null for the token/desktop identity).
  try { db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT"); }
  catch (e) { if (!String((e as Error).message).toLowerCase().includes("duplicate column")) throw e; }
  importJsonIfNeeded(db);
  return db;
}

/**
 * Run `fn` against the one open writer connection.
 *
 * `billing.ts` and any other satellite module MUST reach the database this way rather than opening
 * its own `DatabaseSync`: the BFF already holds this file open in WAL, and a second writer racing it
 * hits SQLITE_BUSY. One connection, one writer — the invariant getDb() exists to keep.
 */
export function withDb<T>(fn: (database: DatabaseSync) => T): T {
  return fn(getDb());
}

function metaGet(database: DatabaseSync, key: string): string | undefined {
  const row = database.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value;
}

function metaSet(database: DatabaseSync, key: string, value: string): void {
  database.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
}

/** Read the frozen JSON (or snapshot.json on a first-ever machine). Never throws. */
function readJsonFile(): PersistedState {
  for (const f of [jsonPath(), SNAPSHOT]) {
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
 * One-shot: empty SQLite ← `state.json`. After this, JSON is not written again.
 *
 * The JSON file is left in place as the rollback source (docs/architecture/sqlite-rollback.md). A final
 * rotation of the `.bak` ring happens here so the last hot-path write is recoverable even
 * after days of sqlite-only saves.
 */
function importJsonIfNeeded(database: DatabaseSync): void {
  if (metaGet(database, "imported") === "1") return;
  const json = readJsonFile();
  rotateJsonBackups();
  writeSnapshot(json, database);
  metaSet(database, "schema_version", "1");
  metaSet(database, "imported", "1");
  metaSet(database, "imported_at", new Date().toISOString());
  metaSet(database, "imported_from", existsSync(jsonPath()) ? jsonPath() : "empty");
  console.log(`[grokbot2] persistence is sqlite (${sqlitePath()}); state.json is frozen`);
}

/** Stamp missing seq so a reload does not have to invent numbers the replica already accepted. */
function withSeq(entries: unknown[]): unknown[] {
  let prev = 0;
  return entries.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const e = raw as { seq?: number };
    const seq = typeof e.seq === "number" && e.seq > prev ? e.seq : prev + 1;
    prev = seq;
    return { ...e, seq };
  });
}

/**
 * UPSERT every row, then prune keys that left the snapshot. P3 rewrote every table with
 * DELETE+INSERT; two processes sharing the file cannot do that — a runtime INSERT would
 * vanish the next time the BFF saved. Empty keep-lists still mean the snapshot has zero of
 * that kind, so those tables are cleared on purpose (`deleteAgents`).
 *
 * Keep-sets go through a TEMP table rather than `NOT IN (?,?,…)`. SQLite binds C-strings,
 * so a `\0` separator would truncate, and a 500-row transcript would blow the variable cap.
 */
function prune(database: DatabaseSync, table: string, column: string, keep: string[]): void {
  if (keep.length === 0) {
    database.exec(`DELETE FROM ${table}`);
    return;
  }
  const tmp = `_keep_${table}`;
  database.exec(`DROP TABLE IF EXISTS ${tmp}`);
  database.exec(`CREATE TEMP TABLE ${tmp} (k TEXT PRIMARY KEY)`);
  const ins = database.prepare(`INSERT OR IGNORE INTO ${tmp} (k) VALUES (?)`);
  for (const k of keep) ins.run(k);
  database.exec(`DELETE FROM ${table} WHERE ${column} NOT IN (SELECT k FROM ${tmp})`);
  database.exec(`DROP TABLE ${tmp}`);
}

function pruneComposite(
  database: DatabaseSync,
  table: string,
  colA: string,
  colB: string,
  keep: Array<[string, string]>,
): void {
  if (keep.length === 0) {
    database.exec(`DELETE FROM ${table}`);
    return;
  }
  const tmp = `_keep_${table}`;
  database.exec(`DROP TABLE IF EXISTS ${tmp}`);
  database.exec(`CREATE TEMP TABLE ${tmp} (a TEXT NOT NULL, b TEXT NOT NULL, PRIMARY KEY (a, b))`);
  const ins = database.prepare(`INSERT OR IGNORE INTO ${tmp} (a, b) VALUES (?, ?)`);
  for (const [a, b] of keep) ins.run(a, b);
  database.exec(
    `DELETE FROM ${table} WHERE NOT EXISTS (SELECT 1 FROM ${tmp} k WHERE k.a = ${table}.${colA} AND k.b = ${table}.${colB})`,
  );
  database.exec(`DROP TABLE ${tmp}`);
}

function writeSnapshot(s: PersistedState, database = getDb()): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const entryKeep: Array<[string, string]> = [];
    const agentIds: string[] = [];
    const insAgent = database.prepare(
      `INSERT INTO agents (id, name, created_at_ms, unread, hidden, body) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, created_at_ms=excluded.created_at_ms,
         unread=excluded.unread, hidden=excluded.hidden, body=excluded.body`,
    );
    for (const raw of s.agents ?? []) {
      const a = raw as { id?: string; name?: string; createdAtMs?: number; unread?: boolean; hidden?: boolean };
      if (!a?.id) continue;
      insAgent.run(a.id, a.name ?? "", a.createdAtMs ?? 0, a.unread ? 1 : 0, a.hidden ? 1 : 0, JSON.stringify(raw));
      agentIds.push(a.id);
    }

    const insEntry = database.prepare(
      `INSERT INTO entries (agent_id, id, seq, timestamp_ms, kind, body) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_id, id) DO UPDATE SET seq=excluded.seq, timestamp_ms=excluded.timestamp_ms,
         kind=excluded.kind, body=excluded.body`,
    );
    for (const [agentId, list] of Object.entries(s.transcripts ?? {})) {
      for (const raw of withSeq(Array.isArray(list) ? list : [])) {
        const e = raw as { id?: string; seq?: number; timestampMs?: number; kind?: string };
        if (!e?.id) continue;
        insEntry.run(agentId, e.id, e.seq ?? 0, e.timestampMs ?? 0, e.kind ?? "", JSON.stringify(raw));
        entryKeep.push([agentId, e.id]);
      }
    }

    const insParked = database.prepare(
      `INSERT INTO parked (kind, key, agent_id, body) VALUES (?, ?, ?, ?)
       ON CONFLICT(kind, key) DO UPDATE SET agent_id=excluded.agent_id, body=excluded.body`,
    );
    const parkedKeep: Array<[string, string]> = [];
    for (const raw of s.parked ?? []) {
      const p = raw as { kind?: string; key?: string; agentId?: string };
      if (!p?.kind || !p.key) continue;
      insParked.run(p.kind, p.key, p.agentId ?? "", JSON.stringify(raw));
      parkedKeep.push([p.kind, p.key]);
    }

    const insAuto = database.prepare(
      `INSERT INTO automations (id, agent_id, body) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET agent_id=excluded.agent_id, body=excluded.body`,
    );
    const autoKeep: string[] = [];
    for (const raw of s.automations ?? []) {
      const a = raw as { id?: string; agentId?: string };
      if (!a?.id) continue;
      insAuto.run(a.id, a.agentId ?? "", JSON.stringify(raw));
      autoKeep.push(a.id);
    }

    const insAccept = database.prepare(
      `INSERT INTO acceptance (client_nonce, body) VALUES (?, ?)
       ON CONFLICT(client_nonce) DO UPDATE SET body=excluded.body`,
    );
    const acceptKeep: string[] = [];
    for (const raw of s.acceptance ?? []) {
      const r = raw as { clientNonce?: string };
      if (!r?.clientNonce) continue;
      insAccept.run(r.clientNonce, JSON.stringify(raw));
      acceptKeep.push(r.clientNonce);
    }

    const insTodos = database.prepare(
      `INSERT INTO todos (agent_id, body) VALUES (?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET body=excluded.body`,
    );
    const todoKeep: string[] = [];
    for (const [agentId, list] of Object.entries(s.todos ?? {})) {
      insTodos.run(agentId, JSON.stringify(list));
      todoKeep.push(agentId);
    }

    const insHand = database.prepare(
      `INSERT INTO handoffs (agent_id, body) VALUES (?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET body=excluded.body`,
    );
    const handKeep: string[] = [];
    // Snapshot shape is `[agentId, handoff][]` — see forever-box.handoffEntries.
    for (const row of s.handoffs ?? []) {
      if (Array.isArray(row) && typeof row[0] === "string") {
        insHand.run(row[0], JSON.stringify(row[1] ?? {}));
        handKeep.push(row[0]);
      }
    }

    const insComp = database.prepare(
      `INSERT INTO compaction (agent_id, body) VALUES (?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET body=excluded.body`,
    );
    const compKeep: string[] = [];
    for (const [agentId, body] of Object.entries(s.compaction ?? {})) {
      insComp.run(agentId, JSON.stringify(body));
      compKeep.push(agentId);
    }

    if (s.hostSettings && typeof s.hostSettings === "object") {
      database.prepare(
        `INSERT INTO host_settings (id, body) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET body=excluded.body`,
      ).run(JSON.stringify(s.hostSettings));
    }

    const insAtt = database.prepare(
      `INSERT INTO attachments_meta (path, mime, width, height, bytes, file_name) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET mime=excluded.mime, width=excluded.width, height=excluded.height,
         bytes=excluded.bytes, file_name=excluded.file_name`,
    );
    const attKeep: string[] = [];
    for (const a of attachmentCatalogRef()) {
      if (!a.path) continue;
      insAtt.run(a.path, a.mime ?? null, a.width ?? null, a.height ?? null, a.bytes ?? null, a.fileName ?? null);
      attKeep.push(a.path);
    }

    prune(database, "agents", "id", agentIds);
    prune(database, "automations", "id", autoKeep);
    prune(database, "acceptance", "client_nonce", acceptKeep);
    prune(database, "todos", "agent_id", todoKeep);
    prune(database, "handoffs", "agent_id", handKeep);
    prune(database, "compaction", "agent_id", compKeep);
    prune(database, "attachments_meta", "path", attKeep);
    pruneComposite(database, "entries", "agent_id", "id", entryKeep);
    pruneComposite(database, "parked", "kind", "key", parkedKeep);

    metaSet(database, "seq", JSON.stringify(s.seq ?? {}));
    database.exec("COMMIT");
  } catch (e) {
    try { database.exec("ROLLBACK"); } catch { /* no tx */ }
    throw e;
  }
}

function loadFromDb(database: DatabaseSync): PersistedState {
  const agents = database.prepare("SELECT body FROM agents").all().map((r) => JSON.parse(String(r.body)));
  const transcripts: Record<string, unknown[]> = {};
  for (const r of database.prepare("SELECT agent_id, body FROM entries ORDER BY agent_id, seq, id").all()) {
    const id = String(r.agent_id);
    (transcripts[id] ??= []).push(JSON.parse(String(r.body)));
  }
  const parked = database.prepare("SELECT body FROM parked").all().map((r) => JSON.parse(String(r.body)));
  const automations = database.prepare("SELECT body FROM automations").all().map((r) => JSON.parse(String(r.body)));
  const acceptance = database.prepare("SELECT body FROM acceptance").all().map((r) => JSON.parse(String(r.body)));
  const todos: Record<string, unknown[]> = {};
  for (const r of database.prepare("SELECT agent_id, body FROM todos").all()) {
    todos[String(r.agent_id)] = JSON.parse(String(r.body));
  }
  const handoffs: unknown[] = database.prepare("SELECT agent_id, body FROM handoffs").all()
    .map((r) => [String(r.agent_id), JSON.parse(String(r.body))]);
  const compaction: Record<string, unknown> = {};
  for (const r of database.prepare("SELECT agent_id, body FROM compaction").all()) {
    compaction[String(r.agent_id)] = JSON.parse(String(r.body));
  }
  const settingsRow = database.prepare("SELECT body FROM host_settings WHERE id = 1").get() as { body?: string } | undefined;
  const seqRaw = metaGet(database, "seq");
  return {
    agents,
    transcripts,
    parked,
    automations,
    acceptance,
    todos,
    handoffs,
    compaction,
    hostSettings: settingsRow?.body ? JSON.parse(settingsRow.body) as Record<string, unknown> : undefined,
    seq: seqRaw ? JSON.parse(seqRaw) as PersistedState["seq"] : undefined,
  };
}

export function loadState(): PersistedState {
  try {
    return loadFromDb(getDb());
  } catch (e) {
    console.warn("[grokbot2] sqlite load failed, falling back to JSON:", (e as Error).message);
    return readJsonFile();
  }
}

const KEEP_BACKUPS = 10;
const ROTATE_EVERY_MS = Number(process.env.GROKBOT2_BACKUP_EVERY_MS ?? 10 * 60_000);

function backupPath(n: number, file: string): string {
  return `${file}.${n}.bak`;
}

function backupIsStale(file: string): boolean {
  try {
    return Date.now() - statSync(backupPath(1, file)).mtimeMs > ROTATE_EVERY_MS;
  } catch {
    return true;
  }
}

function rotateRing(file: string): void {
  if (!existsSync(file) || !backupIsStale(file)) return;
  try {
    for (let n = KEEP_BACKUPS - 1; n >= 1; n--) {
      if (existsSync(backupPath(n, file))) renameSync(backupPath(n, file), backupPath(n + 1, file));
    }
    copyFileSync(file, backupPath(1, file));
  } catch (e) {
    console.warn("[grokbot2] backup rotation failed:", (e as Error).message);
  }
}

/** Last JSON rotation — called once at migrate, then the ring is left alone. */
function rotateJsonBackups(): void {
  rotateRing(jsonPath());
}

function rotateSqliteBackups(database: DatabaseSync): void {
  const file = sqlitePath();
  if (!backupIsStale(file) && existsSync(backupPath(1, file))) return;
  try {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch { /* checkpoint is best-effort; the copy below still helps */ }
  rotateRing(file);
}

let pending: NodeJS.Timeout | null = null;
let latest: (() => PersistedState) | null = null;
let jsonWrites = 0;

export function jsonWriteCount(): number { return jsonWrites; }

/**
 * Chỉ MỘT tiến trình được phép ghi vào kho.
 *
 * Cách lưu ở đây là **ghi đè toàn bộ ảnh chụp trong bộ nhớ**. Nên một tiến trình thứ hai nạp
 * `chat/state.ts` — kể cả chỉ để đọc — rồi lưu vì bất kỳ lý do gì sẽ ghi cái nhìn CŨ của nó đè lên
 * dữ liệu mới của máy chủ. Không có xung đột, không có lỗi: chỉ là dữ liệu biến mất.
 *
 * Đã xảy ra hai lần trong một ngày, và lần thứ hai xoá **2 bot cùng 1790 entry** của người dùng.
 * Thủ phạm là một script nháp `npx tsx` chỉ định nhập `runtime/tools.ts` để đếm tool — nó kéo theo
 * `chat/state.ts`, nạp một ảnh chụp cũ hơn (máy chủ còn dữ liệu mới trong WAL chưa đọc được), rồi
 * ghi lại. Dòng log của chính nó là bằng chứng: "restored 6 agent(s), 158 transcript entries" —
 * đúng bằng những gì còn sót lại sau đó.
 *
 * Nên quyền ghi phải được BẬT rõ ràng, và chỉ máy chủ thật bật nó (`index.ts`). Mọi tiến trình khác
 * đọc thoải mái và không ghi được gì. Test chạy trên kho riêng nên tự bật bằng biến môi trường.
 */
let writingEnabled = process.env.GROKBOT2_ALLOW_WRITE === "1";
let warned = false;

export function enableWriting(): void { writingEnabled = true; }

const mayWrite = (): boolean => {
  if (writingEnabled) return true;
  if (!warned) {
    warned = true;
    console.warn("[grokbot2] [store] tiến trình này KHÔNG có quyền ghi kho — bỏ qua lệnh lưu."
      + " Chỉ máy chủ mới ghi; script phụ chỉ được đọc (xem enableWriting trong store.ts).");
  }
  return false;
};

export function scheduleSave(snapshot: () => PersistedState, delayMs = 400): void {
  if (!mayWrite()) return;
  latest = snapshot;
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const take = latest;
    if (!take) return;
    persistNow(take);
  }, delayMs);
}

export function saveNow(snapshot: () => PersistedState): void {
  if (!mayWrite()) return;
  persistNow(snapshot);
}

function persistNow(snapshot: () => PersistedState): void {
  try {
    const database = getDb();
    rotateSqliteBackups(database);
    writeSnapshot(snapshot(), database);
  } catch (e) {
    console.warn("[grokbot2] save failed:", (e as Error).message);
  }
}

export function persistenceInfo(): { sqlite: string; json: string; imported: boolean } {
  try {
    const database = getDb();
    return { sqlite: sqlitePath(), json: jsonPath(), imported: metaGet(database, "imported") === "1" };
  } catch {
    return { sqlite: sqlitePath(), json: jsonPath(), imported: false };
  }
}

/** Test seam: close the connection so the next call re-reads env paths. */
export function _resetForTest(): void {
  try { db?.close(); } catch { /* already closed */ }
  db = null;
  dbFile = "";
  pending = null;
  latest = null;
  jsonWrites = 0;
}

/** Kept so a mistaken `writeFileSync(state.json)` in a test is visible. */
export function _noteJsonWrite(): void { jsonWrites += 1; }
