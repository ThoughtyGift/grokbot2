/**
 * Marketplace bot — kho listing + hồ sơ người tạo (bước D).
 *
 *   npx tsx --test services/grokbot-backend/src/marketplace.test.ts
 *
 * Kho trỏ vào thư mục TẠM trước khi nạp module (bẫy "sổ trắng hoá ra không trắng" — bảng theo dõi §7):
 * `GROKBOT2_DATA_DIR` cho mẫu bot + state, `GROKBOT2_MARKETPLACE_FILE` cho listing.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "gb2-marketplace-"));
process.env.GROKBOT2_ALLOW_WRITE = "1";
process.env.GROKBOT2_DATA_DIR = TMP;
process.env.GROKBOT2_MARKETPLACE_FILE = join(TMP, "marketplace.json");
process.env.GROKBOT2_WORKFLOWS_FILE = join(TMP, "workflows.json");
process.on("exit", () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* đã dọn */ } });

const { runWithOwner: as } = await import("./request-context.js");
const { createAgent } = await import("./directory/index.js");
const T = await import("./bot-templates.js");
const M = await import("./marketplace.js");

const A = "local|nguoi-a@vi-du.vn";
const B = "local|nguoi-b@vi-du.vn";
const OP = "auth0|grokbot2-user";   // người vận hành máy chủ

T.bindTemplateSources({
  skills: () => [{ name: "Đối soát", description: "", content: "" }],   // rỗng cố ý — blob phải lấp
  plugins: () => [{ pluginId: "7", name: "", description: "" }],
});

/** Một mẫu ĐÃ xuất bản của `owner`, tầm nhìn `team` (như sau `share_bot_template`). */
async function mauDaXuatBan(owner: string, name = "Kế toán") {
  const bot = as(owner, () => createAgent({ name, description: "GMV không phải tiền về." }));
  const tpl = (await as(owner, () => T.createTemplateForAgent(bot.id)))!;
  await as(owner, () => T.publishBotTemplate(tpl.shareId, tpl.version));
  return { bot, tpl };
}

test("slug: bỏ dấu, ASCII, ổn định theo shareId", () => {
  assert.equal(M.slugOf("Kế Toán Đội Shopee", "XYe7GA280aaI_mS-2ouZc"), "ke-toan-doi-shopee-xye7ga");
  assert.equal(M.slugOf("  ", "abcdefghijklmnopqrstu"), "bot-abcdef");
});

test("đăng: mẫu phải là của mình, đã xuất bản, nhóm hợp lệ — sai thì từ chối có chữ", async () => {
  const { tpl } = await mauDaXuatBan(A);
  assert.throws(() => M.publishListing({ shareId: tpl.shareId, category: "engineering" }, B), /kho của bạn/);
  assert.throws(() => M.publishListing({ shareId: tpl.shareId, category: "khong-co" }, A), /nhóm phải là một trong/);
  const bot2 = as(A, () => createAgent({ name: "Nháp" }));
  const nhap = (await as(A, () => T.createTemplateForAgent(bot2.id)))!;
  assert.throws(() => M.publishListing({ shareId: nhap.shareId, category: "design" }, A), /chưa xuất bản/);
});

test("đăng xong: tầm nhìn tự sang public, listing hiện trong danh sách với tên/avatar/creator lấy từ mẫu", async () => {
  const { tpl } = await mauDaXuatBan(A, "Kế toán A");
  assert.equal(tpl.visibility, "team");
  const l = M.publishListing({ shareId: tpl.shareId, category: "ops-finance", categories: ["productivity", "khong-co"] }, A);
  assert.equal(l.category, "ops-finance");
  assert.deepEqual(l.categories, ["ops-finance", "productivity"], "nhóm lạ bị bỏ, nhóm chính đứng đầu");
  assert.equal(l.featured, false);
  assert.equal(T.getPublicBotTemplate(tpl.shareId)?.template.visibility, "public");

  const view = M.publicListings().listings.find((x) => x.shareId === tpl.shareId)!;
  assert.equal(view.name, "Kế toán A");
  assert.equal(view.description, "GMV không phải tiền về.");
  // Bot không chọn icon ⇒ icon SUY từ id như client vẽ (avatar-mac-dinh.ts), không phải hằng blob/blue — đo 06/09 trên UI.
  const { avatarCuaBot } = await import("./avatar-mac-dinh.js");
  const mong = avatarCuaBot({ id: tpl.sourceAgentId });
  assert.deepEqual(view.avatar, { kind: "default", shape: mong.shape, color: mong.color });
  assert.equal(view.creator.name, "nguoi-a", "chưa có hồ sơ ⇒ tên suy từ tài khoản");
  assert.equal(view.slug, l.slug);
  assert.ok(M.publicListings("productivity").listings.some((x) => x.shareId === tpl.shareId), "lọc theo nhóm phụ");
  assert.ok(!M.publicListings("design").listings.some((x) => x.shareId === tpl.shareId));

  const lai = M.publishListing({ shareId: tpl.shareId, category: "sales" }, A);
  assert.equal(lai.slug, l.slug, "đăng lại giữ slug");
  assert.equal(lai.category, "sales");
});

