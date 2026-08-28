/**
 * Đối chiếu một lượt chạy với kịch bản B2 của app gốc — đọc từ BẢN GHI, không từ màn hình.
 *
 *   node services/grokbot-backend/scripts/parity-b2.mjs <agentId>
 *
 * Vì sao đọc bản ghi: mọi phép đo qua giao diện hôm nay đều sai ít nhất một lần (độ dài chuỗi,
 * toạ độ cú bấm, số entry). Bản ghi là thứ duy nhất backend thật sự giữ.
 *
 * Cột "khớp loại" chỉ so LOẠI đầu ra (text/widget/attachment), không so nội dung: kịch bản sinh
 * từ một model khác, trên một catalog khác, nên đòi trùng chữ là đòi một thứ không tồn tại.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const agentId = process.argv[2];
if (!agentId) { console.error("cần <agentId>"); process.exit(1); }
const HERE = dirname(fileURLToPath(import.meta.url));
const token = readFileSync(join(HERE, "..", ".data", "gateway-token.txt"), "utf8").trim();
const gw = (m, b = {}) => fetch(`http://127.0.0.1:8788/gw/api/${m}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(b),
}).then((r) => r.json());

const tr = await gw("getAgentTranscript", { agentId, id: agentId });
const rows = tr?.transcript ?? tr?.entries ?? (Array.isArray(tr) ? tr : []);
const cases = JSON.parse(readFileSync("docs/extracted/kich-ban-b2.json", "utf8"))
  .scenarios.find((s) => s.bot === "Test Clone").cases.filter((c) => String(c.input ?? "").trim());

const moc = [];
/*
 * Mốc case = tin người dùng GÕ VÀO KHUNG SOẠN, và có hai thứ giả dạng nó.
 *
 * `sendPrompt` ghi tin đến từ bot khác thành entry `role:"user"` kèm `fromAgent` — đó là cách nó
 * vào lịch sử model. Và `respondToWidget` ghi lựa chọn người dùng bấm cũng thành `role:"user"`.
 * Cả hai đều đúng về mặt dữ liệu, cả hai đều KHÔNG phải một case mới.
 *
 * Đo được ở lượt Opus 00:06: bảng ra 24 dòng cho 23 case. Kẻ thứ 24 là "Dựng sẵn cấu hình OBS để
 * mình livestream Shopee" — đáp án widget của case 12. Không loại ra thì mọi case sau nó lệch một
 * bậc, và bảng đối chiếu so nhầm câu trả lời của ta với câu hỏi kế tiếp của kịch bản.
 *
 * `clientNonce` là dấu phân biệt: app đặt nó cho mỗi lần gửi từ khung soạn tin, và chỉ ở đó.
 */
rows.forEach((e, i) => { if (e.kind === "message" && e.role === "user" && !e.fromAgent && e.clientNonce) moc.push(i); });
const dem = (xs) => { const c = {}; for (const k of xs) c[k] = (c[k] ?? 0) + 1; return c; };
const ve = (c) => Object.entries(c).map(([k, v]) => (v > 1 ? `${k}×${v}` : k)).join(" ") || "—";

console.log("| # | KỊCH BẢN app gốc | LƯỢT NÀY | khớp loại |");
console.log("|---|---|---|---|");
let khop = 0, thieuW = 0, thuaW = 0, thieuA = 0, im = 0;
moc.forEach((st, n) => {
  const seg = rows.slice(st + 1, moc[n + 1] ?? rows.length);
  const got = dem(seg.map((e) => (e.kind === "tool-call" ? "tool" : e.message?.type ?? e.kind)));
  const mong = dem((cases[n]?.expected ?? []).map((e) => e.kind));
  const wantW = !!mong.widget, wantA = !!mong.attachment;
  /*
   * Đếm CẢ HAI chiều.
   *
   * Bản đầu chỉ phạt khi THIẾU widget. Sau khi sửa ASK_PROTOCOL, số widget nhảy từ 2 lên 6 trong
   * tám case đầu — nhưng một thước đo một chiều sẽ khen luôn cả trường hợp bot mời chọn ở nơi app
   * gốc trả lời thẳng. "Mời chọn mọi lúc" sai ngang "không bao giờ mời chọn", chỉ khác là thước đo
   * cũ không nhìn thấy — một chỉ số chỉ nhìn một phía sẽ khen bản vá của chính người viết ra nó.
   */
  if (wantW && !got.widget) thieuW += 1;
  if (!wantW && got.widget) thuaW += 1;
  if (wantA && !got.attachment) thieuA += 1;
  if (!got.text) im += 1;
  /*
   * Thừa cũng là LỆCH.
   *
   * Bản trước để cột ✓ đúng khi có widget thừa, chỉ ghi chú bên cạnh — nên sau khi tôi sửa
   * ASK_PROTOCOL, bảng báo 20/23 trong khi tính nghiêm chỉ là 14/23, tức TỆ hơn 15/23 trước đó.
   * Một thước đo do chính người viết bản vá chọn mà chỉ phạt một chiều thì nó không đo bản vá, nó
   * khen bản vá.
   */
  const ok = !!got.text && (!wantW || got.widget) && (wantW || !got.widget) && (!wantA || got.attachment);
  if (ok) khop += 1;
  const ghi = [ok ? "✓" : "", !wantW && got.widget ? "widget THỪA" : "", wantW && !got.widget ? "thiếu widget" : "", wantA && !got.attachment ? "thiếu attachment" : "", !got.text ? "IM" : ""].filter(Boolean).join(", ");
  console.log(`| ${n + 1} | ${ve(mong)} | ${ve(got)} | ${ghi} |`);
});
console.log(`\nkhớp loại ${khop}/${moc.length} · widget thiếu ${thieuW} / THỪA ${thuaW} · attachment thiếu ${thieuA} · im ${im}`);

// Hai câu hỏi riêng của hôm nay, hỏi thẳng roster chứ không suy từ bản ghi.
const ros = await gw("listAgents", {});
const all = Array.isArray(ros) ? ros : (ros.agents ?? []);
const groups = all.filter((a) => a.isGroup);
const canh = all.filter((a) => (a.conversationPartnerIds ?? []).length);
console.log(`\nbot dựng ra: ${all.length}`);
console.log(`group: ${groups.length ? groups.map((g) => `${g.name} (${(g.memberIds ?? []).length} tv)`).join(", ") : "KHÔNG CÓ"}`);
console.log(`cạnh bot-nhắn-bot: ${canh.length ? canh.map((a) => a.name).join(", ") : "không con nào"}`);
