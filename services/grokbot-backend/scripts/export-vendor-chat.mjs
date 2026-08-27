/**
 * Xuất lịch sử chat của APP GỐC (vendor 0.29) thành một file Markdown — tài liệu B2 của kế hoạch 7.4.x.
 *
 * Nguồn: %APPDATA%/Grok Bot/sand-client-persistence — kho cache phía client, file `.blob` với tên
 * mã hoá base32 của khoá slice. Hai loại slice đáng giá:
 *
 *   - `...roster.last-roster`            — danh sách bot, KÈM description từng bot (chính là "system
 *                                          prompt" mà bot mẹ viết khi tự tạo bot con — tính năng 1)
 *   - `...transcript.replicas.<agentId>` — bản sao transcript gần nhất của từng bot/nhóm
 *
 * Lưu ý ranh giới: đây là CACHE — bản ghi đầy đủ nằm trong `store.db` trên box của hãng
 * (`/home/box/sand-data/agents/<id>/store.db`), ngoài tầm với. Cache giữ đúng phần client đã tải,
 * và thực đo là đủ dài để tái hiện kịch bản E2E.
 *
 *   node services/grokbot-backend/scripts/export-vendor-chat.mjs [--out <file.md>] [--dir <persistence>]
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const SRC = argOf("--dir", join(process.env.APPDATA ?? "", "Grok Bot", "sand-client-persistence"));
const OUT = argOf("--out", join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..", "..", "docs", "extracted", "chat-goc-0.29.md"));

// Tên file dài hơn MAX_PATH của Windows — mọi đường dẫn vào fs phải mang tiền tố \?\.
const PREFIX = String.fromCharCode(92, 92, 63, 92); // \\?\
const long = (p) => (process.platform === "win32" && !p.startsWith(PREFIX) ? PREFIX + p.replace(/\//g, String.fromCharCode(92)) : p);

/** Giải mã tên blob: base32 (RFC 4648, chữ thường, bỏ đệm) → khoá slice. */
function decodeName(stem) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0, acc = 0;
  const bytes = [];
  for (const ch of stem) {
    const v = alphabet.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 5) | v; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
  }
  return Buffer.from(bytes).toString("utf8");
}

const ts = (ms) => (typeof ms === "number" ? new Date(ms).toISOString().replace("T", " ").slice(0, 19) : "");

/** Một entry transcript → các dòng Markdown. Phòng thủ: shape lạ thì in JSON thô thay vì im lặng bỏ. */
function renderEntry(e, nameOf) {
  const who = (id) => (id ? nameOf(id) ?? id : null);
  if (e.kind === "message") {
    const author = who(e.authorId ?? e.author) ?? "NGƯỜI DÙNG";
    return [`**⟵ ${author}** · ${ts(e.timestampMs)}`, "", quote(e.content ?? ""), ""];
  }
  if (e.kind === "send-message") {
    const author = e.author?.name ?? who(e.author?.id ?? e.authorId) ?? "BOT";
    const m = e.message ?? {};
    if (m.type === "text" || m.content != null) return [`**⟶ ${author}** · ${ts(e.timestampMs)}`, "", quote(m.content ?? ""), ""];
    return [`**⟶ ${author}** · ${ts(e.timestampMs)}`, "", "```json", JSON.stringify(m, null, 1), "```", ""];
  }
  if (e.kind === "tool-call") {
    return [`- 🔧 \`${e.name ?? "?"}\` — ${e.summary ?? ""} _(${e.status ?? "?"})_`, ""];
  }
  if (e.kind === "event") {
    return [`- ⚙️ ${JSON.stringify(e.event ?? e, null, 0).slice(0, 400)}`, ""];
  }
  return ["```json", JSON.stringify(e, null, 1).slice(0, 1200), "```", ""];
}

const quote = (s) => String(s).split("\n").map((l) => `> ${l}`).join("\n");

// ── Đọc kho ────────────────────────────────────────────────────────────────────────────────────
const slices = new Map();
for (const f of readdirSync(long(SRC))) {
  if (!f.endsWith(".blob")) continue;
  const key = decodeName(f.slice(0, -5));
  if (!key) continue;
  try { slices.set(key, JSON.parse(readFileSync(long(join(SRC, f)), "utf8"))); }
  catch (e) { console.warn(`bỏ qua ${key}: ${e.message}`); }
}

const rosterKey = [...slices.keys()].find((k) => k.endsWith(".roster.last-roster"));
const roster = rosterKey ? (slices.get(rosterKey).value?.rows ?? []) : [];
const nameOf = (id) => roster.find((r) => r.id === id)?.name;

const lines = [];
lines.push("# Lịch sử chat app gốc 0.29 — xuất từ cache client (B2)");
lines.push("");
lines.push(`> Xuất lúc ${ts(Date.now())} bằng \`export-vendor-chat.mjs\` từ \`${SRC}\`.`);
lines.push("> Đây là **cache phía client** — bản đầy đủ nằm trong `store.db` trên box của hãng, ngoài tầm với.");
lines.push("");

