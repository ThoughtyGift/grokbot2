/**
 * Compaction unit tests.
 *
 * The failure modes here are all silent: compacting too early throws away context nobody
 * notices is missing, compacting too late blows the window, and a wrong slice drops the
 * newest messages — the ones the next reply actually depends on.
 */
import { estimateTokens, historyTokens, needsCompaction, applyCompaction } from "../src/compaction.ts";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

const msg = (role, content) => ({ role, content });
const many = (n, size = 400) =>
  Array.from({ length: n }, (_, i) => msg(i % 2 ? "assistant" : "user", `${i}:${"x".repeat(size)}`));

console.log("estimate");
check("empty string is zero", estimateTokens(""), 0);
check("longer text costs more", estimateTokens("a".repeat(280)) > estimateTokens("a".repeat(28)), true);
check("pessimistic vs chars/4", estimateTokens("a".repeat(280)) > 280 / 4, true);
check("history adds per-message overhead", historyTokens([msg("user", ""), msg("user", "")]), 8);

console.log("\nthreshold");
check("short history untouched", needsCompaction(many(4)), false);
check("many but small stays under budget", needsCompaction(many(20, 10)), false);
check("long history triggers", needsCompaction(many(60, 900)), true);
check("empty history never triggers", needsCompaction([]), false);

console.log("\napply");
const h = many(20, 50);
const state = { summary: "SUMMARY", coveredCount: 12, atMs: 0 };
const out = applyCompaction(h, state);
check("summary replaces the covered head", out.length, 1 + (20 - 12));
check("first message is the summary", out[0].content.includes("SUMMARY"), true);
check("newest message survives verbatim", out[out.length - 1].content, h[h.length - 1].content);
check("message 12 is the first kept", out[1].content, h[12].content);

console.log("\napply — refuses nonsense rather than losing the conversation");
check("null state passes through", applyCompaction(h, null).length, h.length);
check("coveredCount past the end passes through", applyCompaction(h, { summary: "S", coveredCount: 99, atMs: 0 }).length, h.length);
check("coveredCount zero passes through", applyCompaction(h, { summary: "S", coveredCount: 0, atMs: 0 }).length, h.length);
check("covering everything passes through", applyCompaction(h, { summary: "S", coveredCount: 20, atMs: 0 }).length, h.length);

console.log("\nshrinkage");
const big = many(80, 900);
const compacted = applyCompaction(big, { summary: "S".repeat(600), coveredCount: 72, atMs: 0 });
check("compacted history is much smaller", historyTokens(compacted) < historyTokens(big) / 5, true);
check("compacted history fits the default budget", historyTokens(compacted) < 12_000, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
