/**
 * Khoá phần `bloub` mà FE thật sự dùng.
 *
 *   npx tsx --test apps/grokbot-web/src/avatar.test.ts
 *
 * Bộ test của họ không được chép sang (chạy bằng `vitest`, workspace này không có). Đổi lại, đây
 * là hợp đồng tối thiểu: nếu nâng vendor lên commit mới mà một trong những điều dưới đây gãy thì
 * avatar hỏng, và hỏng theo kiểu **im lặng** — một SVG rỗng vẫn render ra một ô trống trông như
 * "bot này chưa có ảnh".
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AVATAR_COLORS, AVATAR_SHAPES, botAvatarSvg, pickFor } from "./avatar.js";

test("bảng hình và màu đúng số lượng bản gốc", () => {
  assert.equal(AVATAR_SHAPES.length, 8);
  assert.equal(AVATAR_COLORS.length, 12);
  for (const hex of AVATAR_COLORS) assert.match(hex, /^#[0-9a-f]{6}$/i);
});

test("cùng id ⇒ cùng lựa chọn, khác id ⇒ (gần như luôn) khác", () => {
  assert.deepEqual(pickFor("agent-7"), pickFor("agent-7"));
  const picks = new Set<string>();
  for (let i = 1; i <= 40; i++) {
    const p = pickFor(`agent-${i}`);
    picks.add(`${p.shape % 8}/${p.expression % 16}/${p.color % 12}`);
  }
  // 40 bot trên 8×16×12 = 1536 tổ hợp: vài lần trùng là bình thường, dồn cục thì không.
  assert.ok(picks.size >= 34, `chỉ ${picks.size}/40 tổ hợp khác nhau — băm đang dồn cục`);
});

test("SVG có thân, có hai mắt, và không rỗng", () => {
  const svg = botAvatarSvg("agent-1");
  assert.match(svg, /^<svg viewBox="-158 -158 316 316"/);
  const paths = svg.match(/<path /g) ?? [];
  // 1 thân + 2 mắt. Ít hơn nghĩa là engine trả khung rỗng.
  assert.equal(paths.length, 3, svg.slice(0, 200));
  assert.ok(svg.includes("</svg>"));
  assert.ok(svg.length > 300, `SVG chỉ ${svg.length} ký tự — nhiều khả năng thân rỗng`);
});

test("mắt chọn theo màu THÂN, không theo nền trang", () => {
  // Thân tối ⇒ mắt sáng; thân sáng ⇒ mắt tối. Luật này sống qua mọi lần đổi theme.
  assert.ok(botAvatarSvg("agent-1", { colorHex: "#0a0a0c" }).includes('fill="#f9f9f9"'), "thân đen phải có mắt sáng");
  assert.ok(botAvatarSvg("agent-1", { colorHex: "#f1efe9" }).includes('fill="#0a0a0c"'), "thân kem phải có mắt tối");
  assert.ok(botAvatarSvg("agent-1", { eyeMode: "hole" }).includes("<mask"));
});

test("ghi đè hình và màu có tác dụng", () => {
  const a = botAvatarSvg("agent-1", { shapeId: "triangle", colorHex: "#e8483f" });
  const b = botAvatarSvg("agent-1", { shapeId: "cercle", colorHex: "#e8483f" });
  assert.ok(a.includes('fill="#e8483f"'));
  assert.notEqual(a, b, "đổi hình mà đường dẫn thân không đổi");
});

test("màu suy từ id không bao giờ tàng hình trên nền shell", () => {
  // Nền `#070707`: màu biến mất là `encre #0a0a0c`. (Trên nền giấy thì ngược lại — nên luật tính
  // bằng tương phản với `SHELL`, không bằng ngưỡng sáng/tối cố định.)
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const m = /<path d="[^"]*" fill="(#[0-9a-f]{6})"/i.exec(botAvatarSvg(`agent-${i}`));
    if (m) seen.add(m[1]!.toLowerCase());
  }
  assert.ok(!seen.has("#0a0a0c"), "nhánh suy từ id vẫn bốc được màu chìm vào nền");
  assert.ok(seen.size >= 8, `chỉ ${seen.size} màu xuất hiện trong 300 bot`);
  // Nhưng chọn tay thì vẫn phải cho phép.
  assert.ok(botAvatarSvg("agent-1", { colorHex: "#0a0a0c" }).includes('fill="#0a0a0c"'));
});

test("id lạ không làm vỡ", () => {
  for (const id of ["", "agent-999999999", "bot với dấu tiếng Việt", "🙂"]) {
    assert.match(botAvatarSvg(id), /^<svg /);
  }
});
