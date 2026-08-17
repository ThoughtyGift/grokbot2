/**
 * Parsing and scheduling MORE THAN ONE tool call per turn.
 *
 * This is the architectural gap in docs/execution-roadmap.md §10 (P5), and the biggest one left
 * against the original: it dispatches several tools at once, we chain one per turn up to eight, so
 * the same three-step job costs three full round trips to the pool instead of one.
 *
 * Kept as a pure module on purpose. The turn loop in chat.ts is 2,000 lines and carries the
 * scars — six recorded wrong-field bugs, an approval path, presence flags, compaction — and the
 * hard part of P5 is not the wiring, it is deciding what may run together without inventing
 * dependencies. That decision is a function of text and a tool registry, so it belongs somewhere
 * it can be tested in milliseconds instead of by watching an app.
 *
 * Tests: src/tool-calls.test.ts — the first automated tests in this repo.
 */

/** One request the model made. `raw` is kept so the caller can strip it from the visible bubble. */
export interface ToolCall {
  name: string;
  arg: string;
  raw: string;
  /** Where it appeared, so ordering is stable and reportable. */
  index: number;
}

/**
 * How many calls one reply may set off.
 *
 * Not the same limit as `MAX_TOOL_STEPS` in chat.ts, which caps how many ROUNDS a user message may
 * cause. This caps the width of a single round: a model that emits forty calls has misunderstood
 * the format, and running forty is worse than running the first few and saying so.
 */
export const MAX_CALLS_PER_REPLY = 6;

/**
 * Find the end of an argument list that started at `open` (the index of `(`).
 *
 * A regex cannot do this, and the single-call parser in chat.ts only got away with it by anchoring
 * to the end of the string: `/TOOL_CALL:\s*(\w+)\s*\((.*?)\)\s*$/s`. Drop that anchor to find
 * several calls and `.*?` stops at the first `)` — which is inside the argument for anything
 * interesting:
 *
 *   browser_evaluate({"expression":"[...document.querySelectorAll('img')].map(i=>i.src)"})
 *
 * So parentheses are counted, and quoted strings are skipped so a `)` inside a JS or JSON string
 * cannot close the call. Backslash escapes are honoured for the same reason.
 */
function findArgEnd(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;   // unbalanced — the model was cut off mid-call
}

const NAME = /TOOL_CALL:\s*([A-Za-z_][\w-]*)\s*\(/g;

/**
 * Every tool call in `text`, in the order written.
 *
 * `known` filters to tools that exist, exactly as the single-call parser did — an unknown name is
 * the model hallucinating a tool, and running nothing is the correct response to that. Unbalanced
 * or empty-named calls are dropped rather than half-parsed.
 */
export function parseToolCalls(text: string, known: (name: string) => boolean): ToolCall[] {
  const out: ToolCall[] = [];
  NAME.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NAME.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;      // index of the "("
    const close = findArgEnd(text, open);
    if (close < 0) break;                        // truncated reply: keep what parsed cleanly
    const name = m[1].toLowerCase();
    // Continue scanning AFTER this call's own arguments, so a nested `TOOL_CALL:` inside a string
    // argument is never mistaken for a second call.
    NAME.lastIndex = close + 1;
    if (!known(name)) continue;
    out.push({
      name,
      arg: text.slice(open + 1, close).trim(),
      raw: text.slice(m.index, close + 1),
      index: out.length,
    });
    if (out.length >= MAX_CALLS_PER_REPLY) break;
  }
  return out;
}

/** Whether the model asked for more than it is allowed, so the turn can say so out loud. */
export function wasTruncated(text: string, known: (name: string) => boolean): boolean {
  // Counting without the cap: cheap, and the only honest way to report "I ran 6 of your 9".
  const all: string[] = [];
  NAME.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NAME.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = findArgEnd(text, open);
    if (close < 0) break;
    NAME.lastIndex = close + 1;
    if (known(m[1].toLowerCase())) all.push(m[1]);
  }
  return all.length > MAX_CALLS_PER_REPLY;
}

// ── scheduling ────────────────────────────────────────────────────────────────

/**
 * Split calls into batches that may run concurrently.
 *
 * The temptation is to analyse data flow and decide that `read_file_v2` does not depend on
 * `list_dir_v2`. Resist it: nothing in `TOOL_CALL: read_file_v2(notes.md)` says whether the model
 * picked that filename from the previous call's output or knew it already, and guessing wrong in
 * the parallel direction means running a read against a file that has not been written yet.
 *
 * So the rule is conservative and comes from the tool registry, not from the text:
 *
 *   - A run of consecutive calls that are ALL side-effect-free may run together.
 *   - Anything with a side effect — a write, a shell command, a message to another bot — runs
 *     alone, in the order written, and acts as a barrier.
 *
 * A barrier is not pessimism. `edit_file_v2` then `read_file_v2` of the same path is exactly the
 * sequence that must not be reordered, and the registry already knows which is which because
 * `needsApproval` has always encoded it (tools.ts).
 */
export function planBatches(calls: ToolCall[], isReadOnly: (name: string) => boolean): ToolCall[][] {
  const batches: ToolCall[][] = [];
  let current: ToolCall[] = [];
  for (const call of calls) {
    if (isReadOnly(call.name)) {
      current.push(call);
      continue;
    }
    // A side-effecting call closes whatever was accumulating and then stands alone.
    if (current.length) { batches.push(current); current = []; }
    batches.push([call]);
  }
  if (current.length) batches.push(current);
  return batches;
}

/**
 * How much of a round trip the plan saves, for the log line and for Gate B.
 *
 * P5's acceptance is measured, not asserted: without a number there is no way to tell a working
 * parallel path from one that quietly serialised everything.
 */
export function planShape(batches: ToolCall[][]): { calls: number; batches: number; widest: number } {
  const calls = batches.reduce((n, b) => n + b.length, 0);
  return { calls, batches: batches.length, widest: batches.reduce((n, b) => Math.max(n, b.length), 0) };
}
