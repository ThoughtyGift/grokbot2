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
const roster = async () => {
  const r = await gw("listAgents", {});
  return Array.isArray(r) ? r : r.agents ?? [];
};

/**
 * Dọn đúng những bot LƯỢT NÀY sinh ra, và chỉ chúng.
 *
 * Lọc theo TÊN thì không đủ. Kịch bản b2 có case bảo bot tự lập đội, nên một lượt để lại cả
 * `LAP1-z758` lẫn *Vận Hành Đơn*, *CSKH*, *Ads & Khuyến Mãi*, *Sản Phẩm & Nội Dung*, *Báo Cáo* —
 * trùng tên y hệt bot thật của người dùng. Đo được: sau đúng một lượt, roster đi từ 6 lên 13, và
 * người dùng có hai con *CSKH* không biết con nào là của mình.
 *
 * So theo ID trước/sau thì không cần đoán tên gì cả: cái gì không có trước lượt là của lượt.
 */
const donSauLuot = async (truoc) => {
  const con = await roster();
  const moc = con.filter((a) => !truoc.has(a.id));
  for (const a of moc) await gw("deleteAgents", { id: a.id });
  console.log(`  dọn ${moc.length} bot lượt này tạo ra, giữ nguyên ${con.length - moc.length} bot có sẵn`);
};

/**
 * Chạy một lượt. Trả `{id, catCuoi}`, hoặc `null` nếu không đo được gì.
 *
 * `catCuoi` là chỗ tinh tế. `app-replay-b2.mjs` IN kết cục của case rồi MỚI kiểm hạn mức
 * (`loiCuaLuot()`), nên khi hết hạn mức giữa chừng thì case cuối cùng nó in ra chính là case đã
 * nhận bong bóng *"You've hit your limit"* — và bong bóng ấy vẫn được đếm thành "có trả lời
 * (N entry)". Giữ nó lại là đưa một câu từ chối vào phân bố như thể là hành vi của bot.
 */
const motLuot = (n) => new Promise((res) => {
  const p = spawn("node", ["services/grokbot-backend/scripts/app-replay-b2.mjs", "--bot", `LAP${n}-${Date.now().toString(36).slice(-4)}`], { shell: true });
  let out = "";
  p.stdout.on("data", (d) => { out += d; process.stdout.write(`  ${String(d).split("\n").filter(Boolean).pop() ?? ""}\r`); });
  p.stderr.on("data", (d) => { out += d; });
  p.on("close", (code) => {
    const id = (out.match(/agent-\d+/) ?? [null])[0];
    if (!id) return res({ id: null, catCuoi: false, out });
    // Mã 3 = hết hạn mức giữa chừng.
    //
    // Trước đây bỏ CẢ lượt. Đo được đêm 29/08 vì sao thế là quá tay: lượt 1 chạy được 18/23 case
    // rồi bị vứt sạch, lượt 2 và 3 chết ở case 1, và ba lượt liên tiếp như vậy thì không bao giờ
    // có phân bố. Giữ phần đo được — trừ case cuối, vì lý do ở khối chú thích trên.
    if (code === 3) {
      console.log(`\n  lượt ${n}: hết hạn mức giữa chừng — GIỮ phần đo được, bỏ case cuối`);
      return res({ id, catCuoi: true, out });
    }
    res({ id, catCuoi: false, out });
  });
});

/**
 * Nghỉ giữa hai lượt, nhưng CHỈ khi lượt vừa rồi chạm hạn mức.
 *
 * Hạn mức của pool hồi theo cửa sổ trượt chứ không khoá cả ngày — đo 29/08: 23:30 cạn, 23:57 trả
 * lời lại bình thường. Nên ba lượt chạy liền nhau thì lượt 1 đốt hết phần còn lại rồi lượt 2 và 3
 * chết ở case 1, và cái đó KHÔNG phải dữ liệu, chỉ là ba lần đâm vào cùng một bức tường.
 *
 * Chạy tốt thì không nghỉ: bức tường chưa tới thì không có gì để chờ.
 */
const NGHI_PHUT = Number((argv[argv.indexOf("--nghi") + 1] ?? "12")) || 12;
const nghi = async (n) => {
  console.log(`  nghỉ ${NGHI_PHUT} phút cho hạn mức hồi rồi mới vào lượt ${n}…`);
  await new Promise((r) => setTimeout(r, NGHI_PHUT * 60 * 1000));
};

/**
 * In ra vì sao một lượt không đo được gì.
 *
 * Bài này chỉ echo dòng stdout CUỐI của mỗi mẩu, và stderr thì nuốt hoàn toàn. Đêm 30/08 ba lượt
 * liên tiếp hiện đúng `không case nào đo được — bỏ` và không một chữ nào nói tại sao; phải chạy tay
 * `app-replay-b2.mjs` mới đọc được câu thật:
 *
 *     không mở được "LAP1-…" sau 6 lần bấm — màn hình không ghi "LAP1-…'s screen".
 *
 * (Khung máy tính bên phải bị thu lại, nên mốc xác thực biến mất và replay từ chối đo — đúng chỗ
 * nó phải từ chối.) Một bài đo im lặng khi hỏng thì lần sau lại mù y hệt.
 */
