/**
 * The first automated tests in this repo.
 *
 * docs/execution-roadmap.md flags coverage at 0% against an 80% standard, and names the pure
 * functions worth testing first. This is one of them, and it is the right one to start with: every
 * bug it can have is silent. A parser that stops at the wrong `)` does not throw, it runs a
 * truncated command; a scheduler that batches too eagerly does not throw, it reads a file before
 * the write that was supposed to create it.
 *
 *   npx tsx --test src/tool-calls.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToolCalls, planBatches, planShape, wasTruncated, hasIncompleteToolCall, MAX_CALLS_PER_REPLY } from "./tool-calls.js";

const KNOWN = new Set([
  "read_file_v2", "list_dir_v2", "web_search", "web_fetch", "browser_evaluate", "browser_navigate",
  "edit_file_v2", "run_terminal_command_v2", "message_agent", "ask_question",
]);
const known = (n: string) => KNOWN.has(n);
const READ_ONLY = new Set(["read_file_v2", "list_dir_v2", "web_search", "web_fetch", "browser_evaluate", "browser_navigate"]);
const isReadOnly = (n: string) => READ_ONLY.has(n);

// ── parsing ───────────────────────────────────────────────────────────────────

test("reads a single call, as the old parser did", () => {
  const calls = parseToolCalls("TOOL_CALL: list_dir_v2(.)", known);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "list_dir_v2");
  assert.equal(calls[0].arg, ".");
});

test("reads SEVERAL calls from one reply — the whole point of P5", () => {
  const text = [
    "TOOL_CALL: web_search(giá vàng hôm nay)",
    "TOOL_CALL: web_fetch(https://example.com)",
    "TOOL_CALL: list_dir_v2(.)",
  ].join("\n");
  const calls = parseToolCalls(text, known);
  assert.deepEqual(calls.map((c) => c.name), ["web_search", "web_fetch", "list_dir_v2"]);
});

test("a ) inside the argument does not end the call", () => {
  // This is the case that makes a regex impossible and the reason findArgEnd counts parens.
  const expr = `{"expression":"[...document.querySelectorAll('img')].map(i=>i.src)"}`;
  const calls = parseToolCalls(`TOOL_CALL: browser_evaluate(${expr})`, known);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].arg, expr, "argument must survive intact, closing paren and all");
});

test("two calls where the first argument contains parentheses", () => {
  const text = `TOOL_CALL: browser_evaluate({"expression":"f(g(1))"})\nTOOL_CALL: list_dir_v2(.)`;
  const calls = parseToolCalls(text, known);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].arg, `{"expression":"f(g(1))"}`);
  assert.equal(calls[1].name, "list_dir_v2");
});

test("a quoted ) cannot close the call", () => {
  const calls = parseToolCalls(`TOOL_CALL: web_search("what is a ) bracket")`, known);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].arg, `"what is a ) bracket"`);
});

test("prose around the calls is ignored", () => {
  const text = "Mình sẽ tìm rồi đọc file.\nTOOL_CALL: web_search(abc)\nRồi:\nTOOL_CALL: list_dir_v2(.)\nXong.";
  assert.equal(parseToolCalls(text, known).length, 2);
});

test("unknown tool names are dropped, not guessed at", () => {
  const calls = parseToolCalls("TOOL_CALL: definitely_not_a_tool(x)\nTOOL_CALL: list_dir_v2(.)", known);
  assert.deepEqual(calls.map((c) => c.name), ["list_dir_v2"]);
});

test("a truncated final call is dropped, and earlier ones survive", () => {
  // A reply cut off mid-argument must not run half a command.
  const calls = parseToolCalls("TOOL_CALL: list_dir_v2(.)\nTOOL_CALL: web_search(unclosed", known);
  assert.deepEqual(calls.map((c) => c.name), ["list_dir_v2"]);
});

test("TOOL_CALL inside a string argument is not a second call", () => {
  const text = `TOOL_CALL: web_search("how do I write TOOL_CALL: list_dir_v2(.) correctly")`;
  const calls = parseToolCalls(text, known);
  assert.equal(calls.length, 1, "the nested text is an argument, not an instruction");
  assert.equal(calls[0].name, "web_search");
});

test("names are lower-cased, matching the old parser", () => {
  assert.equal(parseToolCalls("TOOL_CALL: LIST_DIR_V2(.)", known)[0].name, "list_dir_v2");
});

test("the number of calls per reply is capped", () => {
  const text = Array.from({ length: MAX_CALLS_PER_REPLY + 3 }, () => "TOOL_CALL: web_search(x)").join("\n");
  assert.equal(parseToolCalls(text, known).length, MAX_CALLS_PER_REPLY);
  assert.equal(wasTruncated(text, known), true, "over the cap must be reportable, not silent");
});

test("at or under the cap is not reported as truncated", () => {
  const text = Array.from({ length: MAX_CALLS_PER_REPLY }, () => "TOOL_CALL: web_search(x)").join("\n");
  assert.equal(wasTruncated(text, known), false);
});

test("no calls at all is an empty list, not a null", () => {
  assert.deepEqual(parseToolCalls("Chào bạn, 2+2 bằng 4.", known), []);
});

/**
 * The reported bug: a big ask_question runs past the token limit, its `TOOL_CALL: ask_question({…`
 * never closes, parseToolCalls skips it (zero parsed calls), and without detection the raw JSON shows
 * on screen instead of a widget. hasIncompleteToolCall is what lets the turn strip it and retry.
 */
