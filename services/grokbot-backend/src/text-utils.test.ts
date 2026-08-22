/**
 * The text handling every tool argument and every fetched page passes through.
 *
 * `unquote` and `renderTree` (tools.ts), `htmlToMarkdown` (web.ts), `redact` (redact.ts), and the
 * three prompt tiers (prompt.ts). All named in docs/history/execution-roadmap.md, all pure, and all with
 * the same failure mode: they do not throw, they hand the model something subtly wrong. A quote
 * left on a path becomes ENOENT; a tree that hides an unexplored branch becomes "the directory is
 * empty"; a prompt whose volatile part drifts forward destroys caching for everything behind it.
 *
 *   npx tsx --test src/text-utils.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { unquote, renderTree, type TreeNode } from "./tools.js";
import { htmlToMarkdown } from "./web.js";
import { redact } from "./redact.js";
import { stableTier, contextTier, volatileTier, buildSystemPrompt } from "./prompt.js";

// ── unquote ───────────────────────────────────────────────────────────────────

test("one matching pair of quotes comes off", () => {
  // Models write list_dir_v2(".") at least as often as list_dir_v2(.), and the quotes turn the
  // path into `"."` — every call then fails with ENOENT.
  assert.equal(unquote('"."'), ".");
  assert.equal(unquote("'.'"), ".");
  assert.equal(unquote("`.`"), ".");
});

test("mismatched or inner quotes are left alone", () => {
  assert.equal(unquote(`"a'`), `"a'`);
  assert.equal(unquote(`say "hi"`), `say "hi"`);
  assert.equal(unquote(`"a" and "b"`), `a" and "b`, "outer pair only — documented behaviour");
});

test("only ONE pair comes off", () => {
  assert.equal(unquote('""x""'), '"x"');
});

test("surrounding whitespace goes, empty input survives", () => {
  assert.equal(unquote('  "x"  '), "x");
  assert.equal(unquote(""), "");
  assert.equal(unquote('""'), "");
});

// ── renderTree ────────────────────────────────────────────────────────────────

const node = (over: Partial<TreeNode> = {}): TreeNode => ({
  abs_path: "/home/box/workspace",
  children_dirs: [],
  children_files: [],
  children_were_processed: true,
  num_files: 0,
  ...over,
});

test("files are listed with their size", () => {
  const out = renderTree(node({ children_files: [{ name: "a.md", size: 31 }] }));
  assert.match(out, /a\.md\s+31B/);
});

test("an UNEXPLORED directory is marked, not silently shown as empty", () => {
  // The agent concluding a directory is empty when it was only truncated is the whole reason
  // this marker exists.
  const out = renderTree(node({
    children_dirs: [node({ abs_path: "/home/box/workspace/deep", children_were_processed: false })],
  }));
  assert.match(out, /deep\/.*chưa mở/);
});

test("an explored directory is not marked as unexplored", () => {
  const out = renderTree(node({
    children_dirs: [node({ abs_path: "/home/box/workspace/src", children_files: [{ name: "x.ts" }] })],
  }));
  assert.doesNotMatch(out, /chưa mở/);
  assert.match(out, /x\.ts/);
});

test("a truncated root says so", () => {
  assert.match(renderTree(node({ children_were_processed: false })), /cắt bớt/);
});

test("no data is stated, not rendered as an empty tree", () => {
  assert.match(renderTree(undefined), /không có dữ liệu/);
});

// ── htmlToMarkdown ────────────────────────────────────────────────────────────

test("headings, lists and code survive", () => {
  const md = htmlToMarkdown("<h1>Tiêu đề</h1><ul><li>một</li><li>hai</li></ul><pre>code()</pre>");
  assert.match(md, /# Tiêu đề/);
  assert.match(md, /- một/);
  assert.match(md, /```/);
});

test("link targets are kept — a link the model cannot follow is worse than none", () => {
  const md = htmlToMarkdown('<a href="https://example.com">ví dụ</a>');
  assert.match(md, /\[ví dụ\]\(https:\/\/example\.com\)/);
});

test("script, style and nav are dropped", () => {
  const md = htmlToMarkdown("<script>alert(1)</script><style>b{}</style><nav>menu</nav><p>thật</p>");
  assert.doesNotMatch(md, /alert|b\{\}|menu/);
  assert.match(md, /thật/);
});

test("entities are decoded", () => {
  assert.match(htmlToMarkdown("<p>a &amp; b &lt;c&gt; &#233;</p>"), /a & b <c> é/);
});

test("the title becomes the first heading", () => {
  assert.match(htmlToMarkdown("<title>Trang</title><p>x</p>"), /^# Trang/);
});

// ── redact ────────────────────────────────────────────────────────────────────

test("a password in a query string is masked, the rest of the URL survives", () => {
  const out = redact("https://h/vnc.html?path=ws&autoconnect=true&password=Secret%231&x=1");
  assert.doesNotMatch(out, /Secret/);
  assert.match(out, /password=\*\*\*/);
  assert.match(out, /autoconnect=true/, "the useful part of the line must remain");
});

