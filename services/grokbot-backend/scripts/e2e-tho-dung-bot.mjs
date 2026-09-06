/**
 * E2E "Thợ dựng bot" — một lượt THẬT gõ `/Dựng bot mới` vào Thợ (backend :8788), đo qua `/gw/api`.
 *
 *   node services/grokbot-backend/scripts/e2e-tho-dung-bot.mjs           # THO=<agentId> để chỉ bot khác tên
 *
 * Gửi đúng thứ client gửi khi chọn skill trong menu `/`: câu bắt đầu bằng `@Dựng bot mới` + việc cần dựng, kèm SẴN ba câu
 * trả lời (skill dặn: câu nào đã trả lời thì bỏ) để lượt không dừng ở widget giữa đường. Mốc:
 *   1. Thợ có thật và có skill "Dựng bot mới"
 *   2. bot MỚI xuất hiện trong roster (create_agent), tên khác Thợ, có mô tả
 *   3. bot mới có ≥ 2 skill, mỗi skill mô tả không rỗng (create_workflow{agent} — trước 06/09 rơi vào Thợ)
 *   4. Thợ KHÔNG nhận skill mới nào (chỉ có skill của chính nó)
 *   5. lượt kết bằng widget hai lựa chọn (Đưa lên Marketplace / Để riêng)
 *   6. trả lời "Đưa lên Marketplace" → mẫu + listing của bot mới có trên `listPublicBotMarketplace`
 *   7. dọn: gỡ listing, xoá mẫu, xoá bot mới (skill xoá theo) — Thợ và mẫu của Thợ giữ nguyên
 * Gửi 2 lượt model (dựng + đăng). Không chạy khi `/gw/health` báo `isBusy`.
 */
const GW = process.env.GW ?? "http://127.0.0.1:8788/gw/api";
const HEALTH = GW.replace(/\/gw\/api$/, "/gw/health");
const TOKEN = process.env.GW_TOKEN_FILE ? (await import("node:fs")).readFileSync(process.env.GW_TOKEN_FILE, "utf8").trim() : (process.env.GW_TOKEN ?? "");
const gw = async (m, body = {}) => {
  const r = await fetch(`${GW}/${m}`, { method: "POST", headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) }, body: JSON.stringify(body) });
  return r.json().catch(() => null);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const health = async () => (await fetch(HEALTH)).json();
const fails = [];
const ok = (name, cond, detail = "") => { console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); if (!cond) fails.push(name); };
const TEN_THO = "Thợ dựng bot";
const TEN_SKILL = "Dựng bot mới";

if ((await health()).isBusy) { console.log("backend đang bận — không đo"); process.exit(2); }
const roster0 = (await gw("listAgents", {})) ?? [];
const tho = process.env.THO ? roster0.find((a) => a.id === process.env.THO) : roster0.find((a) => a.name === TEN_THO);
ok("1 Thợ có thật", !!tho?.id, tho?.id);
if (!tho) { console.log("chạy `npx tsx scripts/dung-tho-dung-bot.mts` trước"); process.exit(1); }
const skillTho0 = (await gw("getAgentWorkflows", { id: tho.id })) ?? [];
ok("1 Thợ có skill Dựng bot mới", skillTho0.some((w) => w.name === TEN_SKILL), skillTho0.map((w) => w.name).join(" · "));

const tail = async (id) => { const t = await gw("getAgentTranscriptTail", { id, limit: 300 }); return Array.isArray(t?.entries) ? t.entries : []; };
/**
 * Chờ một LƯỢT: phải thấy bản ghi mọc (hoặc backend bận) rồi mới chờ rảnh. Bản đầu ngủ 3 s rồi hỏi `isBusy` — lượt do
 * `respondToWidget` kích chưa kịp bắt đầu, backend "rảnh", bài đo đọc mẫu ngay và báo đỏ (đo 06/09 lượt 4: lượt 2 "xong sau 3 s").
 */
/**
 * Tín hiệu đúng là cờ `isRunning` của CHÍNH bot trong roster (`listAgents`) — turn.ts bật nó cho mọi lượt, kể cả lượt do
 * `respondToWidget` kích; còn `/gw/health.isBusy` chỉ đếm lượt qua `sendPrompt` (bảng theo dõi §7). Ba lượt đo 06/09 đỏ giả vì
 * (a) đọc `isBusy`, (b) đếm `length` của đuôi có trần 100, (c) cửa sổ yên 8 s ngắn hơn khoảng nghĩ giữa hai tool của model.
 * Nay: "bắt đầu" = bot `isRunning` HOẶC có entry mới của bot sau `idTruoc`; "xong" = không `isRunning` và không mọc entry 6 s.
 */
