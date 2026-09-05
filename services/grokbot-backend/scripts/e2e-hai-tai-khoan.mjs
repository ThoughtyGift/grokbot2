/**
 * E2E TÀI KHOẢN THỨ HAI — người B (đăng nhập web, JWT thật) thấy listing của người A trên Marketplace, import ra bot của MÌNH,
 * và không đọc/xoá được mẫu của A. Đo qua `/gw/api` của backend THẬT đang chạy (:8788), không cần lượt model.
 *
 *   node services/grokbot-backend/scripts/e2e-hai-tai-khoan.mjs
 *
 * A = chủ mặc định (vé cổng, `auth0|grokbot2-user`, không header). B = `e2e-b@vi-du.vn`, tạo/đăng nhập bằng
 * `nguoi-b-ngoai.mts` (đăng ký ngoài tiến trình vì `/v1/register` đóng khi đã có người). Mẫu của A tạo bằng
 * `mau-bot-ngoai.mts` (không tốn lượt model). Dọn: bot của B, listing + mẫu + bot thử của A. Người B ở lại kho dev.
 *
 * Lưu ý: `createAgentFromTemplate` tự kích lời chào cho bot mới (một lượt model) — bài này KHÔNG chờ nó; pool đứt thì lượt ấy
 * im, các mốc ở đây vẫn đo được.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GW = process.env.GW ?? "http://127.0.0.1:8788/gw/api";
const HERE = dirname(fileURLToPath(import.meta.url));
const fails = [];
const ok = (n, c, d = "") => { console.log(`${c ? "  ok  " : "  FAIL"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fails.push(n); };
const goi = (token) => async (m, body = {}) => {
  const headers = { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const r = await fetch(`${GW}/${m}`, { method: "POST", headers, body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { __raw: t.slice(0, 160), __status: r.status }; }
};
const ngoai = (script, ...args) => JSON.parse(execFileSync("npx", ["tsx", join(HERE, script), ...args],
  { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n").pop());

const A = goi(null);
const nguoiB = ngoai("nguoi-b-ngoai.mts", "e2e-b@vi-du.vn", "mat-khau-e2e-b-12345");
ok("người B đăng nhập web (JWT)", nguoiB.ok === true && typeof nguoiB.token === "string", nguoiB.email ?? JSON.stringify(nguoiB));
if (!nguoiB.ok) process.exit(1);
const B = goi(nguoiB.token);

const botA = (await A("createAgent", { name: "Kho A (đo 2 tài khoản, xoá sau)", description: "Giữ tồn kho đúng, cutoff 18:00." }))?.agent;
ok("A tạo bot thử", !!botA?.id, botA?.id);
let shareId, slug, botB;
try {
  const mau = ngoai("mau-bot-ngoai.mts", "create", botA.id);
  shareId = mau.shareId;
  ok("A có mẫu public đã publish (ngoài tiến trình)", typeof shareId === "string" && shareId.length === 21, shareId);

  const dang = await A("publishBotListing", { shareId, category: "productivity" });
  slug = dang?.slug;
  ok("A đăng listing lên Marketplace", typeof slug === "string" && slug.length > 0, slug);

  // ── B nhìn thấy gì ──
  const cho = await B("listPublicBotMarketplace", {});
  const tatCa = [...(cho?.featuredListings ?? []), ...(cho?.listings ?? [])];
  const thay = tatCa.find((l) => l.shareId === shareId);
  ok("B thấy listing của A trên Marketplace", !!thay, thay ? `${thay.name} · by ${thay.creator?.name}` : JSON.stringify(cho).slice(0, 120));
  ok("listing mang tên người tạo A, không phải B", thay?.creator?.name && thay.creator.name !== "e2e-b", thay?.creator?.name);

  const imp = await B("getPublicBotTemplate", { shareId });
  ok("B đọc được mẫu public của A (getPublicBotTemplate)", imp?.view?.shareId === shareId && imp?.expectedActiveVersion >= 1, `v${imp?.expectedActiveVersion} · ${imp?.view?.name}`);
  ok("view không lộ sourceAgentId của A", imp?.view && !("sourceAgentId" in imp.view));

  const cuaB = await B("listBotTemplates", {});
  ok("B KHÔNG thấy mẫu của A trong kho mẫu riêng (listBotTemplates)", Array.isArray(cuaB) && !cuaB.some((t) => t.shareId === shareId), `${Array.isArray(cuaB) ? cuaB.length : "?"} mẫu của B`);

  // ── B import ──
  const agentId = randomUUID();
  const made = await B("createAgentFromTemplate", { shareId, agentId, name: "Kho của B (xoá sau)", avatarShape: imp?.view?.avatarShape ?? "blob", avatarColor: imp?.view?.avatarColor ?? "blue", expectedActiveVersion: imp?.expectedActiveVersion ?? 1 });
  botB = made?.agent;
  ok("B import ra bot mang đúng id client đúc", botB?.id === agentId, botB?.id);
  ok("bot mới của B mang mô tả/SOP của mẫu", /cutoff 18:00/.test(String(botB?.description ?? "")), String(botB?.description ?? "").slice(0, 60));

  const rosterB = await B("listAgents", {});
  const rosterA = await A("listAgents", {});
  const dsB = Array.isArray(rosterB) ? rosterB : rosterB?.agents ?? [];
  const dsA = Array.isArray(rosterA) ? rosterA : rosterA?.agents ?? [];
  ok("roster B có bot mới", dsB.some((x) => x.id === agentId));
  ok("roster A KHÔNG có bot của B", !dsA.some((x) => x.id === agentId));
  ok("roster B KHÔNG có bot thử của A", !dsB.some((x) => x.id === botA.id));

  // ── B không phá được của A ──
  const xoaTrom = await B("deleteBotTemplate", { shareId });
  const conKhong = await A("getBotTemplateForSourceAgent", { sourceAgentId: botA.id });
  ok("B gọi deleteBotTemplate lên mẫu của A → mẫu của A còn nguyên", conKhong?.shareId === shareId, `reply cho B: ${JSON.stringify(xoaTrom)}`);
  const goTrom = await B("unpublishBotListing", { shareId });
  const conListing = [...((await A("listPublicBotMarketplace", {}))?.listings ?? []), ...((await A("listPublicBotMarketplace", {}))?.featuredListings ?? [])].some((l) => l.shareId === shareId);
  ok("B gọi unpublishBotListing lên listing của A → listing còn", conListing, `reply cho B: ${JSON.stringify(goTrom)}`);
} finally {
  if (botB?.id) { const d = await B("deleteAgents", { ids: [botB.id] }); ok("dọn: xoá bot của B", Array.isArray(d?.deleted) && d.deleted.includes(botB.id)); }
  if (slug) { const u = await A("unpublishBotListing", { shareId }); ok("dọn: A gỡ listing", u === true || u?.ok === true || u === null, JSON.stringify(u)); }
  if (shareId) { const x = await A("deleteBotTemplate", { shareId }); ok("dọn: A xoá mẫu", x === null, JSON.stringify(x)); }
  if (botA?.id) { const d = await A("deleteAgents", { ids: [botA.id] }); ok("dọn: xoá bot thử của A", Array.isArray(d?.deleted) && d.deleted.includes(botA.id)); }
}
console.log(fails.length ? `\nĐỎ ${fails.length}: ${fails.join(" · ")}` : "\nXANH — tài khoản thứ hai thấy đúng, import đúng chủ, không phá được của người khác");
process.exit(fails.length ? 1 : 0);
