/**
 * SQLite is the hot path. These tests never open the user's `.data` — they pin
 * GROKBOT2_STATE_FILE / GROKBOT2_SQLITE_FILE to a temp dir and `_resetForTest()` so
 * the next load re-reads those paths.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import {
  loadState, saveNow, _resetForTest, jsonPath, sqlitePath, jsonWriteCount, enableWriting,
  type PersistedState,
} from "./store.js";

/*
 * Bài kiểm này LÀ một người ghi, nên phải tự khai.
 *
 * `store.ts` mặc định khoá ghi từ sau hai lần mất dữ liệu do script phụ nạp trạng thái cũ rồi lưu
 * đè. Chốt đó đúng — nhưng nó cũng làm `saveNow()` ở đây thành không-làm-gì, và **năm bài kiểm đỏ
 * im lặng** cho tới khi có người chạy cả bộ. Khai một dòng ở đây rẻ hơn nhiều so với nới chốt.
 */
enableWriting();

function isolate(): { dir: string; json: string; sqlite: string } {
  const dir = mkdtempSync(join(tmpdir(), "grokbot2-p3-"));
  const json = join(dir, "state.json");
  const sqlite = join(dir, "grokbot.sqlite");
  process.env.GROKBOT2_STATE_FILE = json;
  process.env.GROKBOT2_SQLITE_FILE = sqlite;
  _resetForTest();
  return { dir, json, sqlite };
}

const fixture = (over: Partial<PersistedState> = {}): PersistedState => ({
  agents: [
    { id: "agent-1", name: "Ada", createdAtMs: 1, unread: false, hidden: false },
    { id: "agent-2", name: "Bob", createdAtMs: 2, unread: true, hidden: false },
  ],
  transcripts: {
    "agent-1": [{ id: "e1", kind: "message", role: "user", content: "hi", timestampMs: 10 }],
    "agent-2": [{ id: "e2", kind: "message", role: "user", content: "yo", timestampMs: 11 }],
  },
  parked: [{ kind: "approval", key: "req-1", agentId: "agent-1", name: "shell" }],
  automations: [{ id: "auto-1", agentId: "agent-1", name: "morning", prompt: "go", trigger: "0 9 * * *", isEnabled: true, runs: [] }],
  seq: { agent: 3, entry: 3 },
  hostSettings: { localToolPermission: "ask" },
  ...over,
});

test("migrates state.json into sqlite and round-trips roster, parked, automations", () => {
  const { json, sqlite } = isolate();
  writeFileSync(json, JSON.stringify(fixture()));
  const loaded = loadState();
  assert.equal(existsSync(sqlite), true);
  assert.equal((loaded.agents as { id: string }[]).map((a) => a.id).join(), "agent-1,agent-2");
  assert.equal((loaded.parked as { key: string }[])[0].key, "req-1");
  assert.equal((loaded.automations as { id: string }[])[0].id, "auto-1");
  assert.equal(loaded.hostSettings?.localToolPermission, "ask");
  assert.equal(loaded.seq?.agent, 3);
});

test("a save does not rewrite state.json — the file is a frozen backup", async () => {
  const { json } = isolate();
  writeFileSync(json, JSON.stringify(fixture()));
  loadState();
  const before = statSync(json).mtimeMs;
  await sleep(20);
  saveNow(() => ({
    ...fixture(),
    agents: [{ id: "agent-9", name: "New", createdAtMs: 9, unread: false, hidden: false }],
  }));
  assert.equal(statSync(json).mtimeMs, before);
  assert.equal(jsonWriteCount(), 0);
  _resetForTest();
  const reloaded = loadState();
  assert.equal((reloaded.agents as { id: string }[])[0].id, "agent-9");
  assert.equal(readFileSync(json, "utf8").includes("agent-1"), true, "frozen json still has the pre-save roster");
});

test("parked rows survive a reopen — the restart-mid-approval case", () => {
  const { json } = isolate();
  writeFileSync(json, JSON.stringify(fixture()));
  loadState();
  saveNow(() => fixture({
    parked: [
      { kind: "approval", key: "req-7", agentId: "agent-1", name: "edit_file_v2", arg: "{}" },
      { kind: "widget", key: "w1", agentId: "agent-2" },
    ],
  }));
  _resetForTest();
  const loaded = loadState();
  const keys = (loaded.parked as { key: string }[]).map((p) => p.key).sort();
  assert.deepEqual(keys, ["req-7", "w1"]);
});