// ── Roster: tên + DESCRIPTION — nguyên liệu chính của tính năng 1 ──────────────────────────────
lines.push("## Dàn bot và description (bot mẹ tự viết khi tạo bot con)");
lines.push("");
for (const r of roster) {
  const flag = r.isGroup || (r.memberIds?.length ?? 0) > 0 ? ` — **NHÓM** (${(r.memberIds ?? []).map((id) => nameOf(id) ?? id).join(", ")})` : "";
  lines.push(`### ${r.name}${flag}`);
  lines.push("");
  lines.push(`- id: \`${r.id}\` · tạo: ${ts(r.createdAt)} · sửa: ${ts(r.updatedAt)}`);
  if (r.title) lines.push(`- title: ${r.title}`);
  if (r.description) { lines.push("- description:"); lines.push(""); lines.push(quote(r.description)); }
  lines.push("");
}

// ── Transcript từng bot ─────────────────────────────────────────────────────────────────────────
for (const [key, data] of slices) {
  const m = key.match(/\.transcript\.replicas\.([0-9a-f-]+)$/);
  if (!m) continue;
  const id = m[1];
  const entries = data.value?.entries ?? [];
  lines.push(`## Transcript — ${nameOf(id) ?? "?"} (\`${id}\`, ${entries.length} entry)`);
  lines.push("");
  for (const e of entries) lines.push(...renderEntry(e, nameOf));
  lines.push("");
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`đã ghi ${OUT} — ${roster.length} bot, ${[...slices.keys()].filter((k) => k.includes(".transcript.")).length} transcript, ${lines.length} dòng`);


/*
 * ── Kịch bản E2E (yêu cầu B2): cặp input → expected, máy đọc được ──────────────────────────────
 *
 * Bản .md ở trên là cho NGƯỜI đọc; để chạy lại trên app mình cần cấu trúc: mỗi tin người dùng gõ
 * vào app gốc + toàn bộ những gì bot gốc trả ra sau đó (text, widget, thẻ xin quyền, file đính,
 * tin nhắn sang bot khác) cho tới tin người dùng kế tiếp. e2e-replay-b2.mjs ăn file này.
 */
const scenarios = [];
for (const [key, data] of slices) {
  const m = key.match(/[.]transcript[.]replicas[.]([0-9a-f-]+)$/);
  if (!m) continue;
  const id = m[1];
  const bot = roster.find((r) => r.id === id);
  const entries = data.value?.entries ?? [];
  const cases = [];
  let cur = null;
  for (const e of entries) {
    if (e.kind === "message" && e.role === "user" && !e.fromAgent) {
      cur = { input: e.content ?? "", atMs: e.timestampMs ?? null, expected: [] };
      cases.push(cur);
      continue;
    }
    if (!cur) continue;
    if (e.kind === "message" && e.role === "assistant" && e.toAgent) {
      cur.expected.push({ kind: "message_agent", to: e.toAgent.name, text: e.content ?? "" });
    } else if (e.kind === "message" && e.role === "user" && e.fromAgent) {
      cur.expected.push({ kind: "from_agent", from: e.fromAgent.name, text: e.content ?? "" });
    } else if (e.kind === "send-message") {
      const msg = e.message ?? {};
      if (msg.type === "text" && (msg.content ?? "").trim()) {
        cur.expected.push({ kind: "text", author: e.author?.name ?? null, text: msg.content });
      } else if (msg.type === "widget") {
        cur.expected.push({ kind: "widget", prompt: msg.widget?.prompt ?? "", options: (msg.widget?.options ?? []).map((o) => o.label), responded: e.respondedValue ?? null });
      } else if (msg.type === "attachment") {
        cur.expected.push({ kind: "attachment", fileName: msg.file_name ?? "" });
      } else if (msg.type === "local-tool-permission") {
        cur.expected.push({ kind: "permission", action: msg.ask?.action ?? "", target: String(msg.ask?.target ?? "").slice(0, 200) });
      }
    }
  }
  scenarios.push({
    botId: id,
    bot: bot?.name ?? id,
    description: bot?.description ?? "",
    isGroup: bot?.isGroup === true || (bot?.memberIds?.length ?? 0) > 0,
    memberNames: (bot?.memberIds ?? []).map((x) => nameOf(x) ?? x),
    cases,
  });
}
const SCEN = join(dirname(OUT), "kich-ban-b2.json");
writeFileSync(SCEN, JSON.stringify({ exportedAt: Date.now(), source: SRC, scenarios }, null, 1), "utf8");
console.log(`đã ghi ${SCEN} — ${scenarios.reduce((n, sc) => n + sc.cases.length, 0)} cặp input/expected trên ${scenarios.length} bot`);