test("a pool key is masked wherever it appears", () => {
  assert.equal(redact("key hal_0123456789abcdef0123456789"), "key hal_***");
});

test("a bearer credential is masked but the scheme is kept", () => {
  assert.match(redact("authorization: Bearer abcdef0123456789"), /Bearer \*\*\*/);
});

test("redact is idempotent — safe to apply at several layers", () => {
  const once = redact("?password=abc");
  assert.equal(redact(once), once);
});

test("a line with no secret is untouched", () => {
  const clean = "backend on http://localhost:8788";
  assert.equal(redact(clean), clean);
});

// ── prompt tiers ──────────────────────────────────────────────────────────────

test("the volatile tier is ONE line and holds the timestamp", () => {
  const v = volatileTier({ now: new Date("2026-08-17T02:00:00Z"), timeZone: "Asia/Ho_Chi_Minh" });
  assert.equal(v.split("\n").length, 1, "every token here is a token that cannot be cached");
  assert.match(v, /Asia\/Ho_Chi_Minh/);
});

test("an invalid timezone falls back to UTC instead of throwing", () => {
  assert.match(volatileTier({ now: new Date(), timeZone: "Not/AZone" }), /UTC/);
});

test("cache order is stable → context → volatile", () => {
  const p = buildSystemPrompt("TOOLS", {
    now: new Date("2026-08-17T02:00:00Z"),
    agentName: "Thư ký",
    boxOn: true,
  });
  const stable = p.indexOf("TOOLS");
  const ctx = p.indexOf("Thư ký");
  const vol = p.indexOf("The current time is");
  assert.ok(stable < ctx, "the stable tier must come first or caching breaks");
  assert.ok(ctx < vol, "the timestamp must be last for the same reason");
});

test("the bot's own name is stated, and model self-naming is closed off", () => {
  const c = contextTier({ agentName: "Thư ký" });
  assert.match(c, /Thư ký/);
  assert.match(c, /Gemini|Claude|GPT/, "the anti-self-naming rule must name the models it forbids");
});

test("with no box, the prompt says so rather than promising a shell", () => {
  const c = contextTier({ boxOn: false, browserOn: false });
  assert.match(c, /no computer is attached/i);
  assert.match(c, /CANNOT run shell commands/, "it has to say what it cannot do, not just that something is missing");
});

test("with a box, the tools are described as running on the agent's OWN computer", () => {
  const c = contextTier({ boxOn: true });
  assert.match(c, /YOUR computer/);
  assert.match(c, /not on the user's machine/, "the whole point is the distinction from the user's machine");
});

/**
 * The word "box" is internal jargon, and the model repeats whatever the prompt uses — it introduced
 * itself as running on a "Linux Box" in a live reply because two tiers of the prompt taught it that
 * word while a third forbade saying it. Asserting its absence is what stops the drift returning.
 */
test("the model-facing prompt never uses the word 'box'", () => {
  for (const c of [contextTier({ boxOn: true, browserOn: true }), contextTier({ boxOn: false })]) {
    assert.ok(!/\bbox\b/i.test(c), `"box" leaked into the prompt: ${c}`);
  }
});

/**
 * The prompt is generated from the original app, which is English throughout; the seams written here
 * were Vietnamese, leaving it a mix. Vietnamese diacritics are the cheap, reliable signal that a new
 * seam has drifted back — user-facing strings live elsewhere and are untouched by this.
 */
test("the model-facing prompt stays in one language", () => {
  const VIETNAMESE = /[àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
  const p = buildSystemPrompt("TOOLS", { now: new Date("2026-08-17T02:00:00Z"), boxOn: true, browserOn: true });
  const stray = p.split("\n").filter((l) => VIETNAMESE.test(l));
  assert.deepEqual(stray, [], `Vietnamese left in the model-facing prompt:\n${stray.join("\n")}`);
});

test("memory lands in the context tier, not the volatile one", () => {
  const mem = "Những điều bạn đã ghi nhớ: thích trả lời ngắn";
  assert.match(contextTier({ memory: mem }), /thích trả lời ngắn/);
  assert.doesNotMatch(volatileTier({ now: new Date(), memory: mem }), /thích trả lời ngắn/);
});

test("the stable tier carries the tool protocol verbatim", () => {
  assert.match(stableTier("\n\nCÔNG CỤ: xyz"), /CÔNG CỤ: xyz/);
});
