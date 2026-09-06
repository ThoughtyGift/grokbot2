/**
 * E2E CHÉP TỆP máy người dùng ↔ box qua ĐƯỜNG MODEL — bản của ta cho CopyToBox / CopyFromBox của hãng.
 *
 *   node services/grokbot-backend/scripts/e2e-chep-tep.mjs
 *
 * Bài đo tạo một tệp nhị phân ngẫu nhiên 1,5 MB trên Desktop (máy chạy bài chính là máy người dùng),
 * rồi bảo bot: chép lên box → `sha256sum` trên box → chép về Desktop dưới tên khác. Kiểm bằng ĐĨA:
 * sha của tệp gốc, sha bot đọc được trên box, sha của tệp chép về phải là MỘT. Thẻ quyền duyệt qua
 * gateway đúng lệnh client gửi. ~4 lượt model. Tự dọn bot, hai tệp Desktop; tệp trên box để lại ở
 * `tu-may/` (bot có thể được bảo xoá, không bắt buộc).
 *
 * Điều kiện: backend dev :8788 rảnh, app local mở (daemon local-exec nối), box nối (`boxConfigured`).
 * Mốc: 1 máy nối · 2 thẻ read-file cho local_copy_to_box · 3 bot nêu đúng sha256 (đọc trên box) ·
 * 4 thẻ write-file cho local_copy_from_box · 5 tệp chép về có trên đĩa · 6 sha tệp về = sha gốc · 7 lượt xong.
 */
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes, createHash } from "node:crypto";

