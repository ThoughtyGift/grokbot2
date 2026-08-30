/**
 * Hàng rào của proxy ảnh — `getMcpPluginLogo` nhận URL từ CATALOG, tức từ ngoài.
 *
 *   npx tsx --test services/grokbot-backend/src/anh-cho-client.test.ts
 *
 * Một proxy tải ảnh là thứ dễ biến thành cửa dò mạng nội bộ nhất: client đưa `url`, host đi tải,
 * và nếu không ai chặn thì `http://192.168.1.1/` hay `http://localhost:8788/` cũng tải được — từ
 * bên trong mạng của người dùng. Đây không phải lo xa: hàng rào ấy đã phải viết một lần cho
 * `attach_image`, và file này dùng lại đúng hàm đó thay vì viết bản thứ hai (một hàng rào có hai
 * bản là một bản sẽ lạc hậu mà không ai biết).
 *
 * Bài kiểm ở đây chỉ đi qua các nhánh KHÔNG cần mạng: giao thức sai, URL hỏng, tên nội bộ. Nhánh
 * tải thật thuộc về đo tay — một test đi ra Internet là một test sẽ đỏ vào ngày mạng chậm.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { taiAnh } from "./anh-cho-client.js";

test("giao thức không phải http/https thì từ chối", async () => {
  for (const u of ["file:///C:/Windows/win.ini", "ftp://example.com/a.png", "data:image/png;base64,AAAA"]) {
    assert.equal(await taiAnh(u), null, u);
  }
});

test("URL hỏng thì trả null, không ném", async () => {
  for (const u of ["", "   ", "khong-phai-url", "http://"]) {
    assert.equal(await taiAnh(u), null, JSON.stringify(u));
  }
});

test("địa chỉ nội bộ bị chặn — kể cả tên miền trỏ về nhà", async () => {
  // Không cần mạng: `isInternalHost` bắt các hậu tố này bằng chuỗi, trước cả khi phân giải DNS.
  for (const u of [
    "http://localhost:8788/gw/api/listAgents",
    "http://abc.localhost/logo.png",
    "http://nas.local/logo.png",
    "http://gateway.internal/logo.png",
  ]) {
    assert.equal(await taiAnh(u), null, u);
  }
});

test("không bao giờ ném — người gọi đổi null thành ảnh rỗng, không thành lỗi đỏ giữa form", async () => {
  // Cổng đóng: fetch sẽ hỏng. Điều đang khoá là nó hỏng thành `null` chứ không thành ngoại lệ.
  const r = await taiAnh("http://127.0.0.1:9/logo.png");
  assert.equal(r, null);
});

test("SVG bị loại dù cũng là image/* — nó chạy được script trong renderer", async () => {
  // Không cần mạng: data: đã bị chặn từ nhánh giao thức, và đây là bài ghi lại CHỦ Ý, để lần sau
  // ai đó "sửa cho đủ định dạng" thì thấy ngay vì sao SVG không nằm trong danh sách trắng.
  assert.equal(await taiAnh("data:image/svg+xml,<svg onload=alert(1)>"), null);
});
