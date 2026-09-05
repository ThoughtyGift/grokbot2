/**
 * E2E Marketplace bot (bước D) — đo qua backend THẬT đang chạy, cả hai cửa client 0.43 dùng:
 *
 *   node services/grokbot-backend/scripts/e2e-marketplace.mjs
 *
 *   /gw/api                                   đăng listing, hồ sơ người tạo, danh sách (đường ĐĂNG + bài đo)
 *   /aiserver.v1.GrokBotService/…             RPC proto main-side 0.43 gọi: ListPublicGrokBotMarketplaceListings,
 *                                             GetGrokBotTemplateImportDetails (+ hai mã lỗi Connect)
 *   GET blob_get_url                          recipe JSON main tải trần rồi parse bằng zod `Dct` (mọi chuỗi min(1))
 *
 * Tự chứa: tạo bot nguồn + mẫu, đo, rồi dọn (listing, skill, bot, mẫu). Mẫu tạo qua `mau-bot-ngoai.mts` vì cửa
 * TẠO mẫu không có lệnh gateway (bên mình đi qua tool trong một lượt chat).
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.GROKBOT2_BASE ?? "http://127.0.0.1:8788").replace(/\/+$/, "");
const GW = `${BASE}/gw/api`;
const OWNER = process.env.MAU_OWNER ?? "auth0|grokbot2-user";
const NGOAI = join(dirname(fileURLToPath(import.meta.url)), "mau-bot-ngoai.mts");
const gw = async (m, body = {}) => {
  const r = await fetch(`${GW}/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => null);
};
const fails = [];
const ok = (name, cond, detail = "") => { console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); if (!cond) fails.push(name); };
const ngoai = (...args) => JSON.parse(execFileSync("npx", ["tsx", NGOAI, ...args],
  { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, MAU_OWNER: OWNER } }).trim().split("\n").pop());

// ── protobuf tối thiểu: đủ để đóng request và mở reply của ba RPC ─────────────────────────────────
const varint = (n) => { const out = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v > 0n) b |= 0x80; out.push(b); } while (v > 0n); return Buffer.from(out); };
const pbStr = (no, s) => { const b = Buffer.from(s, "utf8"); return Buffer.concat([varint((no << 3) | 2), varint(b.length), b]); };
const pbVar = (no, v) => Buffer.concat([varint(no << 3), varint(v)]);
const readVarint = (buf, i) => { let shift = 0n, v = 0n; for (;;) { const b = buf[i++]; v |= BigInt(b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7n; } return [v, i]; };
function* walk(buf) {
  let i = 0;
  while (i < buf.length) {
    let [tag, j] = readVarint(buf, i); i = j; const no = Number(tag >> 3n), wire = Number(tag & 7n);
    if (wire === 0) { const [v, k] = readVarint(buf, i); i = k; yield { no, val: Number(v) }; }
    else if (wire === 2) { const [len, k] = readVarint(buf, i); i = k + Number(len); yield { no, bytes: buf.subarray(k, i) }; }
    else if (wire === 1) i += 8; else if (wire === 5) i += 4; else throw new Error(`wire ${wire}`);
  }
}
const str = (buf, no) => { let s = ""; for (const f of walk(buf)) if (f.no === no && f.bytes) s = f.bytes.toString("utf8"); return s; };
const strs = (buf, no) => [...walk(buf)].filter((f) => f.no === no && f.bytes).map((f) => f.bytes.toString("utf8"));
const num = (buf, no) => { let v; for (const f of walk(buf)) if (f.no === no && f.val !== undefined) v = f.val; return v; };
const msgs = (buf, no) => [...walk(buf)].filter((f) => f.no === no && f.bytes).map((f) => f.bytes);
const rpc = async (method, body, ct = "application/proto") => {
  const r = await fetch(`${BASE}/aiserver.v1.GrokBotService/${method}`, { method: "POST", headers: { "content-type": ct }, body });
  return { status: r.status, ct: r.headers.get("content-type") ?? "", body: Buffer.from(await r.arrayBuffer()) };
};

const health = await fetch(`${BASE}/gw/health`).then((r) => r.status).catch(() => 0);
if (health !== 200) { console.log(`backend chưa lên (${BASE} → ${health}) — bật \`pnpm backend\` trước`); process.exit(1); }

// 1 · bot nguồn + 2 skill (một cái mô tả rỗng — zod Dct của main từ chối chuỗi rỗng)
const nguon = (await gw("createAgent", { name: "E2E chợ (xoá)", description: "Bot tạm của bài đo Marketplace." }))?.agent;
if (!nguon?.id) { console.log("không tạo được bot nguồn"); process.exit(1); }
await gw("createAgentWorkflow", { agentId: nguon.id, name: "Skill chợ một", description: "Cuối tuần", instructions: "1. mở báo cáo\n2. gửi" });
await gw("createAgentWorkflow", { agentId: nguon.id, name: "Skill chợ hai", description: "", instructions: "chỉ có bước" });

let shareId = null, slug = null;
const hoSoCu = await gw("getCreatorProfile");
try {
  // 2 · đăng khi chưa có mẫu → từ chối có chữ
  const chuaCo = await gw("publishBotListing", { shareId: "khong_co_khong_co_kho", category: "sales" });
  ok("đăng mẫu không tồn tại → ok:false có lý do", chuaCo?.ok === false && /shareId/.test(chuaCo.reason ?? ""), chuaCo?.reason);

  shareId = ngoai("create", nguon.id).shareId;
  ok("mẫu nguồn có shareId 21 ký tự", /^[A-Za-z0-9_-]{21}$/.test(shareId ?? ""), shareId);

  const saiNhom = await gw("publishBotListing", { shareId, category: "khong-co" });
  ok("nhóm lạ → từ chối, câu trả lời liệt kê 9 nhóm", saiNhom?.ok === false && /engineering.*productivity/.test(saiNhom.reason ?? ""), saiNhom?.reason?.slice(0, 80));

  const l = await gw("publishBotListing", { shareId, category: "productivity", categories: ["sales"], featured: true });
  slug = l?.slug ?? null;
  ok("đăng thành công → listing {slug, category, categories}", typeof slug === "string" && l.category === "productivity" && Array.isArray(l.categories) && l.categories.includes("sales"), JSON.stringify(l)?.slice(0, 160));
  ok("featured của người vận hành được nhận (chủ mặc định = người vận hành máy này)", l?.featured === true, String(l?.featured));

  // 3 · hồ sơ người tạo
  const ho = await gw("setCreatorProfile", { name: "Đội E2E", handles: { x: "@e2e" } });
  ok("setCreatorProfile → {name, profilePhotoUrl, handles}", ho?.name === "Đội E2E" && ho.handles?.x === "@e2e" && typeof ho.profilePhotoUrl === "string", JSON.stringify(ho));

  // 4 · danh sách qua gateway (hình dạng renderer)
  const ds = await gw("listPublicBotMarketplace");
  const hang = [...(ds?.featuredListings ?? []), ...(ds?.listings ?? [])].find((x) => x.shareId === shareId);
  ok("listPublicBotMarketplace có hàng của mình, ở featured", !!hang && (ds.featuredListings ?? []).some((x) => x.shareId === shareId), JSON.stringify(hang)?.slice(0, 200));
  ok("hàng: name/description từ mẫu, avatar mặc định, creator.name = hồ sơ", hang?.name === "E2E chợ (xoá)" && hang?.description === "Bot tạm của bài đo Marketplace." && hang?.avatar?.kind === "default" && hang?.creator?.name === "Đội E2E");
  ok("lọc theo nhóm phụ 'sales' thấy · 'design' không thấy",
    [...((await gw("listPublicBotMarketplace", { category: "sales" }))?.featuredListings ?? [])].some((x) => x.shareId === shareId)
    && ![...((await gw("listPublicBotMarketplace", { category: "design" }))?.featuredListings ?? [])].some((x) => x.shareId === shareId));
  ok("listMyBotListings có slug của mình", ((await gw("listMyBotListings")) ?? []).some((x) => x.slug === slug));

  // 5 · RPC main-side 0.43: danh sách
  const list = await rpc("ListPublicGrokBotMarketplaceListings", pbVar(2, 100));
  ok("RPC ListPublicGrokBotMarketplaceListings → 200 application/proto", list.status === 200 && /proto/.test(list.ct), `${list.status} ${list.ct}`);
  const row = [...msgs(list.body, 1), ...msgs(list.body, 2)].find((m) => str(m, 9) === shareId);
  ok("hàng proto: slug(1) · share_id(9) · categories(11) · creator(10).name(1) · default_avatar(5)", !!row && str(row, 1) === slug && strs(row, 11).includes("sales") && str(msgs(row, 10)[0] ?? Buffer.alloc(0), 1) === "Đội E2E" && msgs(row, 5).length === 1,
    row ? `${str(row, 1)} · ${strs(row, 11).join(",")}` : "không thấy hàng");
  ok("next_page_token rỗng (một trang)", str(list.body, 3) === "");

  // 6 · RPC chi tiết import → blob
  const det = await rpc("GetGrokBotTemplateImportDetails", pbStr(1, shareId));
  ok("GetGrokBotTemplateImportDetails → 200", det.status === 200, String(det.status));
  const tpl = msgs(det.body, 1)[0] ?? Buffer.alloc(0);
  const blobUrl = str(det.body, 2);
  ok("template(1): share_id · published · active_version=1 · visibility PUBLIC(1) · owner_type USER(1)", str(tpl, 1) === shareId && num(tpl, 10) === 1 && num(tpl, 11) === 1 && num(tpl, 13) === 1 && num(tpl, 14) === 1);
  ok("expected_active_version(3)=1 · creator_display_name(4)=hồ sơ", num(det.body, 3) === 1 && str(det.body, 4) === "Đội E2E", str(det.body, 4));
  ok("blob_get_url trỏ về backend này, đúng shareId/bản", blobUrl === `${BASE}/gw/bot-template-blob/${shareId}/1.json`, blobUrl);

  const blobRes = await fetch(blobUrl);   // trần, không header — đúng như main
  const recipe = await blobRes.json().catch(() => null);
  ok("blob tải trần được (không vé cổng) → 200 JSON", blobRes.status === 200 && recipe && typeof recipe === "object", String(blobRes.status));
  const chu = (s) => typeof s === "string" && s.length > 0;
  ok("recipe qua zod Dct của main: profile.name/description · skills name+description+content · plugins name (description vắng nếu rỗng)",
    chu(recipe?.profile?.name) && chu(recipe?.profile?.description)
    && Array.isArray(recipe?.skills) && recipe.skills.length === 2 && recipe.skills.every((s) => chu(s.name) && chu(s.description) && chu(s.content))
    && Array.isArray(recipe?.plugins) && recipe.plugins.every((p) => chu(p.pluginId) && chu(p.name) && !("description" in p && !chu(p.description))),
    JSON.stringify(recipe?.skills?.map((s) => s.description)));
  ok("blob bản không active → 404", (await fetch(`${BASE}/gw/bot-template-blob/${shareId}/2.json`)).status === 404);

  // 7 · hai mã lỗi Connect
  const khong = await rpc("GetGrokBotTemplateImportDetails", pbStr(1, "khong_co_khong_co_kho"));
  ok("shareId không có → HTTP 404 JSON code not_found", khong.status === 404 && JSON.parse(khong.body.toString("utf8")).code === "not_found", `${khong.status} ${khong.body.toString("utf8").slice(0, 80)}`);
  const khung = await rpc("GetGrokBotTemplateImportDetails", pbStr(1, "khong_co_khong_co_kho"), "application/connect+proto");
  ok("đường khung connect+proto → 200 + khung end-stream mang error.not_found", khung.status === 200 && khung.body[0] === 2 && JSON.parse(khung.body.subarray(5).toString("utf8")).error?.code === "not_found");

  await gw("setBotTemplateVisibility", { shareId, visibility: "team" });
  const cam = await rpc("GetGrokBotTemplateImportDetails", pbStr(1, shareId));
  ok("mẫu rút về team → 403 permission_denied, và biến mất khỏi danh sách", cam.status === 403 && JSON.parse(cam.body.toString("utf8")).code === "permission_denied"
    && ![...msgs((await rpc("ListPublicGrokBotMarketplaceListings", pbVar(2, 100))).body, 1)].some((m) => str(m, 9) === shareId), String(cam.status));
} finally {
  if (shareId) ok("rút listing → ok:true", (await gw("unpublishBotListing", { shareId }))?.ok === true);
  if (hoSoCu) await gw("setCreatorProfile", { name: hoSoCu.name, profilePhotoUrl: hoSoCu.profilePhotoUrl, handles: hoSoCu.handles ?? {} });
  for (const w of (await gw("getAgentWorkflows", { id: nguon.id })) ?? []) await gw("deleteAgentWorkflow", { workflowId: w.id });
  await gw("deleteAgent", { id: nguon.id });
  if (shareId) ngoai("delete", shareId);
  ok("dọn xong: không còn listing của mình", !((await gw("listMyBotListings")) ?? []).some((x) => x.shareId === shareId));
  ok("dọn xong: mẫu và bot đã xoá", (await gw("getBotTemplateForSourceAgent", { sourceAgentId: nguon.id })) === null
    && !(((await gw("listAgents")) ?? [])).some((a) => a.id === nguon.id));
}
console.log(fails.length ? `\nĐỎ ${fails.length}: ${fails.join(" · ")}` : "\nXANH — Marketplace bot: gateway + RPC proto 0.43 + blob recipe");
process.exit(fails.length ? 1 : 0);
