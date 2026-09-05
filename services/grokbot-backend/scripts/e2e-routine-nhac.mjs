/**
 * E2E "bảng Routine → bot lên tiếng" — đo qua `/gw/api` của backend THẬT đang chạy (:8788).
 *
 *   node services/grokbot-backend/scripts/e2e-routine-nhac.mjs
 *
 * App gốc 0.43 (cache client, 05/09): mỗi thao tác trên bảng Routine để lại một hàng sự kiện (*Enabled routine · x*) và
 * bot trả MỘT câu ngay (*"btw `x` vừa bị tắt (paused). muốn bật lại không?"*), bật + sửa liền nhau thì một câu cho cả hai,
 * và KHÔNG có tin người dùng nào trong bản ghi. Bài này tạo một bot riêng, đi 4 nhịp (tạo · tắt · bật+sửa · xoá), đếm hàng
 * sự kiện, câu của bot, tin người dùng, rồi xoá bot. Gửi 4 lượt model — không chạy khi người dùng đang chat (`/gw/health`
 * `isBusy`). Kết quả đo 05/09: 4/4 câu, 6–11 s mỗi câu, 0 tin người dùng.
 */
const GW = process.env.GW ?? "http://127.0.0.1:8788/gw/api";
const HEALTH = GW.replace(/\/gw\/api$/, "/gw/health");
// `GW_TOKEN_FILE`/`GW_TOKEN`: vé cổng cho máy chủ `GROKBOT2_AUTH=enforce` (VPS) — thiếu nó là 401 ở "tạo bot thử", không phải sản phẩm hỏng (đo 06/09).
const TOKEN = process.env.GW_TOKEN_FILE ? (await import("node:fs")).readFileSync(process.env.GW_TOKEN_FILE, "utf8").trim() : (process.env.GW_TOKEN ?? "");
const gw = async (m, body = {}) => {
  const r = await fetch(`${GW}/${m}`, { method: "POST", headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) }, body: JSON.stringify(body) });
  return r.json().catch(() => null);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const health = async () => (await fetch(HEALTH)).json();
const fails = [];
const ok = (name, cond, detail = "") => { console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); if (!cond) fails.push(name); };

let id;
// reply 0.43: `{reachable, entries, beforeSeq, nextBeforeSeq, hasMore, cursor, total}` — mảng nằm ở `entries`
const tail = async () => { const t = await gw("getAgentTranscriptTail", { id, limit: 100 }); return Array.isArray(t?.entries) ? t.entries : []; };
const cauBot = (ds) => ds.filter((e) => e.kind === "send-message" && e.author?.id === id);
const suKien = (ds, action) => ds.filter((e) => e.kind === "event" && e.event?.type === "automation-changed" && e.event?.action === action);
const inDong = (e) => {
  if (e.kind === "event") return `      ⚙ ${e.event?.action} routine · ${e.event?.automationName}`;
  if (e.kind === "send-message") return `      ${e.author?.id === id ? "BOT " : "USER"} ${String(e.message?.content ?? "").replace(/\s+/g, " ").slice(0, 140)}`;
  return `      · ${e.kind}`;
};
/** Chờ bot rảnh VÀ đủ số câu — trần 60 s; đo được 6–11 s. */
const choCau = async (soCau, maxMs = 60_000) => {
  const t0 = Date.now();
  for (;;) {
    const ds = await tail();
    if (!(await health()).isBusy && cauBot(ds).length >= soCau) return { ds, s: (Date.now() - t0) / 1000 };
    if (Date.now() - t0 > maxMs) return { ds, s: (Date.now() - t0) / 1000 };
    await sleep(1500);
  }
};

if ((await health()).isBusy) { console.log("backend đang bận (lượt của người dùng) — không đo"); process.exit(2); }

const a = await gw("createAgent", { name: "Thử routine (xoá sau)", description: "Bot đo — xoá ngay sau khi đo." });
id = a?.agent?.id;                        // reply 0.43: `{agent: SandAgentSummary}` — không phải summary trần
ok("tạo bot thử", typeof id === "string", id);
if (!id) { console.log("không tạo được bot thử — dừng, không có gì để dọn"); process.exit(1); }
try {
  await choCau(0, 15_000);
  const spec = { name: "kiem-ke-sang", prompt: "Tóm tắt tồn kho và báo mặt hàng sắp hết.", trigger: "44 8 * * 1-5", isEnabled: true };

  const list = await gw("createAgentAutomation", { id, spec });
  const auto = (Array.isArray(list) ? list : []).find((x) => x.name === spec.name);
  ok("createAgentAutomation trả routine", !!auto?.id, auto?.id);
  let r = await choCau(1);
  ok("[tạo] hàng sự kiện created", suKien(r.ds, "created").length === 1);
  ok("[tạo] bot nói đúng 1 câu", cauBot(r.ds).length === 1, `${r.s.toFixed(1)}s`);
  r.ds.slice(-2).forEach((e) => console.log(inDong(e)));

  await gw("setAgentAutomationEnabled", { id, automationId: auto.id, isEnabled: false });
  r = await choCau(2);
  ok("[tắt] hàng sự kiện disabled", suKien(r.ds, "disabled").length === 1);
  ok("[tắt] bot nói thêm 1 câu", cauBot(r.ds).length === 2, `${r.s.toFixed(1)}s`);
  ok("[tắt] câu nhắc tên routine trong dấu `", /`kiem-ke-sang`/.test(cauBot(r.ds).at(-1)?.message?.content ?? ""));
  r.ds.slice(-2).forEach((e) => console.log(inDong(e)));

  await gw("setAgentAutomationEnabled", { id, automationId: auto.id, isEnabled: true });
  await sleep(400);
  await gw("updateAgentAutomation", { id, automationId: auto.id, spec: { ...spec, trigger: "15 0 * * *" } });
  r = await choCau(3);
  await sleep(4000);                       // cửa sổ cho câu THỪA mọc ra — không được có
  const ds3 = await tail();
  ok("[bật+sửa] hai hàng sự kiện enabled + updated", suKien(ds3, "enabled").length === 1 && suKien(ds3, "updated").length === 1);
  ok("[bật+sửa] MỘT câu cho cả hai thao tác", cauBot(ds3).length === 3, `${r.s.toFixed(1)}s · ${cauBot(ds3).length - 2} câu`);
  ds3.slice(-3).forEach((e) => console.log(inDong(e)));

  await gw("deleteAgentAutomation", { agentId: id, automationId: auto.id });
  r = await choCau(4);
  ok("[xoá] hàng sự kiện deleted", suKien(r.ds, "deleted").length === 1);
  ok("[xoá] bot nói thêm 1 câu", cauBot(r.ds).length === 4, `${r.s.toFixed(1)}s`);
  r.ds.slice(-2).forEach((e) => console.log(inDong(e)));

  ok("không có tin NGƯỜI DÙNG nào trong bản ghi (lời nhắc im lặng)", r.ds.every((e) => e.kind !== "send-message" || e.author?.id === id));
} finally {
  await gw("deleteAgents", { ids: [id] });
  const con = await gw("listAgents", {});
  ok("đã xoá bot thử", !(Array.isArray(con) ? con : []).some((x) => x.id === id));
}
console.log(fails.length ? `\nĐỎ ${fails.length}: ${fails.join(" · ")}` : "\nXANH — bảng Routine → hàng sự kiện + bot một câu, như app gốc 0.43");
process.exit(fails.length ? 1 : 0);
