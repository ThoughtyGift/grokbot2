/**
 * E2E trang đích của "Copy link" — `/bot/<shareId>` — đo qua Internet trên máy chủ THẬT, hoặc localhost.
 *
 *   # trên VPS (ssh vào rồi chạy; token đọc từ kho dùng chung):
 *   GW=http://127.0.0.1:8788/gw/api GW_TOKEN_FILE=/opt/grokbot2/shared/data/gateway-token.txt \
 *   SITE=https://cinai.app/agent node e2e-trang-chia-se.mjs
 *   # máy dev (không auth, trang ở chính backend):
 *   node services/grokbot-backend/scripts/e2e-trang-chia-se.mjs
 *
 * Đi đúng đường của người dùng: bot thử → client gửi câu `Create a template of yourself…` (`sendPrompt`, đúng shape
 * `coverage.lastArgs`) → bot stage mẫu → trước publish trang phải 404 → `publishBotTemplate` → trang 200 với title
 * "<tên> by <người tạo>", og:url = link đã chép, nút Thêm vào Grok Bot = deep link, lối tải app → xoá mẫu + bot → 404 lại.
 * Gửi MỘT lượt model. Đo 06/09 trên cinai.app: 15/15 (sau khi vá hosts `admin.halcion.vn` trên VPS — xem bảng theo dõi §7).
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const GW = process.env.GW ?? "http://127.0.0.1:8788/gw/api";
// Mặc định cục bộ là `localhost`, không phải `127.0.0.1`: `shareUrlOf` khi thiếu `GROKBOT2_PUBLIC_SITE` rơi về
// `http://localhost:8788`, còn GW của bài này gõ `127.0.0.1` — 06/09 lệch chuỗi ấy làm 2/17 đỏ trên một sản phẩm đúng.
const SITE = (process.env.SITE ?? GW.replace(/\/gw\/api$/, "").replace("127.0.0.1", "localhost")).replace(/\/+$/, "");
const TOKEN = process.env.GW_TOKEN_FILE ? readFileSync(process.env.GW_TOKEN_FILE, "utf8").trim() : (process.env.GW_TOKEN ?? "");
const gw = async (m, body = {}) => {
  const headers = { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) };
  const r = await fetch(`${GW}/${m}`, { method: "POST", headers, body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { __raw: t.slice(0, 200), __status: r.status }; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const ok = (n, c, d = "") => { console.log(`${c ? "  ok  " : "  FAIL"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fails.push(n); };
const trang = (shareId, extra = "") => fetch(`${SITE}/bot/${shareId}${extra}`, { redirect: "manual" });

const TEN = "Mẫu thử trang chia sẻ (xoá sau)";
const a = await gw("createAgent", { name: TEN, description: "Bot đo trang /bot/<shareId> — xoá ngay sau khi đo. Việc: nhắc lịch họp nhóm." });
const id = a?.agent?.id;
ok("tạo bot thử", !!id, id ?? JSON.stringify(a).slice(0, 160));
if (!id) process.exit(1);
let shareId, version;
try {
  await sleep(2000);
  const s = await gw("sendPrompt", { prompt: "Create a template of yourself that I can share with somebody else.", agentId: id, directAddressedAcceptance: true, clientNonce: randomUUID() });
  ok("sendPrompt nhận", s?.accepted === true, JSON.stringify(s).slice(0, 100));
  const t0 = Date.now();
  let tpl = null;
  while (Date.now() - t0 < 150_000) {
    tpl = await gw("getBotTemplateForSourceAgent", { sourceAgentId: id });
    if (tpl?.shareId) break;
    await sleep(3000);
  }
  ok("bot stage mẫu (lượt model)", !!tpl?.shareId, `${((Date.now() - t0) / 1000).toFixed(0)}s · ${tpl?.shareId} v${tpl?.version} published=${tpl?.published}`);
  if (!tpl?.shareId) throw new Error("không có mẫu — xem transcript bot thử trước khi nó bị xoá: đọc /gw/health lastBusyAtMs, journal");
  shareId = tpl.shareId; version = tpl.version;
  ok("shareUrl = SITE/bot/<shareId>", tpl.shareUrl === `${SITE}/bot/${shareId}`, tpl.shareUrl);

  ok("trước publish → 404", (await trang(shareId)).status === 404);
  const pub = await gw("publishBotTemplate", { shareId, version });
  ok("publish", pub?.published === true && pub?.activeVersion === version, JSON.stringify({ published: pub?.published, activeVersion: pub?.activeVersion }));

  const r = await trang(shareId);
  const html = await r.text();
  ok("sau publish → 200 text/html", r.status === 200 && /text\/html/.test(r.headers.get("content-type") ?? ""), `${r.status}`);
  ok("CSP nonce · nosniff · X-Frame-Options DENY", /script-src 'nonce-/.test(r.headers.get("content-security-policy") ?? "") && r.headers.get("x-frame-options") === "DENY");
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
  ok("title '<tên> by <người tạo>'", title.startsWith(`${TEN} by `) && title.length > TEN.length + 4, title);
  ok("og:url = link đã chép", html.includes(`property="og:url" content="${SITE}/bot/${shareId}"`));
  ok("nút Thêm vào Grok Bot = deep link", html.includes(`href="grokbot://app/v1/bot-template?id=${shareId}"`));
  ok("có lối tải app tương đối", html.includes(`href="../download/windows"`));
  const dl = await fetch(`${SITE}/download/windows`, { method: "HEAD", redirect: "manual" });
  ok("đích của lối tải trả lời", dl.status === 200 || dl.status === 503, `${dl.status} ${dl.headers.get("content-disposition") ?? ""}`.slice(0, 100));
  const gach = await trang(shareId, "/");
  ok("gạch chéo cuối → 301 tương đối về dạng chuẩn", gach.status === 301 && gach.headers.get("location") === `../${shareId}`, `${gach.status} ${gach.headers.get("location")}`);
  console.log("  mô tả:", (/<div class="desc">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "(không có)").replace(/\s+/g, " ").slice(0, 160));
  console.log(`  LINK: ${SITE}/bot/${shareId}`);
} finally {
  if (shareId) { const d = await gw("deleteBotTemplate", { shareId }); ok("xoá mẫu", d === null); }
  const del = await gw("deleteAgents", { ids: [id] });
  ok("xoá bot thử", Array.isArray(del?.deleted) && del.deleted.includes(id));
  if (shareId) ok("sau khi xoá → 404", (await trang(shareId)).status === 404);
}
console.log(fails.length ? `\nĐỎ ${fails.length}: ${fails.join(" · ")}` : `\nXANH — trang /bot/<shareId> sống ở ${SITE}`);
process.exit(fails.length ? 1 : 0);
