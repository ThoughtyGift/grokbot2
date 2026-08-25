/**
 * Cửa cấp token phải **hỏi** trước khi cấp.
 *
 * Bài này khoá lại lỗ đã đo ngày 25/08: `POST /oauth/token` với thân rỗng, gọi từ một máy khác trong
 * LAN, trả về token 199 ký tự đọc được `/v1/agents`. Chừng nào chưa bịt thì backend không được rời
 * `127.0.0.1`, nên nó chặn cả chặng 4.
 *
 * Hai đường phải kiểm riêng, vì chúng cấp token vì hai lý do khác nhau:
 *   `/oauth/token`  làm mới — phải có token cũ do CHÍNH ta phát
 *   `/auth/poll`    lần đầu — phải có người đăng nhập thật và duyệt đúng phiên đó
 *
 * Và kiểm cả nhánh `off`: máy đang chạy không được chết vì bản cập nhật này.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";
import { Writable } from "node:stream";
import { DEFAULT_USER, handleAuth, mintJwt, verifyJwt } from "./auth.js";
import { handleAuthPoll, handleAuthApprove, handleLoginPage } from "./login-page.js";
import { challengeFor, resetDeviceLogins } from "./device-login.js";
import { handleWebApp } from "./web-app.js";

/** `ServerResponse` giả — chỉ giữ lại mã và thân, đủ để nói bài này đậu hay hỏng. */
function fakeRes() {
  const out = { status: 0, body: "", headers: {} as Record<string, string> };
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      out.status = status;
      if (headers) out.headers = headers;
      return res;
    },
    end(chunk?: string) { out.body = chunk ?? ""; return res; },
  };
  return { res: res as unknown as ServerResponse, out };
}

const withMode = <T>(mode: string, fn: () => T): T => {
  const prev = process.env.GROKBOT2_AUTH;
  process.env.GROKBOT2_AUTH = mode;
  try { return fn(); } finally { process.env.GROKBOT2_AUTH = prev; }
};

const tokenIn = (body: string): string => JSON.parse(body).access_token as string;

// ── /oauth/token ────────────────────────────────────────────────────────────────

test("enforce: thân rỗng KHÔNG còn được cấp token — đúng lỗ đã đo 25/08", () => {
  const { res, out } = fakeRes();
  withMode("enforce", () => handleAuth(res, Buffer.from("")));
  assert.equal(out.status, 401);
  assert.doesNotMatch(out.body, /access_token/);
});

