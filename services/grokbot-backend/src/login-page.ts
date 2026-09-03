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
 * Bước 2 KHÔNG có form riêng ở đây. Giao diện đăng nhập đã tồn tại từ trước trong
 * `apps/grokbot-web` (email + mật khẩu + tạo tài khoản + đăng xuất), nên `/loginDeepControl` chỉ ghi
 * nhận cặp uuid/challenge rồi **chuyển hướng vào đúng giao diện đó** — xem `web-app.ts`. Dựng form
 * thứ hai là hai chỗ để sửa và hai chỗ để lệch nhau.
 *
 * Xác thực vẫn dùng chung `/v1/login` của chặng 2: scrypt, hãm nhịp theo email+IP, số đời token.
 * Hai đường xác thực là hai chỗ để sai khác nhau.
 */
import type { ServerResponse } from "node:http";
import { DEFAULT_USER, tokenPayload, verifyJwt } from "./auth.js";
import { authMode } from "./auth-mode.js";
import { approveLogin, claimLogin, noteLoginOpened } from "./device-login.js";
import { webAppBuilt, chuaDungHtml } from "./web-app.js";

const html = (res: ServerResponse, body: string, status = 200): void => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
};

const json = (res: ServerResponse, value: unknown, status = 200): void => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
};

/**
 * Nhánh mà backend này đứng dưới, nhìn từ ngoài Internet — ví dụ `/agent`.
 *
 * Backend **không thể tự biết**: nginx cắt tiền tố trước khi chuyển tiếp (`proxy_pass …:8788/` có
 * gạch chéo cuối), nên mọi request tới đây đều trông như ở gốc. Đó là điều tốt — không có gì trong
 * backend phải biết về nginx — trừ **một** chỗ: khi nó tự sinh ra một địa chỉ cho trình duyệt đi tiếp.
 *
 * Rỗng là mặc định, tức bản chạy trên máy cá nhân không đổi gì.
 */
function publicPath(): string {
  const raw = (process.env.GROKBOT2_PUBLIC_PATH ?? "").trim();
  if (!raw || raw === "/") return "";
  // Chuẩn hoá về dạng `/abc`: khai `agent`, `/agent` hay `/agent/` đều phải ra cùng một thứ.
  return `/${raw.replace(/^\/+|\/+$/g, "")}`;
}

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

  if (!webAppBuilt()) return html(res, chuaDungHtml(), 503);

  /*
   * Chuyển hướng vào giao diện đã có, mang theo uuid.
   *
   * Chỉ `uuid` đi tiếp, KHÔNG mang `challenge`: giao diện không cần nó, và một giá trị đã nằm sẵn
   * trong bộ nhớ backend thì không có lý do gì phải đi thêm một vòng qua thanh địa chỉ trình duyệt.
   *
   * `publicPath()` là chỗ backend học được nó đang đứng dưới nhánh nào — nó **không tự biết**, vì
   * nginx cắt tiền tố trước khi chuyển tiếp. Bỏ qua chỗ này thì trên VPS trình duyệt bị đẩy tới
   * `cinai.app/app/` và rơi vào Next.js của cinAPI: đo được ngay lượt chạy thật đầu tiên qua
   * Internet (26/08), và không có lỗi nào nói vì sao.
   */
  res.writeHead(302, {
    location: `${publicPath()}/app/?login_uuid=${encodeURIComponent(uuid)}`,
    "cache-control": "no-store",
  });
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
  /*
   * **404, không phải 403** — và đây là hợp đồng của client, không phải lựa chọn của ta.
   *
   * Đọc từ chính bản dựng (`waitForResult` trong electron-main):
   *
   *     if (status === 403) { …; if (++o >= 3) return null }   ← ĐẾM LÀ LỖI, ba lần thì BỎ CUỘC
   *     else if (status === 404) o = 0                          ← "chưa xong", đếm lại từ đầu
   *
   * Bản trước trả 403 nên client bỏ cuộc sau ba lượt hỏi — tức khoảng vài giây, **trước khi người
   * dùng kịp gõ xong email và mật khẩu**. Đo trên máy thứ hai 27/08: app hỏi lần cuối lúc 09:57:22,
   * người dùng duyệt xong lúc 09:58:27, và không còn ai hỏi nữa. Trang web báo "Xong" hoàn toàn
   * đúng, còn app thì đã thôi lắng nghe từ một phút trước — nên nó hiện "Cursor sign-in did not
   * finish" dù mọi thứ phía máy chủ đều thành công.
   *
   * Vẫn giữ một câu trả lời chung cho "chưa duyệt" và "không có phiên nào": tách ra là nói cho người
   * dò biết uuid nào có thật để dò tiếp.
   */
  return json(res, { error: "authorization_pending" }, 404);
}
