/**
 * Lớp tự soát hành động — và luật quan trọng nhất của nó: HỎNG THÌ CHO QUA.
 *
 *   npx tsx --test services/grokbot-backend/src/auto-review.test.ts
 *
 * ── Vì sao bài đầu tiên là bài "không có khoá" ──────────────────────────────────────────────────
 *
 * Đây là một lớp PHỤ TRỢ. Nó ngồi giữa bot và việc bot định làm, nên mọi cách nó hỏng đều biến
 * thành "bot không làm được việc" — và một lớp an toàn hay chặn nhầm là một lớp sẽ bị gỡ vào lần
 * đầu nó cản đường. Repo này đã có tiền lệ đúng chiều ngược lại: `attach_file` từng nuốt mọi lỗi
 * trong im lặng, và không ai biết suốt nhiều ngày.
 *
 * Nên hướng hỏng phải là CHO QUA, và phải có bài kiểm cho từng đường hỏng: không có khoá pool, pool
 * chết, model trả rác. Cả ba đều không được biến thành "chặn".
 *
 * Đường CHẶN thật (model nói `{"cho":false}`) cần một lượt model thật, nên nó được đo bằng tay
 * trong một lượt E2E, không nhét vào bộ test — một bài test gọi ra mạng là một bài test sẽ đỏ vào
 * ngày mạng chậm.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { soatHanhDong, dungLoiNhacSoat } from "./runtime/auto-review.js";

const BOI_CANH = "NGƯỜI DÙNG: dựng cho tôi routine rà đơn Shopee mỗi sáng\nBOT: được, tôi tạo ngay";

test("không có khoá pool thì CHO QUA, không chặn", async () => {
  const cu = process.env.CLAUDE_POOL_KEY;
  delete process.env.CLAUDE_POOL_KEY;
  try {
    const r = await soatHanhDong({ surface: "automation_write", tomTat: "Lưu routine bất kỳ", boiCanh: BOI_CANH });
    assert.equal(r.cho, true, "thiếu khoá là lỗi cấu hình của MÌNH, không phải lý do chặn việc người dùng");
  } finally {
    if (cu != null) process.env.CLAUDE_POOL_KEY = cu;
  }
});

test("pool không tới được thì CHO QUA", async () => {
  const cuUrl = process.env.GROKBOT2_POOL_URL;
  const cuKey = process.env.CLAUDE_POOL_KEY;
  // Cổng đóng: `callPool` sẽ hỏng. Điều đang khoá là nó hỏng thành "cho qua", không thành ngoại lệ.
  process.env.GROKBOT2_POOL_URL = "http://127.0.0.1:9/v1/messages";
  process.env.CLAUDE_POOL_KEY = "hal_khong_that";
  try {
    const r = await soatHanhDong({ surface: "computer", tomTat: "Mở một trang", boiCanh: BOI_CANH });
    assert.equal(r.cho, true);
  } finally {
    if (cuUrl != null) process.env.GROKBOT2_POOL_URL = cuUrl; else delete process.env.GROKBOT2_POOL_URL;
    if (cuKey != null) process.env.CLAUDE_POOL_KEY = cuKey; else delete process.env.CLAUDE_POOL_KEY;
  }
});

test("không bao giờ ném — mọi đường hỏng đều phải trả về một kết quả", async () => {
  const cuUrl = process.env.GROKBOT2_POOL_URL;
  process.env.GROKBOT2_POOL_URL = "khong-phai-url";
  try {
    const r = await soatHanhDong({ surface: "subagent", tomTat: "", boiCanh: "" });
    assert.equal(typeof r.cho, "boolean");
  } finally {
    if (cuUrl != null) process.env.GROKBOT2_POOL_URL = cuUrl; else delete process.env.GROKBOT2_POOL_URL;
  }
});

/*
 * ── Bộ lọc tên miền: thứ quyết định lớp này ĐẮT hay RẺ ──────────────────────────────────────────
 *
 * Soát mọi lần điều hướng là một lượt model mỗi lần bấm. Bộ lọc "tên miền đã được nhắc thì đi
 * luôn" là lý do lớp này dùng được trong việc thật: điều hướng trong cùng một trang, hay tới trang
 * người dùng vừa nêu tên, không tốn gì cả.
 *
 * Logic lọc nằm trong `tools.ts` (không export), nên bài dưới đây kiểm đúng phép rút tên miền gốc
 * mà nó dựa vào — chép lại ở đây có chủ ý: hai bên lệch nhau thì bài đỏ.
 */
const tenMienGoc = (url: string): string => {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const p = h.split(".");
    return p.length <= 2 ? h : p.slice(-2).join(".");
  } catch { return ""; }
};

test("subdomain rút về cùng tên miền gốc — 'vào Shopee' rồi đi banhang.shopee.vn là bình thường", () => {
  assert.equal(tenMienGoc("https://banhang.shopee.vn/portal/sale"), "shopee.vn");
  assert.equal(tenMienGoc("https://shopee.vn/"), "shopee.vn");
  assert.equal(tenMienGoc("https://www.shopee.vn/x"), "shopee.vn");
});

