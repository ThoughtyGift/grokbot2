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

import { accessVerdict, recordUsage, setPlan, getPlan } from "./billing.js";

const ID = (ten: string) => ({ authId: `test|billing-gate-${ten}`, email: `${ten}@test.local` });

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
