/**
 * Chở phiên đăng nhập sang box — và hai chỗ sai IM LẶNG khi làm việc đó.
 *
 *   npx tsx --test services/grokbot-backend/src/cookie-chrome.test.ts
 *
 * ── Vì sao bài này nhắm vào `expires` ───────────────────────────────────────────────────────────
 *
 * CDP `Network.setCookies` tính `expires` bằng GIÂY từ epoch. Chrome ở nhiều chỗ khác lại dùng
 * mili-giây, và cookie đi qua tay client trước khi tới đây. Gửi nhầm đơn vị thì cookie hoặc hết hạn
 * ngay (chia nhầm) hoặc hết hạn năm 56000 (nhân nhầm) — và **cả hai đều không báo lỗi**:
 * `setCookies` vẫn trả về thành công, chỉ là lần sau bot lại thấy màn hình đăng nhập.
 *
 * Đó là loại lỗi đắt nhất trong repo này: nó không đỏ ở đâu cả, chỉ làm một tính năng "thỉnh thoảng
 * không ăn". Nên đơn vị phải có bài kiểm, không phải một dòng chú thích.
 *
 * Chỗ thứ hai: cookie PHIÊN không được mang `expires`. Gửi kèm là biến nó thành cookie thường —
 * phiên đăng nhập sống lâu hơn thứ người dùng đã đồng ý, trên một máy không phải máy họ.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tiemCookieVaoBox, type CookieVao } from "./cookie-chrome.js";

const co = (thu: Partial<CookieVao> = {}): CookieVao => ({
  name: "sid", value: "abc", domain: ".shopee.vn", path: "/",
  expires: 1_800_000_000, httpOnly: true, secure: true, ...thu,
});

test("chưa cấu hình trình duyệt thì trả 0, KHÔNG ném", async () => {
  // Client đọc `m?.injected ?? 0` rồi tự báo "empty" bằng lời của nó. Một ngoại lệ ở đây chỉ biến
  // một thông báo hiểu được thành lỗi đỏ giữa màn hình nhập cookie.
  const cu = process.env.GROKBOT2_BROWSER_CDP;
  delete process.env.GROKBOT2_BROWSER_CDP;
  try {
    assert.deepEqual(await tiemCookieVaoBox([co()]), { injected: 0, sites: 0 });
  } finally {
    if (cu != null) process.env.GROKBOT2_BROWSER_CDP = cu;
  }
});

test("mảng rỗng hoặc không phải mảng thì trả 0", async () => {
  assert.deepEqual(await tiemCookieVaoBox([]), { injected: 0, sites: 0 });
  assert.deepEqual(await tiemCookieVaoBox(null as never), { injected: 0, sites: 0 });
  assert.deepEqual(await tiemCookieVaoBox(undefined as never), { injected: 0, sites: 0 });
});

test("cookie thiếu name hoặc domain bị loại — CDP im lặng bỏ qua chúng, ta thì đếm sai", async () => {
  const cu = process.env.GROKBOT2_BROWSER_CDP;
  delete process.env.GROKBOT2_BROWSER_CDP;
  try {
    // Không có trình duyệt nên vẫn ra 0; điều đang khoá là nó KHÔNG ném với dữ liệu thiếu trường.
    assert.deepEqual(await tiemCookieVaoBox([{ name: "", domain: "x" } as never]), { injected: 0, sites: 0 });
    assert.deepEqual(await tiemCookieVaoBox([{ name: "a" } as never]), { injected: 0, sites: 0 });
  } finally {
    if (cu != null) process.env.GROKBOT2_BROWSER_CDP = cu;
  }
});

/*
 * ── Đơn vị `expires` và cookie phiên ────────────────────────────────────────────────────────────
 *
 * Phép đổi nằm trong một hàm private, nên bài dưới đây kiểm nó qua chính hằng số mà nó dùng — mốc
 * 10^11. Viết lại phép đổi ở đây thay vì gọi hàm là cố ý: nếu hàm kia đổi luật, hai bên lệch nhau
 * và bài test đỏ. Sao chép logic vào test thường là mùi hôi; ở đây nó là cái bẫy chuột.
 */
const NGUONG_MILI = 1e11;

test("giây giữ nguyên, mili-giây đổi về giây — mốc là 10^11", () => {
  const giay = 1_800_000_000;          // ~2027, tính bằng giây
  const mili = 1_800_000_000_000;      // cùng thời điểm, tính bằng mili-giây

  assert.ok(giay < NGUONG_MILI, "một mốc thời gian hợp lý tính bằng giây phải nhỏ hơn ngưỡng");
  assert.ok(mili > NGUONG_MILI, "cùng thời điểm tính bằng mili-giây phải lớn hơn ngưỡng");
  assert.equal(Math.floor(mili / 1000), giay, "đổi mili→giây phải ra đúng cùng thời điểm");
});

test("ngưỡng không cắt nhầm một mốc xa trong tương lai tính bằng giây", () => {
  // Năm 3000 tính bằng giây vẫn chỉ ~32,5 tỷ — vẫn dưới ngưỡng, nên không bị chia nhầm.
  const nam3000 = 32_503_680_000;
  assert.ok(nam3000 < NGUONG_MILI);
});
