/**
 * E2E MÁY NGƯỜI DÙNG qua ĐƯỜNG MODEL: bot thật gọi `local_write` + `local_shell_bg`, thẻ quyền được duyệt
 * qua gateway (đúng lệnh client gửi), rồi kiểm TỆP TRÊN ĐĨA — vì máy chạy bài này chính là máy người dùng.
 *
 *   node services/grokbot-backend/scripts/e2e-may-nguoi-dung.mjs
 *
 * Điều kiện: backend dev đang chạy (:8788), app Grok Bot local đang mở và daemon local-exec đang nối (bài
 * tự kiểm bằng `hostname` qua `/internal/ops/local-exec`), `/gw/health` rảnh. Tốn ~3 lượt model (một
 * prompt + hai lần tiếp sau tool). Tự dọn bot thử và hai tệp nó ghi; tệp `terminals/<shellId>.txt` của
 * daemon để lại (của daemon, không phải của ta).
 *
 * Vì sao đo đường model chứ không chỉ cửa ops: cửa ops đã chứng minh DÂY (write/spawn tới daemon và về);
 * cái chưa chứng minh là model có GỌI đúng tool với đúng tham số từ một câu tiếng Việt, và thẻ quyền có
 * mang đúng hành động (`write-file` cho ghi, `run-command` cho lệnh nền) để client 0.43 vẽ đúng câu hỏi.
 *
 * Mốc: 1 máy nối · 2 thẻ quyền cho local_write · 3 tệp 1 đúng nội dung · 4 thẻ quyền cho local_shell_bg ·
 * 5 bot nêu shellId · 6 lượt kết thúc · 7 tệp 2 xuất hiện SAU khi lượt xong (lệnh nền sống qua lượt) · dọn.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";

const GW = process.env.GW ?? "http://127.0.0.1:8788/gw/api";
const BASE = GW.replace(/\/gw\/api$/, "");
/*
 * Vé cổng. Từ 08/09 CẢ `/internal/ops/*` cũng đòi nó: cửa ấy chạy lệnh trên máy người dùng và
 * trước đó không hỏi giấy tờ gì (bảng theo dõi §7). Đọc mặc định từ `.data` để chạy ở máy dev
 * không phải gõ env; trên VPS vẫn truyền `GW_TOKEN_FILE`.
 */
const docVe = () => {
  if (process.env.GW_TOKEN_FILE) return readFileSync(process.env.GW_TOKEN_FILE, "utf8").trim();
  if (process.env.GW_TOKEN) return process.env.GW_TOKEN;
  try { return readFileSync(new URL("../.data/gateway-token.txt", import.meta.url), "utf8").trim(); } catch { return ""; }
};
const TOKEN = docVe();
const gw = async (m, body = {}) => {
  const r = await fetch(`${GW}/${m}`, { method: "POST", headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) }, body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
};
const ops = async (body) => {
  const r = await fetch(`${BASE}/internal/ops/local-exec`, { method: "POST", headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) }, body: JSON.stringify(body) });
  return r.json().catch(() => null);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tail = async (id) => { const t = await gw("getAgentTranscriptTail", { id, limit: 300 }); return Array.isArray(t?.entries) ? t.entries : []; };
const dangChay = async (id) => ((await gw("listAgents", {})) ?? []).find((a) => a.id === id)?.isRunning === true;

let diem = 0, tong = 0;
const ok = (ten, dung, them = "") => { tong++; if (dung) diem++; console.log(`${dung ? "✅" : "❌"} ${tong}. ${ten}${them ? ` — ${them}` : ""}`); return dung; };

// ── điều kiện ──────────────────────────────────────────────────────────────────────────────────
const h = await fetch(`${BASE}/gw/health`).then((r) => r.json()).catch(() => null);
if (!h?.ok) { console.error("backend không lên ở", BASE); process.exit(2); }
if (h.isBusy) { console.error("backend đang bận (isBusy) — không chen lượt của người dùng"); process.exit(2); }
const may = await ops({ kind: "shell", command: "hostname", timeoutMs: 20_000 });
const tenMay = String(may?.data?.stdout ?? "").trim();
if (!ok("máy người dùng đang nối (hostname qua local-exec)", may?.ok === true && tenMay.length > 0, tenMay || JSON.stringify(may).slice(0, 200))) process.exit(1);

