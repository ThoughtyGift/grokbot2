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
import { randomBytes } from "node:crypto";
import { DEFAULT_USER, cookieValue, tokenPayload, verifyJwt } from "./auth.js";
import { authMode } from "./auth-mode.js";
import { approveLogin, claimLogin, noteLoginOpened } from "./device-login.js";
import { webAppBuilt, chuaDungHtml } from "./web-app.js";
import { cinapiGoc, hoiCinapiMe } from "./cinapi-danh-tinh.js";

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
export async function handleLoginPage(
  url: string,
  res: ServerResponse,
  headers: Record<string, unknown> = {},
): Promise<void> {
  const q = new URL(url, "http://x").searchParams;
  const uuid = q.get("uuid") ?? "";
  const challenge = q.get("challenge") ?? "";
  if (!uuid || !challenge) {
    return html(res, "<h1>Thiếu mã đăng nhập</h1><p>Hãy bấm đăng nhập lại trong ứng dụng.</p>", 400);
  }

  // Ghi nhận ô chờ ở ĐÂY, trước khi chuyển hướng: đây là lượt duy nhất mang `challenge`.
  noteLoginOpened(uuid, challenge);

  // ── đường cinAPI: một tài khoản cho cả cinai.app và app desktop ──────────────
  //
  // Chỉ mở khi `GROKBOT2_CINAPI_BASE` có mặt. Vắng biến ⇒ mọi dòng dưới đây bị bỏ qua và hành vi
  // giống HỆT bản trước — cùng cách `dashboardUrl` và `GROKBOT2_PUBLIC_SITE` đã làm.
  if (cinapiGoc()) return duongCinai(uuid, challenge, headers, res);

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

/*
 * ── Bước 3 của cinapi-merge: một danh tính ────────────────────────────────────
 *
 * Vì sao đường này KHÔNG phải một cú `302` sang trang đăng nhập cinapi, dù `AuthForm.tsx:34` của họ
 * đã đọc `?next=/…` và cú 302 sẽ chạy: **đường GOOGLE mất `next`**. Đo trên VPS 09/09 —
 * `handler/google_oauth.go:143` ghim cứng đích `http.Redirect(w, r, h.frontendURL+"/vi/studio/chat")`
 * và `state` chỉ là nonce CSRF, không chở gì. Nút *"Continue with Google"* là đúng nút chủ dự án
 * hỏi, nên nếu ta 302 đi thì tab duy nhất còn lại nằm ở `/vi/studio/chat` và `/auth/poll` của app
 * **không bao giờ được duyệt**.
 *
 * Nên thay vì bị chuyển hướng, trang này Ở LẠI và tự hỏi vòng một cửa của chính grokbot2. Cửa ấy
 * đọc `cinapi_at` — có sẵn, vì cookie của cinapi đặt `Path=/` + `Domain` (`handler/auth.go:244`) và
 * `cinai.app` là CÙNG MỘT tên miền, nên mọi request tới `/agent/…` đã mang nó rồi. Đúng cách (C):
 * **grokbot2 không cầm secret nào, và cũng không cần ai chuyển cookie cho nó.** Kết quả: 0 dòng sửa
 * phía cinAPI, và cùng một đường cho cả Google lẫn email.
 *
 * **Và chỗ này KHÔNG được tự duyệt.** Bản đầu của tôi làm đúng thế — "đã có cookie thì lượt đầu
 * duyệt luôn, người dùng không phải bấm gì" — rồi đo ra một lỗ CHIẾM TÀI KHOẢN, ghi lại nguyên văn
 * vì nó là một lớp bẫy chứ không phải một dòng sai:
 *
 *   1. `claimLogin(uuid, verifier)` trao token cho **ai giữ verifier**, tức bên KHỞI TẠO luồng (app
 *      desktop) — không phải trình duyệt vừa duyệt. Hai bên ấy không buộc phải là một người.
 *   2. Nên kẻ tấn công tự bấm đăng nhập trên app của mình, đọc `uuid`+`challenge` từ thanh địa chỉ,
 *      giữ `verifier`, rồi gửi nạn nhân một link `…/loginDeepControl?uuid=U&challenge=C`.
 *   3. Nạn nhân đang đăng nhập cinai.app bấm vào ⇒ nếu cửa này tự duyệt thì luồng được duyệt bằng
 *      danh tính CỦA NẠN NHÂN, và app của kẻ tấn công hỏi vòng rồi nhận token của nạn nhân.
 *
 * Cookie `gb2_login` **không** chặn được, và đó là phần đáng chép: chính cái request mang `uuid` của
 * kẻ tấn công cũng là request ĐÚC RA cookie buộc `uuid` ấy vào trình duyệt nạn nhân. Một cái khoá mà
 * kẻ gửi chìa cũng là kẻ đúc ổ thì không khoá ai. Gỡ riêng nhánh GET cũng chưa đủ: script của trang
 * chờ tự hỏi vòng, và lượt hỏi ấy là CÙNG GỐC nên cookie đi kèm bất kể `SameSite`.
 *
 * Gốc thật: luồng email/mật khẩu lấy **việc gõ mật khẩu** làm bằng chứng chủ ý; SSO thì người dùng
 * đã đăng nhập sẵn nên **không còn hành vi nào tỏ chủ ý** — phải thu nó một cách tường minh. Nên:
 *
 *   • `GET  /auth/cinai` chỉ **BÁO** đang là ai. Không duyệt. Điều hướng tới được cũng vô hại.
 *   • `POST /auth/cinai` mới **DUYỆT**, và đòi cookie `gb2_login` khớp `uuid`. POST thì một cú điều
 *     hướng không tới được; `SameSite=Strict` + `connect-src 'self'` thì chỉ script của trang ta tới
 *     được; và trang chỉ gọi nó **sau một cú bấm**.
 *
 * Còn lại đúng phần dư của mọi trang consent: người dùng bấm xác nhận trên một trang họ không mở.
 * Chữa bằng CHỮ — trang nêu đúng tài khoản sẽ bị nối và dặn đóng trang nếu không phải họ vừa bấm.
 */

/** Cookie của CHÍNH ta, buộc một `uuid` đang chờ vào đúng trình duyệt đã mở deep link. */
const COOKIE_CHO = "gb2_login";

/** Trang đăng nhập của cinAPI, **tương đối** — cùng tên miền nên không cần biết origin. */
const duongLoginCinai = (): string => (process.env.GROKBOT2_CINAPI_LOGIN ?? "/vi/login").trim() || "/vi/login";

const thoatHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Buộc `uuid` vào trình duyệt này.
 *
 * Nó chặn được đúng MỘT chuyện, và không hơn: một trang lạ dụ trình duyệt người dùng gọi thẳng
 * `/agent/auth/cinai?uuid=…` mà **không** đi qua `/loginDeepControl` trước — không có cookie thì 403.
 * `noteLoginOpened` ghi ô chờ ở phía server nhưng không biết trình duyệt nào mở nó, nên một mình nó
 * không chặn được cả chuyện đó.
 *
 * Nó **KHÔNG** chặn được ca `uuid` của kẻ tấn công đi kèm ngay trong link `/loginDeepControl` — lúc
 * ấy chính ta đúc cookie từ `uuid` của kẻ ấy. Thứ chặn ca đó là **cú bấm xác nhận**; xem khối chú
 * thích ở đầu phần cinAPI. Đừng đọc cookie này như một lớp bảo vệ mạnh hơn thực tế.
 *
 * `SameSite=Strict` được: mọi chặng của luồng này đều cùng site (`cinai.app` → `cinai.app/agent`).
 * `Secure` chỉ đặt khi đứng sau reverse proxy công khai — dùng CHÍNH tín hiệu `publicPath()` đã có
 * thay vì thêm một cờ nữa phải nhớ đồng bộ (bản chạy `http://localhost` sẽ bị trình duyệt bỏ cookie
 * `Secure`).
 */
function datCookieCho(res: ServerResponse, uuid: string): string {
  const p = publicPath();
  const phan = [
    `${COOKIE_CHO}=${encodeURIComponent(uuid)}`,
    `Path=${p || "/"}`,
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=900",
  ];
  if (p) phan.push("Secure");
  return phan.join("; ");
}

/** Danh tính cinai của request này, hoặc `null`. Một chỗ hỏi, hai người gọi. */
async function danhTinhTuCookie(headers: Record<string, unknown>) {
  const token = cookieValue(headers["cookie"] as string | string[] | undefined, "cinapi_at");
  return token ? hoiCinapiMe(token) : null;
}

/**
 * Trang chờ: mở login cinai ở TAB KHÁC, tự hỏi vòng, rồi **đòi một cú bấm** mới duyệt.
 *
 * Hai trạng thái, quyết ở phía trang chứ không phía máy chủ, vì máy chủ chỉ thấy được lượt đầu:
 *
 *   chưa có cookie cinai → nút "Đăng nhập trên cinai.app" + hỏi vòng `GET /auth/cinai`
 *   đã có               → nêu ĐÚNG tài khoản + nút "Nối tài khoản này" → `POST /auth/cinai`
 *
 * Cú bấm ấy là bằng chứng chủ ý duy nhất còn lại trong luồng SSO — xem khối chú thích đầu phần cinAPI.
 */
function trangCho(uuid: string, challenge: string, nonce: string): string {
  const quayVe = `${publicPath()}/loginDeepControl?uuid=${encodeURIComponent(uuid)}&challenge=${encodeURIComponent(challenge)}`;
  const login = `${duongLoginCinai()}?next=${encodeURIComponent(quayVe)}`;
  const cua = `${publicPath()}/auth/cinai?uuid=${encodeURIComponent(uuid)}`;
  return `<!doctype html><html lang="vi"><meta charset="utf-8">
<title>Đăng nhập Grok Bot</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.5rem;color:#111}
h1{font-size:1.4rem;margin:0 0 .75rem}code{background:#f2f2f4;padding:.1em .35em;border-radius:.25em}
a.nut,button.nut{display:inline-block;background:#111;color:#fff;border:0;font:inherit;font-weight:600;
text-decoration:none;padding:.65em 1.2em;border-radius:.5em;cursor:pointer}
#tt{color:#666;margin-top:1.25rem}.canh{color:#8a5300;background:#fff6e5;border-radius:.5em;padding:.75em 1em}</style>
<h1>Đăng nhập bằng tài khoản cinai</h1>
<div id="cho">
  <p>Ứng dụng dùng chung tài khoản với <strong>cinai.app</strong>. Bấm nút dưới, đăng nhập (Google hoặc email), rồi quay lại trang này.</p>
  <p><a class="nut" href="${thoatHtml(login)}" target="_blank" rel="noopener">Đăng nhập trên cinai.app</a></p>
  <p id="tt">Đang chờ…</p>
</div>
<div id="xac" hidden>
  <p>Ứng dụng <strong>Grok Bot</strong> trên máy này muốn đăng nhập bằng tài khoản <code id="mail"></code>.</p>
  <p class="canh">Nếu bạn <strong>không</strong> vừa bấm đăng nhập trong ứng dụng Grok Bot thì hãy đóng trang này — đừng bấm nút dưới.</p>
  <p><button class="nut" id="ok" type="button">Nối tài khoản này</button></p>
  <p id="loi" hidden></p>
</div>
<div id="xong" hidden><p>Đã nối. Quay lại <strong>Grok Bot</strong> — ứng dụng sẽ tự nhận trong vài giây.</p></div>
<script nonce="${nonce}">
(function(){
  var CUA = ${JSON.stringify(cua)};
  var cho=document.getElementById("cho"), xac=document.getElementById("xac"),
      xong=document.getElementById("xong"), tt=document.getElementById("tt"),
      mail=document.getElementById("mail"), nut=document.getElementById("ok"),
      loi=document.getElementById("loi"), n=0, hien=false;
  function thu(){
    if(hien) return;
    n++;
    fetch(CUA,{credentials:"same-origin",cache:"no-store"})
      .then(function(r){return r.json()})
      .then(function(j){
        if(j&&j.cinai){ hien=true; mail.textContent=j.email||"cinai"; cho.hidden=true; xac.hidden=false; return }
        tt.textContent="Đang chờ… (đã hỏi "+n+" lần)";
        setTimeout(thu,2000);
      })
      .catch(function(){ setTimeout(thu,3000) });
  }
  nut.addEventListener("click",function(){
    nut.disabled=true; loi.hidden=true;
    fetch(CUA,{method:"POST",credentials:"same-origin",cache:"no-store"})
      .then(function(r){return r.json()})
      .then(function(j){
        if(j&&j.ok){ xac.hidden=true; xong.hidden=false; return }
        nut.disabled=false; loi.hidden=false;
        loi.textContent="Chưa nối được. Hãy bấm đăng nhập lại trong ứng dụng rồi thử lần nữa.";
      })
      .catch(function(){
        nut.disabled=false; loi.hidden=false; loi.textContent="Không gọi được máy chủ. Thử lại.";
      });
  });
  setTimeout(thu,300);
})();
</script>`;
}

/**
 * Cửa `/loginDeepControl` khi bật đường cinAPI. **Không duyệt gì** — chỉ đặt cookie và vẽ trang.
 *
 * Trước đây nó duyệt luôn khi thấy cookie cinai; đó là lỗ chiếm tài khoản ghi ở đầu phần này. Nay
 * một lượt GET tới cửa này không thể đổi trạng thái đăng nhập của bất kỳ ai, dù mang cookie gì.
 */
async function duongCinai(
  uuid: string,
  challenge: string,
  _headers: Record<string, unknown>,
  res: ServerResponse,
): Promise<void> {
  // CSP nonce vì trang có script nội tuyến — cùng phép đã dùng ở `site-bot.ts`.
  const nonce = randomBytes(16).toString("base64");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "set-cookie": datCookieCho(res, uuid),
    "content-security-policy":
      `default-src 'none'; style-src 'unsafe-inline'; connect-src 'self'; script-src 'nonce-${nonce}'`,
  });
  res.end(trangCho(uuid, challenge, nonce));
}

