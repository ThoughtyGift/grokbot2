/**
 * Đặt câu trả lời app gốc cạnh câu trả lời của ta, từng case một.
 *
 *   node services/grokbot-backend/scripts/doi-chieu-noi-dung.mjs <agentId> [từ] [đến]
 *
 * Khác `parity-b2.mjs` ở chỗ nó so LOẠI đầu ra (text/widget/attachment); bài này so NỘI DUNG.
 * Không chấm điểm tự động: hai câu trả lời khác nhau về chữ vẫn có thể cùng đúng, và một hàm đo
 * độ giống chuỗi sẽ cho một con số trông như tri thức mà không phải. Việc của script là bày ra
 * cạnh nhau; việc đánh giá là của người đọc.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const agentId = process.argv[2];
if (!agentId) { console.error("cần <agentId>"); process.exit(1); }
const tu = Number(process.argv[3] ?? 1), den = Number(process.argv[4] ?? 99);
const HERE = dirname(fileURLToPath(import.meta.url));
const token = readFileSync(join(HERE, "..", ".data", "gateway-token.txt"), "utf8").trim();
const gw = (m, b = {}) => fetch(`http://127.0.0.1:8788/gw/api/${m}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(b),
}).then((r) => r.json());

const t = await gw("getAgentTranscript", { agentId, id: agentId });
const rows = t?.transcript ?? t?.entries ?? (Array.isArray(t) ? t : []);
const cases = JSON.parse(readFileSync("docs/extracted/kich-ban-b2.json", "utf8"))
  .scenarios.find((s) => s.bot === "Test Clone").cases.filter((c) => String(c.input ?? "").trim());

const moc = [];
/*
 * Mốc case phải giống HỆT `parity-b2.mjs`: tin người dùng GÕ VÀO KHUNG SOẠN.
 *
 * Đáp án widget (`respondToWidget`) và tin đến từ bot khác (`fromAgent`) cũng là entry `role:"user"`.
 * Tôi đã sửa điều này trong `parity-b2.mjs` rồi QUÊN file anh em — nên từ case đầu tiên có widget
 * trở đi, bảng này ghép câu trả lời của ta với câu hỏi KẾ TIẾP của kịch bản.
 *
 * Hậu quả không nhỏ: tôi đã đánh giá case 7 là "ngang app gốc" dựa trên một cặp lệch bậc, trong
 * khi thật ra bot trả lời đúng câu được hỏi. Hai script đọc cùng một bản ghi thì phải cắt cùng một
 * cách, nếu không cái thứ hai sẽ âm thầm bác kết luận của cái thứ nhất.
 */
rows.forEach((e, i) => { if (e.kind === "message" && e.role === "user" && !e.fromAgent && e.clientNonce) moc.push(i); });
const goi = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

moc.forEach((st, n) => {
  if (n + 1 < tu || n + 1 > den) return;
  const seg = rows.slice(st + 1, moc[n + 1] ?? rows.length);
  const c = cases[n];
  console.log(`\n${"═".repeat(78)}\n### CASE ${n + 1} ⟵ ${goi(c?.input, 120)}\n`);
  console.log("── APP GỐC ──");
  (c?.expected ?? []).forEach((e) => {
    if (e.kind === "text") console.log(`  ${goi(e.text, 260)}`);
    else console.log(`  [${e.kind}]${e.responded ? ` → chọn "${e.responded}"` : ""}`);
  });
  console.log("\n── APP LOCAL ──");
  seg.forEach((e) => {
    if (e.kind === "tool-call") console.log(`  ‹tool ${e.name}›`);
    else if (e.message?.type === "text") console.log(`  ${goi(e.message.content, 260)}`);
    else if (e.message) console.log(`  [${e.message.type}]`);
  });
});