// Máy chạy bài này LÀ máy người dùng, nên đường dẫn ghi phải nằm dưới thư mục người dùng (localRoot của daemon).
const stamp = Date.now().toString(36);
const P1 = `${homedir().replace(/\\/g, "/")}/Desktop/gb2-e2e-may-${stamp}.txt`;
const P2 = `${homedir().replace(/\\/g, "/")}/Desktop/gb2-e2e-nen-${stamp}.txt`;
const NOI_DUNG = `xin chào 06/09 — máy người dùng ${stamp}`;
// 25 s ngủ để tệp 2 chắc chắn xuất hiện SAU khi lượt model đã kết thúc — đó mới là "sống qua lượt".
const LENH_NEN = `powershell -NoProfile -Command "Start-Sleep -Seconds 25; Set-Content -Path '${P2}' -Value xong"`;

// `createAgent` trả `SandAgentSummary` bọc trong `{agent}` từ 05/09 (schema 0.43); bản cũ trả phẳng — nhận cả hai.
const taoRa = await gw("createAgent", { name: "Thử máy người dùng (xoá sau)", description: "Bot đo local_write + local_shell_bg — xoá ngay sau khi đo." });
const bot = taoRa?.agent ?? taoRa;
if (!bot?.id) { console.error("không tạo được bot:", JSON.stringify(taoRa).slice(0, 300)); process.exit(1); }
console.log("bot thử:", bot.id);

