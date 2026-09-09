/**
 * Hỏi cinAPI "cookie này là ai" — cách (C) của cinapi-merge §4.
 *
 *   node services/grokbot-backend/scripts/run-tests.mjs "services/grokbot-backend/src/cinapi-danh-tinh.test.ts"
 *
 * Bài này chạy **TRƯỚC khi nối dây**, đúng luật §7 (*"một bài đo cho module thuần thì chạy được
 * TRƯỚC khi nối dây — hãy chạy nó ở đó"*). Module không chạm đĩa nên không cần `mkdtemp`; thứ phải
 * cách ly là **biến môi trường** `GROKBOT2_CINAPI_BASE`, và mỗi bài tự đặt/trả lại nó — `node --test`
 * chạy các file song song, nhưng `process.env` là của riêng từng tiến trình con nên trong file này
 * chỉ cần không để bài nọ ảnh hưởng bài kia.
 *
 * Cửa mạng được TIÊM: không bài nào mở socket, nên bộ đo không phụ thuộc cinapi có sống hay không.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  cinapiGoc,
  docDanhTinh,
  duongMe,
  hoiCinapiMe,
  TRAN_MS,
  type Lay,
} from "./cinapi-danh-tinh.js";

const GOC = "https://vi.du";
const TOKEN = "day-la-mot-cookie-bi-mat-khong-duoc-ro-ra";

/** Thân reply THẬT của cinapi, đúng hình đo trên VPS 09/09 (`envelope.go` + `me.go` + `auth.go:35`). */
const thanThat = (id: string, email = "ai@vi.du"): string =>
  JSON.stringify({
    code: 200,
    msg: "ok",
    data: { user: { id, email, email_verified: true, role: "user", status: "ACTIVE", display_name: "", avatar_url: "", totp_enabled: false, created_at: "2026-09-01T00:00:00Z" } },
  });

const doiGoc = <T>(gia: string | undefined, f: () => T): T => {
  const cu = process.env.GROKBOT2_CINAPI_BASE;
  if (gia === undefined) delete process.env.GROKBOT2_CINAPI_BASE;
  else process.env.GROKBOT2_CINAPI_BASE = gia;
  try {
    return f();
  } finally {
    if (cu === undefined) delete process.env.GROKBOT2_CINAPI_BASE;
    else process.env.GROKBOT2_CINAPI_BASE = cu;
  }
};

// ── docDanhTinh: THUẦN, và đây là chỗ mọi luật về hình dạng được ghim ──────────

test("docDanhTinh đọc đúng thân envelope THẬT của cinapi", () => {
  assert.deepEqual(docDanhTinh(thanThat("018f-abc-uuid")), {
    authId: "cinapi|018f-abc-uuid",
    email: "ai@vi.du",
  });
});

test("docDanhTinh nhận cả dạng KHÔNG bọc envelope", () => {
  const than = JSON.stringify({ user: { id: "u1", email: "b@vi.du" } });
  assert.deepEqual(docDanhTinh(than), { authId: "cinapi|u1", email: "b@vi.du" });
});

test("docDanhTinh trả null cho thân 401 THẬT — không dựng danh tính từ data:null", () => {
  assert.equal(docDanhTinh('{"code":401,"msg":"unauthorized","data":null}'), null);
});

test("docDanhTinh KHÔNG nhận `{id}` trần — một thân lạ mà đoán ra danh tính là chỗ tệ nhất để dễ tính", () => {
  assert.equal(docDanhTinh('{"id":"u1","email":"b@vi.du"}'), null);
});

test("id RỖNG trả null, không trả `cinapi|` — khoá rỗng gom mọi người vào một chủ", () => {
  assert.equal(docDanhTinh(thanThat("")), null);
  assert.equal(docDanhTinh(thanThat("   ")), null);
});