test("100 interleaved messages keep contiguous per-agent seq after reload", () => {
  const { json } = isolate();
  writeFileSync(json, JSON.stringify({ agents: [], transcripts: {}, seq: { agent: 1, entry: 1 } }));
  loadState();
  const transcripts: Record<string, unknown[]> = { "agent-a": [], "agent-b": [] };
  for (let i = 0; i < 100; i++) {
    const id = i % 2 === 0 ? "agent-a" : "agent-b";
    const n = transcripts[id].length + 1;
    transcripts[id].push({
      id: `${id}-e${n}`, kind: "message", role: "user", content: String(i), timestampMs: i, seq: n,
    });
  }
  saveNow(() => ({
    agents: [
      { id: "agent-a", name: "A", createdAtMs: 1, unread: false, hidden: false },
      { id: "agent-b", name: "B", createdAtMs: 1, unread: false, hidden: false },
    ],
    transcripts,
    seq: { agent: 3, entry: 101 },
  }));
  _resetForTest();
  const loaded = loadState();
  for (const id of ["agent-a", "agent-b"] as const) {
    const seqs = (loaded.transcripts?.[id] as { seq: number }[]).map((e) => e.seq);
    assert.equal(seqs.length, 50);
    assert.deepEqual(seqs, Array.from({ length: 50 }, (_, i) => i + 1), `${id} seq had a gap`);
  }
});

test("jsonPath / sqlitePath follow the env the test just set", () => {
  const { json, sqlite } = isolate();
  assert.equal(jsonPath(), json);
  assert.equal(sqlitePath(), sqlite);
});

test("a second save upserts — dropping an agent prunes it, keeping one does not wipe its entries", () => {
  const { json } = isolate();
  writeFileSync(json, JSON.stringify(fixture()));
  loadState();
  saveNow(() => fixture({
    agents: [{ id: "agent-1", name: "Ada renamed", createdAtMs: 1, unread: false, hidden: false }],
    transcripts: {
      "agent-1": [
        { id: "e1", kind: "message", role: "user", content: "hi", timestampMs: 10, seq: 1 },
        { id: "e3", kind: "message", role: "user", content: "again", timestampMs: 12, seq: 2 },
      ],
    },
  }));
  _resetForTest();
  const loaded = loadState();
  const ids = (loaded.agents as { id: string; name: string }[]).map((a) => `${a.id}:${a.name}`);
  assert.deepEqual(ids, ["agent-1:Ada renamed"]);
  assert.equal((loaded.transcripts?.["agent-1"] as unknown[]).length, 2);
  assert.equal(loaded.transcripts?.["agent-2"], undefined);
});

test("a second save of the same snapshot keeps entry rowids — not DELETE FROM + rewrite", () => {
  const { json, sqlite } = isolate();
  writeFileSync(json, JSON.stringify(fixture()));
  loadState();
  saveNow(() => fixture());
  const first = new DatabaseSync(sqlite, { readOnly: true });
  const rowid = (first.prepare("SELECT rowid AS r FROM entries WHERE id = 'e1'").get() as { r: number }).r;
  first.close();
  saveNow(() => fixture());
  const second = new DatabaseSync(sqlite, { readOnly: true });
  const again = (second.prepare("SELECT rowid AS r FROM entries WHERE id = 'e1'").get() as { r: number }).r;
  second.close();
  assert.equal(again, rowid);
});

test("a second connection can read WAL while this process holds the file", () => {
  const { json, sqlite } = isolate();
  writeFileSync(json, JSON.stringify(fixture()));
  loadState();
  const other = new DatabaseSync(sqlite, { readOnly: true });
  const n = (other.prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number }).n;
  other.close();
  assert.equal(n, 2);
});

test("a second writer INSERT is pruned only when the snapshot omits it; kept rowids stay", () => {
  const { json, sqlite } = isolate();
  writeFileSync(json, JSON.stringify(fixture()));
  loadState();
  saveNow(() => fixture());
  const writer = new DatabaseSync(sqlite);
  const kept = (writer.prepare("SELECT rowid AS r FROM entries WHERE id = 'e1'").get() as { r: number }).r;
  writer.prepare(
    "INSERT INTO entries (agent_id, id, seq, timestamp_ms, kind, body) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("agent-1", "e-extra", 99, 1, "message", JSON.stringify({ id: "e-extra" }));
  writer.close();
  saveNow(() => fixture());
  _resetForTest();
  const loaded = loadState();
  assert.equal((loaded.transcripts?.["agent-1"] as { id: string }[]).map((e) => e.id).join(), "e1");
  const check = new DatabaseSync(sqlite, { readOnly: true });
  assert.equal((check.prepare("SELECT rowid AS r FROM entries WHERE id = 'e1'").get() as { r: number }).r, kept);
  assert.equal((check.prepare("SELECT COUNT(*) AS n FROM entries WHERE id = 'e-extra'").get() as { n: number }).n, 0);
  check.close();
});