test("enforce: refresh_token bịa ra thì bị từ chối", () => {
  const { res, out } = fakeRes();
  const forged = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.`
    + `${Buffer.from('{"sub":"auth0|ai-do","email":"x@y"}').toString("base64url")}.chu-ky-bia`;
  withMode("enforce", () => handleAuth(res, JSON.stringify({ grant_type: "refresh_token", refresh_token: forged })));
  assert.equal(out.status, 401);
});

test("enforce: token thật thì làm mới được, và vẫn là ĐÚNG người đó", () => {
  const user = { authId: "auth0|nguoi-that", email: "that@vi.du" };
  const { res, out } = fakeRes();
  withMode("enforce", () => handleAuth(res, JSON.stringify({ grant_type: "refresh_token", refresh_token: mintJwt(user) })));
  assert.equal(out.status, 200);
  assert.equal(verifyJwt(tokenIn(out.body))?.authId, user.authId);
});

test("enforce: đọc được cả dạng form, không chỉ JSON", () => {
  const user = { authId: "auth0|dang-form", email: "form@vi.du" };
  const { res, out } = fakeRes();
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: mintJwt(user) }).toString();
  withMode("enforce", () => handleAuth(res, body));
  assert.equal(out.status, 200);
  assert.equal(verifyJwt(tokenIn(out.body))?.authId, user.authId);
});

test("off: vẫn cấp như cũ — bản cập nhật này không làm chết máy đang chạy", () => {
  const { res, out } = fakeRes();
  withMode("off", () => handleAuth(res, Buffer.from("")));
  assert.equal(out.status, 200);
  assert.equal(verifyJwt(tokenIn(out.body))?.authId, DEFAULT_USER.authId);
});

// ── luồng thiết bị ──────────────────────────────────────────────────────────────

test("challenge sinh đúng như client sinh — PKCE S256 trên CHUỖI verifier", () => {
  const verifier = "abc-123_xyz";
  assert.equal(challengeFor(verifier), createHash("sha256").update(verifier).digest("base64url"));
});

test("enforce: hỏi vòng khi chưa có ai duyệt thì không có token", () => {
  resetDeviceLogins();
  const verifier = "v-chua-duyet";
  const uuid = "uuid-chua-duyet";
  const open = fakeRes();
  handleLoginPage(`/loginDeepControl?uuid=${uuid}&challenge=${challengeFor(verifier)}`, open.res);
  // Không còn form riêng ở backend: nó đưa người dùng sang giao diện đăng nhập đã có ở `/app/`.
  assert.equal(open.out.status, 302);
  assert.equal(open.out.headers.location, `/app/?login_uuid=${uuid}`);

  const { res, out } = fakeRes();
  withMode("enforce", () => handleAuthPoll(`/auth/poll?uuid=${uuid}&verifier=${verifier}`, res));
  assert.equal(out.status, 403);
  assert.doesNotMatch(out.body, /access_token/);
});

test("enforce: duyệt xong thì app nhận token CỦA ĐÚNG người vừa đăng nhập", () => {
  resetDeviceLogins();
  const verifier = "v-day-du";
  const uuid = "uuid-day-du";
  const user = { authId: "auth0|chu-may-2", email: "may2@vi.du" };

  handleLoginPage(`/loginDeepControl?uuid=${uuid}&challenge=${challengeFor(verifier)}`, fakeRes().res);

  const ap = fakeRes();
  handleAuthApprove(JSON.stringify({ uuid, token: mintJwt(user) }), {}, ap.res);
  assert.equal(ap.out.status, 200);

  const { res, out } = fakeRes();
  withMode("enforce", () => handleAuthPoll(`/auth/poll?uuid=${uuid}&verifier=${verifier}`, res));
  assert.equal(out.status, 200);
  assert.equal(verifyJwt(tokenIn(out.body))?.authId, user.authId);
});

test("enforce: biết uuid mà không có verifier thì vẫn KHÔNG lấy được token", () => {
  resetDeviceLogins();
  const uuid = "uuid-bi-nhin-trom";
  const user = { authId: "auth0|nan-nhan", email: "nan@vi.du" };
  handleLoginPage(`/loginDeepControl?uuid=${uuid}&challenge=${challengeFor("verifier-that")}`, fakeRes().res);
  handleAuthApprove(JSON.stringify({ uuid, token: mintJwt(user) }), {}, fakeRes().res);

  // uuid đi qua thanh địa chỉ trình duyệt nên coi như lộ; verifier thì không rời khỏi app.
  const { res, out } = fakeRes();
  withMode("enforce", () => handleAuthPoll(`/auth/poll?uuid=${uuid}&verifier=doan-bua`, res));
  assert.equal(out.status, 403);
});

test("enforce: một lượt duyệt chỉ đổi được token MỘT lần", () => {
  resetDeviceLogins();
  const verifier = "v-mot-lan", uuid = "uuid-mot-lan";
  handleLoginPage(`/loginDeepControl?uuid=${uuid}&challenge=${challengeFor(verifier)}`, fakeRes().res);
  handleAuthApprove(JSON.stringify({ uuid, token: mintJwt({ authId: "auth0|x", email: "x@y" }) }), {}, fakeRes().res);

  const first = fakeRes();
  withMode("enforce", () => handleAuthPoll(`/auth/poll?uuid=${uuid}&verifier=${verifier}`, first.res));
  assert.equal(first.out.status, 200);

  const second = fakeRes();
  withMode("enforce", () => handleAuthPoll(`/auth/poll?uuid=${uuid}&verifier=${verifier}`, second.res));
  assert.equal(second.out.status, 403);
});

test("duyệt một uuid chưa từng mở qua trình duyệt thì không ăn thua", () => {
  resetDeviceLogins();
  const { res, out } = fakeRes();
  handleAuthApprove(
    JSON.stringify({ uuid: "uuid-tu-bia", token: mintJwt({ authId: "auth0|x", email: "x@y" }) }), {}, res,
  );
  assert.equal(out.status, 404);
});

test("duyệt mà chưa đăng nhập thì bị từ chối", () => {
  resetDeviceLogins();
  const uuid = "uuid-chua-dang-nhap";
  handleLoginPage(`/loginDeepControl?uuid=${uuid}&challenge=${challengeFor("v")}`, fakeRes().res);
  const { res, out } = fakeRes();
  handleAuthApprove(JSON.stringify({ uuid, token: "khong-phai-token" }), {}, res);
  assert.equal(out.status, 401);
});

test("uuid lạ không thoát ra khỏi header Location được", () => {
  resetDeviceLogins();
  // `uuid` đi thẳng từ URL vào một header. Một xuống dòng lọt qua đây là chèn được header khác —
  // nên bài này kiểm mặt tấn công MỚI mà bước chuyển hướng vừa tạo ra, không phải mặt cũ.
  const nasty = `a${String.fromCharCode(13, 10)}Set-Cookie: x=1`;
  const { res, out } = fakeRes();
  handleLoginPage(`/loginDeepControl?uuid=${encodeURIComponent(nasty)}&challenge=c`, res);
  assert.equal(out.status, 302);
  // Thứ đáng kiểm là KHÔNG có xuống dòng thật — chuỗi "Set-Cookie" ở dạng đã mã hoá thì vô hại,
  // nó chỉ là ký tự trong giá trị tham số. Kiểm sự vắng mặt của mấy chữ đó là kiểm nhầm việc.
  assert.ok(!/[\r\n]/.test(out.headers.location), "không được có xuống dòng thật trong Location");
  assert.match(out.headers.location, /%0D%0A/i, "xuống dòng phải bị mã hoá, không bị bỏ đi im lặng");
});

// ── /app/ — backend phát giao diện web đã có ────────────────────────────────────

test("/app/ không cho đi ngang ra ngoài thư mục build", async () => {
  // Đây là cửa công khai DUY NHẤT phát file từ đĩa, và nó nằm ngay cạnh `.env` lẫn `.data/`.
  // Ba dạng: `..` thường, `..` đã mã hoá, và `..` sau một thư mục con có thật.
  for (const path of ["/app/../../../.env", "/app/%2e%2e/%2e%2e/.env", "/app/assets/../../../.env"]) {
    // `handleWebApp` phát file bằng luồng, nên chỗ nhận phải là luồng thật chứ không phải res giả.
    const chunks: Buffer[] = [];
    const sink = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } });
    (sink as unknown as { writeHead: () => void }).writeHead = () => {};
    assert.equal(handleWebApp(path, sink as unknown as ServerResponse), true, `${path} phải do /app xử lý`);
    await new Promise((r) => sink.on("finish", r));
    assert.doesNotMatch(Buffer.concat(chunks).toString("utf8"), /GROKBOT2_/, `${path} không được lộ .env`);
  }
});