test("featured chỉ người vận hành đặt được", async () => {
  const { tpl: cuaA } = await mauDaXuatBan(A, "Của A");
  const la = M.publishListing({ shareId: cuaA.shareId, category: "design", featured: true }, A, OP);
  assert.equal(la.featured, false, "người thường tự khai featured → bỏ qua");
  const { tpl: cuaOp } = await mauDaXuatBan(OP, "Của vận hành");
  const lo = M.publishListing({ shareId: cuaOp.shareId, category: "design", featured: true }, OP, OP);
  assert.equal(lo.featured, true);
  const all = M.publicListings();
  assert.ok(all.featured.some((x) => x.shareId === cuaOp.shareId));
  assert.ok(!all.listings.some((x) => x.shareId === cuaOp.shareId), "một hàng chỉ ở một bên");
});

test("mẫu rút về team → listing biến mất; rút listing → mẫu vẫn còn", async () => {
  const { tpl } = await mauDaXuatBan(A, "Rút");
  M.publishListing({ shareId: tpl.shareId, category: "product" }, A);
  as(A, () => T.setBotTemplateVisibility(tpl.shareId, "team"));
  assert.ok(!M.publicListings().listings.some((x) => x.shareId === tpl.shareId));
  as(A, () => T.setBotTemplateVisibility(tpl.shareId, "public"));
  assert.ok(M.publicListings().listings.some((x) => x.shareId === tpl.shareId));
  assert.equal(M.unpublishListing(tpl.shareId, B), false, "người khác không rút được");
  assert.equal(M.unpublishListing(tpl.shareId, A), true);
  assert.ok(!M.publicListings().listings.some((x) => x.shareId === tpl.shareId));
  assert.ok(T.getPublicBotTemplate(tpl.shareId), "mẫu vẫn import được qua link");
});

test("hồ sơ người tạo: mặc định suy từ tài khoản, đặt được tên/ảnh/handles, listing đọc theo", async () => {
  assert.deepEqual(M.creatorProfileOf(B), { name: "nguoi-b", profilePhotoUrl: "", handles: {} });
  const p = M.setCreatorProfile(B, { name: "  Đội B  ", profilePhotoUrl: "https://vi-du.vn/b.png", handles: { x: "@doib", rong: "  ", so: 5 } });
  assert.deepEqual(p, { name: "Đội B", profilePhotoUrl: "https://vi-du.vn/b.png", handles: { x: "@doib" } });
  const { tpl } = await mauDaXuatBan(B, "Bot của B");
  M.publishListing({ shareId: tpl.shareId, category: "marketing" }, B);
  const v = M.publicListings().listings.find((x) => x.shareId === tpl.shareId)!;
  assert.deepEqual(v.creator, { name: "Đội B", profilePhotoUrl: "https://vi-du.vn/b.png", handles: { x: "@doib" } });
  assert.equal(M.setCreatorProfile(B, { name: "" }).name, "Đội B", "tên rỗng không đè tên cũ");
});

test("cổng RPC: chi tiết import + blob_get_url trên baseUrl; not_found / permission_denied phân biệt", async () => {
  const { tpl } = await mauDaXuatBan(A, "Cổng");
  const port = M.marketplacePortFor("https://bot.vi-du.vn/");
  assert.equal(port.templateImportDetails(tpl.shareId), "permission_denied", "đã xuất bản nhưng còn team");
  assert.equal(port.templateImportDetails("khong_co_khong_co_kho"), "not_found");
  assert.equal(port.templateImportDetails("ngan"), "not_found", "sai regex cũng là không có");
  M.publishListing({ shareId: tpl.shareId, category: "sales" }, A);
  const d = port.templateImportDetails(tpl.shareId);
  assert.ok(typeof d === "object");
  assert.equal(d.blobGetUrl, `https://bot.vi-du.vn/gw/bot-template-blob/${tpl.shareId}/1.json`);
  assert.equal(d.expectedActiveVersion, 1);
  assert.equal(d.template.visibility, "public");
  assert.equal(d.creatorDisplayName, "nguoi-a");
  const bySlug = port.listingBySlug(M.listingsOf(A).find((l) => l.shareId === tpl.shareId)!.slug);
  assert.equal(bySlug?.templateGetUrl, d.blobGetUrl);
  assert.equal(port.listingBySlug("khong-co"), null);
});

test("blob recipe: đúng bản active, mọi chuỗi zod Dct của MAIN đòi min(1) đều có chữ", async () => {
  const { tpl } = await mauDaXuatBan(A, "Blob");
  as(A, () => T.setBotTemplateVisibility(tpl.shareId, "public"));
  assert.equal(M.recipeBlob(tpl.shareId, 2), null, "bản không active → không có blob");
  const r = M.recipeBlob(tpl.shareId, 1)!;
  assert.equal(r.profile.name, "Blob");
  assert.ok(r.profile.description.length > 0);
  assert.ok(r.skills.every((s) => s.name && s.description && s.content), JSON.stringify(r.skills));
  assert.ok(r.plugins.every((p) => p.pluginId && p.name && !("description" in p)), "description rỗng phải VẮNG, không phải chuỗi rỗng");
  assert.equal("gettingStarted" in r, false);
  assert.ok(existsSync(join(TMP, "marketplace.json")), "kho nằm trong thư mục tạm, không phải .data thật");
});
