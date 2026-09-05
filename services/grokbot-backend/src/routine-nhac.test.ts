/**
 * Bot lên tiếng khi người dùng bấm trên bảng Routine — gom nhịp, chờ bot rảnh, lời nhắc im lặng.
 *
 *   pnpm --filter @grokbot2/backend test -- src/routine-nhac.test.ts
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { soanLoiNhac, taoNguoiNhac } from "./routine-nhac.js";

/** setTimeout giả: gom callback, `chay()` chạy hết hàng đợi hiện có. */
function dongHoGia() {
  const q: Array<() => void> = [];
  const st = ((fn: () => void) => { q.push(fn); return 0 as unknown as ReturnType<typeof setTimeout>; }) as unknown as typeof setTimeout;
  return { st, chay: () => { const ds = q.splice(0); for (const f of ds) f(); }, choDoi: () => q.length };
}

test("lời nhắc nói rõ đây là thao tác trên giao diện, đúng động từ, và gợi ý theo hành động CUỐI", () => {
  const s = soanLoiNhac([{ action: "disabled", name: "transcript-healthcheck", lich: "weekdays 8:44" }]);
  assert.match(s, /KHÔNG phải câu chat/);
  assert.match(s, /TẮT \(tạm dừng\) routine "transcript-healthcheck" \(weekdays 8:44\)/);
  assert.match(s, /hỏi có muốn bật lại không/);
  assert.match(s, /Không gọi công cụ/);
  const hai = soanLoiNhac([{ action: "enabled", name: "a" }, { action: "updated", name: "a", lich: "mỗi ngày 00:15" }]);
  assert.match(hai, /- BẬT lại routine "a"\n- SỬA routine "a" \(mỗi ngày 00:15\)/);
  assert.match(hai, /nói lại lịch hoặc nội dung MỚI/, "gợi ý theo hành động cuối (sửa), như app gốc trả một câu cho cả bật + sửa");
  assert.equal(soanLoiNhac([]), "");
});

test("gom nhịp: hai thao tác trong một nhịp → MỘT lời nhắc mang cả hai", () => {
  const dh = dongHoGia();
  const gui: Array<[string, string]> = [];
  const n = taoNguoiNhac({ gui: (a, c) => gui.push([a, c]), dangChay: () => false, setTimeoutFn: dh.st });
  n.ghi("agent-1", { action: "enabled", name: "x" });
  n.ghi("agent-1", { action: "updated", name: "x" });
  assert.equal(n.dangCho("agent-1"), 2);
  assert.equal(gui.length, 0, "chưa hết nhịp thì chưa gửi");
  dh.chay();
  assert.equal(gui.length, 1);
  assert.equal(gui[0][0], "agent-1");
  assert.match(gui[0][1], /BẬT lại routine "x"\n- SỬA routine "x"/);
  assert.equal(n.dangCho("agent-1"), 0);
});

test("bot đang giữa lượt → chờ, không cắt lượt; rảnh rồi mới gửi", () => {
  const dh = dongHoGia();
  const gui: string[] = [];
  let chay = true;
  const n = taoNguoiNhac({ gui: (_a, c) => gui.push(c), dangChay: () => chay, setTimeoutFn: dh.st });
  n.ghi("agent-2", { action: "deleted", name: "d" });
  dh.chay();
  assert.equal(gui.length, 0, "đang chạy thì không gửi");
  assert.equal(dh.choDoi(), 1, "đã hẹn lại");
  chay = false;
  dh.chay();
  assert.equal(gui.length, 1);
  assert.match(gui[0], /XOÁ routine "d"/);
});

test("chờ quá hạn thì bỏ, không nhắc chuyện cũ", () => {
  const dh = dongHoGia();
  const gui: string[] = [];
  const n = taoNguoiNhac({ gui: (_a, c) => gui.push(c), dangChay: () => true, setTimeoutFn: dh.st, choToiDaMs: -1 });
  n.ghi("agent-3", { action: "created", name: "c" });
  dh.chay();
  assert.equal(gui.length, 0);
  assert.equal(n.dangCho("agent-3"), 0, "đã bỏ hẳn");
  assert.equal(dh.choDoi(), 0, "không hẹn lại nữa");
});

test("hai bot khác nhau không gom chung", () => {
  const dh = dongHoGia();
  const gui: string[] = [];
  const n = taoNguoiNhac({ gui: (a) => gui.push(a), dangChay: () => false, setTimeoutFn: dh.st });
  n.ghi("a", { action: "enabled", name: "1" });
  n.ghi("b", { action: "enabled", name: "2" });
  dh.chay();
  assert.deepEqual(gui.sort(), ["a", "b"]);
});