/**
 * `/auth/cinai?uuid=…` — hai phương thức, hai việc, và sự tách đôi ấy LÀ hàng rào:
 *
 *   `GET`  chỉ **báo** request này đang là ai (`{cinai, email}`). Không đổi gì. Một cú điều hướng
 *          chéo site tới được cũng vô hại, và `SameSite=Strict` thì nó cũng không mang cookie nên 403.
 *   `POST` **duyệt**. Một điều hướng không tạo ra được POST, nên chỉ script cùng gốc của trang chờ
 *          tới được — và trang chờ chỉ gọi nó sau một cú bấm của con người.
 *
 * Cả hai đòi cookie `gb2_login` khớp `uuid`. Câu trả lời cố ý gọn: một câu chi tiết ở cửa đăng nhập
 * là bản đồ cho người đang dò, đúng quyết định đã ghi ở `giayDuChoOps` (§6 mục 43).
 */
export async function handleAuthCinai(
  url: string,
  method: string,
  headers: Record<string, unknown>,
  res: ServerResponse,
): Promise<void> {
  const uuid = new URL(url, "http://x").searchParams.get("uuid") ?? "";
  const buoc = cookieValue(headers["cookie"] as string | string[] | undefined, COOKIE_CHO);
  if (!uuid || buoc !== uuid) return json(res, { cinai: false, ok: false }, 403);

  const nguoi = await danhTinhTuCookie(headers);
  const m = (method || "GET").toUpperCase();

  // Mặc định là ĐỌC: một phương thức lạ (HEAD, PUT…) không được rơi vào nhánh duyệt.
  if (m !== "POST") return json(res, { cinai: !!nguoi, email: nguoi?.email ?? "" });

  if (!nguoi) return json(res, { ok: false });
  if (!approveLogin(uuid, { authId: nguoi.authId, email: nguoi.email })) return json(res, { ok: false });
  return json(res, { ok: true });
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
