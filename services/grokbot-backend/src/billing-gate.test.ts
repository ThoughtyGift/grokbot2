/**
 * Cổng billing — nhánh TỪ CHỐI, trước giờ chưa có test nào.
 *
 * Vì sao viết bây giờ: 02/09 bật `GROKBOT2_BILLING=enforce` trên hệ thật (mục 5 roadmap, đã đủ 11
 * ngày số liệu warn). Nhánh `payment_required` là đường **chưa bao giờ chạy** — và bài học cùng ngày
 * từ vụ video: một đường chưa chạy thì không có lỗi nào để thấy, nó chỉ im. Số đo thật lúc bật:
 * tài khoản chủ đã dùng ~18,7 triệu token / trần free 100.000 — tức nếu trình tự bật sai (enforce
 * trước, nâng plan sau) thì chính chủ bị khoá ngay lượt đầu tiên.
 *
 * Chạy dưới `node --test` nên `dataDir()` trỏ thư mục tạm (NODE_TEST_CONTEXT) — không chạm `.data`
 * thật. Kho tạm này DÙNG CHUNG giữa các file test trong một lần chạy, nên mọi authId ở đây mang tiền
 * tố riêng để không giẫm dữ liệu của bài khác.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { accessVerdict, recordUsage, setPlan, getPlan, upgradeUrl } from "./billing.js";

/*
 * Hậu tố ngẫu nhiên THEO LẦN CHẠY, không chỉ theo tên ca.
 *
 * Kho tạm của test (`grokbot2-test-store` trong tmpdir) sống QUA các lần chạy. Bản đầu dùng authId
 * cố định, nên lần chạy thứ hai user `free-qua-tran` vẫn đang vượt trần từ lần trước, và assertion
 * "TRƯỚC khi vượt → granted" sập — đúng bẫy "sổ trắng hoá ra không trắng" (§7 bảng theo dõi), lần
 * này ở quy mô sandbox. Đo được: chạy một mình thì 5/5 xanh, chạy lần hai đỏ đúng một bài.
 */
const LAN_CHAY = Math.random().toString(36).slice(2, 8);
const ID = (ten: string) => ({ authId: `test|billing-gate-${LAN_CHAY}-${ten}`, email: `${ten}@test.local` });

/** Đặt mode cho MỘT khối rồi trả lại như cũ — .env thật của máy đang là "warn". */
const voiMode = async (mode: string, than: () => void | Promise<void>) => {
  const cu = process.env.GROKBOT2_BILLING;
  process.env.GROKBOT2_BILLING = mode;
  try { await than(); } finally {
    if (cu == null) delete process.env.GROKBOT2_BILLING; else process.env.GROKBOT2_BILLING = cu;
  }
};

/** Đẩy một user free vượt trần tháng — trần đọc từ bảng plans thật (seed 100.000). */
const vuotTran = (authId: string) => {
  const cap = getPlan("free")?.monthlyTokenCap ?? 100_000;
  recordUsage(authId, cap, 1);
};

test("warn: vượt trần vẫn GRANTED — chế độ đo không bao giờ khoá ai", async () => {
  await voiMode("warn", () => {
    const u = ID("warn-qua-tran");
    assert.equal(accessVerdict(u), "granted");   // ensureUser tạo dòng free
    vuotTran(u.authId);
    assert.equal(accessVerdict(u), "granted");
  });
});

test("enforce: free DƯỚI trần → granted", async () => {
  await voiMode("enforce", () => {
    assert.equal(accessVerdict(ID("free-duoi-tran")), "granted");
  });
});

test("enforce: free VƯỢT trần → payment_required — nhánh chưa từng chạy trước 02/09", async () => {
  await voiMode("enforce", () => {
    const u = ID("free-qua-tran");
    assert.equal(accessVerdict(u), "granted");
    vuotTran(u.authId);
    assert.equal(accessVerdict(u), "payment_required");
  });
});

test("enforce: pro không hạn (cap null) → granted dù dùng bao nhiêu — đúng ca của tài khoản chủ", async () => {
  await voiMode("enforce", () => {
    const u = ID("pro-khong-han");
    assert.equal(accessVerdict(u), "granted");
    setPlan(u.authId, "pro", null);
    recordUsage(u.authId, 20_000_000, 1_000_000);   // cùng cỡ số thật của chủ
    assert.equal(accessVerdict(u), "granted");
  });
});

test("enforce: pro HẾT HẠN → payment_required, còn hạn → granted", async () => {
  await voiMode("enforce", () => {
    const u = ID("pro-het-han");
    assert.equal(accessVerdict(u), "granted");
    setPlan(u.authId, "pro", Date.now() - 1_000);
    assert.equal(accessVerdict(u), "payment_required");
    setPlan(u.authId, "pro", Date.now() + 86_400_000);
    assert.equal(accessVerdict(u), "granted");
  });
});

/*
 * `upgradeUrl()` — knob CHẾT tới 09/09, và bài đo này ghim đúng chỗ nó chết.
 *
 * `seedPlans()` ghi hàng `pro` bằng `INSERT OR IGNORE`, nên hàng đã tạo hồi biến còn vắng mang
 * `checkout_url = NULL` vĩnh viễn — đo được trên cả kho dev lẫn kho VPS. Đặt biến rồi khởi động lại
 * KHÔNG sửa được. Nay env đọc trước, và ba bài dưới đây là ba câu hỏi khác nhau về nó.
 */
const doiEnv = <T>(v: string | undefined, f: () => T): T => {
  const cu = process.env.GROKBOT2_CHECKOUT_URL;
  if (v === undefined) delete process.env.GROKBOT2_CHECKOUT_URL;
  else process.env.GROKBOT2_CHECKOUT_URL = v;
  try {
    return f();
  } finally {
    if (cu === undefined) delete process.env.GROKBOT2_CHECKOUT_URL;
    else process.env.GROKBOT2_CHECKOUT_URL = cu;
  }
};

test("upgradeUrl: env thắng hàng DB đã nướng NULL — đây là cái đã chết", () => {
  assert.equal(getPlan("pro")?.checkoutUrl ?? null, null, "hàng pro trong kho tạm cũng NULL, đúng như kho thật");
  assert.equal(doiEnv("https://cinai.app/vi/subscription", upgradeUrl), "https://cinai.app/vi/subscription");
});

test("upgradeUrl: env vắng → vẫn null, không bịa địa chỉ", () => {
  assert.equal(doiEnv(undefined, upgradeUrl), null);
});

test("upgradeUrl: chỉ nhận http(s) — javascript: là chạy mã trong app người dùng", () => {
  assert.equal(doiEnv("javascript:alert(1)", upgradeUrl), null);
  assert.equal(doiEnv("  ", upgradeUrl), null, "chuỗi trắng không phải một URL");
});
