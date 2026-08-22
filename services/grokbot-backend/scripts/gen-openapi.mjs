/**
 * Sinh `docs/api/grokbot2-v1.yaml` từ `@grokbot2/api-contract`.
 *
 *   node scripts/gen-openapi.mjs           # ghi file
 *   node scripts/gen-openapi.mjs --check   # so với file trên đĩa, thoát 1 nếu lệch
 *
 * Bản v0 trước đây **viết tay**: 666 dòng, trong đó 633 dòng là schema và chỉ 33 dòng là văn xuôi.
 * Nghĩa là 95% file là thứ máy sinh được, và nó đã lệch thật — thiếu avatar, reaction,
 * `host/sidebar`, lại dùng `{agentId}` trong khi route thật là `{id}`. Một spec lệch còn tệ hơn
 * không có spec: người đọc tin nó.
 *
 * Văn xuôi (lý do thiết kế, các bề mặt còn để dành) chuyển sang `docs/api/README.md` — nó là
 * *explanation*, không phải *reference*, nên không thuộc file máy sinh.
 *
 * `--check` là mục thứ bảy của `pnpm self-xray`: thêm route vào `native.ts` mà quên khai trong hợp
 * đồng thì spec lệch, và lệch thì đỏ.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "@grokbot2/api-contract";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const OUT = join(REPO, "docs", "api", "grokbot2-v1.yaml");
const CHECK = process.argv.includes("--check");

/** Schema có tên → vào `components.schemas`, và mọi chỗ dùng thành `$ref`. */
const NAMED = [
  "Agent", "Entry", "TranscriptPage", "ComputerStatus", "SidebarSection", "Session", "ErrorBody",
  "Author", "Attachment", "Reaction", "LastEntry", "Activity", "Presence", "TranscriptEvent",
  "Widget", "WidgetOption",
  "CreateAgentBody", "PatchAgentBody", "TurnBody", "AvatarBody", "ReactionBody",
  "PermissionBody", "WidgetReplyBody", "UiPrefs",
  "Routine", "RoutineRun", "CreateRoutineBody", "PatchRoutineBody", "SearchHit", "SubagentKind",
];

/*
 * Danh sách trên viết tay, nên nó phải TỰ KIỂM.
 *
 * Quên thêm tên vào đây không gây lỗi: schema chỉ bị nhúng thẳng vào từng route, spec vẫn sinh ra,
 * và không ai biết. Đúng thế đã xảy ra với `UiPrefs`. Nên quét các export của hợp đồng: cái nào
 * trông như schema TypeBox mà không có trong danh sách thì báo ngay.
 */
const looksLikeSchema = (v) => v != null && typeof v === "object" && !Array.isArray(v)
  && (typeof v.type === "string" || Array.isArray(v.anyOf) || Array.isArray(v.allOf));
const missing = Object.keys(C).filter((k) => looksLikeSchema(C[k]) && !NAMED.includes(k));
if (missing.length) {
  console.error(`! schema có export nhưng thiếu trong NAMED: ${missing.join(", ")}`);
  console.error("  thêm vào NAMED, nếu không nó bị nhúng thẳng vào từng route thay vì thành $ref");
  process.exitCode = 1;
}

/** TypeBox đánh dấu bằng Symbol, nên `JSON.stringify` cho ra đúng JSON Schema thuần. */
const plain = (schema) => JSON.parse(JSON.stringify(schema));

const named = new Map();
for (const n of NAMED) {
  if (!C[n]) throw new Error(`hợp đồng không xuất "${n}" — sửa NAMED trong gen-openapi.mjs`);
  named.set(JSON.stringify(plain(C[n])), n);
}

/** Thay schema trùng một schema có tên bằng `$ref`; giữ nguyên phần còn lại. */
function ref(schema) {
  const flat = plain(schema);
  const hit = named.get(JSON.stringify(flat));
  if (hit) return { $ref: `#/components/schemas/${hit}` };
  if (flat.type === "array" && flat.items) return { type: "array", items: ref(flat.items) };
  return flat;
}

