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
import { slotOf, allSlots, freeSlot, perBotDisplays, displayOf, profileDirOf } from "./displays.js";

/*
 * Hồ sơ Chrome thuộc về BOT, không thuộc về slot — và bài này là chỗ giữ điều đó.
 *
 * Bản trước đặt hồ sơ trong thư mục slot, mà `teardown` `rm -rf` cả thư mục ấy sau 10 phút nghỉ.
 * Nghĩa là chủ đăng nhập Shopee trong màn của bot thì mười phút sau phiên bị xoá sạch, và lần sau
 * bot nhận slot khác lại là một hồ sơ khác nữa. Không có bài đo nào bắt được, vì cả hai đường đều
 * "chạy" — chỉ là phiên đăng nhập lặng lẽ biến mất.
 */
test("hồ sơ Chrome đi theo BOT, không theo slot", () => {
  const a = profileDirOf("agent-11"), b = profileDirOf("agent-12");
  assert.notEqual(a, b, "hai bot hai hồ sơ");
  assert.equal(profileDirOf("agent-11"), a, "cùng một bot thì luôn cùng một hồ sơ, dù nhận slot nào");
  for (const s of allSlots()) {
    assert.ok(!a.startsWith(s.dir), `hồ sơ không được nằm trong thư mục slot ${s.dir} — teardown xoá chỗ đó`);
  }
});

test("id bot lạ không thoát ra khỏi thư mục hồ sơ", () => {
  // `agentId` đi từ client. Một dấu `/` hay `..` lọt vào đây là ghi ra ngoài home của người dùng.
  assert.ok(!profileDirOf("../../etc/passwd").includes(".."));
  assert.ok(!profileDirOf("a/b").includes("/b/"));
});

test("slot là một cặp (display, cổng) suy ra được, không phải cấp phát tự do", () => {
  const a = slotOf(0), b = slotOf(3);
  assert.equal(a.display, ":521");
  assert.equal(a.cdpPort, 9301);
  assert.equal(b.display, ":524");
  assert.equal(b.cdpPort, 9304, "cổng thứ tư phải khớp -Slots 4 của đường hầm");
  assert.ok(!("profileDir" in a), "hồ sơ KHÔNG thuộc slot — xem bài dưới");
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
