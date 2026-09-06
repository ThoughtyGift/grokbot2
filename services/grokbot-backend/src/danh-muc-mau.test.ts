/**
 * Danh mục bot mẫu — chín bot, một bot mỗi nhóm, và luật validator client 0.43 (mọi chuỗi phải có chữ).
 * `loiDanhMuc` là hàng rào chung của test và script dựng: một mẫu hỏng ở đây rẻ hơn một mẫu client nuốt im lặng.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DANH_MUC, loiDanhMuc } from "./danh-muc-mau.js";
import { CATEGORIES } from "./marketplace.js";

test("danh mục sạch theo luật validator: 0 lỗi", () => {
  assert.deepEqual(loiDanhMuc(), []);
});

test("mỗi nhóm Marketplace có đúng một bot, tổng 9", () => {
  assert.equal(DANH_MUC.length, CATEGORIES.length);
  for (const c of CATEGORIES) assert.equal(DANH_MUC.filter((b) => b.category === c).length, 1, `nhóm ${c}`);
});

test("hàng Featured có 3 bot (cộng Thợ dựng bot = 4 thẻ như hãng)", () => {
  assert.equal(DANH_MUC.filter((b) => b.featured).length, 3);
});

test("skill có {input} hoặc mô tả bước cụ thể; không hứa kết nối đã nối", () => {
  for (const b of DANH_MUC) {
    for (const s of b.skills) assert.ok(s.instructions.includes("{input}"), `${b.name}/${s.name} thiếu {input}`);
    assert.match(b.sop, /kết nối chưa có thì nói rõ/);
  }
});

test("loiDanhMuc bắt trường rỗng, nhóm lạ, trùng tên", () => {
  const hong = [
    { ...DANH_MUC[0], skills: [{ name: "a", description: "", instructions: "x {input}" }, { name: "a", description: "y", instructions: "z" }] },
    { ...DANH_MUC[1], name: DANH_MUC[0].name, category: "khong-co" as never },
  ];
  const loi = loiDanhMuc(hong);
  assert.ok(loi.some((l) => /trường rỗng/.test(l)));
  assert.ok(loi.some((l) => /trùng tên skill/.test(l)));
  assert.ok(loi.some((l) => /trùng tên bot/.test(l)));
  assert.ok(loi.some((l) => /nhóm lạ/.test(l)));
});