// ── YAML tối giản ────────────────────────────────────────────────────────────
// Không thêm phụ thuộc chỉ để in YAML. Chỉ cần map/array/scalar — đúng phạm vi OpenAPI ở đây.
const needsQuote = (s) =>
  s === "" || /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) || /[:#]\s/.test(s) || /\s$/.test(s)
  || /^(true|false|null|~|y|n|yes|no|on|off)$/i.test(s) || /^[\d.+-]/.test(s);

function yaml(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return needsQuote(value) ? JSON.stringify(value) : value;
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value.map((v) => {
      const body = yaml(v, indent + 2);
      return typeof v === "object" && v !== null
        ? `${pad}- ${body.replace(/^\s+/, "").replace(new RegExp(`\\n${" ".repeat(indent + 2)}`, "g"), `\n${pad}  `)}`
        : `${pad}- ${body}`;
    }).join("\n");
  }
  const keys = Object.keys(value);
  if (!keys.length) return "{}";
  return keys.map((k) => {
    const v = value[k];
    const key = needsQuote(k) ? JSON.stringify(k) : k;
    if (v !== null && typeof v === "object" && (Array.isArray(v) ? v.length : Object.keys(v).length)) {
      return `${pad}${key}:\n${yaml(v, indent + 2)}`;
    }
    return `${pad}${key}: ${yaml(v, indent)}`;
  }).join("\n");
}

// ── dựng spec ────────────────────────────────────────────────────────────────
const paths = {};
for (const r of C.ROUTES) {
  const p = (paths[r.path] ??= {});
  const op = { summary: r.summary, tags: [r.path.split("/")[2] ?? "v1"] };

  // Tham số đường dẫn suy từ chính chuỗi path — không khai tay, không lệch được.
  const params = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1], in: "path", required: true, schema: { type: "string" },
  }));
  for (const q of r.query ?? []) params.push({ name: q, in: "query", required: false, schema: { type: "string" } });
  if (params.length) op.parameters = params;

  if (r.req) op.requestBody = { required: true, content: { "application/json": { schema: ref(r.req) } } };

  const ok = r.method === "post" && r.path.endsWith("/agents") ? "201" : r.res ? "200" : "204";
  op.responses = {
    [ok]: r.res
      ? { description: "OK", content: { "application/json": { schema: ref(r.res) } } }
      : { description: "OK, không có thân" },
  };
  if (r.auth !== false) {
    op.security = [{ bearerAuth: [] }];
    op.responses["401"] = { description: "thiếu hoặc sai bearer", content: { "application/json": { schema: ref(C.ErrorBody) } } };
  }
  if (r.path.includes("{")) {
    op.responses["404"] = { description: "không có", content: { "application/json": { schema: ref(C.ErrorBody) } } };
  }
  p[r.method] = op;
}

const schemas = {};
for (const n of NAMED) schemas[n] = plain(C[n]);

const spec = {
  openapi: "3.1.0",
  info: {
    title: "grokbot2 native API",
    version: "1.0.0",
    description:
      "Hợp đồng /v1 mà apps/grokbot-web gọi. SINH TỰ ĐỘNG từ packages/api-contract — "
      + "đừng sửa file này, sửa schema rồi chạy `node scripts/gen-openapi.mjs`. "
      + "Lý do thiết kế nằm ở docs/api/README.md.",
  },
  servers: [{ url: "http://127.0.0.1:8788", description: "BFF trên máy" }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    schemas,
  },
  paths,
};

const header = [
  "# SINH TỰ ĐỘNG — đừng sửa tay.",
  "#",
  "#   nguồn:  packages/api-contract/src/v1.ts",
  "#   sinh:   node services/grokbot-backend/scripts/gen-openapi.mjs",
  "#   kiểm:   node services/grokbot-backend/scripts/gen-openapi.mjs --check  (nằm trong pnpm self-xray)",
  "#",
  "# Lý do thiết kế và các bề mặt còn để dành: docs/api/README.md",
  "",
].join("\n");
const text = `${header}${yaml(spec)}\n`;

if (CHECK) {
  let onDisk = "";
  try { onDisk = readFileSync(OUT, "utf8"); } catch { /* chưa có */ }
  if (onDisk === text) {
    console.log(`spec khớp hợp đồng (${C.ROUTES.length} route, ${NAMED.length} schema)`);
    process.exit(0);
  }
  console.error("spec LỆCH so với hợp đồng — chạy `node scripts/gen-openapi.mjs` rồi commit lại");
  console.error(`  ${onDisk ? "file trên đĩa khác bản sinh" : "chưa có file"} → ${OUT}`);
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text);
console.log(`${C.ROUTES.length} route · ${NAMED.length} schema → ${OUT}`);