test("id mang `|` bị TỪ CHỐI — không thì một id bịa mạo được danh tính mặc định", () => {
  // Đúng phép mạo danh cần chặn: nối vào sau tiền tố thì chuỗi thành `cinapi|x|grokbot2-user`,
  // và bất kỳ chỗ nào cắt theo `|` cũng đọc ra một phần khác hẳn.
  assert.equal(docDanhTinh(thanThat("x|grokbot2-user")), null);
  assert.equal(docDanhTinh(thanThat("auth0|grokbot2-user")), null);
});

test("id mang khoảng trắng bị từ chối (kể cả tab/newline)", () => {
  assert.equal(docDanhTinh(thanThat("u 1")), null);
  assert.equal(docDanhTinh(thanThat("u\t1")), null);
  assert.equal(docDanhTinh(thanThat("u\n1")), null);
});

test("thân không phải JSON thì trả null, KHÔNG ném", () => {
  for (const x of ["", "khong-phai-json", "<html>401</html>", "null", "[]", "{}"]) {
    assert.equal(docDanhTinh(x), null, `thân ${JSON.stringify(x)} phải ra null`);
  }
});

test("email vắng thì vẫn ra danh tính — id mới là khoá sở hữu, email chỉ để hiện", () => {
  const than = JSON.stringify({ data: { user: { id: "u9" } } });
  assert.deepEqual(docDanhTinh(than), { authId: "cinapi|u9", email: "" });
});

// ── cinapiGoc: vắng biến ⇒ tính năng TẮT ──────────────────────────────────────

test("vắng GROKBOT2_CINAPI_BASE ⇒ null (tính năng tắt, không nhánh nào tự đoán URL)", () => {
  doiGoc(undefined, () => assert.equal(cinapiGoc(), null));
  doiGoc("   ", () => assert.equal(cinapiGoc(), null));
});

test("gốc không phải http/https bị từ chối", () => {
  for (const x of ["javascript:alert(1)", "file:///etc/passwd", "vi.du", "ftp://vi.du"]) {
    doiGoc(x, () => assert.equal(cinapiGoc(), null, `${x} phải bị từ chối`));
  }
});

test("gạch chéo cuối bị cắt để đường /me không thành hai gạch", () => {
  doiGoc("https://vi.du///", () => assert.equal(cinapiGoc(), "https://vi.du"));
  assert.equal(duongMe("https://vi.du"), "https://vi.du/api/v1/me");
});

// ── hoiCinapiMe: token đi ĐÂU, và không đi đâu nữa ────────────────────────────

test("token đi trong header Cookie và KHÔNG BAO GIỜ vào URL", async () => {
  let thayUrl = "";
  let thayHeaders: Record<string, string> = {};
  const lay: Lay = async (url, init) => {
    thayUrl = url;
    thayHeaders = init.headers;
    return { ok: true, status: 200, text: async () => thanThat("u1") };
  };
  const r = await hoiCinapiMe(TOKEN, { lay, goc: GOC });
  assert.deepEqual(r, { authId: "cinapi|u1", email: "ai@vi.du" });
  assert.equal(thayUrl, `${GOC}/api/v1/me`);
  assert.equal(thayUrl.includes(TOKEN), false, "URL không được mang token");
  assert.equal(thayHeaders["cookie"], `cinapi_at=${TOKEN}`);
});

test("token rỗng ⇒ KHÔNG gọi mạng một lần nào", async () => {
  let n = 0;
  const lay: Lay = async () => {
    n++;
    return { ok: true, status: 200, text: async () => thanThat("u1") };
  };
  assert.equal(await hoiCinapiMe("", { lay, goc: GOC }), null);
  assert.equal(await hoiCinapiMe("   ", { lay, goc: GOC }), null);
  assert.equal(n, 0);
});

test("vắng gốc ⇒ KHÔNG gọi mạng (tính năng tắt là tắt hẳn, không phải hỏi rồi lỗi)", async () => {
  let n = 0;
  const lay: Lay = async () => {
    n++;
    return { ok: true, status: 200, text: async () => thanThat("u1") };
  };
  assert.equal(await hoiCinapiMe(TOKEN, { lay, goc: null }), null);
  assert.equal(n, 0);
});

