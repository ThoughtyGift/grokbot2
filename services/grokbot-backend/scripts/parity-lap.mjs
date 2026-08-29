/**
 * Chạy E2E N lượt cùng cấu hình rồi gộp — thay vì một lượt một kết luận.
 *
 *   node services/grokbot-backend/scripts/parity-lap.mjs [--lan 3]
 *
 * ── Vì sao cần ──────────────────────────────────────────────────────────────────────────────────
 *
 * Đêm 28–29/08 tôi đổi lời nhắc ba lần và mỗi lần kết luận từ MỘT lượt. Rồi hai lượt cùng cấu hình
 * cho kết quả khác nhau: case 1 và 4 đổi chiều, và case 6 — ca tôi lấy làm bằng chứng "luật mới
 * chữa đúng bệnh" — có widget ở lượt này, không có ở lượt kia. Nhiễu đủ lớn để nuốt mọi khác biệt
 * vài case mà tôi đã báo cáo như thể là tín hiệu.
 *
 * Nên bài này không in ra một con số. Nó in ra, cho TỪNG case, số lượt widget xuất hiện — để phân
 * biệt cái ỔN ĐỊNH (0/3 hoặc 3/3) với cái DAO ĐỘNG (1/3, 2/3). Chỉ nhóm ổn định mới đáng đem đi
 * sửa; nhóm dao động thì một lượt không nói lên gì, và hai lượt cũng vậy.
 *
 * Không tự đổi lời nhắc, không tự đổi model: bài này chỉ đo. Đổi biến là việc của người đọc, và
 * phải đổi MỘT thứ giữa hai lần gọi thì con số mới quy được trách nhiệm.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const LAN = Number((argv[argv.indexOf("--lan") + 1] ?? "3")) || 3;
const HERE = dirname(fileURLToPath(import.meta.url));
const token = readFileSync(join(HERE, "..", ".data", "gateway-token.txt"), "utf8").trim();
const gw = (m, b = {}) => fetch(`http://127.0.0.1:8788/gw/api/${m}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(b),
}).then((r) => r.json());

const cases = JSON.parse(readFileSync("docs/extracted/kich-ban-b2.json", "utf8"))
  .scenarios.find((s) => s.bot === "Test Clone").cases.filter((c) => String(c.input ?? "").trim());
const mongWidget = cases.map((c) => (c.expected ?? []).some((e) => e.kind === "widget"));

/**
 * Dọn bot do CHÍNH bài này tạo ra, và chỉ chúng.
 *
 * Bản trước xoá sạch mọi bot. Nó viết ra hôm roster chỉ có bot thử, và hôm đó đúng — nhưng nó là
 * một quả mìn: chạy lại vào ngày người ta đã có việc thật trên máy thì mất cả *CSKH*, *Vận Hành
 * Đơn*, *Ads & Khuyến Mãi*. Một bài ĐO không được có quyền xoá thứ nó không tạo ra.
 *
 * Roster còn bot khác thì thanh bên dài hơn, nhưng phép đo không hỏng: `app-replay-b2.mjs` kiểm
 * "<BOT>'s screen" trước từng case và DỪNG nếu mở nhầm bot — nên rủi ro ở đây là dừng ồn ào, chứ
 * không phải đo nhầm im lặng.
 */
const donDep = async () => {
  const r = await gw("listAgents", {});
  const all = Array.isArray(r) ? r : r.agents ?? [];
  const cuaBai = all.filter((a) => /^LAP\d+-/.test(String(a.name ?? "")));
  for (const a of cuaBai) await gw("deleteAgents", { id: a.id });
  const giuLai = all.length - cuaBai.length;
  console.log(`  dọn ${cuaBai.length} bot của bài này, giữ nguyên ${giuLai} bot khác`);
};

/** Chạy một lượt, trả về id bot thử (hoặc null nếu lượt không có giá trị đo). */
const motLuot = (n) => new Promise((res) => {
  const p = spawn("node", ["services/grokbot-backend/scripts/app-replay-b2.mjs", "--bot", `LAP${n}-${Date.now().toString(36).slice(-4)}`], { shell: true });
  let out = "";
  p.stdout.on("data", (d) => { out += d; process.stdout.write(`  ${String(d).split("\n").filter(Boolean).pop() ?? ""}\r`); });
  p.stderr.on("data", (d) => { out += d; });
  p.on("close", (code) => {
    // Mã 3 = model không chạy (hết hạn mức). Lượt đó KHÔNG được gộp vào phân bố — gộp một lượt
    // toàn bong bóng từ chối là tự pha loãng dữ liệu bằng thứ không phải dữ liệu.
    if (code === 3) { console.log(`\n  lượt ${n}: model không chạy — BỎ, không gộp`); return res(null); }
    res((out.match(/agent-\d+/) ?? [null])[0]);
  });
});

const dem = [];
for (let n = 1; n <= LAN; n += 1) {
  console.log(`\n── lượt ${n}/${LAN} ──`);
  await donDep();
  const id = await motLuot(n);
  if (!id) continue;
  const t = await gw("getAgentTranscript", { agentId: id, id });
  const rows = t?.transcript ?? t?.entries ?? (Array.isArray(t) ? t : []);
  const moc = [];
  rows.forEach((e, i) => { if (e.kind === "message" && e.role === "user" && !e.fromAgent && e.clientNonce) moc.push(i); });
  dem.push(moc.map((st, k) => rows.slice(st + 1, moc[k + 1] ?? rows.length).some((e) => e?.message?.type === "widget")));
  console.log(`\n  lượt ${n}: ${moc.length} case đo được`);
}

if (dem.length < 2) { console.log("\nchưa đủ hai lượt hợp lệ — không gộp được phân bố"); process.exit(2); }
console.log(`\n\n### Phân bố qua ${dem.length} lượt hợp lệ\n`);
console.log("| case | app gốc mời chọn | ta mời chọn (số lượt) | đọc là |");
console.log("|---|---|---|---|");
let onDinhSai = 0;
cases.forEach((c, i) => {
  const co = dem.filter((d) => d[i]).length;
  const want = mongWidget[i];
  const ondinh = co === 0 || co === dem.length;
  const doc = !ondinh ? "DAO ĐỘNG — một lượt không kết luận được"
    : want && co === 0 ? "ổn định THIẾU"
    : !want && co === dem.length ? "ổn định THỪA"
    : "ổn định đúng";
  if (ondinh && doc.startsWith("ổn định T")) onDinhSai += 1;
  console.log(`| ${i + 1} | ${want ? "có" : "không"} | ${co}/${dem.length} | ${doc} |`);
});
console.log(`\nlệch ỔN ĐỊNH (đáng sửa): ${onDinhSai} case · phần còn lại là nhiễu hoặc đã đúng`);
