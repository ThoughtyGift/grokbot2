/**
 * Transcript seq must be monotonic and stable — the client parks a replica on any gap.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureSeq, isToolEcho } from "./seq.js";
import type { Entry } from "./types.js";

const msg = (id: string, content: string, extra: Partial<Entry> = {}): Entry =>
  ({ id, kind: "message", role: "user", content, timestampMs: 1, ...extra }) as Entry;

test("ensureSeq assigns increasing seq and does not reshuffle on a second pass", () => {
  const all: Entry[] = [msg("e2", "a"), msg("e5", "b"), msg("e9", "c")];
  const once = ensureSeq(undefined, all).map((e) => e.seq);
  const twice = ensureSeq(undefined, all).map((e) => e.seq);
  assert.deepEqual(once, [2, 5, 9]);
  assert.deepEqual(twice, once);
});

test("ensureSeq fills a hole without renumbering a later id", () => {
  const all: Entry[] = [msg("imported", "a"), msg("e4", "b")];
  const seqs = ensureSeq(undefined, all).map((e) => e.seq);
  assert.equal(seqs[0], 1);
  assert.ok((seqs[1] as number) > (seqs[0] as number));
});

test("isToolEcho hides the retired wrench bubble from previews", () => {
  const e: Entry = {
    id: "e1", kind: "send-message", author: { id: "a", name: "x" }, timestampMs: 1,
    message: { type: "text", content: "🔧 list_dir_v2(.) → []" },
  };
  assert.equal(isToolEcho(e), true);
});
