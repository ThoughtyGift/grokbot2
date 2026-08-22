/**
 * Module boundaries, asserted against the source text rather than the module graph.
 *
 * Reading the files is the point: an import that a bundler would tree-shake away still counts
 * as knowledge in the wrong place, and these are the two facts the phase gates measure —
 * P1's service split, and P2's rule that only the ACL speaks protobuf and Cursor command names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const src = dirname(fileURLToPath(import.meta.url));

/** Every .ts file under src/, so a new module cannot quietly opt out of these rules. */
function sources(dir = src): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return e.isFile() && e.name.endsWith(".ts") ? [p] : [];
  });
}

test("directory does not import runtime", () => {
  const t = readFileSync(join(src, "directory", "index.ts"), "utf8");
  assert.equal(t.includes("../runtime"), false);
});

test("conversation does not import directory or runtime", () => {
  const t = readFileSync(join(src, "conversation", "index.ts"), "utf8");
  assert.equal(t.includes("../directory"), false);
  assert.equal(t.includes("../runtime"), false);
});

test("chat/state does not import directory or runtime", () => {
  const t = readFileSync(join(src, "chat", "state.ts"), "utf8");
  assert.equal(t.includes("../directory"), false);
  assert.equal(t.includes("../runtime"), false);
});

test("gateway does not import the chat barrel", () => {
  const t = readFileSync(join(src, "gateway.ts"), "utf8");
  assert.equal(/from ["']\.\/chat\.js["']/.test(t), false);
});

test("no service module imports protobuf — it lives in the ACL", () => {
  const offenders = sources()
    .filter((f) => /from ["']@grokbot2\/proto["']/.test(readFileSync(f, "utf8")))
    .map((f) => relative(src, f));
  assert.deepEqual(offenders, []);
});

test("native API does not import the Cursor adapter", () => {
  const t = readFileSync(join(src, "native.ts"), "utf8") + readFileSync(join(src, "native-map.ts"), "utf8");
  assert.equal(t.includes("@grokbot2/cursor-acl"), false);
  assert.equal(t.includes("@grokbot2/proto"), false);
});

test("no service module knows a Cursor command name", () => {
  // One name stands in for the vocabulary: it is the command the roadmap names as the test
  // (ROADMAP §5.2), and it appears nowhere a domain module has a reason to write it.
  const offenders = sources()
    .filter((f) => !f.endsWith("boundaries.test.ts"))
    .filter((f) => readFileSync(f, "utf8").includes("getAgentTranscriptTail"))
    .map((f) => relative(src, f));
  assert.deepEqual(offenders, []);
});
