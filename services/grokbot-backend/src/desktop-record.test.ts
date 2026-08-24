/**
 * Bản ghi thao tác desktop thành routine — xem desktop-record.ts.
 *
 * Bộ ghi chạy trên X11 của box nên được kiểm bằng e2e thật (scripts/e2e-desktop.mjs). Chỗ ghim ở
 * đây là câu chữ giao cho bot chạy lại, vì mọi sai sót của nó đều im lặng: một bước chỉ có toạ độ
 * mà không có mô tả sẽ được bấm y nguyên vào chỗ cũ, và nếu cửa sổ đã dịch chỗ thì nó bấm nhầm mà
 * vẫn báo thành công.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { desktopStepsToPrompt, IDLE, type DesktopStep } from "./desktop-record.js";

const steps = (...s: Partial<DesktopStep>[]): DesktopStep[] =>
  s.map((x, i) => ({ t: i * 1000, act: "click", ...x }) as DesktopStep);

test("một buổi dạy thành các bước đánh số mà bot làm theo được", () => {
  const out = desktopStepsToPrompt(steps(
    { act: "click", x: 300, y: 320, looks: "ô nhập 'Ten khach' nền trắng" },
    { act: "type", text: "Nguyen Van A" },
    { act: "click", x: 240, y: 425, looks: "nút xanh dương chữ trắng 'LUU HO SO'" },
    { act: "key", key: "Return" },
  ), { width: 1920, height: 1080 });
  assert.match(out, /1\. bấm vào "ô nhập 'Ten khach' nền trắng"/);
  assert.match(out, /2\. gõ "Nguyen Van A"/);
  assert.match(out, /3\. bấm vào "nút xanh dương chữ trắng 'LUU HO SO'"/);
  assert.match(out, /4\. bấm phím Return/);
  assert.match(out, /1920x1080/, "kích thước màn hình lúc dạy phải có, nếu không toạ độ vô nghĩa");
  assert.match(out, /DỪNG/, "không tìm thấy thì dừng, không đoán bước sau");
});

/**
 * Toạ độ được nêu, nhưng nêu như gợi ý. Nếu lời dặn để bot hiểu là "bấm vào (240,425)" thì cửa sổ
 * dịch mười pixel là hỏng — mà hỏng im lặng, vì cú bấm vẫn thành công, chỉ là trúng thứ khác.
 */
test("toạ độ cũ là gợi ý, và lời dặn nói rõ đừng tin nó", () => {
  const out = desktopStepsToPrompt(steps({ act: "click", x: 240, y: 425, looks: "nút Lưu" }));
  assert.match(out, /lúc dạy nó ở khoảng \(240, 425\)/);
  assert.match(out, /đừng bấm theo toạ độ nếu chỗ đó không phải thứ được mô tả/);
  assert.match(out, /chụp màn hình/, "mỗi bước phải nhìn trước khi bấm");
});

test("bước không tả được thì nói thẳng là không có mô tả", () => {
  const out = desktopStepsToPrompt(steps({ act: "click", x: 10, y: 20 }));
  assert.match(out, /không có mô tả/,
    "im lặng ở đây sẽ thành một bước trông y như các bước khác nhưng chỉ có toạ độ đỡ lưng");
});

test("không ghi được gì thì không sinh routine rỗng", () => {
  assert.equal(desktopStepsToPrompt([]), "");
  assert.equal(desktopStepsToPrompt(steps({ act: "type", text: "" })), "",
    "một bước gõ chuỗi rỗng cũng không phải việc gì để làm lại");
});

/** Lỗi thật đã mắc: `.filter(Boolean)` nuốt cả dòng trống, cả routine dính thành một khối chữ. */
test("danh sách bước tách khỏi phần dặn dò bằng dòng trống", () => {
  const out = desktopStepsToPrompt(steps({ act: "click", x: 1, y: 2, looks: "nút" }));
  const lines = out.split("\n");
  assert.ok(lines.some((l) => l === ""), "phải còn dòng trống ngăn cách");
  assert.equal(lines[1], "", "ngay sau câu mở đầu là một dòng trống");
});

test("cuộn ghi rõ lên hay xuống", () => {
  const out = desktopStepsToPrompt(steps(
    { act: "scroll", x: 500, y: 400, dy: -3 },
    { act: "scroll", x: 500, y: 400, dy: 3 },
  ));
  assert.match(out, /1\. cuộn lên tại \(500, 400\)/);
  assert.match(out, /2\. cuộn xuống tại \(500, 400\)/);
});

test("trạng thái nghỉ đúng hình dạng renderer nhận", () => {
  assert.deepEqual(IDLE, { state: "idle", agentId: null, startedAtMs: null, maxDurationMs: 600_000 });
});
