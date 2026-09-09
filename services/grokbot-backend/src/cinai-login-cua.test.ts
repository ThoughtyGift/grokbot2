/**
 * Cửa đăng nhập cinAPI: **một cú GET không được đăng nhập hộ ai.**
 *
 *   node services/grokbot-backend/scripts/run-tests.mjs "services/grokbot-backend/src/cinai-login-cua.test.ts"
 *
 * Bài này sinh ra từ một lỗ THẬT trong bản đầu của tôi, và mọi mốc dưới đây là chiều PHỦ ĐỊNH của
 * nó. Lỗ ấy: `duongCinai` gọi `approveLogin` ngay trên lượt GET `/loginDeepControl`, bằng đúng
 * cookie `cinapi_at` mà trình duyệt gửi kèm. Ghép với `claimLogin` — hàm trao token cho ai giữ
 * `verifier`, tức bên KHỞI TẠO luồng — thành một đường chiếm tài khoản bằng một cú click:
 *
 *   kẻ tấn công tự bấm đăng nhập trên app của mình, đọc `uuid`+`challenge`, giữ `verifier`
 *   → gửi nạn nhân link `/loginDeepControl?uuid=U&challenge=C`
 *   → nạn nhân (đang đăng nhập cinai) bấm vào, cửa tự duyệt bằng danh tính CỦA NẠN NHÂN
 *   → app của kẻ tấn công hỏi vòng `/auth/poll?uuid=U&verifier=V` và nhận token của nạn nhân.
 *
 * Nên mốc đầu tiên đo đúng kịch bản ấy: sau lượt GET, phiên phải còn `pending`.
 *
 * cinAPI được dựng bằng một máy chủ HTTP THẬT trên loopback thay vì tiêm hàm — vì cửa cần được đo
 * qua cả `cinapiGoc()` (biến môi trường) lẫn `hoiCinapiMe` (đường mạng), đúng hai chỗ mà một bài
 * tiêm hàm sẽ đi vòng qua.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import { handleLoginPage, handleAuthCinai } from "./login-page.js";
import { challengeFor, claimLogin, resetDeviceLogins } from "./device-login.js";

const ID_CINAI = "018f-nguoi-that";
const EMAIL = "nan-nhan@vi.du";

/** Thân `/api/v1/me` đúng hình đo trên VPS 09/09 (`envelope.go` + `me.go`). */
const THAN = JSON.stringify({
  code: 200,
  msg: "ok",
  data: { user: { id: ID_CINAI, email: EMAIL, role: "user", status: "ACTIVE" } },
});

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

/** cinAPI giả: chỉ biết `/api/v1/me`, và chỉ nhận cookie `cinapi_at` đúng giá trị. */
async function moCinapi(token: string): Promise<{ goc: string; dong: () => Promise<void>; soLuot: () => number }> {
  let n = 0;
  const sv: Server = createServer((req, res) => {
    n++;
    const ok = req.url === "/api/v1/me" && String(req.headers.cookie ?? "").includes("cinapi_at=" + token);
    res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
    res.end(ok ? THAN : JSON.stringify({ code: 401, msg: "unauthorized", data: null }));
  });
  await new Promise<void>((ok) => sv.listen(0, "127.0.0.1", ok));
  const cong = (sv.address() as { port: number }).port;
  return {
    goc: "http://127.0.0.1:" + cong,
    dong: () => new Promise<void>((ok) => sv.close(() => ok())),
    soLuot: () => n,
  };
}

interface San {
  uuid: string;
  verifier: string;
  cookieCinai: string;
  trang: string;
  dong: () => Promise<void>;
  soLuot: () => number;
}

/**
 * Dựng sân: cinAPI giả lên, biến môi trường trỏ vào nó, một phiên đăng nhập đang chờ, và một lượt
 * GET `/loginDeepControl` mang SẴN cookie cinai — tức đúng cảnh của kịch bản tấn công.
 */
