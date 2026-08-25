/**
 * Chặn đoán mật khẩu — login-throttle.ts.
 *
 *   npx tsx --test services/grokbot-backend/src/login-throttle.test.ts
 *
 * Bốn thứ đáng khoá lại, và cả bốn đều là chỗ dễ làm sai theo hướng **hại người dùng thật**: khoá
 * nhầm người bên cạnh, khoá vĩnh viễn, phạt người gõ nhầm rồi vào đúng, hoặc khoá cả nghìn tài
 * khoản vì chung một đường mạng.
 */
import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";

const { loginAllowed, noteLoginFailure, noteLoginSuccess, _resetThrottle } =
  await import("./login-throttle.js");

beforeEach(() => { _resetThrottle(); });

test("năm lần sai còn cho thử, lần thứ sáu bị chặn", () => {
  for (let i = 0; i < 5; i++) {
    assert.equal(loginAllowed("a@b.com", "1.1.1.1").ok, true, `lần ${i + 1} phải còn được thử`);
    noteLoginFailure("a@b.com", "1.1.1.1");
  }
  const gate = loginAllowed("a@b.com", "1.1.1.1");
  assert.equal(gate.ok, false);
  assert.ok(!gate.ok && gate.retryAfterSec > 0, "phải nói còn bao lâu, không chặn câm");
});

test("khoá theo email + máy gọi, không phải chỉ một trong hai", () => {
  for (let i = 0; i < 6; i++) noteLoginFailure("a@b.com", "1.1.1.1");
  assert.equal(loginAllowed("a@b.com", "1.1.1.1").ok, false, "đúng cặp đó thì khoá");
  // Chỉ theo email thì một máy quét được cả nghìn tài khoản mà không ai chặn…
  assert.equal(loginAllowed("khac@b.com", "1.1.1.1").ok, true, "email khác cùng máy vẫn thử được");
  // …còn chỉ theo địa chỉ thì mọi người sau cùng một NAT khoá lẫn nhau.
  assert.equal(loginAllowed("a@b.com", "2.2.2.2").ok, true, "cùng email từ máy khác vẫn thử được");
});

test("hết cửa sổ 15 phút thì mở lại — khoá là tạm, không phải án chung thân", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 6; i++) noteLoginFailure("a@b.com", "1.1.1.1", t0);
  assert.equal(loginAllowed("a@b.com", "1.1.1.1", t0 + 60_000).ok, false, "trong cửa sổ vẫn khoá");
  assert.equal(loginAllowed("a@b.com", "1.1.1.1", t0 + 15 * 60_000 + 1).ok, true, "quá cửa sổ thì mở");
});

test("vào được thì xoá vết — người gõ nhầm rồi vào đúng không mang án sang lần sau", () => {
  for (let i = 0; i < 4; i++) noteLoginFailure("a@b.com", "1.1.1.1");
  noteLoginSuccess("a@b.com", "1.1.1.1");
  for (let i = 0; i < 5; i++) {
    assert.equal(loginAllowed("a@b.com", "1.1.1.1").ok, true, "sau khi vào được phải được thử lại đủ 5 lần");
    noteLoginFailure("a@b.com", "1.1.1.1");
  }
});

test("email khác hoa thường vẫn là một người", () => {
  for (let i = 0; i < 6; i++) noteLoginFailure("A@B.com", "1.1.1.1");
  assert.equal(loginAllowed("a@b.com  ", "1.1.1.1").ok, false, "không được lách bằng cách đổi hoa thường");
});
