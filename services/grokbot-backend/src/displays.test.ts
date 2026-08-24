/**
 * Sổ cấp màn hình theo bot — xem displays.ts.
 *
 * Phần dựng/thu phải chạy trên box thật nên được kiểm bằng e2e. Chỗ ghim ở đây là **phép chọn
 * slot**, vì slot không phải con số tuỳ ý: mỗi slot là một cặp (display, cổng CDP) mà đường hầm SSH
 * đã mở TRƯỚC (`box-tunnel.ps1 -Slots`). Cấp lệch một slot là cấp cho bot một con Chrome mà backend
 * không với tới — và nó sẽ trông như "box hỏng", không như "lệch cấu hình".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { slotOf, allSlots, freeSlot, perBotDisplays, displayOf } from "./displays.js";

test("slot là một cặp (display, cổng) suy ra được, không phải cấp phát tự do", () => {
  const a = slotOf(0), b = slotOf(3);
  assert.equal(a.display, ":521");
  assert.equal(a.cdpPort, 9301);
  assert.equal(b.display, ":524");
  assert.equal(b.cdpPort, 9304, "cổng thứ tư phải khớp -Slots 4 của đường hầm");
  assert.ok(a.profileDir.includes("521"), "hồ sơ mang số display để /admin nối được Chrome về màn hình");
});

test("số slot khớp trần cấu hình", () => {
  const all = allSlots();
  assert.equal(all.length, 4);
  assert.deepEqual(all.map((s) => s.cdpPort), [9301, 9302, 9303, 9304]);
  assert.deepEqual(all.map((s) => s.display), [":521", ":522", ":523", ":524"]);
});

test("chọn slot rảnh đầu tiên, kể cả khi lỗ trống nằm ở giữa", () => {
  assert.equal(freeSlot([])?.index, 0);
  assert.equal(freeSlot([0])?.index, 1);
  assert.equal(freeSlot([0, 2])?.index, 1, "slot đã thu ở giữa phải được dùng lại, không bỏ trống");
  assert.equal(freeSlot([0, 1, 2])?.index, 3);
});

/**
 * Hết slot là trạng thái BÌNH THƯỜNG của một box 22 GB, không phải lỗi. Người gọi nhận null và phải
 * quay về màn hình dùng chung — nếu nó ném lỗi thì bot thứ năm mất hẳn khả năng dùng trình duyệt.
 */
test("hết slot thì trả null, không ném lỗi", () => {
  assert.equal(freeSlot([0, 1, 2, 3]), null);
  assert.equal(freeSlot([0, 1, 2, 3, 9]), null);
});

/**
 * Tính chất an toàn quan trọng nhất của cả thay đổi này: khi cờ tắt, đường đang chạy tốt cho mọi bot
 * không đổi một byte. `browser.ts` hỏi `displayOf` trên mỗi lệnh, nên nếu nó trả về gì đó khi cờ tắt
 * thì mọi bot lập tức bị chuyển sang một Chrome không tồn tại.
 */
test("cờ tắt thì không bot nào có màn hình riêng", () => {
  assert.equal(perBotDisplays(), false, "mặc định phải là tắt");
  assert.equal(displayOf("agent-1"), null);
  assert.equal(displayOf(""), null);
});