const dangChay = async (id) => ((await gw("listAgents", {})) ?? []).find((a) => a.id === id)?.isRunning === true;
const moiSau = (ds, idTruoc) => { const i = ds.findIndex((e) => e.id === idTruoc); return i >= 0 ? ds.slice(i + 1) : ds; };
const choRanh = async (maxMs, id = tho?.id, idTruoc = null) => {
  const t0 = Date.now();
  let batDau = false, yen = 0, cuoi = idTruoc;
  while (Date.now() - t0 < maxMs) {
    const chay = await dangChay(id);
    const ds = await tail(id);
    const moi = moiSau(ds, idTruoc);
    const botViet = moi.some((e) => e.kind === "tool-call" || (e.kind === "send-message" && e.author?.id === id));
    if (!batDau) batDau = chay || botViet;
    else if (!chay) { const c = ds.at(-1)?.id ?? null; yen = c === cuoi ? yen + 2000 : 0; cuoi = c; if (yen >= 6000) return true; }
    else yen = 0;
    await sleep(2000);
  }
  return false;
};
const inTool = (ds) => ds.filter((e) => e.kind === "tool-call").map((e) => `${e.name}:${e.status}`).join(" · ");

// Mỗi lần chạy một VIỆC khác và một mã shop riêng: bản ghi của Thợ giữ ký ức các lượt trước (bot thử thì đã xoá), nên cùng một
// yêu cầu lặp lại là bot nói "đã dựng rồi, không tạo trùng" — đúng hành vi, sai bài đo (đo 06/09 lượt 3).
const VIEC = [
  "mỗi sáng gom danh sách đơn yêu cầu hoàn/trả Shopee trong ngày, phân loại lý do, soạn câu trả lời cho khách",
  "mỗi tối gom bình luận dưới các video TikTok Shop trong ngày, tách câu hỏi mua hàng khỏi khen/chê, soạn câu trả lời",
  "mỗi sáng thứ 2 lập lịch livestream tuần, nhắc chuẩn bị kịch bản và mã giảm giá trước mỗi phiên",
  "mỗi chiều đối soát đơn đã giao với sổ thu tiền COD, chỉ ra đơn lệch và soạn tin hỏi đơn vị vận chuyển",
][Math.floor(Date.now() / 1000) % 4];
const MA = Math.random().toString(36).slice(2, 6).toUpperCase();
const DAU = `@${TEN_SKILL} Mình cần một bot cho shop mã ${MA} — shop KHÁC các lần trước, dựng bot mới riêng, tên bot phải có chữ "${MA}". Trả lời sẵn ba câu: (1) lĩnh vực: vận hành shop online, việc chính là ${VIEC}; (2) người dùng là đội CS của shop, giọng ngắn gọn thân mật, tiếng Việt; (3) chạy theo đúng nhịp trong việc, không cần kết nối gì thêm ngoài những gì đang có. Ba câu đã trả lời rồi, không hỏi lại ba câu đó — dựng luôn.`;
const soTruoc = roster0.length;
const entryTruoc = (await tail(tho.id)).at(-1)?.id ?? null;
await gw("sendPrompt", { agentId: tho.id, content: DAU });
const t0 = Date.now();
const ranh1 = await choRanh(240_000, tho.id, entryTruoc);
const ds1 = await tail(tho.id);
console.log(`      lượt 1 xong sau ${((Date.now() - t0) / 1000).toFixed(0)}s · tool: ${inTool(moiSau(ds1, entryTruoc)) || "(không có)"}`);
ds1.filter((e) => e.kind === "send-message" && e.author?.id === tho.id && e.message?.type !== "widget").slice(-3).forEach((e) => console.log("      BOT", String(e.message?.content ?? "").replace(/\s+/g, " ").slice(0, 150)));

