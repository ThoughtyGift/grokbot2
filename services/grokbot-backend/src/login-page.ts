/**
 * Ba cửa của lần đăng nhập ĐẦU trên một máy — cái mà `/oauth/token` không làm.
 *
 * `/oauth/token` chỉ làm mới một token đã có (xem `handleAuth`). Token đầu tiên phải đến từ đâu đó,
 * và trong hợp đồng của client thì nó đến từ luồng thiết bị:
 *
 *   1. app sinh cặp PKCE, mở trình duyệt tới  {website}/loginDeepControl?challenge=…&uuid=…
 *   2. người dùng gõ email + mật khẩu trên trang đó
 *   3. trang gọi  POST /auth/approve  để buộc uuid vào tài khoản vừa đăng nhập
 *   4. app đang hỏi vòng  GET /auth/poll?uuid=…&verifier=…  thì nhận được token
 *
 * Bước 2 là chỗ có thật một con người và một mật khẩu. Trước đây không có bước nào như thế: app hỏi
 * `/auth/poll` là được token ngay, nên "đăng nhập" chỉ là một hình vẽ.
 *
 * Trang này dùng lại `/v1/login` đã có từ chặng 2 — scrypt, hãm nhịp theo email+IP, số đời token.
 * Không dựng đường xác thực thứ hai: hai đường xác thực là hai chỗ để sai khác nhau.
 */
import type { ServerResponse } from "node:http";
import { DEFAULT_USER, tokenPayload, verifyJwt } from "./auth.js";
import { authMode } from "./auth-mode.js";
import { approveLogin, claimLogin, noteLoginOpened } from "./device-login.js";
import { webAppBuilt } from "./web-app.js";

const html = (res: ServerResponse, body: string, status = 200): void => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
};

const json = (res: ServerResponse, value: unknown, status = 200): void => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
};

/** Thoát HTML — `uuid`/`challenge` đi thẳng từ URL vào trang, nên không được tin. */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * `GET /loginDeepControl?challenge=…&uuid=…&mode=login&redirectTarget=sand`
 *
 * Client mở URL này trong trình duyệt mặc định. Ta ghi nhận cặp uuid/challenge rồi đưa người dùng
 * sang giao diện đăng nhập có sẵn ở `/app/`.
 * Ghi nhận ở đây chứ không ở `/auth/poll` là có lý do: đến lúc poll thì chỉ còn `verifier`, mà từ
 * verifier suy ngược ra challenge thì ai cũng làm được — ô chờ phải được mở bởi lượt đi qua trình
 * duyệt, tức lượt có người thật.
 */
export function handleLoginPage(url: string, res: ServerResponse): void {
  const q = new URL(url, "http://x").searchParams;
  const uuid = q.get("uuid") ?? "";
  const challenge = q.get("challenge") ?? "";
  if (!uuid || !challenge) {
    return html(res, "<h1>Thiếu mã đăng nhập</h1><p>Hãy bấm đăng nhập lại trong ứng dụng.</p>", 400);
  }

  // Ghi nhận ô chờ ở ĐÂY, trước khi chuyển hướng: đây là lượt duy nhất mang `challenge`.
  noteLoginOpened(uuid, challenge);

  if (!webAppBuilt()) {
    return html(res, "<h1>Giao diện web chưa được dựng</h1>"
      + "<p>Chạy <code>pnpm --filter @grokbot2/web build</code> rồi bấm đăng nhập lại trong ứng dụng.</p>", 503);
  }

  /*
   * Chuyển hướng vào giao diện đã có, mang theo uuid.
   *
   * Chỉ `uuid` đi tiếp, KHÔNG mang `challenge`: giao diện không cần nó, và một giá trị đã nằm sẵn
   * trong bộ nhớ backend thì không có lý do gì phải đi thêm một vòng qua thanh địa chỉ trình duyệt.
   */
  res.writeHead(302, { location: `/app/?login_uuid=${encodeURIComponent(uuid)}`, "cache-control": "no-store" });
  res.end();
}

/**
 * `POST /auth/approve  {uuid, token}` — trang gọi sau khi `/v1/login` trả token.
 *
 * Nhận **token** chứ không nhận email/mật khẩu: mật khẩu đã đi qua `/v1/login` một lần rồi, và gửi
 * lại nó ở đây là cho nó thêm một chỗ để rò. Token thì `verifyJwt` kiểm được chữ ký thật.
 */
export function handleAuthApprove(body: Buffer | string, headers: Record<string, unknown>, res: ServerResponse): void {
  let uuid = "", token = "";
  try {
    const b = JSON.parse((typeof body === "string" ? body : body.toString("utf8")) || "{}") as
      { uuid?: unknown; token?: unknown };
    uuid = typeof b.uuid === "string" ? b.uuid : "";
    token = typeof b.token === "string" ? b.token : "";
  } catch { /* thân hỏng — rơi xuống 400 bên dưới */ }
  if (!uuid) return json(res, { error: "missing uuid" }, 400);

  // Token trong thân trước, rồi mới tới header: trang vừa đăng nhập cầm token trong tay, còn header
  // thì có thể là phiên trình duyệt của một người KHÁC đang mở cùng máy.
  const user = verifyJwt(token) ?? verifyJwt(headers.authorization as string | string[] | undefined);
  if (!user) return json(res, { error: "not signed in" }, 401);

  if (!approveLogin(uuid, user)) return json(res, { error: "no login is waiting for this code" }, 404);
  return json(res, { ok: true });
}

/**
 * `GET /auth/poll?uuid=…&verifier=…` — app hỏi vòng cho tới khi có người duyệt.
 *
 * Ba mức như phần còn lại của cổng. `off`/`warn` giữ nguyên hành vi cũ (cấp luôn) để máy đang chạy
 * không chết giữa chừng khi cập nhật; `enforce` mới đòi có người duyệt thật. Đây là công tắc phải
 * bật TRƯỚC khi mở backend ra mạng — và cũng là công tắc `GROKBOT2_BIND` đã cảnh báo về nó.
 *
 * Client đọc 403 là "chưa xong, hỏi tiếp"; đó là lý do dùng 403 chứ không phải 404 hay 204.
 */
export function handleAuthPoll(url: string, res: ServerResponse): void {
  const q = new URL(url, "http://x").searchParams;
  const uuid = q.get("uuid") ?? "";
  const verifier = q.get("verifier") ?? "";
  const mode = authMode();

  if (mode !== "enforce") {
    if (mode === "warn") {
      const would = claimLogin(uuid, verifier);
      console.warn(`[auth] /auth/poll cấp KHÔNG kiểm — enforce sẽ trả "${would.state}"`);
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(tokenPayload(DEFAULT_USER));
    return;
  }

  const out = claimLogin(uuid, verifier);
  if (out.state === "ready") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(tokenPayload(out.user));
    return;
  }
  // "chưa duyệt" và "không có phiên nào" trả cùng một câu: tách ra là nói cho người dò biết uuid nào
  // có thật để dò tiếp.
  return json(res, { error: "authorization_pending" }, 403);
}
