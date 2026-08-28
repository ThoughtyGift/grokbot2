/**
 * Thẻ xin quyền có mang `action` không — đo ở đúng ranh giới app nhìn thấy.
 *
 *   node services/grokbot-backend/scripts/e2e-perm-action.mjs
 *
 * Vì sao đáng một bài riêng: thiếu trường này thì nút Allow trong app 0.29 bấm bao nhiêu lần cũng
 * ra "Your answer didn't go through. Check your connection and try again." — một câu đổ lỗi cho
 * đường truyền, trong khi lời gọi chưa bao giờ rời khỏi renderer. Renderer chuyển thẳng
 * `ask.action` xuống IPC main, và main validate nó:
 *
 *     action=undefined      → NÉM "must be local tool action, got undefined"
 *     action="run-command"  → OK
 *
 * Bài này đọc bản ghi hội thoại QUA CỔNG, tức đúng thứ app nhận, chứ không đọc chữ trong file
 * nguồn: một hằng số đúng trong mã vẫn có thể bị rơi ở tầng chuyển đổi nào đó trên đường ra.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const token = readFileSync(join(HERE, "..", ".data", "gateway-token.txt"), "utf8").trim();
const BASE = "http://127.0.0.1:8788";
const gw = (m, b = {}) => fetch(`${BASE}/gw/api/${m}`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(b),
}).then((r) => r.json());

/** Tập app chấp nhận, nguyên văn bundle 0.29. */
const HOP_LE = new Set(["run-command", "send-input", "read-file", "list-directory", "write-file"]);

const bot = (await gw("createAgent", { name: `perm-check ${new Date().toISOString().slice(11, 19)}` })).agent;
console.log(`bot: ${bot.name} (${bot.id})`);

// `/v1` là đường duy nhất bật `askWriteTools`, tức đường duy nhất còn dựng thẻ khi thiết lập
// đứng của máy đang là "always".
const r = await fetch(`${BASE}/v1/agents/${bot.id}/turns`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ content: "Tạo giúp tôi một file tên ghi-chu.txt với nội dung 'xin chao'." }),
});
if (!r.ok) { console.error(`/v1 trả ${r.status}`); process.exit(1); }

let ask = null;
for (let i = 0; i < 40 && !ask; i += 1) {
  await new Promise((s) => setTimeout(s, 3000));
  const tr = await gw("getAgentTranscript", { agentId: bot.id, id: bot.id });
  const rows = tr?.transcript ?? tr?.entries ?? (Array.isArray(tr) ? tr : []);
  const card = rows.find((e) => e?.message?.type === "local-tool-permission");
  if (card) ask = card.message.ask;
}

if (!ask) {
  console.log("\n⚠ không thẻ nào hiện sau 120s — model không gọi công cụ ghi lượt này.");
  console.log("  Chưa kết luận được gì: bài này cần một thẻ thật để đo.");
  process.exit(2);
}

console.log("\nask app nhận được:", JSON.stringify(ask));
const ok = HOP_LE.has(ask.action);
console.log(ok
  ? `\n✅ action = "${ask.action}" — nằm trong tập app chấp nhận, nút Allow gửi được.`
  : `\n❌ action = ${JSON.stringify(ask.action)} — app sẽ NÉM và thẻ hiện "didn't go through".`);
process.exit(ok ? 0 : 1);
