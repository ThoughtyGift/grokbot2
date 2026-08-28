/**
 * `create_routine` gắn routine cho AI.
 *
 *   npx tsx --test services/grokbot-backend/src/routine-target.test.ts
 *
 * Đo 28/08: bot mẹ dựng đội ba con rồi tạo routine cho từng con — tên routine ghi rõ "Kho - …",
 * "CSKH - …" — nhưng cả hai rơi vào BOT MẸ, vì tool cứng `ctx.agentId`. Con bot thật sự phải chạy
 * việc đó thì không có lịch nào; con không liên quan thì ôm hết.
 *
 * App gốc gắn vào từng con: ảnh chụp máy người dùng cho thấy bảng Routines nằm trong panel của
 * chính bot đó — Shopee Kho có "Hàng chờ lấy", Kế toán có "Nhật ký P và L tuần".
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.GROKBOT2_ALLOW_WRITE = "1";
const { runWithOwner: as } = await import("./request-context.js");
const { createAgent } = await import("./directory/index.js");
const { TOOLS } = await import("./runtime/tools.js");
const A = await import("./automations.js");

const OWNER = "local|routine@vi-du.vn";
const NGUOI_KHAC = "local|nguoi-khac@vi-du.vn";
const goi = (ctxId: string, spec: unknown) =>
  String(TOOLS.create_routine!(JSON.stringify(spec), { agentId: ctxId } as never));
const dem = (id: string) => as(OWNER, () => A.getAgentAutomations({ agentId: id, id: id })).length;

test("không nêu agent → routine thuộc về chính người gọi", () => {
  const me = as(OWNER, () => createAgent({ name: "Tu lam" }));
  as(OWNER, () => goi(me.id, { name: "Sáng", prompt: "rà đơn", trigger: "0 8 * * *" }));
  assert.equal(dem(me.id), 1);
});

test("nêu tên đồng đội → routine thuộc về ĐỒNG ĐỘI, không phải người gọi", () => {
  const me = as(OWNER, () => createAgent({ name: "Quan ly" }));
  const kho = as(OWNER, () => createAgent({ name: "Kho" }));
  const truoc = dem(me.id);
  as(OWNER, () => goi(me.id, { name: "Hàng chờ lấy", prompt: "kéo queue", trigger: "0 8,12,17,22 * * *", agent: "Kho" }));
  assert.equal(dem(kho.id), 1, "đồng đội phải nhận routine");
  assert.equal(dem(me.id), truoc, "người gọi KHÔNG được ôm thêm routine của người khác");
});

test("bot của người khác → từ chối, không đặt lịch trên hạn mức của họ", () => {
  const me = as(OWNER, () => createAgent({ name: "Quan ly 2" }));
  const la = as(NGUOI_KHAC, () => createAgent({ name: "Bot nguoi la" }));
  const r = as(OWNER, () => goi(me.id, { name: "X", prompt: "y", trigger: "0 9 * * *", agent: "Bot nguoi la" }));
  assert.match(r, /không thấy bot/, `phải từ chối, nhận: ${r}`);
  assert.equal(as(NGUOI_KHAC, () => A.getAgentAutomations({ agentId: la.id, id: la.id })).length, 0, "bot người khác không được mọc routine");
});

test("tên không có thật → nói rõ có những bot nào, không im lặng tạo cho mình", () => {
  const me = as(OWNER, () => createAgent({ name: "Quan ly 3" }));
  const truoc = dem(me.id);
  const r = as(OWNER, () => goi(me.id, { name: "X", prompt: "y", trigger: "0 9 * * *", agent: "Khong-ton-tai" }));
  assert.match(r, /không thấy bot/);
  assert.equal(dem(me.id), truoc, "từ chối thì KHÔNG được lặng lẽ gắn vào người gọi");
});