const daDuyet = new Set();
const the = [];
let tenTool = [];
try {
  const CAU = `Trên máy tính của mình (máy ${tenMay} đang nối), làm đúng HAI việc rồi báo kết quả, không hỏi lại, không đọc lại tệp, không chạy gì khác:\n`
    + `1) Dùng local_write ghi tệp ${P1} với nội dung đúng từng chữ: ${NOI_DUNG}\n`
    + `2) Dùng local_shell_bg chạy NỀN lệnh này (chép nguyên văn): ${LENH_NEN}\n`
    + `Khi xong, nói cho mình shellId của lệnh nền.`;
  await gw("sendPrompt", { agentId: bot.id, content: CAU });

  // Vòng duyệt thẻ: mỗi thẻ pending → resolveLocalToolPermission như client gửi. Ghi lại hành động trên thẻ.
  const t0 = Date.now();
  let thayChay = false, yen = 0, soCuoi = -1;
  while (Date.now() - t0 < 300_000) {
    await sleep(1500);
    const ds = await tail(bot.id);
    // `/gw` trả entry THÔ: thẻ quyền là `send-message` mang `message.type: "local-tool-permission"` với `ask{status,action,target,requestId}`
    // (khác trang `/v1`, nơi thẻ được trộn vào hàng tool-call). Lượt đo đầu 06/09 lọc theo hình `/v1` nên không thấy thẻ nào — bài đo đỏ, sản phẩm đúng.
    for (const e of ds) {
      const ask = e.kind === "send-message" && e.message?.type === "local-tool-permission" ? e.message.ask : null;
      if (!ask || ask.status !== "pending" || daDuyet.has(ask.requestId)) continue;
      daDuyet.add(ask.requestId);
      const r = await gw("resolveLocalToolPermission", { requestId: ask.requestId, entryId: e.id, agentId: bot.id, resolution: "allow-once" });
      the.push({ name: String(ask.target ?? ""), action: String(ask.action ?? ""), resolved: r?.resolved });
      console.log(`   duyệt thẻ [${ask.action}]:`, String(ask.target ?? "").slice(0, 90), "→", JSON.stringify(r));
    }
    const chay = await dangChay(bot.id);
    if (chay) { thayChay = true; yen = 0; soCuoi = ds.length; continue; }
    if (!thayChay && ds.length <= 1) continue;
    yen = ds.length === soCuoi ? yen + 1500 : 0;
    soCuoi = ds.length;
    if (yen >= 6000) break;
  }
  const ds = await tail(bot.id);
  // Đổ bản ghi ra file TRƯỚC khi dọn — lượt đo đầu xoá bot trong `finally` rồi mới muốn đọc (bẫy §7 "dọn sau khi đọc").
  const { writeFileSync } = await import("node:fs");
  const DUMP = `${process.env.TEMP ?? process.env.TMP ?? "."}/e2e-may-nguoi-dung-${stamp}.json`;
  try { writeFileSync(DUMP, JSON.stringify(ds, null, 1)); console.log("   bản ghi:", DUMP); } catch { /* không sao */ }
  tenTool = ds.filter((e) => e.kind === "tool-call").map((e) => `${e.name}:${e.status}`);
  console.log("   tool đã gọi:", tenTool.join(", ") || "(không)");

  const theGhi = the.find((x) => x.name.startsWith("local_write("));
  ok("thẻ quyền cho local_write xuất hiện, mang hành động write-file, và được duyệt",
    !!theGhi && theGhi.action === "write-file" && theGhi.resolved !== false,
    the.map((x) => `${x.name.split("(")[0]}→${x.action}`).join(", ") || "không thẻ nào");
  const co1 = existsSync(P1);
  const noi = co1 ? readFileSync(P1, "utf8").trim() : "";
  ok("tệp 1 có trên đĩa với đúng nội dung (utf-8, có dấu)", co1 && noi === NOI_DUNG, co1 ? JSON.stringify(noi).slice(0, 80) : "không có tệp");
  const theNen = the.find((x) => x.name.startsWith("local_shell_bg("));
  ok("thẻ quyền cho local_shell_bg xuất hiện, mang hành động run-command, và được duyệt",
    !!theNen && theNen.action === "run-command" && theNen.resolved !== false);

  // Câu của bot: `send-message` với `message.type:"text"` mang `message.content` (không phải `.text` — lượt đo 2 đỏ giả vì đọc sai khoá),
  // hoặc entry `message` role assistant.
  const cauBot = ds.map((e) => e.kind === "message" && e.role === "assistant" ? String(e.content ?? "")
    : e.kind === "send-message" && e.message?.type === "text" ? String(e.message.content ?? e.message.text ?? "") : "").filter(Boolean).join("\n");
  const shellId = /shell\s*Id\D{0,6}(\d+)/i.exec(cauBot)?.[1] ?? null;
  ok("bot nêu shellId của lệnh nền trong câu trả lời", shellId != null, shellId ? `shellId ${shellId}` : cauBot.slice(-160));
  const conChay = await dangChay(bot.id);
  ok("lượt đã kết thúc (isRunning false)", !conChay);
  const co2LucXong = existsSync(P2);
  console.log(`   tệp 2 lúc lượt xong: ${co2LucXong ? "ĐÃ có (lệnh nền xong trước lượt)" : "chưa có — chờ lệnh nền"}`);
  const t1 = Date.now();
  let co2 = co2LucXong;
  while (!co2 && Date.now() - t1 < 45_000) { await sleep(1000); co2 = existsSync(P2); }
  ok("tệp 2 xuất hiện — lệnh nền sống qua lượt và tự ghi khi không còn lượt nào chạy", co2,
    co2 ? `sau ${Math.round((Date.now() - t1) / 1000)} s kể từ lúc lượt xong` : "không thấy sau 45 s");
} finally {
  await gw("deleteAgents", { ids: [bot.id] });
  for (const p of [P1, P2]) { try { rmSync(p, { force: true }); } catch { /* không sao */ } }
  console.log("đã dọn bot thử + hai tệp");
}

console.log(`\n${diem}/${tong} ${diem === tong ? "XANH" : "ĐỎ"}`);
process.exit(diem === tong ? 0 : 1);