const GW = process.env.GW ?? "http://127.0.0.1:8788/gw/api";
const BASE = GW.replace(/\/gw\/api$/, "");
const TOKEN = process.env.GW_TOKEN_FILE ? readFileSync(process.env.GW_TOKEN_FILE, "utf8").trim() : (process.env.GW_TOKEN ?? "");
const gw = async (m, body = {}) => {
  const r = await fetch(`${GW}/${m}`, { method: "POST", headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) }, body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
};
const ops = async (body) => fetch(`${BASE}/internal/ops/local-exec`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tail = async (id) => { const t = await gw("getAgentTranscriptTail", { id, limit: 300 }); return Array.isArray(t?.entries) ? t.entries : []; };
const dangChay = async (id) => ((await gw("listAgents", {})) ?? []).find((a) => a.id === id)?.isRunning === true;
const sha = (b) => createHash("sha256").update(b).digest("hex");

let diem = 0, tong = 0;
const ok = (ten, dung, them = "") => { tong++; if (dung) diem++; console.log(`${dung ? "✅" : "❌"} ${tong}. ${ten}${them ? ` — ${them}` : ""}`); return dung; };

const h = await fetch(`${BASE}/gw/health`).then((r) => r.json()).catch(() => null);
if (!h?.ok) { console.error("backend không lên ở", BASE); process.exit(2); }
if (h.isBusy) { console.error("backend đang bận — không chen lượt của người dùng"); process.exit(2); }
const may = await ops({ kind: "shell", command: "hostname", timeoutMs: 20_000 });
const tenMay = String(may?.data?.stdout ?? "").trim();
if (!ok("máy người dùng đang nối", may?.ok === true && tenMay.length > 0, tenMay)) process.exit(1);

const stamp = Date.now().toString(36);
const DESK = `${homedir().replace(/\\/g, "/")}/Desktop`;
const GOC = `${DESK}/gb2-chep-${stamp}.bin`;
const VE = `${DESK}/gb2-chep-${stamp}.ve.bin`;
const TEN_BOX = `tu-may/gb2-chep-${stamp}.bin`;
const bytes = randomBytes(1536 * 1024);
writeFileSync(GOC, bytes);
const shaGoc = sha(bytes);
console.log("tệp gốc:", GOC, bytes.length, "byte, sha", shaGoc.slice(0, 16) + "…");

const taoRa = await gw("createAgent", { name: "Thử chép tệp (xoá sau)", description: "Bot đo local_copy_to_box / local_copy_from_box — xoá ngay sau khi đo." });
const bot = taoRa?.agent ?? taoRa;
if (!bot?.id) { console.error("không tạo được bot:", JSON.stringify(taoRa).slice(0, 300)); rmSync(GOC, { force: true }); process.exit(1); }
console.log("bot thử:", bot.id);

const daDuyet = new Set();
const the = [];
try {
  const CAU = `Trên máy ${tenMay} của mình có tệp ${GOC}. Làm đúng BA việc theo thứ tự, không hỏi lại:\n`
    + `1) local_copy_to_box chép nó lên máy của bạn, đặt ở ${TEN_BOX}.\n`
    + `2) Trên máy của bạn chạy: sha256sum ${TEN_BOX}  — và chép NGUYÊN VĂN 64 ký tự sha256 vào câu trả lời.\n`
    + `3) local_copy_from_box chép ${TEN_BOX} về máy mình với "path" đúng là ${VE}.\n`
    + `Kết bằng một câu ngắn có sha256 đó.`;
  await gw("sendPrompt", { agentId: bot.id, content: CAU });

  const t0 = Date.now();
  let thayChay = false, yen = 0, soCuoi = -1;
  while (Date.now() - t0 < 420_000) {
    await sleep(1500);
    const ds = await tail(bot.id);
    for (const e of ds) {
      const ask = e.kind === "send-message" && e.message?.type === "local-tool-permission" ? e.message.ask : null;
      if (!ask || ask.status !== "pending" || daDuyet.has(ask.requestId)) continue;
      daDuyet.add(ask.requestId);
      await gw("resolveLocalToolPermission", { requestId: ask.requestId, entryId: e.id, agentId: bot.id, resolution: "allow-once" });
      the.push({ name: String(ask.target ?? ""), action: String(ask.action ?? "") });
      console.log(`   duyệt thẻ [${ask.action}]:`, String(ask.target ?? "").slice(0, 100));
    }
    const chay = await dangChay(bot.id);
    if (chay) { thayChay = true; yen = 0; soCuoi = ds.length; continue; }
    if (!thayChay && ds.length <= 1) continue;
    yen = ds.length === soCuoi ? yen + 1500 : 0;
    soCuoi = ds.length;
    if (yen >= 8000) break;
  }
  const ds = await tail(bot.id);
  const DUMP = `${process.env.TEMP ?? "."}/e2e-chep-tep-${stamp}.json`;
  try { writeFileSync(DUMP, JSON.stringify(ds, null, 1)); console.log("   bản ghi:", DUMP); } catch { /* không sao */ }
  console.log("   tool đã gọi:", ds.filter((e) => e.kind === "tool-call").map((e) => `${e.name}:${e.status}`).join(", ") || "(không)");

  const len = the.find((x) => x.name.startsWith("local_copy_to_box("));
  ok("thẻ quyền local_copy_to_box mang hành động read-file", !!len && len.action === "read-file", the.map((x) => `${x.name.split("(")[0]}→${x.action}`).join(", ") || "không thẻ");
  const cauBot = ds.map((e) => e.kind === "message" && e.role === "assistant" ? String(e.content ?? "")
    : e.kind === "send-message" && e.message?.type === "text" ? String(e.message.content ?? "") : "").filter(Boolean).join("\n");
  ok("bot nêu đúng sha256 đọc được TRÊN BOX (= sha tệp gốc)", cauBot.includes(shaGoc), cauBot.includes(shaGoc) ? shaGoc.slice(0, 16) + "…" : cauBot.slice(-200));
  const ve = the.find((x) => x.name.startsWith("local_copy_from_box("));
  ok("thẻ quyền local_copy_from_box mang hành động write-file", !!ve && ve.action === "write-file");
  const coVe = existsSync(VE);
  ok("tệp chép về có trên Desktop", coVe, VE);
  ok("sha tệp chép về = sha tệp gốc (đi máy → box → máy nguyên từng byte)", coVe && sha(readFileSync(VE)) === shaGoc);
  ok("lượt đã kết thúc", !(await dangChay(bot.id)));
} finally {
  await gw("deleteAgents", { ids: [bot.id] });
  for (const p of [GOC, VE]) { try { rmSync(p, { force: true }); } catch { /* không sao */ } }
  console.log("đã dọn bot thử + hai tệp Desktop (tệp trên box để lại:", TEN_BOX + ")");
}
console.log(`\n${diem}/${tong} ${diem === tong ? "XANH" : "ĐỎ"}`);
process.exit(diem === tong ? 0 : 1);