async function dungSan(uuid = "u-" + Math.random().toString(36).slice(2)): Promise<San> {
  resetDeviceLogins();
  const token = "cookie-cinai-cua-nan-nhan";
  const { goc, dong, soLuot } = await moCinapi(token);
  process.env.GROKBOT2_CINAPI_BASE = goc;
  const verifier = "v-" + uuid;
  const { res, out } = fakeRes();
  await handleLoginPage(
    "/loginDeepControl?uuid=" + uuid + "&challenge=" + challengeFor(verifier),
    res,
    { cookie: "cinapi_at=" + token },
  );
  assert.equal(out.status, 200, "trang chờ phải vẽ được");
  return { uuid, verifier, cookieCinai: "cinapi_at=" + token, trang: out.body, dong, soLuot };
}

const donSan = async (s: San): Promise<void> => {
  delete process.env.GROKBOT2_CINAPI_BASE;
  await s.dong();
};

// ── mốc 1: chính kịch bản chiếm tài khoản ──────────────────────────────────────

test("GET /loginDeepControl có cookie cinai KHÔNG duyệt — phiên còn pending", async () => {
  const s = await dungSan();
  try {
    assert.deepEqual(claimLogin(s.uuid, s.verifier), { state: "pending" });
  } finally { await donSan(s); }
});

test("trang chờ đòi một cú BẤM: có nút, và lượt hỏi vòng không phải POST", async () => {
  const s = await dungSan();
  try {
    assert.match(s.trang, /Nối tài khoản này/);
    // Đúng MỘT chỗ gửi POST trong cả trang, và nó nằm SAU chỗ gắn tay bấm.
    const soPost = s.trang.split('method:"POST"').length - 1;
    assert.equal(soPost, 1, "chỉ một chỗ POST");
    assert.ok(
      s.trang.indexOf('addEventListener("click"') < s.trang.indexOf('method:"POST"'),
      "POST phải nằm trong tay bấm, không nằm trong vòng hỏi",
    );
    assert.match(s.trang, /vừa bấm đăng nhập trong ứng dụng/, "trang phải dặn đóng nếu không phải họ");
  } finally { await donSan(s); }
});

test("cookie buộc phiên: HttpOnly + SameSite=Strict + hạn ngắn", async () => {
  const s = await dungSan();
  try {
    const { res, out } = fakeRes();
    await handleLoginPage("/loginDeepControl?uuid=" + s.uuid + "&challenge=c", res, {});
    const c = out.headers["set-cookie"] ?? "";
    assert.match(c, /gb2_login=/);
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Strict/);
    assert.match(c, /Max-Age=900/);
  } finally { await donSan(s); }
});

// ── mốc 2: GET /auth/cinai chỉ BÁO ─────────────────────────────────────────────

test("GET /auth/cinai báo đúng tài khoản mà KHÔNG duyệt", async () => {
  const s = await dungSan();
  try {
    const { res, out } = fakeRes();
    await handleAuthCinai("/auth/cinai?uuid=" + s.uuid, "GET", {
      cookie: "gb2_login=" + s.uuid + "; " + s.cookieCinai,
    }, res);
    assert.deepEqual(JSON.parse(out.body), { cinai: true, email: EMAIL });
    assert.deepEqual(claimLogin(s.uuid, s.verifier), { state: "pending" }, "GET không được duyệt");
  } finally { await donSan(s); }
});

test("phương thức LẠ (HEAD/PUT) rơi về nhánh đọc, không rơi vào nhánh duyệt", async () => {
  for (const m of ["HEAD", "PUT", "DELETE", "post"]) {
    const s = await dungSan();
    try {
      const { res } = fakeRes();
      await handleAuthCinai("/auth/cinai?uuid=" + s.uuid, m, {
        cookie: "gb2_login=" + s.uuid + "; " + s.cookieCinai,
      }, res);
      // `post` chữ thường PHẢI duyệt được: phương thức HTTP không phân biệt hoa thường ở đây,
      // và một cửa chỉ nhận đúng chữ "POST" là một cửa hỏng theo cách im lặng.
      const cho = m === "post" ? "ready" : "pending";
      assert.equal(claimLogin(s.uuid, s.verifier).state, cho, "phương thức " + m);
    } finally { await donSan(s); }
  }
});

// ── mốc 3: POST là cửa duy nhất, và nó đòi cookie khớp ─────────────────────────

