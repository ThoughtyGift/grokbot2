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
import { soatHanhDong } from "./runtime/auto-review.js";

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
