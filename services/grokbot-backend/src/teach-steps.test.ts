/**
 * Bài dạy phải ra danh sách bước GIỐNG VIỆC NGƯỜI ĐÃ LÀM — không thừa hệ quả, không thiếu bàn phím.
 *
 *   npx tsx --test services/grokbot-backend/src/teach-steps.test.ts
 *
 * ── Vì sao có bài này ───────────────────────────────────────────────────────────────────────────
 *
 * Đo thật ngày 2026-08-29: dựng lại đúng bài 24h.com.vn mà app gốc đã ghi (mở Google → gõ `24h` →
 * Enter → bấm kết quả → bấm một bài), routine sinh ra có 8 bước và **không có bước điền nào**. Chữ
 * `24h` — thứ duy nhất người dạy gõ, thứ quyết định bài đó là bài gì — biến mất; còn 4 trong 8 bước
 * là URL do chính các cú bấm sinh ra, trong đó bước 1 là nơi tab đang đứng sẵn từ phiên trước.
 *
 * Xem docs/extracted/0-30-teach-a-task.md để có hai đầu ra đặt cạnh nhau.
 *
 * Bài này khoá cả HAI phía, vì mỗi luật đều có ca ngược đáng giữ:
 *   - bỏ điều hướng hệ quả, NHƯNG giữ điều hướng người tự mở;
 *   - bỏ nơi tab đang đứng, NHƯNG giữ nó khi đó là điểm bắt đầu thật.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stepsToPrompt, type Step } from "./teach.js";

type S = Step & { quality?: string };
const soBuoc = (out: string): string[] => out.split("\n").filter((l) => /^\d+\./.test(l));

test("bài 24h.com.vn ra đúng việc người đã làm, không thừa không thiếu", () => {
  // Đúng chuỗi bước bộ ghi bắt được sau khi vá, với mốc giờ như lần chạy thật.
  const t0 = 1_000_000;
  const out = stepsToPrompt([
    { act: "navigate", url: "https://www.google.com/search?q=24h&sca_esv=625aac&ei=aZOSav", t: t0 },
    { act: "navigate", url: "https://www.google.com/", t: t0 + 4000 },
    { act: "click", sel: "#ti6dpd", quality: "id", t: t0 + 8000 },
    { act: "fill", sel: "#ti6dpd", value: "24h", quality: "id", t: t0 + 9000 },
    { act: "key", key: "Enter", t: t0 + 9500 },
    { act: "navigate", url: "https://www.google.com/search?q=24h&ei=CpSSar", t: t0 + 10_500 },
    { act: "click", sel: ".zReHs", text: "Tin tức bóng đá, thể thao", quality: "class", t: t0 + 14_000 },
    { act: "navigate", url: "https://www.24h.com.vn/", t: t0 + 15_000 },
    { act: "click", sel: ".d-block", text: "Xôn xao hình ảnh xốp", quality: "class", t: t0 + 19_000 },
    { act: "navigate", url: "https://www.24h.com.vn/tin-tuc/xon-xao-c46a1790607.html", t: t0 + 20_000 },
  ] as S[]);

  // Sáu bước, và đúng sáu bước app gốc kể lại: "mở Chrome, gõ `24h` rồi Enter, bấm kết quả
  // 24h.com.vn, mở bài nổi bật trên trang chủ".
  const lines = soBuoc(out);
  assert.equal(lines.length, 6, "mười bước ghi được rút về đúng sáu việc người làm:\n" + out);
  assert.match(lines[0], /mở https:\/\/www\.google\.com\/$/);
  assert.match(lines[1], /bấm `#ti6dpd`/);
  assert.match(lines[2], /điền `#ti6dpd` = "24h"/);
  assert.match(lines[3], /nhấn Enter/);
  assert.match(lines[4], /bấm `\.zReHs`/);
  assert.match(lines[5], /bấm `\.d-block`/);

  // Cái quan trọng nhất: chữ người ta gõ phải còn.
  assert.match(out, /"24h"/, "mất chữ đã gõ là mất luôn nội dung bài dạy");
  // Và không được còn URL kết quả Google mang token hết hạn.
  assert.ok(!/sca_esv|[?&]ei=/.test(out), "URL kết quả Google là hệ quả của cú bấm, không phải việc:\n" + out);
});

test("điều hướng người TỰ mở thì giữ, dù đứng ngay sau một cú bấm", () => {
  const t0 = 5_000_000;
  const out = stepsToPrompt([
    { act: "click", sel: "#dong", quality: "id", t: t0 },
    // Bốn giây sau mới đổi trang: quá xa để là hệ quả của cú bấm, đủ gần để là người gõ địa chỉ.
    { act: "navigate", url: "https://noi-khac.test/bang-dieu-khien", t: t0 + 4000 },
  ] as S[]);
  assert.match(out, /noi-khac\.test/, "bỏ nhầm bước này là routine mất chỗ để đi tiếp");
});

test("nơi tab đang đứng bị bỏ khi có trang khác đè lên ngay", () => {
  const out = stepsToPrompt([
    { act: "navigate", url: "https://con-sot-tu-phien-truoc.test/x" },
    { act: "navigate", url: "https://that-su-bat-dau.test/" },
    { act: "click", sel: "#di", quality: "id" },
  ] as S[]);
  assert.ok(!out.includes("con-sot-tu-phien-truoc"), "không ai mở trang đó trong buổi dạy");
  assert.match(out, /1\. mở https:\/\/that-su-bat-dau\.test\//);
});

test("nơi tab đang đứng được GIỮ khi đó là điểm bắt đầu thật", () => {
  // Người dạy mở sẵn trang cần dạy rồi mới bật ghi — bỏ bước này là routine không biết mở ở đâu.
  const out = stepsToPrompt([
    { act: "navigate", url: "https://crm.test/khach-hang" },
    { act: "click", sel: "#them", quality: "id" },
  ] as S[]);
  assert.match(out, /1\. mở https:\/\/crm\.test\/khach-hang/);
});

test("thiếu mốc giờ thì tin vào thứ tự, không im lặng giữ lại rác", () => {
  const out = stepsToPrompt([
    { act: "click", sel: "#mua", quality: "id" },
    { act: "navigate", url: "https://shop.test/da-dat-hang" },
  ] as S[]);
  assert.equal(soBuoc(out).length, 1, "điều hướng ngay sau cú bấm vẫn là hệ quả:\n" + out);
});

test("phím chức năng có mặt trong bản dịch ra lời", () => {
  const out = stepsToPrompt([
    { act: "fill", sel: "#q", value: "hoá đơn tháng 8", quality: "id" },
    { act: "key", key: "Enter" },
    { act: "key", key: "Escape" },
  ] as S[]);
  assert.match(out, /nhấn Enter/);
  assert.match(out, /nhấn Escape/);
});

test("một bước key không có tên phím thì bỏ qua, không in bước rỗng", () => {
  const out = stepsToPrompt([
    { act: "click", sel: "#a", quality: "id" },
    { act: "key" },
  ] as S[]);
  assert.equal(soBuoc(out).length, 1, "bước rỗng đọc như một việc phải làm mà không nói làm gì");
});