const roster1 = (await gw("listAgents", {})) ?? [];
const moi = roster1.filter((a) => !roster0.some((b) => b.id === a.id));
const botMoi = moi[0];
ok("2 bot MỚI xuất hiện trong roster (create_agent), đúng một con", ranh1 && moi.length === 1 && botMoi?.name !== TEN_THO, moi.map((a) => `${a.id} ${a.name}`).join(" | ") || `roster ${soTruoc} → ${roster1.length}`);
ok("2 bot mới có mô tả (validator client đòi min 1)", (botMoi?.description ?? "").trim().length > 0, (botMoi?.description ?? "").slice(0, 80));

const skillMoi = botMoi ? (await gw("getAgentWorkflows", { id: botMoi.id })) ?? [] : [];
ok("3 bot mới có ≥ 2 skill", skillMoi.length >= 2, skillMoi.map((w) => w.name).join(" · "));
ok("3 mỗi skill có mô tả", skillMoi.length > 0 && skillMoi.every((w) => (w.description ?? "").trim().length > 0));
const skillTho1 = (await gw("getAgentWorkflows", { id: tho.id })) ?? [];
ok("4 Thợ không nhận skill mới (create_workflow{agent} đi đúng bot)", skillTho1.length === skillTho0.length, `${skillTho0.length} → ${skillTho1.length}`);
const routineMoi = botMoi ? (await gw("getAgentAutomations", { id: botMoi.id })) ?? [] : [];
console.log(`      routine của bot mới: ${routineMoi.map((r) => `${r.name} (${r.triggerDescription})`).join(" · ") || "(không)"}`);

const widget = [...ds1].reverse().find((e) => e.kind === "send-message" && e.message?.type === "widget" && e.respondedValue == null);
const nhan = (widget?.message?.widget?.options ?? []).map((o) => o.label ?? o.value);
ok("5 kết bằng widget hai lựa chọn Marketplace / để riêng", !!widget && nhan.some((l) => /marketplace/i.test(l)), nhan.join(" / "));

let shareId = null;
try {
  if (widget && botMoi) {
    const chon = (widget.message.widget.options.find((o) => /marketplace/i.test(o.label ?? o.value)) ?? {});
    await gw("respondToWidget", { agentId: tho.id, entryId: widget.id, value: chon.value ?? chon.label });
    const t1 = Date.now();
    const ranh2 = await choRanh(180_000, tho.id, ds1.at(-1)?.id ?? null);
    const ds2 = await tail(tho.id);
    console.log(`      lượt 2 xong sau ${((Date.now() - t1) / 1000).toFixed(0)}s · tool: ${inTool(moiSau(ds2, ds1.at(-1)?.id ?? null)) || "(không có)"}`);
    ds2.filter((e) => e.kind === "send-message" && e.author?.id === tho.id && e.message?.type !== "widget").slice(-1).forEach((e) => console.log("      BOT", String(e.message?.content ?? "").replace(/\s+/g, " ").slice(0, 200)));
    const tpl = await gw("getBotTemplateForSourceAgent", { sourceAgentId: botMoi.id });
    shareId = tpl?.shareId ?? null;
    const pub = await gw("listPublicBotMarketplace", {});
    const trenCho = [...(pub?.featuredListings ?? []), ...(pub?.listings ?? [])].some((l) => l.shareId === shareId || l.name === botMoi.name);
    ok("6 mẫu + listing của bot mới lên Marketplace", ranh2 && !!shareId && tpl?.published === true && trenCho, `${shareId ?? "không có mẫu"} · ${tpl?.published ? "published" : "chưa publish"} · ${trenCho ? "có listing" : "không listing"}`);
  }
} finally {
  if (shareId) { await gw("unpublishBotListing", { shareId }); await gw("deleteBotTemplate", { shareId }); }
  for (const a of moi) await gw("deleteAgents", { ids: [a.id] });
  const con = (await gw("listAgents", {})) ?? [];
  ok("7 dọn: bot mới đã xoá, Thợ còn", !con.some((a) => moi.some((m) => m.id === a.id)) && con.some((a) => a.id === tho.id));
  const tplTho = await gw("getBotTemplateForSourceAgent", { sourceAgentId: tho.id });
  ok("7 mẫu của Thợ nguyên", !!tplTho?.shareId, tplTho?.shareId);
}
console.log(fails.length ? `\nĐỎ ${fails.length}: ${fails.join(" · ")}` : "\nXANH — /Dựng bot mới dựng được bot + skill cho ĐÚNG bot mới và đưa lên Marketplace");
process.exit(fails.length ? 1 : 0);
