/**
 * Điều khiển desktop của box — xem desktop.ts và docs/plan/desktop-computer-use.md.
 *
 * Bản thân driver phải chạy trên X11 thật nên được kiểm bằng tay (screen_info, di chuột rồi đọc lại
 * toạ độ, chụp màn hình). Chỗ đáng ghim ở đây là phần **đọc đối số**, vì hai lỗi nguy hiểm nhất của
 * nó đều im lặng: một `click` thiếu toạ độ vẫn chạy trót lọt và bấm vào chỗ con trỏ tình cờ đang
 * đứng, còn một action lạ chỉ lộ ra sau một vòng mạng tới box.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDesktopArg, isDesktopLook } from "./desktop.js";

const ok = (r: ReturnType<typeof parseDesktopArg>) => {
  assert.ok(!("error" in r), `mong đợi hợp lệ, nhận: ${"error" in r ? r.error : ""}`);
  return r as Exclude<typeof r, { error: string }>;
};

test("một click đọc ra đúng toạ độ", () => {
  const a = ok(parseDesktopArg('{"action":"click","x":100,"y":200}'));
  assert.equal(a.action, "click");
  assert.equal(a.x, 100);
  assert.equal(a.y, 200);
});

test("click thiếu toạ độ bị chặn ở đây, không gửi tới box", () => {
  const r = parseDesktopArg('{"action":"click"}');
  assert.ok("error" in r && /cần "x" và "y"/.test(r.error),
    "thiếu x/y mà vẫn chạy thì chuột bấm vào chỗ nó tình cờ đang đứng — sai mà không ai biết");
});

test("action lạ bị từ chối kèm danh sách action có thật", () => {
  const r = parseDesktopArg('{"action":"double_click","x":1,"y":2}');
  assert.ok("error" in r);
  assert.match((r as { error: string }).error, /mouse_move/, "model phải đọc được nó có thể dùng gì");
});

test("drag phải có điểm thả, type phải có chữ, key phải có phím", () => {
  assert.ok("error" in parseDesktopArg('{"action":"drag","x":1,"y":2}'));
  assert.ok("error" in parseDesktopArg('{"action":"type"}'));
  assert.ok("error" in parseDesktopArg('{"action":"key"}'));
  ok(parseDesktopArg('{"action":"drag","x":1,"y":2,"to_x":9,"to_y":9}'));
  ok(parseDesktopArg('{"action":"type","text":"xin chào"}'));
  ok(parseDesktopArg('{"action":"key","key":"ctrl+s"}'));
});

test("action không cần toạ độ thì không đòi toạ độ", () => {
  for (const act of ["screenshot", "cursor_position", "screen_info"]) {
    assert.equal(ok(parseDesktopArg(`{"action":"${act}"}`)).action, act);
  }
});

/** Model hay gửi tên trần thay vì JSON; bắt nó viết lại một vòng chỉ để thêm dấu ngoặc là phí. */
test("một tên trần vẫn hiểu được", () => {
  assert.equal(ok(parseDesktopArg("screenshot")).action, "screenshot");
  assert.equal(ok(parseDesktopArg('"screenshot"')).action, "screenshot");
});

test("scroll nhận dy dưới cả hai tên model hay dùng", () => {
  assert.equal(ok(parseDesktopArg('{"action":"scroll","dy":-3}')).dy, -3);
  assert.equal(ok(parseDesktopArg('{"action":"scroll","amount":5}')).dy, 5);
});

/**
 * Nhìn thì tự chạy, bấm thì hỏi. Ranh giới này khác `browser_*` một cách cố ý: thao tác trình
 * duyệt bị giới hạn trong một trang, còn một cú click trên desktop không bị giới hạn bởi gì cả.
 */
test("chỉ hành động nhìn mới được duyệt sẵn", () => {
  assert.equal(isDesktopLook('{"action":"screenshot"}'), true);
  assert.equal(isDesktopLook('{"action":"cursor_position"}'), true);
  assert.equal(isDesktopLook('{"action":"screen_info"}'), true);
  assert.equal(isDesktopLook('{"action":"click","x":1,"y":2}'), false);
  assert.equal(isDesktopLook('{"action":"type","text":"rm -rf /"}'), false);
});

/**
 * Một màn hình, nhiều bot.
 *
 * `browser_*` chịu được nhiều bot cùng chạy vì mỗi bot có tab riêng và CDP không cần tab nằm trên
 * cùng. `computer_use` thì bấm vào cửa sổ đang ở trên cùng — của bất kỳ ai. Chuyện này đã xảy ra
 * thật: một bot đang đọc trang Shopee bị bot khác gõ chữ vào đúng tab đó, và không có lỗi nào nổi
 * lên vì mọi thao tác đều "thành công", chỉ là trúng cửa sổ của người khác.
 */
test("chỉ một bot cầm màn hình tại một thời điểm", async (t) => {
  const { claimDesktop, releaseDesktop, desktopHeldBy } = await import("./desktop.js");
  releaseDesktop(desktopHeldBy() ?? "");
  t.after(() => releaseDesktop(desktopHeldBy() ?? ""));

  assert.deepEqual(claimDesktop("bot-a"), { ok: true });
  assert.deepEqual(claimDesktop("bot-b"), { ok: false, heldBy: "bot-a" },
    "bot thứ hai phải bị từ chối kèm tên bot đang giữ, để nó nói lại được với người dùng");
  assert.deepEqual(claimDesktop("bot-a"), { ok: true }, "chính chủ gọi lại thì không tự chặn mình");
  assert.equal(desktopHeldBy(), "bot-a");

  releaseDesktop("bot-b");
  assert.equal(desktopHeldBy(), "bot-a", "bot khác không nhả hộ được");
  releaseDesktop("bot-a");
  assert.equal(desktopHeldBy(), null);
  assert.deepEqual(claimDesktop("bot-b"), { ok: true }, "nhả rồi thì người sau vào được");
  releaseDesktop("bot-b");
});