const vachLyDo = (out) => {
  const dong = String(out ?? "").split(/\r?\n/).map((l) => l.replace(/\r/g, "").trim()).filter(Boolean);
  if (!dong.length) { console.log("     (tiến trình không in ra gì)"); return; }
  console.log("     ── replay nói ──");
  for (const l of dong.slice(-8)) console.log(`     ${l.slice(0, 160)}`);
};

const dem = [];
let vuaChamHan = false;
for (let n = 1; n <= LAN; n += 1) {
  if (vuaChamHan) await nghi(n);
  console.log(`\n── lượt ${n}/${LAN} ──`);
  // Chụp roster TRƯỚC, dọn SAU. Dọn trước thì không biết cái gì là của lượt này, mà dọn sau khi
  // đọc transcript cũng bắt buộc: bot thử nằm trong đám sắp xoá.
  const truoc = new Set((await roster()).map((a) => a.id));
  const luot = await motLuot(n);
  vuaChamHan = luot.catCuoi === true;
  let co = [];
  if (luot.id) {
    const t = await gw("getAgentTranscript", { agentId: luot.id, id: luot.id });
    const rows = t?.transcript ?? t?.entries ?? (Array.isArray(t) ? t : []);
    const moc = [];
    rows.forEach((e, i) => { if (e.kind === "message" && e.role === "user" && !e.fromAgent && e.clientNonce) moc.push(i); });
    co = moc.map((st, k) => rows.slice(st + 1, moc[k + 1] ?? rows.length).some((e) => e?.message?.type === "widget"));
    if (luot.catCuoi) co.pop();
  }
  if (co.length) {
    dem.push(co);
    console.log(`\n  lượt ${n}: ${co.length}/${cases.length} case đo được${luot.catCuoi ? " (đã bỏ case cuối)" : ""}`);
  } else {
    console.log(`\n  lượt ${n}: không case nào đo được — bỏ`);
    vachLyDo(luot.out);
  }
  // Chạy cả khi lượt bị bỏ: một lượt hết hạn mức vẫn kịp tạo bot, và bỏ qua dọn ở đúng nhánh đó là
  // cách roster lặng lẽ phình ra sau mỗi lần chạy hỏng.
  await donSauLuot(truoc);
}

if (dem.length < 2) { console.log("\nchưa đủ hai lượt có dữ liệu — không gộp được phân bố"); process.exit(2); }

/*
 * Mẫu số theo TỪNG CASE, không phải theo số lượt.
 *
 * Lượt dở chỉ đo tới case k. Nếu vẫn chia cho tổng số lượt thì các case sau k bị tính là "không có
 * widget" ở lượt ấy — nhưng chúng có được ĐO đâu; chúng vắng mặt. Nhầm "vắng mặt" thành "không" là
 * cách một case đúng bị đọc thành "ổn định THIẾU" rồi ai đó đi sửa một thứ không hỏng.
 */
console.log(`\n\n### Phân bố qua ${dem.length} lượt (${dem.map((d) => d.length).join(", ")} case)\n`);
console.log("| case | app gốc mời chọn | ta mời chọn | đọc là |");
console.log("|---|---|---|---|");
let onDinhSai = 0;
let thieuDuLieu = 0;
cases.forEach((c, i) => {
  const doDuoc = dem.filter((d) => i < d.length);
  const want = mongWidget[i];
  if (doDuoc.length < 2) {
    thieuDuLieu += 1;
    console.log(`| ${i + 1} | ${want ? "có" : "không"} | ${doDuoc.length} lượt đo | CHƯA ĐỦ DỮ LIỆU |`);
    return;
  }
  const co = doDuoc.filter((d) => d[i]).length;
  const ondinh = co === 0 || co === doDuoc.length;
  const doc = !ondinh ? "DAO ĐỘNG — một lượt không kết luận được"
    : want && co === 0 ? "ổn định THIẾU"
    : !want && co === doDuoc.length ? "ổn định THỪA"
    : "ổn định đúng";
  if (ondinh && doc.startsWith("ổn định T")) onDinhSai += 1;
  console.log(`| ${i + 1} | ${want ? "có" : "không"} | ${co}/${doDuoc.length} | ${doc} |`);
});
console.log(`\nlệch ỔN ĐỊNH (đáng sửa): ${onDinhSai} case · phần còn lại là nhiễu hoặc đã đúng`);
if (thieuDuLieu) {
  console.log(`chưa đủ dữ liệu: ${thieuDuLieu} case — dưới hai lượt thì không phân biệt được ổn định với dao động`);
}