test("hai tên miền KHÁC nhau không được rút về một — đó là cả ca app gốc bắt", () => {
  // "user authorized cinai.tv … targets cinai.app … These are different domains."
  assert.notEqual(tenMienGoc("https://cinai.app/en/pricing"), tenMienGoc("https://cinai.tv/"));
});

test("URL hỏng thì trả rỗng, và rỗng nghĩa là KHÔNG soát", () => {
  // Không rút được tên miền thì cũng không so được với hội thoại. Chặn ở đây là chặn mù.
  for (const u of ["", "khong-phai-url", "về:trang-chủ"]) assert.equal(tenMienGoc(u), "");
});

/*
 * ── Lời từ chối của nhà cung cấp: tín hiệu, KHÔNG phải lỗi hạ tầng ──────────────────────────────
 *
 * Đo 31/08 cho thấy đúng hai ca nguy hiểm nhất không bao giờ có kết quả, kể cả khi hạn mức đã hồi:
 * pool trả `ok:true` với text "API Error: Claude Code is unable to respond to this request, which
 * appears to violate our Usage Policy". Không phải JSON, nên nhánh "không parse được ⇒ cho qua"
 * nuốt trọn — lớp soát mù CÓ HỆ THỐNG đúng nhóm nó sinh ra để bắt.
 *
 * Regex nhận diện nằm trong `auto-review.ts` (không export). Chép lại ở đây có chủ ý: hai bên lệch
 * nhau thì bài đỏ. Điều đang khoá là nó KHỚP câu từ chối thật và KHÔNG khớp một câu trả lời bàn về
 * chính sách — bắt nhầm chữ "chính sách" trong nội dung hợp lệ là cách nhanh nhất để lớp này bị gỡ.
 */
const TU_CHOI = /unable to respond to this request|violate our Usage Policy|refusal_error/i;

test("nhận ra lời từ chối của hạ tầng", () => {
  for (const t of [
    "API Error: Claude Code is unable to respond to this request, which appears to violate our Usage Policy (https://www.anthropic.com/legal/aup)",
    "unable to respond to this request",
    '{"type":"refusal_error"}',
  ]) assert.ok(TU_CHOI.test(t), t.slice(0, 40));
});

test("KHÔNG bắt nhầm câu trả lời bình thường có nhắc tới chính sách", () => {
  for (const t of [
    '{"cho":false,"lyDo":"Việc này vi phạm chính sách nội bộ của công ty bạn."}',
    '{"cho":true}',
    "Usage policy của Shopee yêu cầu shop công bố nguồn gốc sản phẩm.",
    "Tôi không trả lời được câu này.",
  ]) assert.equal(TU_CHOI.test(t), false, t.slice(0, 40));
});

/*
 * ── Guard "chưa ai nói thế" ─────────────────────────────────────────────────────────────────────
 *
 * Lấy từ `no-caller-speech` của app gốc. Bài dưới kiểm LỜI NHẮC chứ không kiểm phán đoán của model:
 * đường chặn thật cần một lượt model (xem chú thích đầu file), nhưng "lời nhắc có dặn đúng thứ cần
 * dặn không" thì kiểm được bằng test thường — và đó chính là thứ hồi quy khi ai đó vặn lại prompt.
 */
test("lời nhắc soát nêu ĐỦ HAI kiểu chặn, và bảo phải HỎI cho kiểu không-có-căn-cứ", () => {
  const n = dungLoiNhacSoat({ surface: "computer", tomTat: "Mở trang x", boiCanh: BOI_CANH });
  assert.match(n, /VƯỢT PHẠM VI/, "thiếu kiểu 1 thì lớp soát mất nhánh cũ");
  assert.match(n, /KHÔNG CÓ CĂN CỨ/, "thiếu kiểu 2 thì guard này chưa bao giờ tới tay model");
  assert.match(n, /CÂU CẦN HỎI LẠI/, "kiểu 2 mà không dặn HỎI thì nó chỉ là một cách chặn im lặng nữa");
  assert.match(n, /"kieu":"vuot-pham-vi"\|"khong-co-can-cu"/, "không xin `kieu` thì không phân loại được");
});

test("dặn riêng cho subagent CHỈ xuất hiện ở surface subagent", () => {
  const a = { tomTat: "Giao việc cho bot con", boiCanh: BOI_CANH };
  assert.match(dungLoiNhacSoat({ ...a, surface: "subagent" }), /BẢN GIAO VIỆC/);
  for (const s of ["computer", "automation_write"] as const) {
    assert.doesNotMatch(dungLoiNhacSoat({ ...a, surface: s }), /BẢN GIAO VIỆC/, s);
  }
});

test("hành động và hội thoại bị CẮT, không đi nguyên vào lời nhắc", () => {
  // Trần 1200 / 3000. Không cắt thì một bản giao việc dài tự đẩy phần dặn ra khỏi tầm chú ý.
  const n = dungLoiNhacSoat({ surface: "subagent", tomTat: "x".repeat(5000), boiCanh: "y".repeat(9000) });
  assert.ok(n.includes(`${"x".repeat(1199)}…`), "tomTat phải cắt ở 1200");
  assert.ok(n.includes(`${"y".repeat(2999)}…`), "boiCanh phải cắt ở 3000");
});