test("a cut-off tool call parses to nothing but is flagged incomplete", () => {
  const cut = 'Bạn muốn gì?\nTOOL_CALL: ask_question({"options":[{"label":"A","value":"a"}],"prompt":"gì?"';
  assert.equal(parseToolCalls(cut, known).length, 0, "an unclosed call must not parse");
  assert.equal(hasIncompleteToolCall(cut, known), true, "…but it must be detectable so raw JSON never shows");
});

test("a complete call is not flagged incomplete, and prose is neither", () => {
  const full = 'TOOL_CALL: ask_question({"prompt":"x","options":[{"label":"A","value":"a"}]})';
  assert.equal(hasIncompleteToolCall(full, known), false);
  assert.equal(hasIncompleteToolCall("Chào bạn, không cần công cụ.", known), false);
});

// ── scheduling ────────────────────────────────────────────────────────────────

test("consecutive read-only calls share one batch", () => {
  const calls = parseToolCalls("TOOL_CALL: web_search(a)\nTOOL_CALL: web_fetch(b)\nTOOL_CALL: list_dir_v2(.)", known);
  const batches = planBatches(calls, isReadOnly);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 3);
});

test("a write runs alone and acts as a barrier", () => {
  // The sequence that must never be reordered: write, then read the same path.
  const calls = parseToolCalls(
    "TOOL_CALL: web_search(a)\nTOOL_CALL: edit_file_v2({\"path\":\"n.md\",\"content\":\"x\"})\nTOOL_CALL: read_file_v2(n.md)",
    known,
  );
  const batches = planBatches(calls, isReadOnly);
  assert.equal(batches.length, 3, "read | write | read — the write cannot merge with either side");
  assert.deepEqual(batches.map((b) => b.map((c) => c.name)), [
    ["web_search"],
    ["edit_file_v2"],
    ["read_file_v2"],
  ]);
});

test("two writes stay in order, one per batch", () => {
  const calls = parseToolCalls(
    "TOOL_CALL: run_terminal_command_v2(ls)\nTOOL_CALL: message_agent({\"to\":\"Sales\",\"content\":\"hi\"})",
    known,
  );
  const batches = planBatches(calls, isReadOnly);
  assert.deepEqual(batches.map((b) => b.length), [1, 1]);
});

test("order is preserved within a batch", () => {
  const calls = parseToolCalls("TOOL_CALL: web_search(first)\nTOOL_CALL: web_fetch(second)", known);
  const [batch] = planBatches(calls, isReadOnly);
  assert.deepEqual(batch.map((c) => c.arg), ["first", "second"]);
});

test("planShape reports the saving, which is what Gate B measures", () => {
  const calls = parseToolCalls("TOOL_CALL: web_search(a)\nTOOL_CALL: web_fetch(b)\nTOOL_CALL: list_dir_v2(.)", known);
  assert.deepEqual(planShape(planBatches(calls, isReadOnly)), { calls: 3, batches: 1, widest: 3 });
});

test("all-sequential work reports no saving rather than a fake one", () => {
  const calls = parseToolCalls(
    "TOOL_CALL: edit_file_v2({\"path\":\"a\",\"content\":\"1\"})\nTOOL_CALL: run_terminal_command_v2(ls)",
    known,
  );
  assert.deepEqual(planShape(planBatches(calls, isReadOnly)), { calls: 2, batches: 2, widest: 1 });
});

test("an empty plan is empty", () => {
  assert.deepEqual(planBatches([], isReadOnly), []);
  assert.deepEqual(planShape([]), { calls: 0, batches: 0, widest: 0 });
});
