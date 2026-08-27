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

/*
 * ── Onboarding là chuyện của từng NGƯỜI ────────────────────────────────────────
 *
 * Đo trên máy thứ hai 27/08: người dùng mới bị app nhảy thẳng vào giao diện chính, **mất phần giới
 * thiệu mở đầu**. Truy ra `hasSeenOnboarding` là mặc định cứng `true` và dùng chung cho mọi người —
 * nên một backend đã chạy một thời gian nói với MỌI người mới rằng họ đã xem rồi.
 */
test("người MỚI chưa xem giới thiệu", () => {
  const s = as("auth0|nguoi-hoan-toan-moi", () => hostSettings());
  assert.equal(s.hasSeenOnboarding, false,
    "người chưa có slice nào phải được coi là chưa xem — nếu không app cắt mất phần mở đầu");
});

test("xem xong thì chỉ NGƯỜI ĐÓ được nhớ, người khác vẫn được xem", () => {
  as("auth0|nguoi-A", () => patchHostSettings({ hasSeenOnboarding: true }));
  assert.equal(as("auth0|nguoi-A", () => hostSettings()).hasSeenOnboarding, true, "A đã xem");
  assert.equal(as("auth0|nguoi-B", () => hostSettings()).hasSeenOnboarding, false,
    "B chưa xem — A xem xong không được cướp mất phần mở đầu của B");
});