test("POST không cookie gb2_login ⇒ 403 và KHÔNG duyệt", async () => {
  const s = await dungSan();
  try {
    const { res, out } = fakeRes();
    await handleAuthCinai("/auth/cinai?uuid=" + s.uuid, "POST", { cookie: s.cookieCinai }, res);
    assert.equal(out.status, 403);
    assert.deepEqual(claimLogin(s.uuid, s.verifier), { state: "pending" });
  } finally { await donSan(s); }
});

test("POST cookie gb2_login của phiên KHÁC ⇒ 403 và KHÔNG duyệt", async () => {
  const s = await dungSan();
  try {
    const { res, out } = fakeRes();
    await handleAuthCinai("/auth/cinai?uuid=" + s.uuid, "POST", {
      cookie: "gb2_login=phien-khac; " + s.cookieCinai,
    }, res);
    assert.equal(out.status, 403);
    assert.deepEqual(claimLogin(s.uuid, s.verifier), { state: "pending" });
  } finally { await donSan(s); }
});

test("POST đủ giấy ⇒ duyệt, và chủ là `cinapi|<id>` chứ không phải danh tính mặc định", async () => {
  const s = await dungSan();
  try {
    const { res, out } = fakeRes();
    await handleAuthCinai("/auth/cinai?uuid=" + s.uuid, "POST", {
      cookie: "gb2_login=" + s.uuid + "; " + s.cookieCinai,
    }, res);
    assert.deepEqual(JSON.parse(out.body), { ok: true });
    assert.deepEqual(claimLogin(s.uuid, s.verifier), {
      state: "ready",
      user: { authId: "cinapi|" + ID_CINAI, email: EMAIL },
    });
  } finally { await donSan(s); }
});

test("POST không có cookie cinai ⇒ không duyệt, và cửa không hỏi cinapi lần nào thừa", async () => {
  const s = await dungSan();
  try {
    const truoc = s.soLuot();
    const { res, out } = fakeRes();
    await handleAuthCinai("/auth/cinai?uuid=" + s.uuid, "POST", { cookie: "gb2_login=" + s.uuid }, res);
    assert.deepEqual(JSON.parse(out.body), { ok: false });
    assert.deepEqual(claimLogin(s.uuid, s.verifier), { state: "pending" });
    assert.equal(s.soLuot(), truoc, "không cookie cinai thì không gọi cinapi");
  } finally { await donSan(s); }
});

test("cookie cinai BỊA ⇒ cinapi trả 401 ⇒ không duyệt", async () => {
  const s = await dungSan();
  try {
    const { res, out } = fakeRes();
    await handleAuthCinai("/auth/cinai?uuid=" + s.uuid, "POST", {
      cookie: "gb2_login=" + s.uuid + "; cinapi_at=bia-dat",
    }, res);
    assert.deepEqual(JSON.parse(out.body), { ok: false });
    assert.deepEqual(claimLogin(s.uuid, s.verifier), { state: "pending" });
  } finally { await donSan(s); }
});

test("uuid không có phiên nào đang chờ ⇒ không duyệt được", async () => {
  const s = await dungSan();
  try {
    const { res, out } = fakeRes();
    await handleAuthCinai("/auth/cinai?uuid=khong-ai-mo", "POST", {
      cookie: "gb2_login=khong-ai-mo; " + s.cookieCinai,
    }, res);
    assert.deepEqual(JSON.parse(out.body), { ok: false });
  } finally { await donSan(s); }
});

// ── mốc 4: vắng biến ⇒ hành vi cũ, không nhánh nào tự bật ──────────────────────

test("vắng GROKBOT2_CINAPI_BASE thì /loginDeepControl KHÔNG vẽ trang cinai", async () => {
  resetDeviceLogins();
  delete process.env.GROKBOT2_CINAPI_BASE;
  const { res, out } = fakeRes();
  await handleLoginPage("/loginDeepControl?uuid=u-tat&challenge=c", res, { cookie: "cinapi_at=gi-cung-duoc" });
  assert.doesNotMatch(out.body, /Nối tài khoản này/);
  assert.equal(claimLogin("u-tat", "khong-quan-trong").state, "unknown");
});
