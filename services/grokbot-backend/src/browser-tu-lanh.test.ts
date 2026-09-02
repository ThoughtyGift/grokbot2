/**
 * Điều kiện tự lành trình duyệt dùng chung.
 *
 * Chỉ test `nenThuLanh` chứ không test cả `tuLanhChromeDungChung`: hàm kia gọi box qua
 * `await import("./box-exec.js")` động, không chèn mock được mà không đổi kiến trúc — cùng giới hạn
 * đã ghi cho `readBoxRange` trong `attachments.ts`. Nên phần đo thật của nó là một lượt thật trên
 * box (`scripts/chrome-webgl.mts`), và phần LOGIC — thứ dễ sai im lặng — nằm ở đây.
 *
 * Hai điều kiện này không phải trang trí. Thiếu vế "có màn hình riêng" thì một bot đã được cấp
 * Chrome riêng sẽ làm backend bật thêm một con dùng chung không ai dùng (~300 MB trên box mà RAM là
 * thứ chặn trước — 14 bot, không phải 37). Thiếu vế khoảng nghỉ thì một trình duyệt chết biến thành
 * một cơn bão lệnh `exec` lên box DÙNG CHUNG, mỗi thao tác browser thất bại một lệnh.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { nenThuLanh } from "./browser.js";

const PHUT = 60_000;

test("bot có màn hình riêng thì KHÔNG lành con dùng chung", () => {
  // Kể cả khi đã quá khoảng nghỉ rất lâu.
  assert.equal(nenThuLanh(10 * PHUT, 0, true), false);
});

test("lần đầu (chưa lành bao giờ) thì được thử", () => {
  assert.equal(nenThuLanh(Date.now(), 0, false), true);
});

test("trong khoảng nghỉ thì KHÔNG thử lại", () => {
  const now = 5 * PHUT;
  assert.equal(nenThuLanh(now, now - 1_000, false), false, "1 giây trước — còn trong khoảng nghỉ");
  assert.equal(nenThuLanh(now, now - 59_000, false), false, "59 giây trước — vẫn trong khoảng nghỉ");
});

test("quá khoảng nghỉ thì thử lại", () => {
  const now = 5 * PHUT;
  assert.equal(nenThuLanh(now, now - 60_000, false), true, "đúng 60 giây — biên tính là được");
  assert.equal(nenThuLanh(now, now - 120_000, false), true);
});
