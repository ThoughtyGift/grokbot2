/**
 * Extract the original agent's tool catalog from the shipped client bundle.
 *
 * The renderer carries the full `aiserver.v1` descriptor set, so the tool ENUM, the
 * `ClientSideToolV2Call` params oneof, and every param message's fields are all
 * recoverable — even though the bundle is minified, because protobuf descriptors
 * keep their real names as string literals.
 *
 * What is NOT recoverable, and never shipped: the system prompt and the agent loop.
 * The bundle only holds the field *names* (`system_prompt_override`,
 * `custom_system_prompt`, `system_prompt_spec`) — the text lives server-side.
 *
 *   node extract-tools.mjs <bundle.js> [outDir]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(process.argv[2], "utf8");
const outDir = process.argv[3] ?? ".";

/** Scan forward from an opening bracket to its match, respecting strings. */
function balanced(text, start, open = "[", close = "]") {
  let depth = 0, quote = null;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === open) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

// ── minified identifier -> proto type name ────────────────────────────────────
const typeName = new Map();
for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\.typeName\s*=\s*"([\w.]+)"/g)) typeName.set(m[1], m[2]);

// ── message fields ────────────────────────────────────────────────────────────
const FIELD = /\{no:(\d+),name:"([\w.]+)",kind:"(\w+)"([^{}]*)\}/g;
const messages = new Map();
for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\.fields\s*=\s*[\w$]+\.util\.newFieldList\(\(\)=>/g)) {
  const ident = m[1];
  const open = src.indexOf("[", m.index + m[0].length);
  if (open < 0) continue;
  const body = balanced(src, open);
  if (!body) continue;
  const fields = [];
  for (const f of body.matchAll(FIELD)) {
    const extra = f[4] ?? "";
    const ref = /T:([A-Za-z_$][\w$]*)/.exec(extra)?.[1];
    fields.push({
      no: Number(f[1]),
      name: f[2],
      kind: f[3],
      ...(ref ? { type: typeName.get(ref) ?? ref } : {}),
      ...(/repeated:!0/.test(extra) ? { repeated: true } : {}),
      ...(/opt:!0/.test(extra) ? { optional: true } : {}),
      ...(/oneof:"(\w+)"/.exec(extra) ? { oneof: /oneof:"(\w+)"/.exec(extra)[1] } : {}),
    });
  }
  messages.set(typeName.get(ident) ?? ident, fields);
}

// ── enums ─────────────────────────────────────────────────────────────────────
const enums = new Map();
for (const m of src.matchAll(/util\.setEnumType\([A-Za-z_$][\w$]*,"([\w.]+)",/g)) {
  const open = src.indexOf("[", m.index + m[0].length);
  const body = balanced(src, open);
  if (!body) continue;
  enums.set(m[1], [...body.matchAll(/\{no:(\d+),name:"(\w+)"/g)].map((e) => ({ no: Number(e[1]), name: e[2] })));
}

// ── assemble the catalog ──────────────────────────────────────────────────────
const toolEnum = enums.get("aiserver.v1.ClientSideToolV2") ?? [];
const callFields = messages.get("aiserver.v1.ClientSideToolV2Call") ?? [];
const resultFields = messages.get("aiserver.v1.ClientSideToolV2Result") ?? [];

/** CLIENT_SIDE_TOOL_V2_READ_FILE -> read_file */
const slug = (n) => n.replace(/^CLIENT_SIDE_TOOL_V2_/, "").toLowerCase();

const paramsByBase = new Map();
for (const f of callFields) if (f.oneof === "params") paramsByBase.set(f.name.replace(/_params$/, ""), f);
const resultByBase = new Map();
for (const f of resultFields) if (f.oneof) resultByBase.set(f.name.replace(/_result$/, ""), f);

const tools = toolEnum
  .filter((e) => e.no !== 0)
  .map((e) => {
    const base = slug(e.name);
    const p = paramsByBase.get(base);
    const r = resultByBase.get(base);
    return {
      enum: e.name,
      number: e.no,
      name: base,
      paramsMessage: p?.type ?? null,
      params: p?.type ? messages.get(p.type) ?? null : null,
      resultMessage: r?.type ?? null,
    };
  });

const catalog = {
  source: process.argv[2],
  note: "Tool schemas only. The system prompt and agent loop are server-side and are not present in this bundle.",
  counts: {
    toolsInEnum: tools.length,
    toolsWithParams: tools.filter((t) => t.params).length,
    protoMessages: messages.size,
    protoEnums: enums.size,
  },
  tools,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "tool-catalog.json"), JSON.stringify(catalog, null, 2));

// Every aiserver.v1 / agent.v1 message, for later protocol work. agent.v1 carries the
// box-side contracts (ComputerUseAction is what actually drives the VNC desktop).
const PROTO_NS = /^(aiserver|agent)\.v1\./;
writeFileSync(
  join(outDir, "proto-messages.json"),
  JSON.stringify(Object.fromEntries([...messages].filter(([k]) => PROTO_NS.test(k)).sort()), null, 2)
);
writeFileSync(
  join(outDir, "proto-enums.json"),
  JSON.stringify(Object.fromEntries([...enums].filter(([k]) => PROTO_NS.test(k)).sort()), null, 2)
);

console.log(`tools in enum      : ${catalog.counts.toolsInEnum}`);
console.log(`tools with params  : ${catalog.counts.toolsWithParams}`);
console.log(`proto messages     : ${catalog.counts.protoMessages}`);
console.log(`proto enums        : ${catalog.counts.protoEnums}`);
console.log(`\nwrote ${join(outDir, "tool-catalog.json")}`);
for (const t of tools.slice(0, 12)) {
  console.log(`  ${t.name.padEnd(28)} ${(t.params ?? []).map((f) => f.name).slice(0, 5).join(", ") || "(no params)"}`);
}