test("401 ⇒ null, và thân không được đọc để dựng danh tính", async () => {
  const lay: Lay = async () => ({
    ok: false,
    status: 401,
    text: async () => '{"code":401,"msg":"unauthorized","data":null}',
  });
  assert.equal(await hoiCinapiMe(TOKEN, { lay, goc: GOC }), null);
});

test("200 mà thân lạ ⇒ null (không suy danh tính từ mã trạng thái)", async () => {
  const lay: Lay = async () => ({ ok: true, status: 200, text: async () => "<html>ok</html>" });
  assert.equal(await hoiCinapiMe(TOKEN, { lay, goc: GOC }), null);
});

test("mạng ném ⇒ null, không ném ra ngoài, và câu lỗi không mang token", async () => {
  const lay: Lay = async () => {
    throw new Error(`fetch failed cho ${TOKEN}`);
  };
  // Nếu hàm để lỗi lọt ra thì token đi theo `stack` vào log của người gọi — bài này ghim là không.
  assert.equal(await hoiCinapiMe(TOKEN, { lay, goc: GOC }), null);
});

test("cinapi treo thì bỏ theo TRẦN CHỜ, không đợi vô hạn — đường này có người đang đứng xem", async () => {
  const lay: Lay = (_u, init) =>
    new Promise((_ok, that) => {
      init.signal?.addEventListener("abort", () => that(new Error("aborted")));
    });
  const t0 = Date.now();
  assert.equal(await hoiCinapiMe(TOKEN, { lay, goc: GOC, tranMs: 40 }), null);
  assert.ok(Date.now() - t0 < 2000, "phải về theo trần chờ, không treo");
  assert.equal(TRAN_MS, 4000);
});

test("hỏi xong thì đồng hồ ĐƯỢC DỌN — đếm tài nguyên sống, không đo bằng cách để bài treo", async () => {
  const lay: Lay = async () => ({ ok: true, status: 200, text: async () => thanThat("u1") });
  const demTimer = (): number =>
    (process.getActiveResourcesInfo?.() ?? []).filter((x) => x === "Timeout").length;
  /*
   * Bản đầu của bài này chỉ gọi hàm với `tranMs` rất lớn rồi assert kết quả, và tôi đặt tên nó là
   * "đồng hồ được dọn". Lượt tiêm lỗi (bỏ `clearTimeout`) cho thấy nó ĐỎ — nhưng đỏ vì tiến trình
   * TREO tới hết trần của kịch bản kiểm, không vì một assert nào ở đây; tức tên bài khai một tính
   * chất mà thân bài không kiểm. Đúng §7: *"một cửa kiểm đỏ vì lý do khác thì chưa phải bằng chứng
   * nó bắt được thứ nó khai"*. Nay đếm tài nguyên sống của tiến trình: một `setTimeout` chưa dọn là
   * một `Timeout` còn trong danh sách.
   */
  const truoc = demTimer();
  const r = await hoiCinapiMe(TOKEN, { lay, goc: GOC, tranMs: 600_000 });
  assert.deepEqual(r, { authId: "cinapi|u1", email: "ai@vi.du" });
  assert.equal(demTimer(), truoc, "sau khi hỏi xong không được còn Timeout nào của lượt này");
});

// ── ghim bằng cách ĐỌC MÃ: module này không được có đường rò ───────────────────

test("module KHÔNG có một lời gọi log nào — một dòng log là một chỗ rò", () => {
  const tep = join(dirname(fileURLToPath(import.meta.url)), "cinapi-danh-tinh.ts");
  const ma = readFileSync(tep, "utf8");
  // Bỏ chú thích khối và dòng trước khi đếm: chú thích đầu tệp CÓ nhắc chữ "log" một cách cố ý.
  const than = ma.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const cam of ["console.", "process.stdout", "process.stderr"]) {
    assert.equal(than.includes(cam), false, `module không được chứa ${cam}`);
  }
});

test("`duongMe` không nhận token — hình dạng hàm là thứ bảo đảm token không vào URL", () => {
  assert.equal(duongMe.length, 1, "đúng một đối số: gốc");
  assert.equal(duongMe(GOC).includes(TOKEN), false);
});
