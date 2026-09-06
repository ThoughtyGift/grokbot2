/**
 * `publish_bot_listing{agent, category, description}` — MỘT lệnh đóng gói + phát + đăng listing.
 *
 * Đo 06/09 trên VPS (Thợ dựng bot): bước "Đưa lên Marketplace" viết là `share_bot_template` rồi `publish_bot_listing`,
 * và model dừng sau lệnh đầu vì kết quả của nó bảo "mời người dùng bấm Publish" — Marketplace không có gì. Nay skill
 * chỉ gọi `publish_bot_listing` kèm `description`; tool phải (1) đặt đúng câu ấy làm thân thẻ (không phải SOP của bot),
 * (2) phát bản vừa đóng gói, (3) đăng listing đúng nhóm; và (4) một mẫu đang có bản CHỜ (do share_bot_template) thì
 * phát bản chờ ấy chứ không giữ bản cũ.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Cách ly VÔ ĐIỀU KIỆN (bảng theo dõi §7 "bộ test xoá kho thật" · "runner cấp một DATA_DIR cho cả bộ").
const goc = mkdtempSync(join(tmpdir(), "grokbot2-publish-mot-lenh-"));
process.env.GROKBOT2_ALLOW_WRITE = "1";
process.env.GROKBOT2_DATA_DIR = goc;
process.env.GROKBOT2_MARKETPLACE_FILE = join(goc, "marketplace.json");
process.env.GROKBOT2_WORKFLOWS_FILE = join(goc, "workflows.json");
process.env.GROKBOT2_STATE_FILE = join(goc, "state.json");
const { runWithOwner: as } = await import("./request-context.js");
const { createAgent } = await import("./directory/index.js");
const { TOOLS } = await import("./runtime/tools.js");
const { getBotTemplateForSourceAgent } = await import("./bot-templates.js");
const { listingsOf } = await import("./marketplace.js");

const OWNER = "local|publish-mot-lenh@vi-du.vn";
const rieng = (ten: string): string => `${ten} ${Math.random().toString(36).slice(2, 8)}`;
const ctx = (agentId: string) => ({ agentId, note: () => {}, draft: () => {} }) as unknown as Parameters<typeof TOOLS.publish_bot_listing>[1];
const SOP = "Bạn là bot săn khách. Bước 1… Bước 2… (SOP dài, không được lên thẻ)";
const THE = "Lọc khách tiềm năng và soạn tin chào đầu cho đội sales nhỏ. Giọng ngắn. Không gửi tin thay người dùng.";

test("description → thân thẻ đúng câu ấy, mẫu đã phát, listing đúng nhóm — trong một lệnh", async () => {
  const me = as(OWNER, () => createAgent({ name: rieng("Thợ") }));
  const con = as(OWNER, () => createAgent({ name: rieng("Săn Khách"), description: SOP }));
  const r = await as(OWNER, () => TOOLS.publish_bot_listing(JSON.stringify({ agent: con.name, category: "sales", description: THE }), ctx(me.id)));
  assert.match(String(r), /đã đăng .* nhóm sales/);
  const tpl = as(OWNER, () => getBotTemplateForSourceAgent(con.id));
  assert.ok(tpl, "phải có mẫu cho bot mới");
  assert.equal(tpl.published, true);
  assert.ok(tpl.activeVersion != null, "bản phát phải có số");
  assert.equal(tpl.staged, undefined, "không còn bản chờ lửng");
  assert.equal(tpl.description, THE, "thân thẻ = description model đưa, không phải SOP");
  const ls = listingsOf(OWNER).filter((l) => l.shareId === tpl.shareId);
  assert.equal(ls.length, 1);
  assert.equal(ls[0].category, "sales");
});

test("mẫu đang có bản CHỜ (share_bot_template trước) → publish_bot_listing phát đúng bản chờ", async () => {
  const me = as(OWNER, () => createAgent({ name: rieng("Thợ") }));
  const con = as(OWNER, () => createAgent({ name: rieng("Hoàn Trả"), description: SOP }));
  await as(OWNER, () => TOOLS.share_bot_template(JSON.stringify({ agent: con.name, description: THE }), ctx(me.id)));
  const cho = as(OWNER, () => getBotTemplateForSourceAgent(con.id));
  assert.ok(cho?.staged, "share_bot_template phải để lại bản chờ");
  const r = await as(OWNER, () => TOOLS.publish_bot_listing(JSON.stringify({ agent: con.name, category: "customer-support" }), ctx(me.id)));
  assert.match(String(r), /đã đăng/);
  const tpl = as(OWNER, () => getBotTemplateForSourceAgent(con.id));
  assert.equal(tpl?.published, true);
  assert.equal(tpl?.activeVersion, cho.staged.version);
  assert.equal(tpl?.description, THE);
  assert.equal(tpl?.staged, undefined);
});

test("không description, chưa có mẫu → vẫn đóng gói + phát + đăng (đường cũ giữ nguyên)", async () => {
  const me = as(OWNER, () => createAgent({ name: rieng("Thợ") }));
  const con = as(OWNER, () => createAgent({ name: rieng("Sổ Thu Chi"), description: SOP }));
  const r = await as(OWNER, () => TOOLS.publish_bot_listing(JSON.stringify({ agent: con.name, category: "ops-finance" }), ctx(me.id)));
  assert.match(String(r), /đã đăng .* nhóm ops-finance/);
  const tpl = as(OWNER, () => getBotTemplateForSourceAgent(con.id));
  assert.equal(tpl?.published, true);
});
