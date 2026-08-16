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
    if (c === "\\") { out += text[i] + text[i + 1]; i += 2; continue; }
    if (c === "$" && text[i + 1] === "{") { depth++; out += "${"; i += 2; continue; }
    if (c === "}" && depth > 0) { depth--; out += "}"; i++; continue; }
    if (c === "`" && depth === 0) return { value: out, end: i };
    out += c;
    i++;
  }
  return null;
}

/** Read a double-quoted JS string starting at the quote. */
function readQuoted(text, start) {
  let i = start + 1;
  let out = "";
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      const n = text[i + 1];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n === '"' ? '"' : n === "\\" ? "\\" : n;
      i += 2;
      continue;
    }
    if (c === '"') return { value: out, end: i };
    out += c;
    i++;
  }
  return null;
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
  const parts = [];
  for (let k = 0; k < body.length; k++) {
    if (body[k] !== "`") continue;
    const t = readTemplate(body, k);
    if (!t) break;
    if (t.value.trim().length > 40) parts.push(t.value);
    k = t.end;
  }
  if (parts.length) prompts.push({ name: m[1], kind: "builder", text: parts.join("\n\n---\n\n") });
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
