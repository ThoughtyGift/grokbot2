/**
 * Mẫu bot — dựng một đội một lần, phát cho máy khác.
 *
 *   npx tsx --test services/grokbot-backend/src/bot-templates.test.ts
 *
 * Bài quan trọng nhất là **vòng tròn cả đội**: nhóm 3 bot có SOP riêng → mẫu → dựng lại → phải ra
 * nhóm 3 bot với đúng SOP đó. Dựng lại mỗi cái vỏ nhóm rỗng thì người nhận có một cái phòng không
 * ai ở trong — mà đó chính là thứ tính năng này tồn tại để tránh.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.GROKBOT2_ALLOW_WRITE = "1";
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".data", "bot-templates");
const sach = (): void => { try { rmSync(DIR, { recursive: true, force: true }); } catch { /* chưa có */ } };

const { runWithOwner: as } = await import("./request-context.js");
const { createAgent, createGroup, updateAgent } = await import("./directory/index.js");
const { agents } = await import("./chat/state.js");
const T = await import("./bot-templates.js");

const A = "local|nguoi-a@vi-du.vn";
const B = "local|nguoi-b@vi-du.vn";

/** Dựng đội Shopee thu nhỏ: nhóm + 2 thành viên, mỗi con một SOP. */
function doiShopee(owner: string) {
  return as(owner, () => {
    const kho = createAgent({ name: "Kho", description: "Ưu tiên Hỏa Tốc, cutoff 18:00." });
    const cs = createAgent({ name: "CS", description: "Trả Shopee Chat trong 2 phút." });
    return createGroup({ name: "Shopee Ops", memberAgentIds: [kho.id, cs.id] });
  });
}

test("vòng tròn cả ĐỘI: nhóm 2 bot có SOP → mẫu → dựng lại đủ người, đủ SOP", () => {
  sach();
  const g = doiShopee(A);
  const tpl = as(A, () => T.getBotTemplateForSourceAgent(g.id))!;
  assert.equal(tpl.snapshot.isGroup, true);
  assert.deepEqual(tpl.snapshot.members.map((m) => m.name), ["Kho", "CS"]);

  as(A, () => T.publishBotTemplate(tpl.shareId, 1));
  const made = as(A, () => T.createAgentFromTemplate({ shareId: tpl.shareId, name: "Shopee Ops (bản sao)" }))!;
  const rec = made.agent as { id: string; name: string; isGroup?: boolean; memberIds?: string[] };

  assert.equal(rec.name, "Shopee Ops (bản sao)", "tên trên thẻ phải đè tên của mẫu");
  assert.equal(rec.isGroup, true);
  assert.equal(rec.memberIds?.length, 2, "phòng rỗng là đúng thứ tính năng này phải tránh");
  const dựng = (rec.memberIds ?? []).map((id) => agents.get(id)!);
  assert.deepEqual(dựng.map((m) => m.name), ["Kho", "CS"]);
  assert.match(dựng[0].description ?? "", /Hỏa Tốc/, "SOP thành viên phải đi theo");
  assert.match(dựng[1].description ?? "", /2 phút/);
});

test("bot lẻ cũng dựng lại được, kèm mô tả", () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Kế toán", description: "GMV không phải tiền về." }));
  const tpl = as(A, () => T.getBotTemplateForSourceAgent(bot.id))!;
  const made = as(A, () => T.createAgentFromTemplate({ shareId: tpl.shareId }))!;
  const rec = made.agent as { name: string; description?: string; isGroup?: boolean };
  assert.equal(rec.name, "Kế toán");
  assert.match(rec.description ?? "", /GMV/);
  assert.notEqual(rec.isGroup, true);
});

test("mẫu mới là bản NHÁP — chưa xuất bản", () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Nhap" }));
  const tpl = as(A, () => T.getBotTemplateForSourceAgent(bot.id))!;
  // Máy trạng thái của renderer: activeVersion==null && published===false → chưa xuất bản.
  assert.equal(tpl.published, false);
  assert.equal(tpl.activeVersion, null);
  assert.equal(tpl.visibility, "team", "mặc định KHÔNG public — chia sẻ là việc người dùng tự chọn");
});

test("xuất bản chụp LẠI bot nguồn — sửa mô tả rồi bấm Publish phải ăn bản mới", () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Doi", description: "bản cũ" }));
  const tpl = as(A, () => T.getBotTemplateForSourceAgent(bot.id))!;
  as(A, () => updateAgent({ id: bot.id, description: "bản MỚI sau khi sửa" }));
  const pub = as(A, () => T.publishBotTemplate(tpl.shareId, 2))!;
  assert.match(pub.snapshot.description, /bản MỚI/, "mẫu phải là ảnh của bot HÔM NAY");
  assert.equal(pub.published, true);
  assert.equal(pub.activeVersion, 2);
});

test("gọi lại cho cùng một bot trả về CÙNG mẫu, không đẻ thêm", () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Mot" }));
  const t1 = as(A, () => T.getBotTemplateForSourceAgent(bot.id))!;
  const t2 = as(A, () => T.getBotTemplateForSourceAgent(bot.id))!;
  assert.equal(t1.shareId, t2.shareId);
  assert.equal(as(A, () => T.listBotTemplates()).length, 1);
});

test("mẫu theo NGƯỜI — người B không thấy và không dựng được mẫu của A", () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Rieng" }));
  const tpl = as(A, () => T.getBotTemplateForSourceAgent(bot.id))!;
  assert.deepEqual(as(B, () => T.listBotTemplates()), []);
  assert.equal(as(B, () => T.getBotTemplateVersion(tpl.shareId, 1)), null);
  assert.equal(as(B, () => T.createAgentFromTemplate({ shareId: tpl.shareId })), null);
});

test("đổi tầm nhìn, và xoá", () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Xoa" }));
  const tpl = as(A, () => T.getBotTemplateForSourceAgent(bot.id))!;
  assert.equal(as(A, () => T.setBotTemplateVisibility(tpl.shareId, "public"))?.visibility, "public");
  // Giá trị lạ phải rơi về "team", không được nhận bừa: đây là cờ quyết định ai đọc được mẫu.
  assert.equal(as(A, () => T.setBotTemplateVisibility(tpl.shareId, "ai-cung-doc"))?.visibility, "team");
  as(A, () => T.deleteBotTemplate(tpl.shareId));
  assert.deepEqual(as(A, () => T.listBotTemplates()), []);
});

test("shareId lạ / bot không tồn tại: trả null, không nổ", () => {
  sach();
  assert.equal(as(A, () => T.getBotTemplateForSourceAgent("khong-co")), null);
  assert.equal(as(A, () => T.getBotTemplateForSourceAgent("")), null);
  assert.equal(as(A, () => T.publishBotTemplate("tpl-ma", 1)), null);
  assert.equal(as(A, () => T.setBotTemplateVisibility("tpl-ma", "team")), null);
  assert.equal(as(A, () => T.createAgentFromTemplate({ shareId: "tpl-ma" })), null);
  as(A, () => T.deleteBotTemplate("tpl-ma"));   // không được ném
});

test("dọn", () => { sach(); });
