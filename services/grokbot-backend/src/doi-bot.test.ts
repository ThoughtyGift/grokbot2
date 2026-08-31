/**
 * Bước "mỗi con một lịch" — phần đếm được.
 *
 *   npx tsx --test services/grokbot-backend/src/doi-bot.test.ts
 *
 * Bài này không đo model. Nó khoá bốn thứ mà nếu mất đi thì lời dặn trở lại đúng trạng thái đã
 * hỏng: thiếu `agent` (lịch rơi vào bot mẹ), thiếu ví dụ cron, thiếu lời hỏi trước khi đặt, và
 * thiếu ý "mỗi vai một nhịp".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUOC_DAT_LICH } from "./doi-bot.js";

test("dạy nêu tên bot con — thiếu nó thì lịch rơi vào bot mẹ", () => {
  // Lỗi thật 28/08: bot mẹ tạo hai routine cho hai con, cả hai rơi vào chính nó.
  assert.match(BUOC_DAT_LICH, /"agent":"/);
  assert.match(BUOC_DAT_LICH, /PHẢI có/);
});

test("có ví dụ create_routine chạy được, kèm cron thật", () => {
  assert.match(BUOC_DAT_LICH, /TOOL_CALL: create_routine\(\{/);
  assert.match(BUOC_DAT_LICH, /0 8 \* \* 1-5/, "cron phải là chuỗi thật, không phải <giờ>");
});

test("hỏi trước khi đặt lịch, không tự quyết", () => {
  // Một cái lịch chạy mãi về sau; đặt hộ rồi báo sau thì người dùng gặp nó khi nó đã chạy vài hôm.
  assert.match(BUOC_DAT_LICH, /hỏi một câu trước khi tạo/);
});

test("mỗi vai một nhịp, không cùng một giờ cho tất cả", () => {
  assert.match(BUOC_DAT_LICH, /CS theo ca trực/);
  assert.match(BUOC_DAT_LICH, /không phải cùng một giờ/);
});

/*
 * ── Luật đặt tên ────────────────────────────────────────────────────────────────────────────────
 *
 * Trích từ chính tên app gốc đã tạo (prompt live của hãng không có mục nào về đặt tên):
 * `Shopee CS`, `Shopee Kho`, `Shopee Ads`, `Shopee Kế toán`, nhóm `Shopee Ops`. Khuôn `<Miền> <Vai>`.
 */
test("dạy khuôn <Miền> <Vai> kèm ví dụ thật", async () => {
  const { LUAT_DAT_TEN } = await import("./doi-bot.js");
  assert.match(LUAT_DAT_TEN, /<Miền> <Vai>/);
  assert.match(LUAT_DAT_TEN, /Shopee CS/);
  assert.match(LUAT_DAT_TEN, /Shopee Ops/, "nhóm cũng mang tiền tố");
});

test("nói VÌ SAO cần tiền tố, không chỉ ra lệnh", async () => {
  const { LUAT_DAT_TEN } = await import("./doi-bot.js");
  // Một luật không kèm lý do là luật model sẽ bỏ khi nó thấy cách khác gọn hơn.
  assert.match(LUAT_DAT_TEN, /đội thứ hai/);
});

test("cấm đúng bốn thứ làm tên khó đọc trong hàng hẹp", async () => {
  const { LUAT_DAT_TEN } = await import("./doi-bot.js");
  for (const c of [/`Bot`/, /đánh số/, /`&`/, /ĐƠN HÀNG/]) assert.match(LUAT_DAT_TEN, c);
});
