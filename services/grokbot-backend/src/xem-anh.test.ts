/**
 * `view_image` và số khung của `watch_video` — hai thứ chặn buổi dạy bằng video.
 *
 *   npx tsx --test services/grokbot-backend/src/xem-anh.test.ts
 *
 * Đo 01/09 bằng một buổi demo thật: bot xem 6 khung của clip 75 giây, thấy "chưa đủ để đọc ra từng
 * thao tác", tự trích 25 khung ghép thành `sheet.png` — rồi tắc vì không mở được ảnh của chính mình.
 * Mọi bước đều "thành công" và kết quả vẫn là không học được gì.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "./runtime/tools.js";

const ctxGia = () => {
  const daThay: string[] = [];
  return { ctx: { agentId: "agent-xem", see: (u: string) => daThay.push(u), attach: () => {} } as never, daThay };
};

test("view_image có mặt, và tách bạch với attach_image", () => {
  // `attach_image` TẢI ảnh từ web rồi gửi cho NGƯỜI DÙNG xem; `view_image` mở ảnh trên box và đặt
  // trước mắt CHÍNH MODEL. Trộn hai việc là bot gửi rác cho người dùng mỗi lần nó muốn tự nhìn.
  assert.equal(typeof TOOLS.view_image, "function");
  assert.equal(typeof TOOLS.attach_image, "function");
});

test("thiếu đường dẫn thì nói cần gì, không im lặng", async () => {
  const { ctx } = ctxGia();
  const r = await TOOLS.view_image("{}", ctx);
  assert.match(String(r), /view_image cần/);
});

test("chưa nối box thì nói ra, không ném", async () => {
  const cu = process.env.GROKBOT2_BOX_EXEC_URL;
  const cu2 = process.env.GROKBOT2_COMPUTER_URL;
  delete process.env.GROKBOT2_BOX_EXEC_URL;
  delete process.env.GROKBOT2_COMPUTER_URL;
  try {
    const { ctx, daThay } = ctxGia();
    const r = await TOOLS.view_image('{"path":"a.png"}', ctx);
    assert.match(String(r), /Chưa nối máy tính/);
    assert.equal(daThay.length, 0, "không có box thì không được đặt gì trước mắt model");
  } finally {
    if (cu != null) process.env.GROKBOT2_BOX_EXEC_URL = cu;
    if (cu2 != null) process.env.GROKBOT2_COMPUTER_URL = cu2;
  }
});
