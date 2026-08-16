/**
 * Pull the prompts that DO ship, out of the box host bundle.
 *
 * `agent-brain.md` established that the main agent loop and its system prompt are
 * server-side — that is still true. But that conclusion was drawn from the *renderer*
 * bundle. `dist/host/host-main.cjs` is the **box host**, and it carries the specialist
 * layer verbatim: subagent system reminders, their tool allowlists, model choices and
 * permission modes. That layer is reusable.
 *
 *   node scripts/extract-prompts.mjs <path-to>/dist/host/host-main.cjs docs/extracted
 *
 * Writes subagent-prompts.json (machine) + subagent-prompts.md (readable).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [, , hostPath, outDir = "docs/extracted"] = process.argv;
if (!hostPath) {
  console.error("usage: node scripts/extract-prompts.mjs <host-main.cjs> [outDir]");
  process.exit(1);
}
const src = readFileSync(hostPath, "utf8");

/** Read a template literal starting at the backtick, honouring escapes and nested `${}`. */
function readTemplate(text, start) {
  let i = start + 1;
  let depth = 0;
  let out = "";
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") { const e = decodeEscape(text, i); out += e.value; i = e.next; continue; }
    if (c === "$" && text[i + 1] === "{") { depth++; out += "${"; i += 2; continue; }
    if (c === "}" && depth > 0) { depth--; out += "}"; i++; continue; }
    if (c === "`" && depth === 0) return { value: out, end: i };
    out += c;
    i++;
  }
  return null;
}

/**
 * Decode one JS escape sequence starting at the backslash.
 *
 * The previous reader copied the backslash and the next character through unchanged, so
 * every `\n` stayed two literal characters and every `—` stayed six. A prompt full of
 * literal "\n" and "—" is not the prompt the model was given — it is a different
 * document that merely looks similar, which is exactly how a bad extraction slips through
 * a character count.
 */
function decodeEscape(text, i) {
  const n = text[i + 1];
  const simple = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };
  if (n === "u") {
    if (text[i + 2] === "{") {
      const close = text.indexOf("}", i + 3);
      const hex = text.slice(i + 3, close);
      if (close > 0 && /^[0-9a-fA-F]+$/.test(hex)) {
        return { value: String.fromCodePoint(parseInt(hex, 16)), next: close + 1 };
      }
    }
    const hex = text.slice(i + 2, i + 6);
    if (/^[0-9a-fA-F]{4}$/.test(hex)) return { value: String.fromCharCode(parseInt(hex, 16)), next: i + 6 };
  }
  if (n === "x") {
    const hex = text.slice(i + 2, i + 4);
    if (/^[0-9a-fA-F]{2}$/.test(hex)) return { value: String.fromCharCode(parseInt(hex, 16)), next: i + 4 };
  }
  if (n === "\n") return { value: "", next: i + 2 };          // line continuation
  if (n in simple) return { value: simple[n], next: i + 2 };
  return { value: n ?? "", next: i + 2 };                      // \` \" \' \\ \$ and friends
}

/** Read a double-quoted JS string starting at the quote. */
function readQuoted(text, start) {
  const quote = text[start];
  let i = start + 1;
  let out = "";
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") { const e = decodeEscape(text, i); out += e.value; i = e.next; continue; }
    if (c === "\n") return null;              // a real string never spans a raw newline
    if (c === quote) return { value: out, end: i };
    out += c;
    i++;
  }
  return null;
}

/**
 * Collect the prose strings of a prompt builder, in source order.
 *
 * The prompt is not one template — most of it is an ARRAY of quoted lines
 * (`"...", "", "## Heading", "..."`) that the builder joins with newlines. Reading only
 * backtick templates made one reader swallow an entire array as a single "template",
 * which is where the JS fragments in the first extraction came from.
 */
function readPromptStrings(body) {
  const out = [];
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c !== "`" && c !== '"' && c !== "'") continue;
    const t = c === "`" ? readTemplate(body, i) : readQuoted(body, i);
    if (!t) continue;                          // stray quote: skip this char, keep scanning
    const v = t.value;
    // Keep prose and blank lines; drop identifiers, keys and flags like "utf8" or "n".
    if (v === "" || /\s/.test(v.trim()) || /^[#\-*>|]/.test(v.trim())) out.push(v);
    i = t.end;
  }
  return out;
}

