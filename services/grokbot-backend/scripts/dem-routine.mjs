/**
 * Bot dựng xong một ĐỘI thì có tạo routine cho từng con không? — đếm, đừng đoán.
 *
 *   node services/grokbot-backend/scripts/dem-routine.mjs
 *
 * ── Vì sao có bài này ───────────────────────────────────────────────────────────────────────────
 *
 * 28/08 người dùng gửi hai ảnh: bên app gốc, mỗi bot trong đội Shopee đều có routine riêng —
 *
 *     Shopee Kho      "Hàng chờ lấy"          0 8,12,17,22 * * *
 *     Shopee Kế toán  "Nhật ký P và L tuần"   thứ Hai 9:30
 *     Shopee Ads      "Check ads sáng"        (Paused)
 *
 * — còn đội bot ta dựng ra thì trống trơn. Tôi đã vá bằng LỜI NHẮC: `tools.ts` nay dạy hẳn định
 * dạng cron và câu "một bot có mô tả mà không có nhịp thì chỉ chạy khi bị hỏi".
 *
 * Nhưng vá lời nhắc rồi tin là xong thì đúng vào cái bẫy đã sập bốn lần trên repo này. `parity-lap`
 * không giúp được: nó chỉ đếm widget và text, không nhìn vào bảng routine. Nên cần một phép đo
 * riêng, và phép đo đó phải trả lời đúng một câu: **sau lượt dựng đội, có bao nhiêu routine?**
 *
 * ── Cách đo ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Ghi roster TRƯỚC, chạy một lượt dựng đội, ghi roster SAU. Bot mới = hiệu hai tập id — không lọc
 * theo tên, vì kịch bản này sinh ra *CSKH*, *Vận Hành Đơn*… trùng tên bot thật của người dùng, và
 * `parity-lap.mjs` đã phải học bài đó bằng một lần suýt xoá sạch việc thật.
 *
 * Dọn cũng theo đúng tập id ấy, và chỉ nó. Bài ĐO không được có quyền xoá thứ nó không tạo ra.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const token = readFileSync(join(HERE, "..", ".data", "gateway-token.txt"), "utf8").trim();
const gw = (m, b = {}) => fetch(`http://127.0.0.1:8788/gw/api/${m}`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(b),
}).then((r) => r.json());
const nghi = (ms) => new Promise((r) => setTimeout(r, ms));

const roster = async () => {
  const r = await gw("listAgents", {});
  return Array.isArray(r) ? r : r.agents ?? [];
};

/**
 * Đúng câu case 9 của kịch bản b2 — ca app gốc trả về hai tệp đính kèm và một đội có nhịp.
 * Giữ nguyên văn để so được với bản ghi app gốc, đừng viết lại cho "rõ hơn".
 */
const DE_BAI = "xây quy trình vận hành sàn shopee cho shop tôi, lập đội bot làm việc luôn";

const CHO_TOI_DA_MS = 12 * 60 * 1000;

const main = async () => {
  const truoc = new Set((await roster()).map((a) => a.id));
  console.log(`roster trước: ${truoc.size} bot`);

  const ten = `RT-${Math.random().toString(36).slice(2, 6)}`;
  const tao = await gw("createAgent", { name: ten });
  const chu = tao?.id ?? tao?.agent?.id;
  if (!chu) { console.error("không tạo được bot chủ:", JSON.stringify(tao).slice(0, 200)); process.exit(1); }
  console.log(`bot chủ: ${ten} (${chu})`);

  await gw("sendPrompt", { agentId: chu, prompt: DE_BAI, text: DE_BAI });

  const hetHan = Date.now() + CHO_TOI_DA_MS;
  let xong = false;
  while (Date.now() < hetHan) {
    await nghi(10_000);
    const r = await roster();
    const me = r.find((a) => a.id === chu);
    const moi = r.filter((a) => !truoc.has(a.id) && a.id !== chu).length;
    process.stdout.write(`\r  đang chạy=${me?.isRunning ?? "?"} · bot mới=${moi} · ${Math.round((hetHan - Date.now()) / 1000)}s  `);
    if (me && me.isRunning === false && moi > 0) { xong = true; break; }
  }
  console.log(xong ? "\n→ lượt xong" : "\n→ HẾT GIỜ (đo dở, con số dưới đây là tại thời điểm cắt)");

  const sau = await roster();
  const sinhRa = sau.filter((a) => !truoc.has(a.id));

  console.log(`\nbot lượt này sinh ra: ${sinhRa.length}`);
  let tong = 0;
  for (const a of sinhRa) {
    const r = await gw("getAgentAutomations", { agentId: a.id });
    const ds = Array.isArray(r) ? r : r.automations ?? [];
    tong += ds.length;
    // `trigger` là object (`{type:"cron",schedule:"0 9 * * *"}` hoặc `{type:"slack",…}`), không phải
    // chuỗi — in thẳng ra thì được `[object Object]`, và cái ta cần đọc chính là NHỊP.
    const nhip = (t) => (typeof t === "string" ? t : t?.schedule ?? t?.cron ?? t?.type ?? "?");
    const mo = ds.map((x) => `"${x.name}" ${nhip(x.trigger ?? x.schedule)}`).join(" · ");
    console.log(`  ${String(ds.length).padStart(2)} routine — ${a.name}${mo ? `\n       ${mo}` : ""}`);
  }
  console.log(`\nTỔNG: ${tong} routine trên ${sinhRa.length} bot`);
  console.log(tong === 0
    ? "→ luật routine trong tools.ts KHÔNG ăn. Lời nhắc tới được model mà model không gọi."
    : "→ luật routine có ăn. So nhịp với app gốc (Kho 4 ca/ngày, Kế toán tuần+tháng) để xem sát tới đâu.");

  for (const a of sinhRa) await gw("deleteAgents", { id: a.id }).catch(() => {});
  console.log(`đã dọn ${sinhRa.length} bot lượt này tạo (không đụng ${truoc.size} bot có sẵn)`);
};

main().catch((e) => { console.error(e); process.exit(1); });
