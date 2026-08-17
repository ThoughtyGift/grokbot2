/**
 * Pair the ORIGINAL "Thư ký" transcript with our replay of the same inputs, turn for turn.
 *
 * Both sides come from a stored replica of the same protocol — the original's from
 * `.data/profile-real`, ours from the gateway — so the comparison is data against data rather than a
 * screenshot against an impression.
 *
 * Emits `docs/parity-thuky.md`: the surface table first (what the original renders that we never
 * emit), then every turn side by side.
 */
import fs from "node:fs";

const SCRATCH = "C:/Users/admin/AppData/Local/Temp/claude/c--Users-admin-Desktop-grokbot2/eaada360-f857-4797-9134-91fa41755587/scratchpad";
const orig = JSON.parse(fs.readFileSync(`${SCRATCH}/thuky-raw.json`, "utf8")).entries;
const mine = JSON.parse(fs.readFileSync(`${SCRATCH}/replay-local.json`, "utf8"));

/** Group the original into turns: each user `message` plus everything the bot produced after it. */
const turns = [];
let current = null;
for (const e of orig) {
  if (e.kind === "message") {
    current = { input: String(e.message?.content ?? e.content ?? ""), out: [] };
    turns.push(current);
    continue;
  }
  if (current) current.out.push(e);
}

const surfaces = (list) => {
  const seen = {};
  for (const e of list) {
    const k = e.kind === "event" ? `event/${e.event?.type ?? "?"}` : `${e.kind}/${e.message?.type ?? "-"}`;
    seen[k] = (seen[k] ?? 0) + 1;
  }
  return seen;
};
const origSurfaces = surfaces(orig);
const mySurfaces = {};
for (const t of mine) for (const k of t.kinds ?? []) mySurfaces[k] = (mySurfaces[k] ?? 0) + 1;

const text = (e) => String(e.message?.content ?? "").trim();
const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n)}…`);
const cell = (s) => clip(String(s ?? "").replace(/\s*\n+\s*/g, " ⏎ "), 300).replace(/\|/g, "\\|");

const L = [];
L.push("# Đối chiếu bot “Thư ký”: bản gốc vs bản local\n");
L.push("Sinh bằng `node services/grokbot-backend/scripts/compare-original.mjs`.\n");
L.push(
  "**Nguồn dữ liệu — cả hai bên đều là dữ liệu thật, không phải ảnh chụp.** Bản gốc lấy từ replica " +
  "mà chính client của nó lưu (`.data/profile-real/sand-client-persistence`, đúng giao thức " +
  "ordered-replica mà backend này emulate), giải mã từ tên file base32. Bản local lấy từ gateway sau " +
  "khi phát lại **cùng những câu input đó**, tuần tự, trong một bot duy nhất — hội thoại có trạng " +
  "thái, lượt 19 nhắc tới bot mà lượt 18 vừa tạo.\n",
);
L.push(`- Bản gốc: **${orig.length} entry**, **${turns.length} lượt người dùng**`);
L.push(`- Bản local: **${mine.length} lượt** đã phát lại\n`);

/**
 * Surfaces this backend CAN emit, verified directly rather than inferred from a run.
 *
 * A zero in the local column has two completely different meanings — "we cannot produce this" and
 * "this run never asked for it" — and collapsing them produced a table that reported three surfaces
 * as missing on the same evening they were implemented and tested. The agent renames itself and
 * creates routines only when it decides to, so a replay cannot be relied on to exercise them.
 */
const IMPLEMENTED = {
  "event/name-changed": "đã cài — kiểm riêng: Inbox Triage → Điều phối → Thư ký",
  "event/automation-changed": "đã cài — kiểm riêng: created rồi updated",
  "send-message/listener-connect": 'đã cài — kiểm riêng: {platform:"slack"}',
};

const blanks = mine.filter((r) => r.blank).length;
if (blanks) {
  L.push(
    `> ⚠️ **${blanks}/${mine.length} lượt của bản local không ghi được gì** và đã bị loại khỏi bảng dưới. ` +
    "Một lượt trống là lỗ hổng của phép đo, không phải bằng chứng thiếu bề mặt.\n",
  );
}

L.push("## 1. Bề mặt: bản gốc vẽ được gì mà ta chưa phát ra\n");
L.push("| Loại entry | Bản gốc | Bản local | Tình trạng |");
L.push("|---|---:|---:|---|");
const allKinds = [...new Set([...Object.keys(origSurfaces), ...Object.keys(mySurfaces)])].sort();
for (const k of allKinds) {
  const o = origSurfaces[k] ?? 0;
  const m = mySurfaces[k] ?? 0;
  const verdict = !o && m ? "chỉ ta có"
    : o && m ? "có cả hai"
    : o && !m ? (IMPLEMENTED[k] ? `lượt này không chạm tới — ${IMPLEMENTED[k]}` : "**THIẾU**")
    : "—";
  L.push(`| \`${k}\` | ${o} | ${m} | ${verdict} |`);
}
const reallyMissing = allKinds.filter((k) => (origSurfaces[k] ?? 0) && !(mySurfaces[k] ?? 0) && !IMPLEMENTED[k]);
L.push(`\n**Thiếu thật: ${reallyMissing.length}** — ${reallyMissing.map((k) => `\`${k}\``).join(", ") || "không còn"}.`);

L.push("\n## 2. Từng lượt, đặt cạnh nhau\n");
for (const [i, t] of mine.entries()) {
  const o = turns[i];
  L.push(`### Lượt ${t.n}\n`);
  L.push(`**Input:** ${cell(t.input)}\n`);
  L.push("| | Bản gốc | Bản local |");
  L.push("|---|---|---|");
  const oText = (o?.out ?? []).filter((e) => e.kind === "send-message" && e.message?.type === "text").map(text).join(" ⏎ ");
  L.push(`| Trả lời | ${cell(oText) || "_(không có)_"} | ${cell(t.reply) || "_(không có)_"} |`);
  const oKinds = Object.keys(surfaces(o?.out ?? [])).join(", ");
  L.push(`| Bề mặt | ${oKinds || "—"} | ${(t.kinds ?? []).join(", ") || "—"} |`);
  L.push(`| Công cụ | _(bản gốc không lưu tool-call trong replica)_ | ${t.tools?.length ? t.tools.join(", ") : "không"} |`);
  L.push(`| Thời gian | — | ${Math.round(t.ms / 100) / 10}s |`);
  L.push("");
}

const dest = "c:/Users/admin/Desktop/grokbot2/docs/parity-thuky.md";
fs.writeFileSync(dest, L.join("\n"));
console.log(`-> ${dest}  (${L.length} dong)`);
console.log(`\nbe mat CHI BAN GOC co: ${allKinds.filter((k) => (origSurfaces[k] ?? 0) && !(mySurfaces[k] ?? 0)).join(", ") || "khong con"}`);