// ── 1. named prompt constants: FOO_PROMPT = `…` ──────────────────────────────
const prompts = [];
for (const m of src.matchAll(/\b([A-Z][A-Z0-9_]*_PROMPT)\s*=\s*`/g)) {
  const t = readTemplate(src, m.index + m[0].length - 1);
  if (t) prompts.push({ name: m[1], kind: "constant", text: t.value });
}

// ── 2. builder functions: buildXSubagentPrompt(...) { … } ────────────────────
for (const m of src.matchAll(/function (build[A-Za-z0-9]*Prompt)\s*\(/g)) {
  // Take the template literals inside the function body (balanced braces from the `{`).
  const open = src.indexOf("{", m.index + m[0].length);
  if (open < 0) continue;
  let i = open, depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) continue;
  const body = src.slice(open, end + 1);
  const parts = readPromptStrings(body);
  if (parts.length) {
    // Join with a single newline: that is how the builder's own arrays are assembled.
    // (An earlier version inserted "---" between parts, producing 41 section breaks that
    // exist nowhere in the original.)
    prompts.push({ name: m[1], kind: "builder", segments: parts, text: parts.join("\n") });
  }
}

// ── 3. subagent configs: type, model, permission, tools, description ─────────
const configs = [];
for (const m of src.matchAll(/\b([A-Z][A-Z0-9_]*_SUBAGENT_CONFIG)\s*=\s*\{/g)) {
  const open = src.indexOf("{", m.index + m[0].length - 1);
  let i = open, depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) continue;
  const body = src.slice(open, end + 1);
  const descAt = body.indexOf('description: "');
  const desc = descAt >= 0 ? readQuoted(body, descAt + 'description: '.length)?.value : undefined;
  configs.push({
    name: m[1],
    description: desc,
    models: [...body.matchAll(/"([a-z0-9.\-]*(?:sonnet|opus|haiku|composer|gpt|gemini|grok)[a-z0-9.\-]*)"/g)].map((x) => x[1]),
    permissionMode: /permissionMode:\s*[A-Za-z.]*\.([A-Z_]+)/.exec(body)?.[1],
    systemReminder: /systemReminder:\s*\(\)\s*=>\s*([A-Z_]+)/.exec(body)?.[1],
  });
}

// ── 4. tool allowlists per subagent ──────────────────────────────────────────
const allowlists = [];
for (const m of src.matchAll(/\b([A-Z][A-Z0-9_]*TOOL_IDENTIFIERS)\s*=\s*\/\* @__PURE__ \*\/ new Set\(\[([^\]]*)\]\)/g)) {
  allowlists.push({ name: m[1], tools: [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]) });
}

// ── 5. the browser MCP tool surface ──────────────────────────────────────────
const ACTIONS = /^browser_(navigate|snapshot|take_screenshot|click|mouse_click_xy|type|fill|select_option|press_key|scroll|drag|get_bounding_box|highlight|evaluate|tabs|cdp)$/;
const browserTools = [...new Set(src.match(/browser_[a-z_]+/g) ?? [])].filter((n) => ACTIONS.test(n)).sort();

mkdirSync(outDir, { recursive: true });
const payload = {
  source: hostPath,
  note:
    "Extracted from the BOX HOST bundle. The main agent loop and its system prompt are still " +
    "server-side and absent; what ships here is the specialist layer (subagent reminders, " +
    "tool allowlists, model choices) plus the browser MCP tool names.",
  counts: {
    prompts: prompts.length,
    configs: configs.length,
    allowlists: allowlists.length,
    browserTools: browserTools.length,
  },
  prompts: prompts.sort((a, b) => a.name.localeCompare(b.name)),
  configs,
  allowlists,
  browserTools,
};
writeFileSync(join(outDir, "subagent-prompts.json"), JSON.stringify(payload, null, 2));

const md = [
  "# Prompts that ship in the box host",
  "",
  "Generated by `scripts/extract-prompts.mjs` — do not edit by hand.",
  "",
  payload.note,
  "",
  `## Browser MCP tool surface (\`cursor-ide-browser\`) — ${browserTools.length} actions`,
  "",
  "```",
  browserTools.join(" · "),
  "```",
  "",
  "## Subagent configs",
  "",
  "| Config | Permission | Models | Reminder |",
  "|---|---|---|---|",
  ...configs.map(
    (c) =>
      `| \`${c.name}\` | ${c.permissionMode ?? "—"} | ${c.models?.length ? c.models.join(", ") : "—"} | ${c.systemReminder ? "`" + c.systemReminder + "`" : "—"} |`,
  ),
  "",
  "## Tool allowlists",
  "",
  ...allowlists.map((a) => `- \`${a.name}\` → ${a.tools.map((t) => "`" + t + "`").join(", ")}`),
  "",
  "## Prompts",
  "",
  ...prompts.flatMap((p) => [`### ${p.name} (${p.kind})`, "", "```text", p.text.trim(), "```", ""]),
].join("\n");
writeFileSync(join(outDir, "subagent-prompts.md"), md);

console.log(
  `prompts ${prompts.length} · configs ${configs.length} · allowlists ${allowlists.length} · browser tools ${browserTools.length}`,
);
console.log(`→ ${join(outDir, "subagent-prompts.json")}`);
console.log(`→ ${join(outDir, "subagent-prompts.md")}`);
