/**
 * host_settings tách theo người — chặng 4.
 *
 *   npx tsx --test services/grokbot-backend/src/host-settings.test.ts
 *
 * Một câu hỏi: hai người dùng chung một backend có đè múi giờ của nhau không. Trước chặng 4 thì CÓ —
 * `userTimeZone` là một khoá dùng chung. Bài này khoá lại rằng giờ thì KHÔNG, mà cài đặt máy (MCP)
 * thì vẫn dùng chung — không được siết nhầm sang cả hai.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

// Kho ghi ra thư mục tạm (NODE_TEST_CONTEXT), nên bài này không đụng .data thật.
process.env.GROKBOT2_ALLOW_WRITE = "1";
const { runWithOwner: as } = await import("./request-context.js");
const { hostSettings, patchHostSettings } = await import("./host-settings.js");

test("hai người, hai múi giờ, không đè nhau", () => {
  as("user-A", () => patchHostSettings({ userTimeZone: "Asia/Ho_Chi_Minh" }));
  as("user-B", () => patchHostSettings({ userTimeZone: "America/New_York" }));

  assert.equal(as("user-A", () => hostSettings().userTimeZone), "Asia/Ho_Chi_Minh");
  assert.equal(as("user-B", () => hostSettings().userTimeZone), "America/New_York", "B không được mang giờ của A");
});

test("cài đặt máy (không thuộc PER_USER_KEYS) vẫn dùng chung", () => {
  as("user-A", () => patchHostSettings({ localToolPermission: "allow" }));
  // B chưa đặt gì cho khoá này → thấy giá trị A vừa đặt, vì đây là cài đặt của MÁY.
  assert.equal(as("user-B", () => hostSettings().localToolPermission), "allow");
});

test("notifications cũng theo người", () => {
  as("user-A", () => patchHostSettings({ notifications: { isEnabled: true } }));
  as("user-B", () => patchHostSettings({ notifications: { isEnabled: false } }));
  assert.deepEqual(as("user-A", () => hostSettings().notifications), { isEnabled: true });
  assert.deepEqual(as("user-B", () => hostSettings().notifications), { isEnabled: false });
});
