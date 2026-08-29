/**
 * Bản ghi dạy việc KHÔNG được mang mật khẩu, OTP, khoá API hay số thẻ vào routine.
 *
 *   npx tsx --test services/grokbot-backend/src/teach-mask.test.ts
 *
 * ── Vì sao ──────────────────────────────────────────────────────────────────────────────────────
 *
 * `teach.ts` chỉ che 'input[type=password]'. Mọi ô khác ghi nguyên văn rồi thành một routine SỐNG
 * MÃI, đọc được từ bảng Routines. Ô OTP hầu như luôn là type="text"; khoá API dán vào ô text cũng
 * vậy; số thẻ trên phần lớn trang thanh toán cũng vậy.
 *
 * App gốc 0.30 nêu phạm vi trong skill 'learn-from-demonstration': "passwords, one-time codes, API
 * keys, financial account numbers, and private personal details".
 *
 * ── Và vì sao KHÔNG che nhiều hơn ───────────────────────────────────────────────────────────────
 *
 * Che một giá trị THẬT thì bước đó không replay được nữa. Một dãy 4–8 chữ số trần có thể là OTP,
 * mà cũng có thể là số lượng, năm, mã bưu chính. Nên luật che bám tín hiệu mạnh, và bài test này
 * khoá cả HAI phía: che đúng thứ nhạy cảm, và KHÔNG che giá trị thường.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Script chạy TRONG TRANG, không export được. Nên bài này bóc đúng ba hàm quyết định ra khỏi nguồn
 * rồi chạy thật — đo mã đang chạy, không đọc chữ trong file.
 */
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "teach.ts"), "utf8");
const lay = (ten: string): string => {
  const i = src.indexOf(`const ${ten} = `);
  assert.ok(i > 0, `không thấy ${ten} trong teach.ts`);
  const j = src.indexOf("\n  };", i);
  return src.slice(i, j + 5).replace(/^  /gm, "");
};
const dung = new Function(`${lay("nhanO")}${lay("oNhayCam")}${lay("laSoThe")}${lay("laKhoa")}
  return { oNhayCam, laSoThe, laKhoa };`)() as {
  oNhayCam: (t: unknown) => boolean; laSoThe: (v: string) => boolean; laKhoa: (v: string) => boolean;
};

/** Ô giả lập: chỉ cần `type` và `getAttribute`. */
const o = (attrs: Record<string, string>) => ({
  type: attrs.type ?? "text",
  getAttribute: (k: string) => attrs[k] ?? null,
});

test("ô mật khẩu — che", () => {
  assert.equal(dung.oNhayCam(o({ type: "password" })), true);
});

test("ô OTP nhận ra qua autocomplete và qua tên, dù type=text", () => {
  assert.equal(dung.oNhayCam(o({ autocomplete: "one-time-code" })), true);
  assert.equal(dung.oNhayCam(o({ name: "otp" })), true);
  assert.equal(dung.oNhayCam(o({ id: "verificationCode" })), true);
  assert.equal(dung.oNhayCam(o({ "aria-label": "Mã xác thực (passcode)" })), true);
});

test("ô thẻ và tài khoản", () => {
  assert.equal(dung.oNhayCam(o({ autocomplete: "cc-number" })), true);
  assert.equal(dung.oNhayCam(o({ name: "cardNumber" })), true);
  assert.equal(dung.oNhayCam(o({ name: "cvv" })), true);
  assert.equal(dung.oNhayCam(o({ placeholder: "Account number" })), true);
});

test("ô khoá / token", () => {
  assert.equal(dung.oNhayCam(o({ name: "api_key" })), true);
  assert.equal(dung.oNhayCam(o({ id: "secretToken" })), true);
});

test("ô THƯỜNG không bị che — bước dạy việc phải replay được", () => {
  for (const a of [{ name: "email" }, { name: "search" }, { name: "quantity" },
                   { name: "address" }, { placeholder: "Tìm sản phẩm" }, { name: "sku" }]) {
    assert.equal(dung.oNhayCam(o(a)), false, `không được che ${JSON.stringify(a)}`);
  }
});

test("số thẻ thật qua Luhn thì che, số thường thì không", () => {
  assert.equal(dung.laSoThe("4111111111111111"), true, "số thẻ test Visa");
  assert.equal(dung.laSoThe("4111 1111 1111 1111"), true, "có khoảng trắng vẫn nhận");
  assert.equal(dung.laSoThe("1234567890123"), false, "13 chữ số nhưng trượt Luhn");
  assert.equal(dung.laSoThe("2026"), false, "năm");
  assert.equal(dung.laSoThe("100000"), false, "số lượng");
});

test("khoá nhận ra qua tiền tố và qua hình dạng", () => {
  assert.equal(dung.laKhoa("sk-abc123def456"), true);
  assert.equal(dung.laKhoa("hal_c46e0000000000000000000000000000"), true);
  assert.equal(dung.laKhoa("ghp_1234567890abcdefghij"), true);
  assert.equal(dung.laKhoa("a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"), true, "32+ ký tự lẫn chữ và số");
});

test("câu chữ bình thường KHÔNG bị nhận nhầm là khoá", () => {
  for (const v of ["Nguyễn Văn A", "hà nội việt nam", "đơn hàng hôm nay chưa xử lý",
                   "This is a fairly long sentence that a person typed"]) {
    assert.equal(dung.laKhoa(v), false, `không được coi "${v}" là khoá`);
  }
});
