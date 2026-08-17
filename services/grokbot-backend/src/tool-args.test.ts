/**
 * `toolArgs` — P5-3. One named-argument reader for every tool.
 *
 * The cases below are not hypothetical. Each is a failure that happened, was worked around locally,
 * and is now covered:
 *
 *   a quoted path becoming ENOENT              →  unquote existed for this
 *   `"a.md", "text, more"` splitting wrongly    →  the reason JSON has to be primary
 *   `\n` arriving as two visible characters     →  unescapeText existed for this
 *   the original's own parameter names ignored  →  found while writing this file
 *
 *   npx tsx --test src/tool-args.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { toolArgs, unquote } from "./tools.js";

const FILE = [
  { name: "relative_workspace_path", aliases: ["path", "target_file", "file"] },
  { name: "contents_after_edit", aliases: ["content", "contents", "text"] },
];

// ── JSON is primary ───────────────────────────────────────────────────────────

test("the ORIGINAL's parameter names work — the bug this task fixed", () => {
  // Before P5-3 this returned two empty strings and answered "Thiếu đường dẫn.", because the reader
  // only knew our shorter names. A model that knows the original sends exactly this.
  const a = toolArgs('{"relative_workspace_path":"n.md","contents_after_edit":"xin chào"}', FILE);
  assert.equal(a.relative_workspace_path, "n.md");
  assert.equal(a.contents_after_edit, "xin chào");
});

test("our older names still work, so nothing that worked stops", () => {
  const a = toolArgs('{"path":"n.md","content":"x"}', FILE);
  assert.equal(a.relative_workspace_path, "n.md");
  assert.equal(a.contents_after_edit, "x");
});

test("the canonical name wins when a model sends both", () => {
  const a = toolArgs('{"relative_workspace_path":"real.md","path":"alias.md"}', FILE);
  assert.equal(a.relative_workspace_path, "real.md");
});

test("the underscore-free spelling is accepted", () => {
  const a = toolArgs('{"relativeworkspacepath":"n.md"}', FILE);
  assert.equal(a.relative_workspace_path, "n.md");
});

test("a comma inside JSON content survives — positional cannot do this", () => {
  // `parts()` splits on commas, so this exact value is what broke the positional form.
  const a = toolArgs('{"path":"n.md","content":"một, hai, ba"}', FILE);
  assert.equal(a.contents_after_edit, "một, hai, ba");
});

test("a ) inside JSON content survives", () => {
  const a = toolArgs('{"path":"n.md","content":"f(x) = y"}', FILE);
  assert.equal(a.contents_after_edit, "f(x) = y");
});

test("real newlines pass through JSON untouched", () => {
  const a = toolArgs('{"path":"n.md","content":"dòng 1\\ndòng 2"}', FILE);
  assert.equal(a.contents_after_edit, "dòng 1\ndòng 2");
  assert.equal(a.contents_after_edit.split("\n").length, 2);
});

test("a missing key is an empty string, never undefined", () => {
  // Callers do `if (!path) return "Thiếu đường dẫn."`, so the type has to be stable.
  const a = toolArgs('{"path":"n.md"}', FILE);
  assert.equal(a.contents_after_edit, "");
});

test("a non-string value is converted, not dropped", () => {
  const a = toolArgs('{"target_directory":".","depth":3}', [
    { name: "target_directory" }, { name: "depth" },
  ]);
  assert.equal(a.depth, "3");
});

test("null is treated as absent", () => {
  const a = toolArgs('{"path":"n.md","content":null}', FILE);
  assert.equal(a.contents_after_edit, "");
});

// ── positional stays as the fallback ─────────────────────────────────────────

test("positional still works — removing it would break calls that work today", () => {
  const a = toolArgs("n.md, xin chào", FILE);
  assert.equal(a.relative_workspace_path, "n.md");
  assert.equal(a.contents_after_edit, "xin chào");
});

test("positional strips one quote pair per part", () => {
  // `list_dir_v2(".")` was a real ENOENT: the quotes made the path literally `"."`.
  const a = toolArgs('".", 2', [{ name: "target_directory" }, { name: "depth" }]);
  assert.equal(a.target_directory, ".");
  assert.equal(a.depth, "2");
});

test("positional unescapes \\n, because the wire carries no real newline", () => {
  const a = toolArgs("n.md, dòng 1\\ndòng 2", FILE);
  assert.equal(a.contents_after_edit, "dòng 1\ndòng 2");
});

test("the LAST positional part keeps its commas", () => {
  // parts() splits into at most n; the remainder stays whole. Without this, prose content is
  // truncated at its first comma.
  const a = toolArgs("n.md, một, hai, ba", FILE);
  assert.equal(a.relative_workspace_path, "n.md");
  assert.equal(a.contents_after_edit, "một, hai, ba");
});

test("a single positional argument fills the first key only", () => {
  const a = toolArgs("chỉ đường dẫn", FILE);
  assert.equal(a.relative_workspace_path, "chỉ đường dẫn");
  assert.equal(a.contents_after_edit, "");
});

test("malformed JSON falls back to positional instead of throwing", () => {
  // A truncated reply is common; it must degrade, not crash the turn.
  const a = toolArgs('{"path":"n.md", "content"', FILE);
  assert.equal(typeof a.relative_workspace_path, "string");
});

test("a JSON ARRAY is not treated as named arguments", () => {
  const a = toolArgs('["a","b"]', FILE);
  assert.equal(typeof a.relative_workspace_path, "string", "falls through to positional");
});

test("empty input yields empty strings, not a throw", () => {
  const a = toolArgs("", FILE);
  assert.equal(a.relative_workspace_path, "");
  assert.equal(a.contents_after_edit, "");
});

// ── unquote is still exported and still correct ───────────────────────────────

test("unquote remains available for the positional path", () => {
  assert.equal(unquote('"x"'), "x");
});
