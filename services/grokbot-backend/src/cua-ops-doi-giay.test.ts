/**
 * Cửa `/internal/ops/` đòi giấy tờ, và vé của một người là danh tính CỦA NGƯỜI ẤY.
 *
 * Ghim một lỗ đo được ngày 08/09, phát hiện bởi `scripts/e2e-may-lan-dau.mts` mốc 6 — và nó là
 * lỗ nặng nhất từng đo được ở dự án này:
 *
 *   POST https://cinai.app/agent/internal/ops/local-exec  {"kind":"shell","command":"hostname"}
 *
 * không kèm header nào, từ Internet, chạy `hostname` trên máy Windows của người dùng và trả về tên
 * máy. Hai chỗ hỏng độc lập, và mỗi chỗ đủ để mở cửa:
 *
 *   1. Cửa ops không hỏi giấy tờ gì. Chú thích cũ ghi *"loopback — this server binds 127.0.0.1"*:
 *      đúng chữ, nhưng nginx trên VPS `proxy_pass` từ CÙNG MÁY, nên `bindHost` là một địa chỉ chứ
 *      không phải một biên giới.
 *   2. `ownerFromRequest` — hàm cửa ops dùng để hỏi "ai đang gọi" — không đọc vé cổng. Nên kể cả
 *      khi có giấy, vé của người B vẫn rơi về danh tính mặc định (người A) và lệnh chạy trên máy A.
 *
 * Bài này ghim CẢ HAI, vì bịt một chỗ thì chỗ kia vẫn đủ để rò — cùng họ với "hai mặt SSE".
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Cách ly vô điều kiện trước khi nạp module — không `??=` theo env của runner (bẫy §7).
const tam = mkdtempSync(join(tmpdir(), "gb2-ops-giay-"));
process.env.GROKBOT2_DATA_DIR = tam;
process.env.GROKBOT2_STATE_FILE = join(tam, "state.json");
process.env.GROKBOT2_GATEWAY_TOKEN = "ve-chung-cua-nguoi-van-hanh-0123456789";

const { giayDuChoOps, checkAuth } = await import("./auth-gate.js");
const { mintTicket } = await import("./gateway-ticket.js");
const { ownerFromRequest, DEFAULT_USER } = await import("./auth.js");

test("chỉ ba loại giấy THẬT mở được cửa ops", () => {
  for (const saw of ["matching-bearer", "user-ticket", "user-jwt"] as const) {
    assert.equal(giayDuChoOps(saw), true, saw);
  }
});

test("bốn loại 'không có giấy' đều bị từ chối — kể cả no-header", () => {
  for (const saw of ["no-header", "other-scheme", "stale-literal", "unknown-token"] as const) {
    assert.equal(giayDuChoOps(saw), false, saw);
  }
});

test("cửa ops KHÔNG phụ thuộc GROKBOT2_AUTH — 'off' cũng vẫn phải có giấy", () => {
  const truoc = process.env.GROKBOT2_AUTH;
  try {
    // `off` là mặc định lúc phát triển. Trên VPS 08/09 nó là `enforce`, và cửa vẫn mở toang — tức
    // mức siết chưa bao giờ là thứ giữ cửa này; phép quyết định phải tự đứng.
    process.env.GROKBOT2_AUTH = "off";
    const trang = checkAuth("/internal/ops/local-exec", {});
    assert.equal(trang.allow, true, "checkAuth ở mức off vẫn cho qua — đúng, nó là cửa khác");
    assert.equal(giayDuChoOps(trang.saw), false, "nhưng cửa ops phải tự từ chối");
  } finally {
    if (truoc == null) delete process.env.GROKBOT2_AUTH; else process.env.GROKBOT2_AUTH = truoc;
  }
});

test("request trần (đúng thứ đo được từ Internet 08/09) không qua được", () => {
  assert.equal(giayDuChoOps(checkAuth("/internal/ops/local-exec", {}).saw), false);
  assert.equal(giayDuChoOps(checkAuth("/internal/ops/local-exec", { authorization: "Basic abc" }).saw), false);
  assert.equal(giayDuChoOps(checkAuth("/internal/ops/local-exec", { authorization: "Bearer gw-token" }).saw), false);
  assert.equal(giayDuChoOps(checkAuth("/internal/ops/local-exec", { authorization: "Bearer " }).saw), false);
});

test("vé dùng chung và vé của một người đều là giấy thật ở cửa này", () => {
  const chung = `Bearer ${process.env.GROKBOT2_GATEWAY_TOKEN}`;
  assert.equal(giayDuChoOps(checkAuth("/internal/ops/local-exec", { authorization: chung }).saw), true);
  const rieng = `Bearer ${mintTicket("local|b@vi-du.vn")}`;
  assert.equal(giayDuChoOps(checkAuth("/internal/ops/local-exec", { authorization: rieng }).saw), true);
});

test("ownerFromRequest đọc VÉ — nếu không, vé của B chạy lệnh trên máy của A", () => {
  const B = "local|b@vi-du.vn";
  const chu = ownerFromRequest({ authorization: `Bearer ${mintTicket(B)}` });
  assert.equal(chu, B);
  assert.notEqual(chu, DEFAULT_USER.authId, "rơi về danh tính mặc định CHÍNH LÀ cái lỗ 08/09");
});

test("vé của hai người ra hai chủ khác nhau, và vé dùng chung ra danh tính mặc định", () => {
  const a = ownerFromRequest({ authorization: `Bearer ${mintTicket("local|a@vi-du.vn")}` });
  const b = ownerFromRequest({ authorization: `Bearer ${mintTicket("local|b@vi-du.vn")}` });
  assert.notEqual(a, b);
  // Vé dùng chung không mang danh tính ai cả — người vận hành, tức chủ mặc định.
  assert.equal(ownerFromRequest({ authorization: `Bearer ${process.env.GROKBOT2_GATEWAY_TOKEN}` }), DEFAULT_USER.authId);
});

test("vé giả mạo không phải giấy, và không đổi được chủ", () => {
  const gia = "gwu.bG9jYWx8YkB2aS1kdS52bg.chuky-bia-dat-khong-phai-hmac";
  assert.equal(giayDuChoOps(checkAuth("/internal/ops/local-exec", { authorization: `Bearer ${gia}` }).saw), false);
  assert.equal(ownerFromRequest({ authorization: `Bearer ${gia}` }), DEFAULT_USER.authId);
});
