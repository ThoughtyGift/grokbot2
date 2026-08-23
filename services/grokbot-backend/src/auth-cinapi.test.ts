/**
 * Hợp đồng danh tính với cinAPI (docs/plan/cinapi-merge.md P1).
 *
 *   npx tsx --test services/grokbot-backend/src/auth-cinapi.test.ts
 *
 * Đây là phần dễ hỏng nhất của việc hợp nhất: hai service dùng CHUNG một secret HS256, nên mọi
 * token cinAPI phát ra đều có chữ ký hợp lệ với grokbot2. Thứ duy nhất phân biệt "được vào" và
 * "không được vào" là `purpose` — nếu không kiểm, một token đặt-lại-mật-khẩu cũng mở được agent.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHmac } from "node:crypto";

process.env.GROKBOT2_JWT_SECRET ??= "test-shared-secret-with-cinapi";
const { verifyJwt, ownerFromRequest, DEFAULT_USER } = await import("./auth.js");

const b64 = (s: string | Buffer): string =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Dựng token đúng cách cinAPI dựng: HS256, `sub` + `purpose` + `token_version` + `exp`. */
function cinapiToken(opts: { sub?: string; purpose?: string; expSec?: number } = {}): string {
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(JSON.stringify({
    sub: opts.sub ?? "a1b2c3d4e5f6a7b8c9d0e1f2",
    purpose: opts.purpose,
    token_version: 1,
    iat: Math.floor(Date.now() / 1000),
    exp: opts.expSec ?? Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = b64(createHmac("sha256", process.env.GROKBOT2_JWT_SECRET!).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

test("token access của cinAPI được nhận, và owner là `sub` của họ", () => {
  const u = verifyJwt(`Bearer ${cinapiToken({ purpose: "access", sub: "user-cinapi-1" })}`);
  assert.equal(u?.authId, "user-cinapi-1");
});

test("token KHÔNG phải access bị từ chối — dù chữ ký hợp lệ", () => {
  for (const purpose of ["password_reset", "email_verify", "2fa_pending", "step_up"]) {
    assert.equal(verifyJwt(`Bearer ${cinapiToken({ purpose })}`), null, `${purpose} lọt qua được`);
  }
});

test("token grokbot2 tự mint (không có `purpose`) vẫn chạy — tương thích ngược", () => {
  const u = verifyJwt(`Bearer ${cinapiToken({ purpose: undefined, sub: "local|a@b.vn" })}`);
  assert.equal(u?.authId, "local|a@b.vn");
});

test("token hết hạn bị từ chối", () => {
  assert.equal(verifyJwt(`Bearer ${cinapiToken({ purpose: "access", expSec: Math.floor(Date.now() / 1000) - 10 })}`), null);
});

test("chữ ký sai bị từ chối", () => {
  const t = cinapiToken({ purpose: "access" });
  assert.equal(verifyJwt(`Bearer ${t.slice(0, -3)}xyz`), null);
});

test("cookie `cinapi_at` cho ra đúng owner", () => {
  const t = cinapiToken({ purpose: "access", sub: "user-от-cookie" });
  assert.equal(ownerFromRequest({ cookie: `foo=1; cinapi_at=${t}; bar=2` }), "user-от-cookie");
});

test("cookie mang token KHÔNG phải access thì về danh tính mặc định, không leo thang", () => {
  const t = cinapiToken({ purpose: "password_reset" });
  assert.equal(ownerFromRequest({ cookie: `cinapi_at=${t}` }), DEFAULT_USER.authId);
});

test("header thắng cookie — caller gắn header là đang nói rõ mình là ai", () => {
  const owner = ownerFromRequest({
    authorization: `Bearer ${cinapiToken({ purpose: "access", sub: "tu-header" })}`,
    cookie: `cinapi_at=${cinapiToken({ purpose: "access", sub: "tu-cookie" })}`,
  });
  assert.equal(owner, "tu-header");
});

test("không có gì cả ⇒ danh tính mặc định (desktop một người dùng)", () => {
  assert.equal(ownerFromRequest({}), DEFAULT_USER.authId);
  assert.equal(ownerFromRequest({ cookie: "other=1" }), DEFAULT_USER.authId);
});

test("cookie rỗng hoặc méo không làm vỡ phép đọc", () => {
  for (const cookie of ["cinapi_at=", "cinapi_at", "=x", ";;", "cinapi_at=not.a.jwt"]) {
    assert.equal(ownerFromRequest({ cookie }), DEFAULT_USER.authId, `vỡ ở: ${cookie}`);
  }
});
